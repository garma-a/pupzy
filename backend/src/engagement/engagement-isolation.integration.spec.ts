import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import DataLoader from 'dataloader';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  blocks,
  cities,
  commentBoosts,
  comments,
  postSaves,
  postUpvotes,
  posts,
  users,
  type City,
  type Comment,
  type Post,
  type User,
} from '../database/schema';
import { PostsRepository } from '../posts/posts.repository';
import { PostsService } from '../posts/posts.service';
import { PostsResolver } from '../posts/posts.resolver';
import { CommentsRepository } from '../comments/comments.repository';
import { CommentsService } from '../comments/comments.service';
import { CommentsResolver } from '../comments/comments.resolver';
import { AccountIsolationPolicy, canonicalAccountPairKey } from '../blocks/account-isolation.policy';
import { CitiesRepository } from '../cities/cities.repository';
import { UsersRepository } from '../users/users.repository';
import { CitiesService } from '../cities/cities.service';
import { UsersService } from '../users/users.service';
import { UploadService } from '../upload/upload.service';
import { ViewFlushCron } from '../posts/view-flush.cron';
import { NotificationsService } from '../notifications/notifications.service';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import type { GqlContext } from '../common/types/gql-context.type';

const NONEXISTENT_POST_ID = '0192ffff-0000-7000-8000-000000000000';
const NONEXISTENT_COMMENT_ID = '0192ffff-0000-7000-8000-000000000001';

const TOGGLE_UPVOTE = `mutation ToggleUpvote($postId: ID!) {
  toggleUpvote(postId: $postId) { id upvoteCount saveCount isUpvotedByMe isSavedByMe }
}`;

const TOGGLE_SAVE = `mutation ToggleSave($postId: ID!) {
  toggleSave(postId: $postId) { id upvoteCount saveCount isUpvotedByMe isSavedByMe }
}`;

const TOGGLE_BOOST = `mutation ToggleBoost($commentId: ID!) {
  toggleCommentBoost(commentId: $commentId) { commentId isBoostedByMe boostedByMe boostCount }
}`;

const POST_FLAGS = `query PostFlags($ids: [ID!]!) {
  countedPosts(ids: $ids) { id upvoteCount saveCount isUpvotedByMe isSavedByMe }
}`;

const COMMENT_FLAGS = `query CommentFlags($ids: [ID!]!) {
  commentsByIds(ids: $ids) { id boostCount isBoostedByMe }
}`;

const MY_SAVED_POSTS = `query Saved($first: Int) {
  mySavedPosts(first: $first) {
    edges { node { id } }
    pageInfo { hasNextPage endCursor }
  }
}`;

interface TogglePostPayload {
  id: string;
  upvoteCount: number;
  saveCount: number;
  isUpvotedByMe: boolean;
  isSavedByMe: boolean;
}

interface ToggleBoostPayload {
  commentId: string;
  isBoostedByMe: boolean;
  boostedByMe: boolean;
  boostCount: number;
}

interface PostFlagPayload {
  id: string;
  upvoteCount: number;
  saveCount: number;
  isUpvotedByMe: boolean;
  isSavedByMe: boolean;
}

interface CommentFlagPayload {
  id: string;
  boostCount: number;
  isBoostedByMe: boolean;
}

interface SavedPostsPage {
  edges: Array<{ node: { id: string } }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

describe('Engagement account isolation (Ticket 08)', () => {
  jest.setTimeout(180_000);

  let dbHelper: TestDatabaseHelper;
  let executableSchema: GraphQLSchema;
  let postsRepository: PostsRepository;
  let postsService: PostsService;
  let postsResolver: PostsResolver;
  let commentsRepository: CommentsRepository;
  let commentsService: CommentsService;
  let commentsResolver: CommentsResolver;
  let isolationPolicy: AccountIsolationPolicy;
  let citiesService: CitiesService;
  let usersService: UsersService;
  let uploadService: UploadService;
  let viewFlushCron: ViewFlushCron;
  let notificationsService: NotificationsService;
  let mockCache: Cache;

  let testCity: City;
  let viewer: User;
  let author: User;
  let other: User;
  let poster: User;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    const cacheStore = new Map<string, unknown>();
    mockCache = {
      get: jest.fn((key: string) => Promise.resolve(cacheStore.get(key))),
      set: jest.fn((key: string, value: unknown) => {
        cacheStore.set(key, value);
        return Promise.resolve();
      }),
      del: jest.fn((key: string) => {
        cacheStore.delete(key);
        return Promise.resolve();
      }),
      reset: jest.fn(() => {
        cacheStore.clear();
        return Promise.resolve();
      }),
    } as unknown as Cache;

    const mockConfig = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'PHONE_ENCRYPTION_KEY':
            return '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
          default:
            return undefined;
        }
      }),
    } as unknown as ConfigService;

    const citiesRepo = new CitiesRepository(dbHelper.db);
    const usersRepo = new UsersRepository(dbHelper.db);
    postsRepository = new PostsRepository(dbHelper.db);
    commentsRepository = new CommentsRepository(dbHelper.db);
    isolationPolicy = new AccountIsolationPolicy(dbHelper.db);

    citiesService = new CitiesService(citiesRepo, mockCache);
    usersService = new UsersService(usersRepo, citiesService, mockConfig, mockCache);
    uploadService = new UploadService(mockConfig, mockCache, dbHelper.db);
    viewFlushCron = new ViewFlushCron(postsRepository, mockCache);
    notificationsService = {
      fireNotification: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService;

    postsService = new PostsService(
      postsRepository,
      citiesService,
      uploadService,
      viewFlushCron,
      usersService,
      notificationsService,
      mockCache,
    );
    commentsService = new CommentsService(
      commentsRepository,
      postsRepository,
      uploadService,
      mockConfig,
      undefined,
      undefined,
      usersService,
      isolationPolicy,
    );

    postsResolver = new PostsResolver(postsService);
    commentsResolver = new CommentsResolver(commentsService);

    const schemaFiles = [
      'src/common/graphql/enums.graphql',
      'src/users/users.graphql',
      'src/cities/cities.graphql',
      'src/posts/posts-enums.graphql',
      'src/posts/posts.graphql',
      'src/mating/mating.graphql',
      'src/comments/comments.graphql',
      'src/notifications/notifications.graphql',
      'src/contacts/contacts.graphql',
      'src/adoptions/adoptions.graphql',
    ];
    const typeDefs = [
      ...schemaFiles.map((relPath) => fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf8')),
      `extend type Query {
        countedPosts(ids: [ID!]!): [Post!]!
        commentsByIds(ids: [ID!]!): [Comment!]!
      }`,
    ];

    executableSchema = makeExecutableSchema({
      typeDefs,
      resolvers: {
        DateTime: {
          __parseValue: (value: unknown) => value,
          __serialize: (value: unknown) => (value instanceof Date ? value.toISOString() : value),
        },
        Query: {
          mySavedPosts: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) =>
            postsResolver.mySavedPosts(args, ctx),
          // Test-only list seam mirroring ticket 07: returns Post nodes without
          // going through feed filtering, so viewer-specific field resolvers can
          // be observed on content a Block otherwise hides.
          countedPosts: (_root: unknown, args: { ids: string[] }) =>
            dbHelper.db.select().from(posts).where(inArray(posts.id, args.ids)),
          commentsByIds: (_root: unknown, args: { ids: string[] }) =>
            dbHelper.db.select().from(comments).where(inArray(comments.id, args.ids)),
        },
        Mutation: {
          toggleUpvote: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.toggleUpvote(args.postId, ctx),
          toggleSave: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.toggleSave(args.postId, ctx),
          toggleCommentBoost: (_root: unknown, args: { commentId: string }, ctx: GqlContext) =>
            commentsResolver.toggleCommentBoost(args.commentId, ctx),
        },
        Post: {
          isUpvotedByMe: (root: Post, _args: unknown, ctx: GqlContext) => postsResolver.isUpvotedByMe(root, ctx),
          isSavedByMe: (root: Post, _args: unknown, ctx: GqlContext) => postsResolver.isSavedByMe(root, ctx),
        },
        Comment: {
          isBoostedByMe: (root: Comment, _args: unknown, ctx: GqlContext) => commentsResolver.isBoostedByMe(root, ctx),
          boostCount: (root: Comment) => commentsResolver.boostCount(root),
        },
      },
    });
  });

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();

    const [city] = await dbHelper.db
      .insert(cities)
      .values({
        nameEnglish: 'Cairo',
        nameArabic: 'القاهرة',
        governorate: 'Cairo',
        status: 'OFFICIAL',
        centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    testCity = city;

    viewer = await insertUser('viewer');
    author = await insertUser('author');
    other = await insertUser('other');
    poster = await insertUser('poster');
  });

  async function insertUser(label: string): Promise<User> {
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${label}-${generateUuidV7()}`,
        email: `${label}-${generateUuidV7()}@pupzy.dev`,
        fullName: `Engagement ${label}`,
      })
      .returning();
    return user;
  }

  async function seedPost(creatorId: string, effectiveScore = 0): Promise<Post> {
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId,
        postType: 'RESCUE',
        title: `Engagement isolation ${generateUuidV7().slice(-6)}`,
        description: 'Engagement isolation fixture',
        status: 'ACTIVE',
        urgency: 'URGENT',
        cityId: testCity.id,
        governorate: testCity.governorate,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
        effectiveScore,
      })
      .returning();
    return post;
  }

  async function seedComment(params: {
    postId: string;
    authorId: string;
    text: string;
    parentId?: string | null;
  }): Promise<Comment> {
    const [comment] = await dbHelper.db
      .insert(comments)
      .values({
        postId: params.postId,
        authorId: params.authorId,
        parentId: params.parentId ?? null,
        text: params.text,
        status: 'ACTIVE',
      })
      .returning();
    return comment;
  }

  async function setBlock(blocker: User, blocked: User): Promise<void> {
    await dbHelper.db.delete(blocks);
    await dbHelper.db.insert(blocks).values({ blockerId: blocker.id, blockedId: blocked.id });
  }

  async function clearBlocks(): Promise<void> {
    await dbHelper.db.delete(blocks);
  }

  async function storedPost(postId: string): Promise<Post> {
    const [post] = await dbHelper.db.select().from(posts).where(eq(posts.id, postId));
    return post;
  }

  async function storedComment(commentId: string): Promise<Comment> {
    const [comment] = await dbHelper.db.select().from(comments).where(eq(comments.id, commentId));
    return comment;
  }

  async function countUpvote(postId: string, userId: string): Promise<number> {
    const rows = await dbHelper.db
      .select({ postId: postUpvotes.postId })
      .from(postUpvotes)
      .where(and(eq(postUpvotes.postId, postId), eq(postUpvotes.userId, userId)));
    return rows.length;
  }

  async function countSave(postId: string, userId: string): Promise<number> {
    const rows = await dbHelper.db
      .select({ postId: postSaves.postId })
      .from(postSaves)
      .where(and(eq(postSaves.postId, postId), eq(postSaves.userId, userId)));
    return rows.length;
  }

  async function countBoost(commentId: string, userId: string): Promise<number> {
    const rows = await dbHelper.db
      .select({ id: commentBoosts.id })
      .from(commentBoosts)
      .where(and(eq(commentBoosts.commentId, commentId), eq(commentBoosts.userId, userId)));
    return rows.length;
  }

  function createContext(user?: User): GqlContext {
    const userLoader = new DataLoader<string, User | null>(async (ids: readonly string[]) => {
      const rows = await dbHelper.db
        .select()
        .from(users)
        .where(inArray(users.id, ids as string[]));
      const map = new Map(rows.map((row) => [row.id, row]));
      return ids.map((id) => map.get(id) ?? null);
    });

    return {
      req: {} as unknown as GqlContext['req'],
      user,
      loaders: {
        cityById: citiesService.createCityByIdLoader(),
        userById: userLoader,
        mediaByPostId: postsRepository.createMediaByPostIdLoader(),
        upvotedByMe: postsRepository.createUpvotedByMeLoader(),
        savedByMe: postsRepository.createSavedByMeLoader(),
        commentBoostedByMe: commentsRepository.createCommentBoostedByMeLoader(),
        pinnedCommentIdByPostId: commentsRepository.createPinnedCommentIdByPostIdLoader(),
        commentMediaByCommentId: commentsRepository.createCommentMediaByCommentIdLoader(),
        reachableCommentCountByPostId: commentsRepository.createReachableCommentCountByPostIdLoader(),
        reachableReplyCountByCommentId: commentsRepository.createReachableReplyCountByCommentIdLoader(),
      },
    };
  }

  function runGql<TData>(
    source: string,
    variables: Record<string, unknown>,
    user: User,
  ): Promise<ExecutionResult<TData>> {
    return graphql({
      schema: executableSchema,
      source,
      variableValues: variables,
      contextValue: createContext(user),
    }) as Promise<ExecutionResult<TData>>;
  }

  async function runMutation<TData>(source: string, variables: Record<string, unknown>, user: User): Promise<TData> {
    const result = await runGql<TData>(source, variables, user);
    expect(result.errors).toBeUndefined();
    return result.data!;
  }

  async function runRejected(source: string, variables: Record<string, unknown>, user: User): Promise<string> {
    const result = await runGql(source, variables, user);
    expect(result.data ?? null).toBeNull();
    expect(result.errors).toBeDefined();
    expect(result.errors).toHaveLength(1);
    return result.errors![0].message;
  }

  function neutralized(message: string, identifier: string): string {
    return message.split(identifier).join('<id>');
  }

  function savedPostIds(page: SavedPostsPage): string[] {
    return page.edges.map((edge) => edge.node.id);
  }

  async function postFlags(postId: string, user: User): Promise<PostFlagPayload> {
    const data = await runMutation<{ countedPosts: PostFlagPayload[] }>(POST_FLAGS, { ids: [postId] }, user);
    expect(data.countedPosts).toHaveLength(1);
    return data.countedPosts[0];
  }

  async function commentFlags(commentId: string, user: User): Promise<CommentFlagPayload> {
    const data = await runMutation<{ commentsByIds: CommentFlagPayload[] }>(COMMENT_FLAGS, { ids: [commentId] }, user);
    expect(data.commentsByIds).toHaveLength(1);
    return data.commentsByIds[0];
  }

  async function waitForUngrantedAdvisoryLock(classId: number, objectId: number, minimum = 1): Promise<void> {
    for (let attempt = 0; attempt < 160; attempt += 1) {
      const { rows } = await dbHelper.pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM pg_locks
         WHERE locktype = 'advisory' AND NOT granted AND classid = $1 AND objid = $2`,
        [classId, objectId],
      );
      if (Number(rows[0]?.count ?? 0) >= minimum) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('expected advisory lock contention was not observed');
  }

  async function deadlockCount(): Promise<number> {
    const { rows } = await dbHelper.pool.query<{ deadlocks: string | number }>(
      `SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`,
    );
    return Number(rows[0]?.deadlocks ?? 0);
  }

  async function withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return Promise.race([
      work,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)),
    ]);
  }

  /**
   * Commits a Block while an engagement write races it, exactly like
   * `blockUser` will: the raw session acquires the canonical pair lock, inserts
   * the Block, then the engagement mutation queues behind it.
   */
  async function commitBlockAheadOf(blocked: User, work: () => Promise<ExecutionResult<unknown>>) {
    const pairKey = canonicalAccountPairKey(viewer.id, blocked.id);
    const { rows } = await dbHelper.pool.query<{ classid: number; objid: number }>(
      `SELECT hashtext('account_pair')::int AS classid, hashtext($1)::int AS objid`,
      [pairKey],
    );
    const blocker = await dbHelper.pool.connect();
    let committed = false;
    try {
      await blocker.query('BEGIN');
      await blocker.query(`SELECT pg_advisory_xact_lock(hashtext('account_pair'), hashtext($1))`, [pairKey]);
      await blocker.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [viewer.id, blocked.id]);

      const pending = work();
      await waitForUngrantedAdvisoryLock(rows[0].classid, rows[0].objid);

      await blocker.query('COMMIT');
      committed = true;

      return await withTimeout(pending, 10_000, 'racing engagement write');
    } finally {
      if (!committed) await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
    }
  }

  it('non-isolated engagement keeps its mutation names, result shapes, and toggling behavior', async () => {
    const post = await seedPost(author.id);
    const comment = await seedComment({ postId: post.id, authorId: author.id, text: 'Boost me' });

    const upvote = await runMutation<{ toggleUpvote: TogglePostPayload }>(TOGGLE_UPVOTE, { postId: post.id }, viewer);
    expect(upvote.toggleUpvote).toMatchObject({ id: post.id, upvoteCount: 1, isUpvotedByMe: true });
    expect((await storedPost(post.id)).upvoteCount).toBe(1);

    const save = await runMutation<{ toggleSave: TogglePostPayload }>(TOGGLE_SAVE, { postId: post.id }, viewer);
    expect(save.toggleSave).toMatchObject({ id: post.id, saveCount: 1, isSavedByMe: true });

    const boost = await runMutation<{ toggleCommentBoost: ToggleBoostPayload }>(
      TOGGLE_BOOST,
      { commentId: comment.id },
      viewer,
    );
    expect(boost.toggleCommentBoost).toEqual({
      commentId: comment.id,
      isBoostedByMe: true,
      boostedByMe: true,
      boostCount: 1,
    });

    const unUpvote = await runMutation<{ toggleUpvote: TogglePostPayload }>(TOGGLE_UPVOTE, { postId: post.id }, viewer);
    expect(unUpvote.toggleUpvote).toMatchObject({ upvoteCount: 0, isUpvotedByMe: false });

    const unSave = await runMutation<{ toggleSave: TogglePostPayload }>(TOGGLE_SAVE, { postId: post.id }, viewer);
    expect(unSave.toggleSave).toMatchObject({ saveCount: 0, isSavedByMe: false });

    const unBoost = await runMutation<{ toggleCommentBoost: ToggleBoostPayload }>(
      TOGGLE_BOOST,
      { commentId: comment.id },
      viewer,
    );
    expect(unBoost.toggleCommentBoost).toEqual({
      commentId: comment.id,
      isBoostedByMe: false,
      boostedByMe: false,
      boostCount: 0,
    });
  });

  it('rejects new Upvotes and Saves across a Block in either direction with neutral errors', async () => {
    const missingUpvote = neutralized(
      await runRejected(TOGGLE_UPVOTE, { postId: NONEXISTENT_POST_ID }, viewer),
      NONEXISTENT_POST_ID,
    );
    const missingSave = neutralized(
      await runRejected(TOGGLE_SAVE, { postId: NONEXISTENT_POST_ID }, viewer),
      NONEXISTENT_POST_ID,
    );

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      const post = await seedPost(author.id);
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const upvoteError = await runRejected(TOGGLE_UPVOTE, { postId: post.id }, viewer);
      expect(upvoteError).not.toMatch(/block/i);
      expect(neutralized(upvoteError, post.id)).toBe(missingUpvote);

      const saveError = await runRejected(TOGGLE_SAVE, { postId: post.id }, viewer);
      expect(saveError).not.toMatch(/block/i);
      expect(neutralized(saveError, post.id)).toBe(missingSave);

      expect(await countUpvote(post.id, viewer.id)).toBe(0);
      expect(await countSave(post.id, viewer.id)).toBe(0);
      const stored = await storedPost(post.id);
      expect(stored.upvoteCount).toBe(0);
      expect(stored.saveCount).toBe(0);

      await clearBlocks();
    }
  });

  it('rejects new Comment and Reply Boosts across a Block in either direction with neutral errors', async () => {
    const missingBoost = neutralized(
      await runRejected(TOGGLE_BOOST, { commentId: NONEXISTENT_COMMENT_ID }, viewer),
      NONEXISTENT_COMMENT_ID,
    );

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      const post = await seedPost(poster.id);
      const comment = await seedComment({ postId: post.id, authorId: author.id, text: 'Boost target comment' });
      const otherParent = await seedComment({ postId: post.id, authorId: other.id, text: 'Reply parent' });
      const reply = await seedComment({
        postId: post.id,
        authorId: author.id,
        text: 'Boost target reply',
        parentId: otherParent.id,
      });

      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      for (const targetId of [comment.id, reply.id]) {
        const boostError = await runRejected(TOGGLE_BOOST, { commentId: targetId }, viewer);
        expect(boostError).not.toMatch(/block/i);
        expect(neutralized(boostError, targetId)).toBe(missingBoost);

        expect(await countBoost(targetId, viewer.id)).toBe(0);
        expect((await storedComment(targetId)).boostCount).toBe(0);
      }

      // A Boost under an isolated Post is rejected even when the target author
      // is a third party: the discussion context itself is unavailable.
      await clearBlocks();
      await setBlock(viewer, poster);
      const contextError = await runRejected(TOGGLE_BOOST, { commentId: comment.id }, viewer);
      expect(contextError).not.toMatch(/block/i);
      expect(await countBoost(comment.id, viewer.id)).toBe(0);

      // A Reply is also isolated by its parent Comment's author.
      await clearBlocks();
      await setBlock(viewer, other);
      const parentError = await runRejected(TOGGLE_BOOST, { commentId: reply.id }, viewer);
      expect(parentError).not.toMatch(/block/i);
      expect(await countBoost(reply.id, viewer.id)).toBe(0);

      await clearBlocks();
    }
  });

  it('lets callers remove owned Upvotes, Saves, and Boosts while isolation is active', async () => {
    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      const post = await seedPost(author.id);
      const comment = await seedComment({ postId: post.id, authorId: author.id, text: 'Owned boost' });

      await runMutation(TOGGLE_UPVOTE, { postId: post.id }, viewer);
      await runMutation(TOGGLE_SAVE, { postId: post.id }, viewer);
      await runMutation(TOGGLE_BOOST, { commentId: comment.id }, viewer);

      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const unUpvote = await runMutation<{ toggleUpvote: TogglePostPayload }>(
        TOGGLE_UPVOTE,
        { postId: post.id },
        viewer,
      );
      expect(unUpvote.toggleUpvote).toMatchObject({ upvoteCount: 0, isUpvotedByMe: false });

      const unSave = await runMutation<{ toggleSave: TogglePostPayload }>(TOGGLE_SAVE, { postId: post.id }, viewer);
      expect(unSave.toggleSave).toMatchObject({ saveCount: 0, isSavedByMe: false });

      const unBoost = await runMutation<{ toggleCommentBoost: ToggleBoostPayload }>(
        TOGGLE_BOOST,
        { commentId: comment.id },
        viewer,
      );
      expect(unBoost.toggleCommentBoost).toEqual({
        commentId: comment.id,
        isBoostedByMe: false,
        boostedByMe: false,
        boostCount: 0,
      });

      expect(await countUpvote(post.id, viewer.id)).toBe(0);
      expect(await countSave(post.id, viewer.id)).toBe(0);
      expect(await countBoost(comment.id, viewer.id)).toBe(0);

      // Removal does not restore interaction: re-adding is still rejected.
      const reAddError = await runRejected(TOGGLE_UPVOTE, { postId: post.id }, viewer);
      expect(reAddError).not.toMatch(/block/i);
      expect(await countUpvote(post.id, viewer.id)).toBe(0);
      const reSaveError = await runRejected(TOGGLE_SAVE, { postId: post.id }, viewer);
      expect(reSaveError).not.toMatch(/block/i);
      const reBoostError = await runRejected(TOGGLE_BOOST, { commentId: comment.id }, viewer);
      expect(reBoostError).not.toMatch(/block/i);

      await clearBlocks();
    }
  });

  it('creating a Block preserves engagement rows, counters, and ranking state', async () => {
    const post = await seedPost(author.id, 12.5);
    const comment = await seedComment({ postId: post.id, authorId: author.id, text: 'Preserved boost' });

    await runMutation(TOGGLE_UPVOTE, { postId: post.id }, viewer);
    await runMutation(TOGGLE_SAVE, { postId: post.id }, viewer);
    await runMutation(TOGGLE_BOOST, { commentId: comment.id }, viewer);

    const before = await storedPost(post.id);
    const commentBefore = await storedComment(comment.id);

    await setBlock(viewer, author);

    const after = await storedPost(post.id);
    expect(after.upvoteCount).toBe(before.upvoteCount);
    expect(after.saveCount).toBe(before.saveCount);
    expect(after.effectiveScore).toBe(before.effectiveScore);
    expect((await storedComment(comment.id)).boostCount).toBe(commentBefore.boostCount);

    expect(await countUpvote(post.id, viewer.id)).toBe(1);
    expect(await countSave(post.id, viewer.id)).toBe(1);
    expect(await countBoost(comment.id, viewer.id)).toBe(1);

    const saved = await runMutation<{ mySavedPosts: SavedPostsPage }>(MY_SAVED_POSTS, { first: 10 }, viewer);
    expect(savedPostIds(saved.mySavedPosts)).not.toContain(post.id);

    await clearBlocks();
    const restored = await runMutation<{ mySavedPosts: SavedPostsPage }>(MY_SAVED_POSTS, { first: 10 }, viewer);
    expect(savedPostIds(restored.mySavedPosts)).toContain(post.id);
  });

  it('resolves viewer Upvote, Save, and Boost booleans false while isolated and restores them after Unblock', async () => {
    const post = await seedPost(author.id);
    const comment = await seedComment({ postId: post.id, authorId: author.id, text: 'Masked boost' });

    await runMutation(TOGGLE_UPVOTE, { postId: post.id }, viewer);
    await runMutation(TOGGLE_SAVE, { postId: post.id }, viewer);
    await runMutation(TOGGLE_BOOST, { commentId: comment.id }, viewer);

    const visible = await postFlags(post.id, viewer);
    expect(visible).toMatchObject({ isUpvotedByMe: true, isSavedByMe: true, upvoteCount: 1, saveCount: 1 });
    expect(await commentFlags(comment.id, viewer)).toMatchObject({ isBoostedByMe: true, boostCount: 1 });

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const masked = await postFlags(post.id, viewer);
      expect(masked).toMatchObject({
        isUpvotedByMe: false,
        isSavedByMe: false,
        upvoteCount: 1,
        saveCount: 1,
      });
      const maskedComment = await commentFlags(comment.id, viewer);
      expect(maskedComment).toMatchObject({ isBoostedByMe: false, boostCount: 1 });

      await clearBlocks();

      const unmasked = await postFlags(post.id, viewer);
      expect(unmasked).toMatchObject({ isUpvotedByMe: true, isSavedByMe: true });
      expect(await commentFlags(comment.id, viewer)).toMatchObject({ isBoostedByMe: true, boostCount: 1 });
    }
  });

  it('Saved Posts omits isolated Posts, retains the underlying Save, and restores after Unblock', async () => {
    const authorPost = await seedPost(author.id);
    const otherPost = await seedPost(other.id);
    await runMutation(TOGGLE_SAVE, { postId: authorPost.id }, viewer);
    await runMutation(TOGGLE_SAVE, { postId: otherPost.id }, viewer);

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const page = await runMutation<{ mySavedPosts: SavedPostsPage }>(MY_SAVED_POSTS, { first: 10 }, viewer);
      expect(savedPostIds(page.mySavedPosts)).toEqual([otherPost.id]);
    }

    expect(await countSave(authorPost.id, viewer.id)).toBe(1);

    await clearBlocks();
    const restored = await runMutation<{ mySavedPosts: SavedPostsPage }>(MY_SAVED_POSTS, { first: 10 }, viewer);
    expect(savedPostIds(restored.mySavedPosts).sort()).toEqual([authorPost.id, otherPost.id].sort());
  });

  it('serializes a committed Block ahead of racing Upvote, Save, and Boost writes', async () => {
    const upvotePost = await seedPost(author.id);
    const upvoteResult = await commitBlockAheadOf(author, () =>
      runGql(TOGGLE_UPVOTE, { postId: upvotePost.id }, viewer),
    );
    expect(upvoteResult.data ?? null).toBeNull();
    expect(upvoteResult.errors).toHaveLength(1);
    expect(upvoteResult.errors![0].message).not.toMatch(/block/i);
    expect(await countUpvote(upvotePost.id, viewer.id)).toBe(0);
    expect((await storedPost(upvotePost.id)).upvoteCount).toBe(0);

    await clearBlocks();
    const savePost = await seedPost(author.id);
    const saveResult = await commitBlockAheadOf(author, () => runGql(TOGGLE_SAVE, { postId: savePost.id }, viewer));
    expect(saveResult.data ?? null).toBeNull();
    expect(saveResult.errors).toHaveLength(1);
    expect(saveResult.errors![0].message).not.toMatch(/block/i);
    expect(await countSave(savePost.id, viewer.id)).toBe(0);
    expect((await storedPost(savePost.id)).saveCount).toBe(0);

    await clearBlocks();
    const boostPost = await seedPost(poster.id);
    const boostComment = await seedComment({ postId: boostPost.id, authorId: author.id, text: 'Racing boost' });
    const boostResult = await commitBlockAheadOf(author, () =>
      runGql(TOGGLE_BOOST, { commentId: boostComment.id }, viewer),
    );
    expect(boostResult.data ?? null).toBeNull();
    expect(boostResult.errors).toHaveLength(1);
    expect(boostResult.errors![0].message).not.toMatch(/block/i);
    expect(await countBoost(boostComment.id, viewer.id)).toBe(0);
    expect((await storedComment(boostComment.id)).boostCount).toBe(0);
  });

  it('preserves an interaction that commits before a later Block and keeps rejecting new writes', async () => {
    const post = await seedPost(author.id);
    const comment = await seedComment({ postId: post.id, authorId: author.id, text: 'Won the race' });

    await runMutation(TOGGLE_UPVOTE, { postId: post.id }, viewer);
    await runMutation(TOGGLE_SAVE, { postId: post.id }, viewer);
    await runMutation(TOGGLE_BOOST, { commentId: comment.id }, viewer);

    // A later Block commits (raw transaction on the canonical pair lock) and
    // hides the preserved engagement without deleting it.
    const blocker = await dbHelper.pool.connect();
    try {
      const pairKey = canonicalAccountPairKey(viewer.id, author.id);
      await blocker.query('BEGIN');
      await blocker.query(`SELECT pg_advisory_xact_lock(hashtext('account_pair'), hashtext($1))`, [pairKey]);
      await blocker.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [viewer.id, author.id]);
      await blocker.query('COMMIT');
    } finally {
      blocker.release();
    }

    expect(await countUpvote(post.id, viewer.id)).toBe(1);
    expect(await countSave(post.id, viewer.id)).toBe(1);
    expect(await countBoost(comment.id, viewer.id)).toBe(1);

    const masked = await postFlags(post.id, viewer);
    expect(masked).toMatchObject({ isUpvotedByMe: false, isSavedByMe: false, upvoteCount: 1, saveCount: 1 });
    expect(await commentFlags(comment.id, viewer)).toMatchObject({ isBoostedByMe: false, boostCount: 1 });

    // New relationships still cannot be created against untouched isolated
    // content, while the preserved relationships above stay in storage.
    const untouchedPost = await seedPost(author.id);
    const untouchedComment = await seedComment({ postId: untouchedPost.id, authorId: author.id, text: 'Untouched' });
    await runRejected(TOGGLE_UPVOTE, { postId: untouchedPost.id }, viewer);
    await runRejected(TOGGLE_SAVE, { postId: untouchedPost.id }, viewer);
    await runRejected(TOGGLE_BOOST, { commentId: untouchedComment.id }, viewer);
    expect(await countUpvote(untouchedPost.id, viewer.id)).toBe(0);
    expect(await countSave(untouchedPost.id, viewer.id)).toBe(0);
    expect(await countBoost(untouchedComment.id, viewer.id)).toBe(0);

    await clearBlocks();

    const restored = await postFlags(post.id, viewer);
    expect(restored).toMatchObject({ isUpvotedByMe: true, isSavedByMe: true });
    expect(await commentFlags(comment.id, viewer)).toMatchObject({ isBoostedByMe: true, boostCount: 1 });
  });

  it('rechecks isolation before waiting on held Post and discussion locks', async () => {
    const post = await seedPost(author.id);
    const comment = await seedComment({ postId: post.id, authorId: author.id, text: 'Lock order' });
    await setBlock(viewer, author);

    // (a) Another session holds the Post row FOR UPDATE. The isolated Upvote
    // must reject from the pair-lock recheck without ever waiting for the row.
    const postHolder = await dbHelper.pool.connect();
    try {
      await postHolder.query('BEGIN');
      await postHolder.query(`SELECT * FROM posts WHERE id = $1 FOR UPDATE`, [post.id]);

      const upvote = await withTimeout(
        runGql(TOGGLE_UPVOTE, { postId: post.id }, viewer),
        5_000,
        'isolated upvote behind a held Post lock',
      );
      expect(upvote.data ?? null).toBeNull();
      expect(upvote.errors).toHaveLength(1);
    } finally {
      await postHolder.query('ROLLBACK');
      postHolder.release();
    }

    // (b) Another session holds the Post discussion advisory lock. The isolated
    // Boost must reject before acquiring the discussion lock.
    const discussionHolder = await dbHelper.pool.connect();
    try {
      await discussionHolder.query('BEGIN');
      await discussionHolder.query(`SELECT pg_advisory_xact_lock(hashtextextended('comment_discussion:' || $1, 0))`, [
        post.id,
      ]);

      const boost = await withTimeout(
        runGql(TOGGLE_BOOST, { commentId: comment.id }, viewer),
        5_000,
        'isolated boost behind a held discussion lock',
      );
      expect(boost.data ?? null).toBeNull();
      expect(boost.errors).toHaveLength(1);
    } finally {
      await discussionHolder.query('ROLLBACK');
      discussionHolder.release();
    }

    expect(await countUpvote(post.id, viewer.id)).toBe(0);
    expect(await countBoost(comment.id, viewer.id)).toBe(0);
    await clearBlocks();
  });

  it('runs overlapping engagement writes without PostgreSQL deadlocks', async () => {
    const post = await seedPost(poster.id);
    const commentByAuthor = await seedComment({ postId: post.id, authorId: author.id, text: 'Author comment' });
    const commentByOther = await seedComment({ postId: post.id, authorId: other.id, text: 'Other comment' });

    const deadlocksBefore = await deadlockCount();

    const results = await Promise.all([
      runGql(TOGGLE_BOOST, { commentId: commentByAuthor.id }, viewer),
      runGql(TOGGLE_BOOST, { commentId: commentByOther.id }, viewer),
      runGql(TOGGLE_BOOST, { commentId: commentByAuthor.id }, other),
      runGql(TOGGLE_BOOST, { commentId: commentByOther.id }, author),
    ]);

    for (const result of results) {
      expect(result.errors).toBeUndefined();
    }
    expect(await deadlockCount()).toBe(deadlocksBefore);
    expect((await storedComment(commentByAuthor.id)).boostCount).toBe(2);
    expect((await storedComment(commentByOther.id)).boostCount).toBe(2);
  });
});

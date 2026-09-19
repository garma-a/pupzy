import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import DataLoader from 'dataloader';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  blocks,
  cities,
  comments,
  commentQuotaAdmissions,
  postPins,
  posts,
  users,
  type City,
  type Comment,
  type Post,
  type User,
} from '../database/schema';
import * as schema from '../database/schema';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';
import { CommentsResolver } from './comments.resolver';
import { PostsRepository } from '../posts/posts.repository';
import { PostsService } from '../posts/posts.service';
import { PostsResolver } from '../posts/posts.resolver';
import { AccountIsolationPolicy, canonicalAccountPairKeys } from '../blocks/account-isolation.policy';
import { CitiesRepository } from '../cities/cities.repository';
import { UsersRepository } from '../users/users.repository';
import { CitiesService } from '../cities/cities.service';
import { UsersService } from '../users/users.service';
import { UploadService } from '../upload/upload.service';
import { ViewFlushCron } from '../posts/view-flush.cron';
import { NotificationsService } from '../notifications/notifications.service';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { NotFoundError } from '../common/errors/app.errors';
import type { GqlContext } from '../common/types/gql-context.type';

const NONEXISTENT_POST_ID = '0192ffff-0000-7000-8000-000000000000';
const NONEXISTENT_COMMENT_ID = '0192ffff-0000-7000-8000-000000000001';

const COMMENTS_QUERY = `query Comments($postId: ID!, $sort: CommentSort, $first: Int, $after: String) {
  comments(postId: $postId, sort: $sort, first: $first, after: $after) {
    edges {
      node { id text status author { id } replyCount boostCount isPinned }
      cursor
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const REPLIES_QUERY = `query Replies($commentId: ID!, $first: Int, $after: String) {
  replies(commentId: $commentId, first: $first, after: $after) {
    edges { node { id text author { id } replyCount } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const POST_COMMENT_COUNT_QUERY = `query PostCommentCount($id: ID!) {
  post(id: $id) { id commentCount }
}`;

const CREATE_COMMENT_MUTATION = `mutation CreateComment($input: CreateCommentInput!) {
  createComment(input: $input) { id postId text }
}`;

const CREATE_REPLY_MUTATION = `mutation CreateReply($input: CreateReplyInput!) {
  createReply(input: $input) { id postId parentId text }
}`;

const PIN_COMMENT_MUTATION = `mutation PinComment($commentId: ID!) {
  pinComment(commentId: $commentId) { id isPinned }
}`;

interface CommentNode {
  id: string;
  text: string;
  status: string;
  author: { id: string } | null;
  replyCount: number;
  boostCount: number;
  isPinned: boolean;
}

interface CommentPage {
  edges: Array<{ node: CommentNode; cursor: string }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  Plans?: PlanNode[];
}

describe('Comment and Reply account isolation with viewer-visible counts (Ticket 07)', () => {
  jest.setTimeout(180_000);

  let dbHelper: TestDatabaseHelper;
  let executableSchema: GraphQLSchema;
  let commentsRepository: CommentsRepository;
  let commentsService: CommentsService;
  let commentsResolver: CommentsResolver;
  let postsRepository: PostsRepository;
  let postsService: PostsService;
  let postsResolver: PostsResolver;
  let citiesService: CitiesService;
  let usersService: UsersService;
  let uploadService: UploadService;
  let viewFlushCron: ViewFlushCron;
  let notificationsService: NotificationsService;
  let isolationPolicy: AccountIsolationPolicy;
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
      'extend type Query { countedPosts(ids: [ID!]!): [Post!]! }',
    ];

    executableSchema = makeExecutableSchema({
      typeDefs,
      resolvers: {
        DateTime: {
          __parseValue: (value: unknown) => value,
          __serialize: (value: unknown) => (value instanceof Date ? value.toISOString() : value),
        },
        Query: {
          post: (_root: unknown, args: { id: string }, ctx: GqlContext) => postsResolver.post(args.id, ctx),
          // Test-only list seam that mirrors a feed: several Post nodes are
          // returned by one repository call, so their field resolvers run in one
          // tick and must share the request-scoped loader.
          countedPosts: (_root: unknown, args: { ids: string[] }) =>
            dbHelper.db.select().from(posts).where(inArray(posts.id, args.ids)),
          comments: (
            _root: unknown,
            args: { postId: string; sort?: string; first?: number; after?: string },
            ctx: GqlContext,
          ) => commentsResolver.comments(args.postId, args.sort, args.first, args.after, ctx),
          replies: (_root: unknown, args: { commentId: string; first?: number; after?: string }, ctx: GqlContext) =>
            commentsResolver.replies(args.commentId, args.first, args.after, ctx),
        },
        Mutation: {
          createComment: (_root: unknown, args: { input: unknown }, ctx: GqlContext) =>
            commentsResolver.createComment(args.input, ctx),
          createReply: (_root: unknown, args: { input: unknown }, ctx: GqlContext) =>
            commentsResolver.createReply(args.input, ctx),
          pinComment: (_root: unknown, args: { commentId: string }, ctx: GqlContext) =>
            commentsResolver.pinComment(args.commentId, ctx),
          unpinComment: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            commentsResolver.unpinComment(args.postId, ctx),
        },
        Comment: {
          author: (root: Comment, _args: unknown, ctx: GqlContext) => commentsResolver.author(root, ctx),
          text: (root: Comment) => commentsResolver.text(root),
          media: (root: Comment, _args: unknown, ctx: GqlContext) => commentsResolver.media(root, ctx),
          isBoostedByMe: (root: Comment, _args: unknown, ctx: GqlContext) => commentsResolver.isBoostedByMe(root, ctx),
          boostCount: (root: Comment) => commentsResolver.boostCount(root),
          isPinned: (root: Comment, _args: unknown, ctx: GqlContext) => commentsResolver.isPinned(root, ctx),
          replyCount: (root: Comment, _args: unknown, ctx: GqlContext) => commentsResolver.replyCount(root, ctx),
        },
        Post: {
          commentCount: (root: Post, _args: unknown, ctx: GqlContext) => postsResolver.commentCount(root, ctx),
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
        fullName: `Isolation ${label}`,
      })
      .returning();
    return user;
  }

  async function seedPost(creatorId: string, options?: { createdAt?: Date }): Promise<Post> {
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId,
        postType: 'RESCUE',
        title: `Isolation discussion ${generateUuidV7().slice(-6)}`,
        description: 'Discussion isolation fixture',
        status: 'ACTIVE',
        urgency: 'URGENT',
        cityId: testCity.id,
        governorate: testCity.governorate,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
        ...(options?.createdAt ? { createdAt: options.createdAt } : {}),
      })
      .returning();
    return post;
  }

  async function seedComment(params: {
    postId: string;
    authorId: string;
    text: string;
    parentId?: string | null;
    status?: Comment['status'];
    createdAt?: Date;
    boostCount?: number;
  }): Promise<Comment> {
    const createdAt = params.createdAt ?? new Date();
    const [comment] = await dbHelper.db
      .insert(comments)
      .values({
        postId: params.postId,
        authorId: params.authorId,
        parentId: params.parentId ?? null,
        text: params.text,
        status: params.status ?? 'ACTIVE',
        boostCount: params.boostCount ?? 0,
        createdAt,
        updatedAt: createdAt,
      })
      .returning();
    return comment;
  }

  /**
   * Keeps stored counters canonical after direct fixture seeding without
   * touching seeded boostCount values (reconciliation would reset those).
   */
  async function syncCanonicalCounters(postId: string): Promise<void> {
    await dbHelper.pool.query(
      `UPDATE posts SET comment_count = (
         SELECT count(*) FROM comments c
         WHERE c.post_id = $1 AND c.parent_id IS NULL AND c.status IN ('ACTIVE', 'IMAGE_HIDDEN')
       ) + (
         SELECT count(*) FROM comments c
         JOIN comments p ON c.parent_id = p.id
         WHERE c.post_id = $1 AND c.status IN ('ACTIVE', 'IMAGE_HIDDEN') AND p.status <> 'REMOVED'
       )
       WHERE id = $1`,
      [postId],
    );
    await dbHelper.pool.query(
      `UPDATE comments p SET reply_count = (
         SELECT count(*) FROM comments c
         WHERE c.parent_id = p.id AND c.status IN ('ACTIVE', 'IMAGE_HIDDEN')
       )
       WHERE p.post_id = $1 AND p.parent_id IS NULL`,
      [postId],
    );
  }

  async function setBlock(blocker: User, blocked: User): Promise<void> {
    await dbHelper.db.insert(blocks).values({ blockerId: blocker.id, blockedId: blocked.id });
  }

  async function clearBlocks(): Promise<void> {
    await dbHelper.db.delete(blocks);
  }

  async function storedCounters(postId: string, commentIds: string[]) {
    const [post] = await dbHelper.db.select().from(posts).where(eq(posts.id, postId));
    const commentRows = await dbHelper.db.select().from(comments).where(inArray(comments.id, commentIds));
    return {
      postCommentCount: post.commentCount,
      replyCounts: new Map(commentRows.map((row) => [row.id, row.replyCount])),
    };
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
        commentBoostedByMe: { load: jest.fn().mockResolvedValue(false) },
        pinnedCommentIdByPostId: commentsRepository.createPinnedCommentIdByPostIdLoader(),
        commentMediaByCommentId: commentsRepository.createCommentMediaByCommentIdLoader(),
        reachableCommentCountByPostId: commentsRepository.createReachableCommentCountByPostIdLoader(),
        reachableReplyCountByCommentId: commentsRepository.createReachableReplyCountByCommentIdLoader(),
      } as unknown as GqlContext['loaders'],
    };
  }

  function runGql<TData>(
    source: string,
    variables: Record<string, unknown>,
    user?: User,
  ): Promise<ExecutionResult<TData>> {
    return graphql({
      schema: executableSchema,
      source,
      variableValues: variables,
      contextValue: createContext(user),
    }) as Promise<ExecutionResult<TData>>;
  }

  async function commentsPage(
    postId: string,
    variables: { sort?: 'TOP' | 'NEWEST'; first?: number; after?: string },
    user?: User,
  ): Promise<CommentPage> {
    const result = await runGql<{ comments: CommentPage }>(COMMENTS_QUERY, { postId, ...variables }, user);
    expect(result.errors).toBeUndefined();
    return result.data!.comments;
  }

  async function repliesPage(
    commentId: string,
    variables: { first?: number; after?: string },
    user?: User,
  ): Promise<CommentPage> {
    const result = await runGql<{ replies: CommentPage }>(REPLIES_QUERY, { commentId, ...variables }, user);
    expect(result.errors).toBeUndefined();
    return result.data!.replies;
  }

  function nodeIds(page: CommentPage): string[] {
    return page.edges.map((edge) => edge.node.id);
  }

  /** Replaces an identifier in an error message so neutral errors can be compared. */
  function neutralized(message: string, id: string): string {
    return message.split(id).join('<id>');
  }

  async function replyErrorMessage(commentId: string, user?: User): Promise<string> {
    const result = await runGql(REPLIES_QUERY, { commentId }, user);
    expect(result.errors).toBeDefined();
    expect(result.errors).toHaveLength(1);
    return result.errors![0].message;
  }

  async function commentCountFor(postId: string, user?: User): Promise<number> {
    const result = await runGql<{ post: { id: string; commentCount: number } | null }>(
      POST_COMMENT_COUNT_QUERY,
      { id: postId },
      user,
    );
    expect(result.errors).toBeUndefined();
    expect(result.data!.post).not.toBeNull();
    return result.data!.post!.commentCount;
  }

  async function creationAdmissions(userId: string): Promise<number> {
    const rows = await dbHelper.db
      .select({ id: commentQuotaAdmissions.id })
      .from(commentQuotaAdmissions)
      .where(
        sql`${commentQuotaAdmissions.userId} = ${userId} AND ${commentQuotaAdmissions.action} = 'COMMENT_CREATION'`,
      );
    return rows.length;
  }

  async function waitForUngrantedAdvisoryLock(classId: number, objectId: number, minimum = 1): Promise<void> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
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

  it('TOP and NEWEST pages exclude isolated top-level authors before pagination in both directions', async () => {
    const post = await seedPost(poster.id);
    const blockedNewest = await seedComment({
      postId: post.id,
      authorId: author.id,
      text: 'Blocked highest boost',
      createdAt: new Date('2026-01-05T00:00:00Z'),
      boostCount: 100,
    });
    const visibleOne = await seedComment({
      postId: post.id,
      authorId: other.id,
      text: 'Visible one',
      createdAt: new Date('2026-01-04T00:00:00Z'),
      boostCount: 50,
    });
    const blockedMiddle = await seedComment({
      postId: post.id,
      authorId: author.id,
      text: 'Blocked middle boost',
      createdAt: new Date('2026-01-03T00:00:00Z'),
      boostCount: 40,
    });
    const visibleTwo = await seedComment({
      postId: post.id,
      authorId: other.id,
      text: 'Visible two',
      createdAt: new Date('2026-01-02T00:00:00Z'),
      boostCount: 30,
    });
    const visibleThree = await seedComment({
      postId: post.id,
      authorId: other.id,
      text: 'Visible three',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      boostCount: 20,
    });
    await syncCanonicalCounters(post.id);

    const visibleNewestFirst = [visibleOne.id, visibleTwo.id, visibleThree.id];

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      await clearBlocks();
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const topFirst = await commentsPage(post.id, { sort: 'TOP', first: 2 }, viewer);
      expect(nodeIds(topFirst)).toEqual(visibleNewestFirst.slice(0, 2));
      expect(topFirst.pageInfo.hasNextPage).toBe(true);
      expect(topFirst.edges.every((edge) => edge.node.author?.id === other.id)).toBe(true);

      const topSecond = await commentsPage(
        post.id,
        { sort: 'TOP', first: 2, after: topFirst.pageInfo.endCursor! },
        viewer,
      );
      expect(nodeIds(topSecond)).toEqual(visibleNewestFirst.slice(2));
      expect(topSecond.pageInfo.hasNextPage).toBe(false);

      const newestFirst = await commentsPage(post.id, { sort: 'NEWEST', first: 2 }, viewer);
      expect(nodeIds(newestFirst)).toEqual(visibleNewestFirst.slice(0, 2));
      expect(newestFirst.pageInfo.hasNextPage).toBe(true);

      const newestSecond = await commentsPage(
        post.id,
        { sort: 'NEWEST', first: 2, after: newestFirst.pageInfo.endCursor! },
        viewer,
      );
      expect(nodeIds(newestSecond)).toEqual(visibleNewestFirst.slice(2));
      expect(newestSecond.pageInfo.hasNextPage).toBe(false);

      const densePage = await commentsPage(post.id, { sort: 'TOP', first: 5 }, viewer);
      expect(nodeIds(densePage)).toEqual(visibleNewestFirst);
      expect(densePage.pageInfo.hasNextPage).toBe(false);

      expect(nodeIds(densePage)).not.toContain(blockedNewest.id);
      expect(nodeIds(densePage)).not.toContain(blockedMiddle.id);
    }

    await clearBlocks();
    const unfiltered = await commentsPage(post.id, { sort: 'TOP', first: 10 }, viewer);
    expect(nodeIds(unfiltered)).toEqual([
      blockedNewest.id,
      visibleOne.id,
      blockedMiddle.id,
      visibleTwo.id,
      visibleThree.id,
    ]);
  });

  it('a hidden top-level Comment makes its complete Reply branch unreachable', async () => {
    const post = await seedPost(poster.id);
    const hiddenParent = await seedComment({
      postId: post.id,
      authorId: author.id,
      text: 'Blocked branch parent',
      createdAt: new Date('2026-01-03T00:00:00Z'),
    });
    const hiddenReplyOne = await seedComment({
      postId: post.id,
      authorId: other.id,
      parentId: hiddenParent.id,
      text: 'Reply under blocked parent',
      createdAt: new Date('2026-01-03T00:01:00Z'),
    });
    const hiddenReplyViewer = await seedComment({
      postId: post.id,
      authorId: viewer.id,
      parentId: hiddenParent.id,
      text: 'Viewer reply under blocked parent',
      createdAt: new Date('2026-01-03T00:02:00Z'),
    });
    const hiddenReplyThree = await seedComment({
      postId: post.id,
      authorId: author.id,
      parentId: hiddenParent.id,
      text: 'Blocked reply under blocked parent',
      createdAt: new Date('2026-01-03T00:03:00Z'),
    });

    const visibleParent = await seedComment({
      postId: post.id,
      authorId: other.id,
      text: 'Reachable parent',
      createdAt: new Date('2026-01-02T00:00:00Z'),
    });
    const visibleReplyByBlocked = await seedComment({
      postId: post.id,
      authorId: author.id,
      parentId: visibleParent.id,
      text: 'Blocked reply under reachable parent',
      createdAt: new Date('2026-01-02T00:01:00Z'),
    });
    const visibleReply = await seedComment({
      postId: post.id,
      authorId: other.id,
      parentId: visibleParent.id,
      text: 'Reachable reply',
      createdAt: new Date('2026-01-02T00:02:00Z'),
    });

    const deletedParent = await seedComment({
      postId: post.id,
      authorId: author.id,
      text: 'Deleted blocked parent',
      status: 'DELETED',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    await seedComment({
      postId: post.id,
      authorId: other.id,
      parentId: deletedParent.id,
      text: 'Reply under deleted blocked parent',
      createdAt: new Date('2026-01-01T00:01:00Z'),
    });

    const tombstoneWithOnlyBlockedReplies = await seedComment({
      postId: post.id,
      authorId: other.id,
      text: 'Tombstone with only blocked replies',
      status: 'DELETED',
      createdAt: new Date('2026-01-04T00:00:00Z'),
    });
    await seedComment({
      postId: post.id,
      authorId: author.id,
      parentId: tombstoneWithOnlyBlockedReplies.id,
      text: 'Only blocked reply',
      createdAt: new Date('2026-01-04T00:01:00Z'),
    });

    await syncCanonicalCounters(post.id);

    // Baseline before any Block: every branch is reachable.
    const baselineParent = await commentsPage(post.id, { sort: 'NEWEST', first: 10 }, viewer);
    expect(nodeIds(baselineParent)).toContain(hiddenParent.id);
    const baselineReplies = await repliesPage(hiddenParent.id, { first: 10 }, viewer);
    expect(baselineReplies.edges).toHaveLength(3);
    expect(await commentCountFor(post.id, viewer)).toBe(9);

    const missingMessage = await replyErrorMessage(NONEXISTENT_COMMENT_ID, viewer);

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      await clearBlocks();
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const page = await commentsPage(post.id, { sort: 'NEWEST', first: 10 }, viewer);
      const pageIds = nodeIds(page);
      expect(pageIds).not.toContain(hiddenParent.id);
      expect(pageIds).not.toContain(deletedParent.id);
      expect(pageIds).not.toContain(tombstoneWithOnlyBlockedReplies.id);
      expect(pageIds).toContain(visibleParent.id);

      // The whole hidden branch is unreachable through the direct Replies query,
      // with the same neutral not-found used for a missing Comment.
      const branchMessage = await replyErrorMessage(hiddenParent.id, viewer);
      expect(neutralized(branchMessage, hiddenParent.id)).toBe(neutralized(missingMessage, NONEXISTENT_COMMENT_ID));
      expect(branchMessage).not.toMatch(/block/i);

      // The reachable branch only exposes non-isolated Replies.
      const reachableReplies = await repliesPage(visibleParent.id, { first: 10 }, viewer);
      expect(nodeIds(reachableReplies)).toEqual([visibleReply.id]);
      expect(nodeIds(reachableReplies)).not.toContain(visibleReplyByBlocked.id);

      const visibleParentNode = page.edges.find((edge) => edge.node.id === visibleParent.id)!.node;
      expect(visibleParentNode.replyCount).toBe(1);

      // Reachable contributions: visibleParent + visibleReply + no hidden branch.
      expect(await commentCountFor(post.id, viewer)).toBe(2);
    }

    // Stored canonical counters are preserved while isolation is active.
    const stored = await storedCounters(post.id, [hiddenParent.id, visibleParent.id, deletedParent.id]);
    expect(stored.postCommentCount).toBe(9);
    expect(stored.replyCounts.get(hiddenParent.id)).toBe(3);
    expect(stored.replyCounts.get(visibleParent.id)).toBe(2);

    await clearBlocks();
    const restored = await commentsPage(post.id, { sort: 'NEWEST', first: 10 }, viewer);
    expect(nodeIds(restored)).toContain(hiddenParent.id);
    expect(nodeIds(restored)).toContain(tombstoneWithOnlyBlockedReplies.id);
    const restoredBranch = await repliesPage(hiddenParent.id, { first: 10 }, viewer);
    expect(nodeIds(restoredBranch)).toEqual([hiddenReplyOne.id, hiddenReplyViewer.id, hiddenReplyThree.id]);
    expect(await commentCountFor(post.id, viewer)).toBe(9);
  });

  it('Replies authored by an isolated account are omitted from reachable branches with stable cursors', async () => {
    const post = await seedPost(poster.id);
    const parent = await seedComment({
      postId: post.id,
      authorId: other.id,
      text: 'Reachable discussion parent',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const blockedReplies = [];
    const visibleReplies = [];
    for (let index = 0; index < 6; index += 1) {
      const blocked = index % 2 === 0;
      const reply = await seedComment({
        postId: post.id,
        authorId: blocked ? author.id : other.id,
        parentId: parent.id,
        text: blocked ? `Blocked reply ${index}` : `Visible reply ${index}`,
        createdAt: new Date(`2026-01-01T00:0${index + 1}:00Z`),
      });
      if (blocked) blockedReplies.push(reply);
      else visibleReplies.push(reply);
    }
    await syncCanonicalCounters(post.id);

    await setBlock(viewer, author);

    const firstPage = await repliesPage(parent.id, { first: 2 }, viewer);
    expect(nodeIds(firstPage)).toEqual([visibleReplies[0].id, visibleReplies[1].id]);
    expect(firstPage.pageInfo.hasNextPage).toBe(true);

    const secondPage = await repliesPage(parent.id, { first: 2, after: firstPage.pageInfo.endCursor! }, viewer);
    expect(nodeIds(secondPage)).toEqual([visibleReplies[2].id]);
    expect(secondPage.pageInfo.hasNextPage).toBe(false);

    for (const blocked of blockedReplies) {
      expect(nodeIds(firstPage).concat(nodeIds(secondPage))).not.toContain(blocked.id);
    }

    const parentNode = (await commentsPage(post.id, { sort: 'NEWEST', first: 10 }, viewer)).edges.find(
      (edge) => edge.node.id === parent.id,
    )!.node;
    expect(parentNode.replyCount).toBe(3);
    expect(await commentCountFor(post.id, viewer)).toBe(4);

    const stored = await storedCounters(post.id, [parent.id]);
    expect(stored.replyCounts.get(parent.id)).toBe(6);
    expect(stored.postCommentCount).toBe(7);

    await clearBlocks();
    const unfiltered = await repliesPage(parent.id, { first: 10 }, viewer);
    expect(unfiltered.edges).toHaveLength(6);
    expect(await commentCountFor(post.id, viewer)).toBe(7);
  });

  it('a pinned Comment cannot bypass isolation and the next eligible result is ordered correctly', async () => {
    const post = await seedPost(poster.id);
    const pinnedBlocked = await seedComment({
      postId: post.id,
      authorId: author.id,
      text: 'Pinned but blocked',
      createdAt: new Date('2026-01-05T00:00:00Z'),
      boostCount: 1000,
    });
    const eligibleOne = await seedComment({
      postId: post.id,
      authorId: other.id,
      text: 'Eligible one',
      createdAt: new Date('2026-01-04T00:00:00Z'),
      boostCount: 5,
    });
    const eligibleTwo = await seedComment({
      postId: post.id,
      authorId: other.id,
      text: 'Eligible two',
      createdAt: new Date('2026-01-03T00:00:00Z'),
      boostCount: 3,
    });
    await dbHelper.db.insert(postPins).values({ postId: post.id, commentId: pinnedBlocked.id });
    await syncCanonicalCounters(post.id);

    const pinnedBefore = await commentsPage(post.id, { sort: 'TOP', first: 1 }, viewer);
    expect(pinnedBefore.edges).toHaveLength(1);
    expect(pinnedBefore.edges[0].node.id).toBe(pinnedBlocked.id);
    expect(pinnedBefore.edges[0].node.isPinned).toBe(true);
    expect(pinnedBefore.pageInfo.hasNextPage).toBe(true);

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      await clearBlocks();
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const topFirst = await commentsPage(post.id, { sort: 'TOP', first: 1 }, viewer);
      expect(nodeIds(topFirst)).toEqual([eligibleOne.id]);
      expect(topFirst.edges[0].node.isPinned).toBe(false);
      expect(topFirst.pageInfo.hasNextPage).toBe(true);

      const topSecond = await commentsPage(
        post.id,
        { sort: 'TOP', first: 1, after: topFirst.pageInfo.endCursor! },
        viewer,
      );
      expect(nodeIds(topSecond)).toEqual([eligibleTwo.id]);
      expect(topSecond.pageInfo.hasNextPage).toBe(false);

      const newestFirst = await commentsPage(post.id, { sort: 'NEWEST', first: 1 }, viewer);
      expect(nodeIds(newestFirst)).toEqual([eligibleOne.id]);
      expect(newestFirst.edges[0].node.isPinned).toBe(false);

      const dense = await commentsPage(post.id, { sort: 'TOP', first: 2 }, viewer);
      expect(nodeIds(dense)).toEqual([eligibleOne.id, eligibleTwo.id]);
      expect(dense.pageInfo.hasNextPage).toBe(false);
      expect(nodeIds(dense)).not.toContain(pinnedBlocked.id);
      expect(await commentCountFor(post.id, viewer)).toBe(2);
    }

    await clearBlocks();
    const pinnedAfter = await commentsPage(post.id, { sort: 'TOP', first: 1 }, viewer);
    expect(pinnedAfter.edges[0].node.id).toBe(pinnedBlocked.id);
    expect(pinnedAfter.edges[0].node.isPinned).toBe(true);
  });

  it('pinning an isolated account Comment fails neutrally without pinning or notifying', async () => {
    const post = await seedPost(poster.id);
    const target = await seedComment({ postId: post.id, authorId: author.id, text: 'Pin target' });

    const baseline = await runGql<{ pinComment: { id: string; isPinned: boolean } }>(
      PIN_COMMENT_MUTATION,
      { commentId: target.id },
      poster,
    );
    expect(baseline.errors).toBeUndefined();
    expect(baseline.data?.pinComment.isPinned).toBe(true);

    await dbHelper.db.delete(postPins).where(eq(postPins.postId, post.id));
    const eventsBefore = await dbHelper.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM discussion_notification_events WHERE related_comment_id = $1`,
      [target.id],
    );

    const missing = await runGql(PIN_COMMENT_MUTATION, { commentId: NONEXISTENT_COMMENT_ID }, poster);
    const missingMessage = missing.errors![0].message;

    for (const direction of ['poster-blocks', 'author-blocks'] as const) {
      await clearBlocks();
      if (direction === 'poster-blocks') {
        await setBlock(poster, author);
      } else {
        await setBlock(author, poster);
      }

      const res = await runGql<{ pinComment: { id: string; isPinned: boolean } }>(
        PIN_COMMENT_MUTATION,
        { commentId: target.id },
        poster,
      );
      expect(res.data?.pinComment ?? null).toBeNull();
      expect(res.errors).toHaveLength(1);
      expect(neutralized(res.errors![0].message, target.id)).toBe(neutralized(missingMessage, NONEXISTENT_COMMENT_ID));
      expect(res.errors![0].message).not.toMatch(/block/i);

      const pins = await dbHelper.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM post_pins WHERE post_id = $1`,
        [post.id],
      );
      expect(Number(pins.rows[0].count)).toBe(0);
      const eventsAfter = await dbHelper.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM discussion_notification_events WHERE related_comment_id = $1`,
        [target.id],
      );
      expect(eventsAfter.rows[0].count).toBe(eventsBefore.rows[0].count);
    }

    await clearBlocks();
    const restored = await runGql<{ pinComment: { id: string; isPinned: boolean } }>(
      PIN_COMMENT_MUTATION,
      { commentId: target.id },
      poster,
    );
    expect(restored.errors).toBeUndefined();
    expect(restored.data?.pinComment.isPinned).toBe(true);
  });

  it('cursor continuation over filtered Comment and Reply pages stays complete and dense', async () => {
    const post = await seedPost(poster.id);
    const visibleTopOrder: Array<{ id: string; boostCount: number }> = [];
    const visibleNewestOrder: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      const blocked = index % 3 === 0;
      const comment = await seedComment({
        postId: post.id,
        authorId: blocked ? author.id : other.id,
        text: `Comment ${index}`,
        createdAt: new Date(`2026-02-${String(index + 1).padStart(2, '0')}T00:00:00Z`),
        boostCount: 10 - index,
      });
      if (!blocked) {
        visibleNewestOrder.push(comment.id);
        visibleTopOrder.push({ id: comment.id, boostCount: 10 - index });
      }
    }
    visibleNewestOrder.reverse();
    const expectedTop = [...visibleTopOrder].sort((left, right) => right.boostCount - left.boostCount).map((c) => c.id);
    await syncCanonicalCounters(post.id);

    await setBlock(author, viewer);

    const collect = async (sort: 'TOP' | 'NEWEST', first: number): Promise<string[]> => {
      const collected: string[] = [];
      let after: string | undefined;
      for (let page = 0; page < 10; page += 1) {
        const result = await commentsPage(post.id, { sort, first, after }, viewer);
        collected.push(...nodeIds(result));
        if (!result.pageInfo.hasNextPage) return collected;
        after = result.pageInfo.endCursor!;
      }
      throw new Error('pagination did not terminate');
    };

    expect(await collect('TOP', 2)).toEqual(expectedTop);
    expect(await collect('NEWEST', 1)).toEqual(visibleNewestOrder);

    // Reply continuation is equally dense after filtering.
    const parent = await seedComment({
      postId: post.id,
      authorId: other.id,
      text: 'Cursor reply parent',
      createdAt: new Date('2026-02-20T00:00:00Z'),
    });
    const expectedReplies: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const blocked = index % 2 === 1;
      const reply = await seedComment({
        postId: post.id,
        authorId: blocked ? author.id : other.id,
        parentId: parent.id,
        text: `Reply ${index}`,
        createdAt: new Date(`2026-02-21T00:0${index}:00Z`),
      });
      if (!blocked) expectedReplies.push(reply.id);
    }
    await syncCanonicalCounters(post.id);

    const collectedReplies: string[] = [];
    let replyAfter: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await repliesPage(parent.id, { first: 1, after: replyAfter }, viewer);
      collectedReplies.push(...nodeIds(result));
      if (!result.pageInfo.hasNextPage) break;
      replyAfter = result.pageInfo.endCursor!;
    }
    expect(collectedReplies).toEqual(expectedReplies);
  });

  it('creating a Comment on an isolated account Post fails neutrally and consumes no quota', async () => {
    const authorPost = await seedPost(author.id);
    const otherPost = await seedPost(other.id);

    const control = await runGql<{ createComment: { id: string } }>(
      CREATE_COMMENT_MUTATION,
      { input: { clientRequestId: 'isolation-comment-control', postId: otherPost.id, text: 'Control comment' } },
      viewer,
    );
    expect(control.errors).toBeUndefined();

    const missing = await runGql<{ createComment: null }>(
      CREATE_COMMENT_MUTATION,
      { input: { clientRequestId: 'isolation-comment-missing', postId: NONEXISTENT_POST_ID, text: 'Missing' } },
      viewer,
    );
    const missingMessage = missing.errors![0].message;

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      await clearBlocks();
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }
      const admissionsBefore = await creationAdmissions(viewer.id);

      const result = await runGql<{ createComment: null }>(
        CREATE_COMMENT_MUTATION,
        { input: { clientRequestId: `isolation-comment-${direction}`, postId: authorPost.id, text: 'Blocked' } },
        viewer,
      );
      expect(result.data?.createComment ?? null).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(neutralized(result.errors![0].message, authorPost.id)).toBe(
        neutralized(missingMessage, NONEXISTENT_POST_ID),
      );
      expect(result.errors![0].message).not.toMatch(/block/i);
      expect(await creationAdmissions(viewer.id)).toBe(admissionsBefore);

      const persisted = await dbHelper.db.select().from(comments).where(eq(comments.postId, authorPost.id));
      expect(persisted).toHaveLength(0);

      // The whole Post discussion is unavailable, not just writes.
      const commentsResult = await runGql<{ comments: CommentPage }>(COMMENTS_QUERY, { postId: authorPost.id }, viewer);
      expect(commentsResult.data?.comments ?? null).toBeNull();
      expect(commentsResult.errors).toHaveLength(1);
      expect(commentsResult.errors![0].message).not.toMatch(/block/i);
    }

    await clearBlocks();
    const restored = await runGql<{ createComment: { id: string } }>(
      CREATE_COMMENT_MUTATION,
      { input: { clientRequestId: 'isolation-comment-restored', postId: authorPost.id, text: 'Restored' } },
      viewer,
    );
    expect(restored.errors).toBeUndefined();
    expect(restored.data!.createComment.id).toBeDefined();
  });

  it('creating a Reply across any relevant isolated relationship fails before commit', async () => {
    const post = await seedPost(poster.id);
    const parentByAuthor = await seedComment({
      postId: post.id,
      authorId: author.id,
      text: 'Parent by blocked author',
    });
    const authorOwnedPost = await seedPost(author.id);
    const parentOnAuthorPost = await seedComment({
      postId: authorOwnedPost.id,
      authorId: other.id,
      text: 'Parent on blocked post',
    });
    await syncCanonicalCounters(post.id);
    await syncCanonicalCounters(authorOwnedPost.id);

    const missing = await runGql<{ createReply: null }>(
      CREATE_REPLY_MUTATION,
      {
        input: { clientRequestId: 'isolation-reply-missing', commentId: NONEXISTENT_COMMENT_ID, text: 'Missing' },
      },
      viewer,
    );
    const missingMessage = missing.errors![0].message;

    const scenarios: Array<{ label: string; commentId: string; postId: string }> = [
      { label: 'parent-author', commentId: parentByAuthor.id, postId: post.id },
      { label: 'post-creator', commentId: parentOnAuthorPost.id, postId: authorOwnedPost.id },
      { label: 'both', commentId: parentByAuthor.id, postId: authorOwnedPost.id },
    ];

    for (const scenario of scenarios) {
      await clearBlocks();
      await setBlock(viewer, author);
      const admissionsBefore = await creationAdmissions(viewer.id);
      const countersBefore = await storedCounters(scenario.postId, []);

      const result = await runGql<{ createReply: null }>(
        CREATE_REPLY_MUTATION,
        {
          input: {
            clientRequestId: `isolation-reply-${scenario.label}`,
            commentId: scenario.commentId,
            text: 'Blocked reply',
          },
        },
        viewer,
      );
      expect(result.data?.createReply ?? null).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(neutralized(result.errors![0].message, scenario.commentId)).toBe(
        neutralized(missingMessage, NONEXISTENT_COMMENT_ID),
      );
      expect(result.errors![0].message).not.toMatch(/block/i);
      expect(await creationAdmissions(viewer.id)).toBe(admissionsBefore);

      const replies = await dbHelper.db.select().from(comments).where(eq(comments.parentId, scenario.commentId));
      expect(replies).toHaveLength(0);
      const countersAfter = await storedCounters(scenario.postId, []);
      expect(countersAfter.postCommentCount).toBe(countersBefore.postCommentCount);
    }

    // A Post creator replying to a blocked parent author is also rejected.
    await clearBlocks();
    await setBlock(poster, author);
    const creatorReply = await runGql<{ createReply: null }>(
      CREATE_REPLY_MUTATION,
      {
        input: { clientRequestId: 'isolation-reply-creator', commentId: parentByAuthor.id, text: 'Creator reply' },
      },
      poster,
    );
    expect(creatorReply.data?.createReply ?? null).toBeNull();
    expect(creatorReply.errors).toHaveLength(1);
    expect(creatorReply.errors![0].message).not.toMatch(/block/i);

    await clearBlocks();
    const restored = await runGql<{ createReply: { id: string } }>(
      CREATE_REPLY_MUTATION,
      { input: { clientRequestId: 'isolation-reply-restored', commentId: parentByAuthor.id, text: 'Restored' } },
      viewer,
    );
    expect(restored.errors).toBeUndefined();
    expect(restored.data!.createReply.id).toBeDefined();
  });

  it('multi-party Reply locking is deterministic, ordered before discussion locks, and deadlock-free', async () => {
    const post = await seedPost(poster.id);
    const parentByAuthor = await seedComment({ postId: post.id, authorId: author.id, text: 'Parent A' });
    const parentByOther = await seedComment({ postId: post.id, authorId: other.id, text: 'Parent O' });
    await syncCanonicalCounters(post.id);

    // (a) While another session holds the Post discussion lock, an isolated Reply
    // must fail immediately: the pair lock and recheck happen before the
    // discussion lock, so the write never waits behind the held discussion lock.
    await setBlock(viewer, author);
    const discussionHolder = await dbHelper.pool.connect();
    try {
      await discussionHolder.query('BEGIN');
      await discussionHolder.query(`SELECT pg_advisory_xact_lock(hashtextextended('comment_discussion:' || $1, 0))`, [
        post.id,
      ]);

      const rejected = commentsRepository.createReplyWithCounters({
        commentId: parentByAuthor.id,
        authorId: viewer.id,
        text: 'Isolated reply against a held discussion lock',
        clientRequestId: 'isolation-reply-lock-order',
        requestHash: 'isolation-reply-lock-order-hash',
      });
      await expect(withTimeout(rejected, 5_000, 'isolated reply')).rejects.toThrow(NotFoundError);
    } finally {
      await discussionHolder.query('ROLLBACK');
      discussionHolder.release();
    }
    await clearBlocks();

    // (b) Concurrent Replies with overlapping account pairs all commit without a
    // PostgreSQL deadlock. pg_stat_database.deadlocks is the authoritative signal.
    const deadlocksBefore = await deadlockCount();
    const concurrentReplies = [
      { authorId: viewer.id, commentId: parentByAuthor.id, requestId: 'race-reply-1' },
      { authorId: author.id, commentId: parentByOther.id, requestId: 'race-reply-2' },
      { authorId: other.id, commentId: parentByAuthor.id, requestId: 'race-reply-3' },
      { authorId: viewer.id, commentId: parentByOther.id, requestId: 'race-reply-4' },
    ];

    const results = await Promise.all(
      concurrentReplies.map((entry) =>
        runGql<{ createReply: { id: string } }>(
          CREATE_REPLY_MUTATION,
          {
            input: {
              clientRequestId: entry.requestId,
              commentId: entry.commentId,
              text: `Concurrent reply ${entry.requestId}`,
            },
          },
          [viewer, author, other].find((user) => user.id === entry.authorId),
        ),
      ),
    );
    for (const result of results) {
      expect(result.errors).toBeUndefined();
      expect(result.data!.createReply.id).toBeDefined();
    }
    expect(await deadlockCount()).toBe(deadlocksBefore);

    const [postAfter] = await dbHelper.db.select().from(posts).where(eq(posts.id, post.id));
    expect(postAfter.commentCount).toBe(6);
    const [parentAAfter] = await dbHelper.db.select().from(comments).where(eq(comments.id, parentByAuthor.id));
    expect(parentAAfter.replyCount).toBe(2);
    const [parentOAfter] = await dbHelper.db.select().from(comments).where(eq(comments.id, parentByOther.id));
    expect(parentOAfter.replyCount).toBe(2);
  });

  it('a committed Block rejects a concurrent Reply and a committed Reply is hidden by a later Block', async () => {
    const post = await seedPost(poster.id);
    const parent = await seedComment({ postId: post.id, authorId: author.id, text: 'Race parent' });
    await syncCanonicalCounters(post.id);

    // Block commits first: the Reply waits on the canonical pair lock, then the
    // in-transaction recheck rejects it with neutral behavior and no side effects.
    const blocker = await dbHelper.pool.connect();
    const pairKeys = canonicalAccountPairKeys([[viewer.id, author.id]]);
    const { rows: pairIds } = await dbHelper.pool.query<{ classid: number; objid: number }>(
      `SELECT hashtext('account_pair')::int AS classid, hashtext($1)::int AS objid`,
      [pairKeys[0]],
    );
    let committed = false;
    try {
      await blocker.query('BEGIN');
      await blocker.query(`SELECT pg_advisory_xact_lock(hashtext('account_pair'), hashtext($1))`, [pairKeys[0]]);
      await blocker.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [viewer.id, author.id]);

      const reply = runGql<{ createReply: { id: string } }>(
        CREATE_REPLY_MUTATION,
        {
          input: { clientRequestId: 'isolation-race-reply', commentId: parent.id, text: 'Racing reply' },
        },
        viewer,
      );
      await waitForUngrantedAdvisoryLock(pairIds[0].classid, pairIds[0].objid);

      await blocker.query('COMMIT');
      committed = true;

      const result = await withTimeout(reply, 5_000, 'racing reply');
      expect(result.data?.createReply ?? null).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].message).not.toMatch(/block/i);

      const persisted = await dbHelper.db.select().from(comments).where(eq(comments.parentId, parent.id));
      expect(persisted).toHaveLength(0);
      expect(await creationAdmissions(viewer.id)).toBe(0);
      const [postAfterRejection] = await dbHelper.db.select().from(posts).where(eq(posts.id, post.id));
      expect(postAfterRejection.commentCount).toBe(1);
    } finally {
      if (!committed) await blocker.query('ROLLBACK');
      blocker.release();
    }

    // Reply commits first: the following Block hides it without rewriting the
    // canonical stored counters or deleting the row.
    await clearBlocks();
    const parentByOther = await seedComment({ postId: post.id, authorId: other.id, text: 'Reachable parent' });
    await syncCanonicalCounters(post.id);
    const accepted = await runGql<{ createReply: { id: string } }>(
      CREATE_REPLY_MUTATION,
      {
        input: { clientRequestId: 'isolation-reply-before-block', commentId: parentByOther.id, text: 'Accepted reply' },
      },
      author,
    );
    expect(accepted.errors).toBeUndefined();
    const acceptedId = accepted.data!.createReply.id;

    await setBlock(viewer, author);
    const visible = await repliesPage(parentByOther.id, { first: 10 }, viewer);
    expect(nodeIds(visible)).not.toContain(acceptedId);
    const stored = await storedCounters(post.id, [parentByOther.id]);
    expect(stored.replyCounts.get(parentByOther.id)).toBe(1);
    expect(stored.postCommentCount).toBe(3);
    const [replyRow] = await dbHelper.db.select().from(comments).where(eq(comments.id, acceptedId));
    expect(replyRow.status).toBe('ACTIVE');

    await clearBlocks();
    const restored = await repliesPage(parentByOther.id, { first: 10 }, viewer);
    expect(nodeIds(restored)).toContain(acceptedId);
    expect(await commentCountFor(post.id, viewer)).toBe(3);
  });

  it('stored global counters stay canonical when Blocks change and personalized counts track reachability', async () => {
    const post = await seedPost(poster.id);
    const topLevelVisible = await seedComment({
      postId: post.id,
      authorId: other.id,
      text: 'Top-level visible',
      createdAt: new Date('2026-03-03T00:00:00Z'),
    });
    const topLevelBlocked = await seedComment({
      postId: post.id,
      authorId: author.id,
      text: 'Top-level blocked',
      createdAt: new Date('2026-03-02T00:00:00Z'),
    });
    const visibleReply = await seedComment({
      postId: post.id,
      authorId: other.id,
      parentId: topLevelVisible.id,
      text: 'Visible reply',
      createdAt: new Date('2026-03-03T00:01:00Z'),
    });
    const blockedReply = await seedComment({
      postId: post.id,
      authorId: author.id,
      parentId: topLevelVisible.id,
      text: 'Blocked reply',
      createdAt: new Date('2026-03-03T00:02:00Z'),
    });
    const hiddenBranchReply = await seedComment({
      postId: post.id,
      authorId: other.id,
      parentId: topLevelBlocked.id,
      text: 'Reply in blocked branch',
      createdAt: new Date('2026-03-02T00:01:00Z'),
    });
    await syncCanonicalCounters(post.id);

    expect(await commentCountFor(post.id, viewer)).toBe(5);
    expect(await commentCountFor(post.id)).toBe(5);

    const [canonicalBefore] = await dbHelper.db.select().from(posts).where(eq(posts.id, post.id));
    expect(canonicalBefore.commentCount).toBe(5);

    await setBlock(viewer, author);

    expect(await commentCountFor(post.id, viewer)).toBe(2);
    expect(await commentCountFor(post.id)).toBe(5);
    const [canonicalDuring] = await dbHelper.db.select().from(posts).where(eq(posts.id, post.id));
    expect(canonicalDuring.commentCount).toBe(5);

    const page = await commentsPage(post.id, { sort: 'TOP', first: 10 }, viewer);
    expect(nodeIds(page)).toEqual([topLevelVisible.id]);
    const visibleNode = page.edges[0].node;
    expect(visibleNode.replyCount).toBe(1);
    const reachableReplies = await repliesPage(topLevelVisible.id, { first: 10 }, viewer);
    expect(nodeIds(reachableReplies)).toEqual([visibleReply.id]);
    expect(nodeIds(reachableReplies)).not.toContain(blockedReply.id);
    const blockedBranchMessage = await replyErrorMessage(topLevelBlocked.id, viewer);
    expect(blockedBranchMessage).not.toMatch(/block/i);
    const [parentDuring] = await dbHelper.db.select().from(comments).where(eq(comments.id, topLevelVisible.id));
    expect(parentDuring.replyCount).toBe(2);

    await clearBlocks();
    expect(await commentCountFor(post.id, viewer)).toBe(5);
    const restoredPage = await commentsPage(post.id, { sort: 'TOP', first: 10 }, viewer);
    expect(nodeIds(restoredPage)).toContain(topLevelBlocked.id);
    expect(restoredPage.edges.find((edge) => edge.node.id === topLevelVisible.id)!.node.replyCount).toBe(2);
    const restoredHiddenBranch = await repliesPage(topLevelBlocked.id, { first: 10 }, viewer);
    expect(nodeIds(restoredHiddenBranch)).toEqual([hiddenBranchReply.id]);
    const [canonicalAfter] = await dbHelper.db.select().from(posts).where(eq(posts.id, post.id));
    expect(canonicalAfter.commentCount).toBe(5);
  });

  it('viewer-visible commentCount and replyCount batch through request-scoped loaders without N+1 queries', async () => {
    const captured: Array<{ sql: string; params: unknown[] }> = [];
    const capturingDb: NodePgDatabase<typeof schema> = drizzle(dbHelper.pool, {
      schema,
      logger: {
        logQuery(query: string, params: unknown[]) {
          captured.push({ sql: query, params });
        },
      },
    });
    const capturingRepository = new CommentsRepository(capturingDb);

    const postOne = await seedPost(poster.id);
    const postTwo = await seedPost(poster.id);
    const postThree = await seedPost(poster.id);
    const commentOne = await seedComment({ postId: postOne.id, authorId: other.id, text: 'Counted comment one' });
    const commentTwo = await seedComment({ postId: postOne.id, authorId: other.id, text: 'Counted comment two' });
    const commentThree = await seedComment({ postId: postTwo.id, authorId: other.id, text: 'Counted comment three' });
    await seedComment({ postId: postThree.id, authorId: other.id, text: 'Counted comment four' });
    await seedComment({
      postId: postOne.id,
      authorId: author.id,
      parentId: commentOne.id,
      text: 'Counted reply one',
    });
    await seedComment({
      postId: postOne.id,
      authorId: author.id,
      parentId: commentTwo.id,
      text: 'Counted reply two',
    });
    await syncCanonicalCounters(postOne.id);
    await syncCanonicalCounters(postTwo.id);
    await syncCanonicalCounters(postThree.id);

    await setBlock(viewer, author);

    const commentCountLoader = capturingRepository.createReachableCommentCountByPostIdLoader();
    captured.length = 0;
    const counts = await Promise.all(
      [postOne.id, postTwo.id, postThree.id].map((postId) => commentCountLoader.load(`${viewer.id}:${postId}`)),
    );
    expect(counts).toEqual([2, 1, 1]);
    // Two batched queries total (top-level + replies) regardless of Post count.
    expect(captured).toHaveLength(2);

    const replyCountLoader = capturingRepository.createReachableReplyCountByCommentIdLoader();
    captured.length = 0;
    const replyCounts = await Promise.all(
      [commentOne.id, commentTwo.id, commentThree.id].map((commentId) =>
        replyCountLoader.load(`${viewer.id}:${commentId}`),
      ),
    );
    expect(replyCounts).toEqual([0, 0, 0]);
    expect(captured).toHaveLength(1);

    // Anonymous and unblocked viewers resolve the canonical stored counters.
    const anonymousLoader = capturingRepository.createReachableCommentCountByPostIdLoader();
    expect(await anonymousLoader.load(`:${postOne.id}`)).toBe(4);
    expect(await anonymousLoader.load(`:${postTwo.id}`)).toBe(1);
    expect(await anonymousLoader.load(`:${postThree.id}`)).toBe(1);
    const anonymousReplyLoader = capturingRepository.createReachableReplyCountByCommentIdLoader();
    expect(await anonymousReplyLoader.load(`:${commentOne.id}`)).toBe(1);
    expect(await anonymousReplyLoader.load(`:${commentTwo.id}`)).toBe(1);
    expect(await anonymousReplyLoader.load(`:${commentThree.id}`)).toBe(0);

    // End-to-end: the field resolvers use the same batched loaders.
    const endToEnd = await runGql<{ post: { id: string; commentCount: number } }>(
      POST_COMMENT_COUNT_QUERY,
      { id: postOne.id },
      viewer,
    );
    expect(endToEnd.errors).toBeUndefined();
    expect(endToEnd.data!.post.commentCount).toBe(2);

    // Sibling Post fields in one authenticated GraphQL request share the
    // request-scoped loader: the query count stays constant as Posts grow.
    const baseContext = createContext(viewer);
    const capturingContext: GqlContext = {
      ...baseContext,
      loaders: {
        ...baseContext.loaders,
        reachableCommentCountByPostId: capturingRepository.createReachableCommentCountByPostIdLoader(),
        reachableReplyCountByCommentId: capturingRepository.createReachableReplyCountByCommentIdLoader(),
      },
    };

    captured.length = 0;
    const batchedPosts = (await graphql({
      schema: executableSchema,
      source: `query Counted($ids: [ID!]!) {
        countedPosts(ids: $ids) { id commentCount }
      }`,
      variableValues: { ids: [postOne.id, postTwo.id, postThree.id] },
      contextValue: capturingContext,
    })) as ExecutionResult<{ countedPosts: Array<{ id: string; commentCount: number }> }>;
    expect(batchedPosts.errors).toBeUndefined();
    const countsByPostId = new Map(batchedPosts.data!.countedPosts.map((post) => [post.id, post.commentCount]));
    expect(countsByPostId.get(postOne.id)).toBe(2);
    expect(countsByPostId.get(postTwo.id)).toBe(1);
    expect(countsByPostId.get(postThree.id)).toBe(1);
    expect(captured).toHaveLength(2);

    // Sibling Comment fields in one response batch their viewer-visible reply
    // counts into a single query, even though the stored counts are canonical.
    captured.length = 0;
    const batchedComments = (await graphql({
      schema: executableSchema,
      source: `query {
        comments(postId: "${postOne.id}") {
          edges { node { id replyCount } }
        }
      }`,
      contextValue: capturingContext,
    })) as ExecutionResult<{ comments: CommentPage }>;
    expect(batchedComments.errors).toBeUndefined();
    expect(batchedComments.data!.comments.edges.map((edge) => edge.node.replyCount)).toEqual([0, 0]);
    expect(captured).toHaveLength(1);

    await clearBlocks();
    expect(await commentCountFor(postOne.id, viewer)).toBe(4);
    const replies = await repliesPage(commentOne.id, { first: 10 }, viewer);
    expect(replies.edges).toHaveLength(1);
  });

  it('query-plan evidence: isolation executes in SQL before the Comment limit with bounded indexed Block access', async () => {
    const captured: Array<{ sql: string; params: unknown[] }> = [];
    const capturingDb: NodePgDatabase<typeof schema> = drizzle(dbHelper.pool, {
      schema,
      logger: {
        logQuery(query: string, params: unknown[]) {
          captured.push({ sql: query, params });
        },
      },
    });
    const capturingRepository = new CommentsRepository(capturingDb);

    const post = await seedPost(poster.id);
    const fillers = await dbHelper.db
      .insert(users)
      .values(
        Array.from({ length: 120 }, (_, index) => ({
          firebaseUserId: `comment-plan-filler-${index}-${generateUuidV7()}`,
          email: `comment-plan-filler-${index}-${generateUuidV7()}@pupzy.dev`,
          fullName: `Comment Plan Filler ${index}`,
        })),
      )
      .returning();

    await dbHelper.pool.query(`
      INSERT INTO blocks (blocker_id, blocked_id)
      SELECT a.id, b.id
      FROM users a
      CROSS JOIN users b
      WHERE a.firebase_user_id LIKE 'comment-plan-filler-%'
        AND b.firebase_user_id LIKE 'comment-plan-filler-%'
        AND a.id <> b.id
    `);
    await dbHelper.db
      .insert(blocks)
      .values([
        { blockerId: viewer.id, blockedId: author.id },
        ...fillers.slice(0, 20).map((filler) => ({ blockerId: viewer.id, blockedId: filler.id })),
      ]);

    const createdAt = Date.now();
    await dbHelper.db.insert(comments).values(
      Array.from({ length: 400 }, (_, index) => ({
        postId: post.id,
        authorId: index % 3 === 0 ? viewer.id : index % 3 === 1 ? author.id : fillers[index % fillers.length].id,
        text: `Plan comment ${index}`,
        boostCount: index,
        createdAt: new Date(createdAt - index * 1_000),
        updatedAt: new Date(createdAt - index * 1_000),
      })),
    );
    await syncCanonicalCounters(post.id);
    await dbHelper.pool.query('ANALYZE comments');
    await dbHelper.pool.query('ANALYZE blocks');

    captured.length = 0;
    await capturingRepository.findTopLevelCommentsByPostId(post.id, 20, 'TOP', undefined, viewer.id);
    const listQuery = captured.find(
      (entry) => entry.sql.includes('order by') && entry.sql.includes('"comments"."boost_count"'),
    );
    expect(listQuery).toBeDefined();

    const explain = await dbHelper.pool.query<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>({
      text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${listQuery!.sql}`,
      values: listQuery!.params,
    });
    const plan = explain.rows[0]['QUERY PLAN'][0].Plan;

    const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap((child) => flatten(child))];
    const nodes = flatten(plan);

    const limit = nodes.find((node) => node['Node Type'] === 'Limit');
    expect(limit).toBeDefined();
    // The limit receives a full viewer-visible page (limit + 1), not a sparse
    // post-filtered page.
    expect(limit!['Actual Rows']).toBe(21);

    // Two Block predicates may be planned (the top-level anti-join and the
    // correlated tombstone probe), each one bounded lookup per Block direction —
    // never one pair check per candidate row.
    const blocksScans = nodes.filter((node) => node['Relation Name'] === 'blocks');
    expect(blocksScans.length).toBeGreaterThan(0);
    expect(blocksScans.length).toBeLessThanOrEqual(4);
    for (const scan of blocksScans) {
      expect(String(scan['Node Type'])).toMatch(/Index|Bitmap/);
      expect(scan['Actual Loops']).toBeLessThanOrEqual(2);
    }
  });
});

import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { eq, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  blocks,
  cities,
  postMedia,
  postSaves,
  posts,
  users,
  type City,
  type Post,
  type User,
} from '../database/schema';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';
import { PostsResolver } from './posts.resolver';
import { CitiesRepository } from '../cities/cities.repository';
import { UsersRepository } from '../users/users.repository';
import { AccountDeletionRepository } from '../users/account-deletion.repository';
import { CitiesService } from '../cities/cities.service';
import { UsersService } from '../users/users.service';
import { UploadService } from '../upload/upload.service';
import { ViewFlushCron } from './view-flush.cron';
import { NotificationsService } from '../notifications/notifications.service';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import type { GqlContext } from '../common/types/gql-context.type';

type PostType = 'RESCUE' | 'LOST' | 'ADOPTION' | 'PRODUCT' | 'MATING';

const NONEXISTENT_POST_ID = '0192ffff-0000-7000-8000-000000000000';

const UPDATE_POST_STATUS = `mutation UpdatePostStatus($postId: ID!, $status: PostStatus!) {
  updatePostStatus(postId: $postId, status: $status) { id status postType }
}`;

const DELETE_POST = `mutation DeletePost($postId: ID!) {
  deletePost(postId: $postId)
}`;

const DIRECT_POST = `query DirectPost($id: ID!) {
  post(id: $id) { id status postType }
}`;

const RESCUE_DETAIL = `query RescueDetail($postId: ID!) {
  rescuePostDetail(postId: $postId) { postId }
}`;

const HOME_FEED = `query Home($cityId: ID, $first: Int) {
  homeFeed(cityId: $cityId, first: $first) { edges { node { id status } } }
}`;

const MY_POSTS = `query Mine($postType: PostType!, $first: Int) {
  myPosts(postType: $postType, first: $first) { edges { node { id status } } }
}`;

const SAVED_POSTS = `query Saved($first: Int) {
  mySavedPosts(first: $first) { edges { node { id status } } }
}`;

interface UpdateStatusData {
  updatePostStatus: { id: string; status: Post['status']; postType: Post['postType'] };
}

interface DeletePostData {
  deletePost: boolean;
}

interface DirectPostData {
  post: { id: string; status: Post['status']; postType: Post['postType'] } | null;
}

interface FeedData {
  homeFeed: { edges: Array<{ node: { id: string; status: Post['status'] } }> };
}

interface MyPostsData {
  myPosts: { edges: Array<{ node: { id: string; status: Post['status'] } }> };
}

interface SavedPostsData {
  mySavedPosts: { edges: Array<{ node: { id: string; status: Post['status'] } }> };
}

describe('Post lifecycle transitions through the executable GraphQL schema (Ticket 01)', () => {
  jest.setTimeout(180_000);

  let dbHelper: TestDatabaseHelper;
  let postsService: PostsService;
  let postsResolver: PostsResolver;
  let citiesService: CitiesService;
  let usersService: UsersService;
  let executableSchema: GraphQLSchema;
  let cacheStore: Map<string, unknown>;
  let mockCache: Cache;

  let testCity: City;
  let owner: User;
  let other: User;
  let viewer: User;

  let postSequence = 0;

  function nextPostId(): string {
    postSequence += 1;
    return `0192f1e0-0000-7000-8000-${String(postSequence).padStart(12, '0')}`;
  }

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    cacheStore = new Map<string, unknown>();
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
    const postsRepository = new PostsRepository(dbHelper.db);

    citiesService = new CitiesService(citiesRepo, mockCache);
    usersService = new UsersService(
      usersRepo,
      citiesService,
      new AccountDeletionRepository(dbHelper.db),
      mockConfig,
      mockCache,
    );

    postsService = new PostsService(
      postsRepository,
      citiesService,
      {} as UploadService,
      {} as ViewFlushCron,
      usersService,
      { fireNotification: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService,
      mockCache,
    );
    postsResolver = new PostsResolver(postsService);

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
    const typeDefs = schemaFiles.map((relPath) => fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf8'));

    executableSchema = makeExecutableSchema({
      typeDefs,
      resolvers: {
        DateTime: {
          __parseValue: (value: unknown) => value,
          __serialize: (value: unknown) => (value instanceof Date ? value.toISOString() : value),
        },
        Query: {
          post: (_root: unknown, args: { id: string }, ctx: GqlContext) => postsResolver.post(args.id, ctx),
          rescuePostDetail: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.rescuePostDetail(args.postId, ctx),
          homeFeed: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) =>
            postsResolver.homeFeed(args, ctx),
          myPosts: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) => postsResolver.myPosts(args, ctx),
          mySavedPosts: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) =>
            postsResolver.mySavedPosts(args, ctx),
        },
        Mutation: {
          updatePostStatus: (_root: unknown, args: { postId: string; status: string }, ctx: GqlContext) =>
            postsResolver.updatePostStatus(args.postId, args.status, ctx),
          deletePost: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.deletePost(args.postId, ctx),
        },
      },
    });
  });

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();
    cacheStore.clear();

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

    owner = await insertUser('owner');
    other = await insertUser('other');
    viewer = await insertUser('viewer');
  });

  async function insertUser(label: string): Promise<User> {
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${label}-${generateUuidV7()}`,
        email: `${label}-${generateUuidV7()}@pupzy.dev`,
        fullName: `Lifecycle ${label}`,
      })
      .returning();
    return user;
  }

  async function seedPost(params: {
    creatorId?: string;
    postType: PostType;
    status?: Post['status'];
    id?: string;
  }): Promise<Post> {
    const id = params.id ?? nextPostId();
    const isUrgencyType = params.postType === 'RESCUE' || params.postType === 'LOST';
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        id,
        creatorId: params.creatorId ?? owner.id,
        postType: params.postType,
        title: `Lifecycle ${params.postType} ${id.slice(-4)}`,
        description: 'Lifecycle contract fixture',
        status: params.status ?? 'ACTIVE',
        moderationStatus: 'CLEAN',
        urgency: isUrgencyType ? 'URGENT' : undefined,
        cityId: testCity.id,
        governorate: testCity.governorate,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
        effectiveScore: 0,
      })
      .returning();
    return post;
  }

  function createContext(user?: User): GqlContext {
    return { req: {} as unknown as GqlContext['req'], user, loaders: {} as GqlContext['loaders'] };
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

  async function closePost(post: Post, user: User = owner, status = 'RESOLVED') {
    return runGql<UpdateStatusData>(UPDATE_POST_STATUS, { postId: post.id, status }, user);
  }

  async function removePost(post: Post, user: User = owner) {
    return runGql<DeletePostData>(DELETE_POST, { postId: post.id }, user);
  }

  async function storedPost(postId: string): Promise<Post> {
    const [row] = await dbHelper.db.select().from(posts).where(eq(posts.id, postId));
    return row;
  }

  async function storedPostCount(userId: string): Promise<number> {
    const [row] = await dbHelper.pool
      .query<{ post_count: number }>('SELECT post_count FROM users WHERE id = $1', [userId])
      .then((result) => result.rows);
    return Number(row.post_count);
  }

  function errorCode(result: ExecutionResult<unknown>): string | undefined {
    return (result.errors?.[0].originalError as { code?: string } | undefined)?.code;
  }

  // ─── Owner closure ──────────────────────────────────────────────────────

  describe('owner closure', () => {
    it.each([
      ['RESCUE', 'RESOLVED'],
      ['LOST', 'REUNITED'],
      ['ADOPTION', 'ADOPTED'],
      ['PRODUCT', 'SOLD'],
    ] as Array<[PostType, Post['status']]>)(
      'closes an ACTIVE %s Post as %s without leaving discovery',
      async (postType, outcome) => {
        const post = await seedPost({ postType });

        const result = await closePost(post, owner, outcome);

        expect(result.errors).toBeUndefined();
        expect(result.data?.updatePostStatus).toMatchObject({ id: post.id, status: outcome, postType });

        const persisted = await storedPost(post.id);
        expect(persisted.status).toBe(outcome);
        expect(await storedPostCount(owner.id)).toBe(1);

        const direct = await runGql<DirectPostData>(DIRECT_POST, { id: post.id }, owner);
        expect(direct.errors).toBeUndefined();
        expect(direct.data?.post?.status).toBe(outcome);

        const feed = await runGql<FeedData>(HOME_FEED, { cityId: testCity.id, first: 20 }, viewer);
        expect(feed.data?.homeFeed.edges.map((edge) => edge.node.id)).not.toContain(post.id);
      },
    );

    it('keeps MATING out of owner closure in this preparatory contract', async () => {
      const post = await seedPost({ postType: 'MATING' });

      const result = await closePost(post, owner, 'RESOLVED');

      expect(result.data?.updatePostStatus ?? null).toBeNull();
      expect(errorCode(result)).toBe('VALIDATION_ERROR');
      expect(result.errors?.[0].message).toContain('MATING posts can only transition to: .');
      expect((await storedPost(post.id)).status).toBe('ACTIVE');
    });

    it('rejects a closure target that belongs to another Post type', async () => {
      const rescue = await seedPost({ postType: 'RESCUE' });
      const product = await seedPost({ postType: 'PRODUCT' });

      const rescueResult = await closePost(rescue, owner, 'SOLD');
      expect(errorCode(rescueResult)).toBe('VALIDATION_ERROR');
      expect(rescueResult.errors?.[0].message).toContain('RESCUE posts can only transition to: RESOLVED');

      const productResult = await closePost(product, owner, 'RESOLVED');
      expect(errorCode(productResult)).toBe('VALIDATION_ERROR');
      expect(productResult.errors?.[0].message).toContain('PRODUCT posts can only transition to: SOLD');

      expect((await storedPost(rescue.id)).status).toBe('ACTIVE');
      expect((await storedPost(product.id)).status).toBe('ACTIVE');
    });

    it('rejects a second closure and treats a Removed Post as not found', async () => {
      const post = await seedPost({ postType: 'RESCUE' });
      await closePost(post, owner, 'RESOLVED');

      const repeated = await closePost(post, owner, 'RESOLVED');
      expect(errorCode(repeated)).toBe('VALIDATION_ERROR');
      expect(repeated.errors?.[0].message).toContain('already in "RESOLVED" status');

      const removed = await seedPost({ postType: 'RESCUE', status: 'REMOVED' });
      const removedResult = await closePost(removed, owner, 'RESOLVED');
      expect(errorCode(removedResult)).toBe('NOT_FOUND');

      const missingResult = await closePost({ id: NONEXISTENT_POST_ID } as Post, owner, 'RESOLVED');
      expect(errorCode(missingResult)).toBe('NOT_FOUND');
    });

    it('rejects closure by anyone but the owner', async () => {
      const post = await seedPost({ postType: 'RESCUE' });

      const result = await closePost(post, other, 'RESOLVED');
      expect(errorCode(result)).toBe('FORBIDDEN');
      expect((await storedPost(post.id)).status).toBe('ACTIVE');
    });

    it('invalidates the owner profile cache after a closure commit', async () => {
      const post = await seedPost({ postType: 'ADOPTION' });
      const cacheKey = `user_resolve:${owner.firebaseUserId}`;
      cacheStore.set(cacheKey, { id: owner.id });

      const result = await closePost(post, owner, 'ADOPTED');
      expect(result.errors).toBeUndefined();

      expect(cacheStore.has(cacheKey)).toBe(false);
    });

    it('serializes concurrent competing closures so one commits and one is rejected', async () => {
      const post = await seedPost({ postType: 'RESCUE' });

      const [first, second] = await Promise.all([
        closePost(post, owner, 'RESOLVED'),
        closePost(post, owner, 'RESOLVED'),
      ]);
      const outcomes = [errorCode(first), errorCode(second)];
      // The loser observes the committed status either during its pre-lock read
      // (VALIDATION_ERROR) or when it revalidates after taking the lock
      // (NOT_FOUND). Both are stable, non-mutating rejections.
      expect(outcomes.filter((code) => code === undefined)).toHaveLength(1);
      expect(outcomes.filter((code) => code !== undefined)).toHaveLength(1);
      expect(['VALIDATION_ERROR', 'NOT_FOUND']).toContain(outcomes.find((code) => code !== undefined));
      expect((await storedPost(post.id)).status).toBe('RESOLVED');
    });
  });

  // ─── Owner removal ──────────────────────────────────────────────────────

  describe('owner removal', () => {
    it('sets a Removed Post, hides it from every client surface and invalidates the profile cache', async () => {
      const post = await seedPost({ postType: 'RESCUE' });
      await dbHelper.db.insert(postSaves).values({ postId: post.id, userId: owner.id });
      const cacheKey = `user_resolve:${owner.firebaseUserId}`;
      cacheStore.set(cacheKey, { id: owner.id });

      const result = await removePost(post);
      expect(result.errors).toBeUndefined();
      expect(result.data?.deletePost).toBe(true);

      const persisted = await storedPost(post.id);
      expect(persisted.status).toBe('REMOVED');
      expect(await storedPostCount(owner.id)).toBe(0);
      expect(cacheStore.has(cacheKey)).toBe(false);

      const direct = await runGql<DirectPostData>(DIRECT_POST, { id: post.id }, owner);
      expect(direct.errors).toBeUndefined();
      expect(direct.data?.post).toBeNull();

      const detail = await runGql(RESCUE_DETAIL, { postId: post.id }, owner);
      expect(errorCode(detail)).toBe('NOT_FOUND');

      const feed = await runGql<FeedData>(HOME_FEED, { cityId: testCity.id, first: 20 }, viewer);
      expect(feed.data?.homeFeed.edges.map((edge) => edge.node.id)).not.toContain(post.id);

      const mine = await runGql<MyPostsData>(MY_POSTS, { postType: 'RESCUE', first: 20 }, owner);
      expect(mine.data?.myPosts.edges.map((edge) => edge.node.id)).not.toContain(post.id);

      const saved = await runGql<SavedPostsData>(SAVED_POSTS, { first: 20 }, owner);
      expect(saved.data?.mySavedPosts.edges.map((edge) => edge.node.id)).not.toContain(post.id);
    });

    it('retains Post media rows when the owner removes the Post', async () => {
      const post = await seedPost({ postType: 'RESCUE' });
      await dbHelper.db.insert(postMedia).values({
        postId: post.id,
        publicUrl: 'https://cdn.pupzy.net/posts/lifecycle.webp',
        cloudflareStorageKey: `posts/${post.id}/lifecycle.webp`,
        displayOrder: 0,
      });

      const result = await removePost(post);
      expect(result.errors).toBeUndefined();

      const retainedMedia = await dbHelper.db.select().from(postMedia).where(eq(postMedia.postId, post.id));
      expect(retainedMedia).toHaveLength(1);
      expect((await storedPost(post.id)).status).toBe('REMOVED');
    });

    it('keeps manual removal available from a recorded outcome', async () => {
      const post = await seedPost({ postType: 'PRODUCT' });
      await closePost(post, owner, 'SOLD');

      const result = await removePost(post);
      expect(result.errors).toBeUndefined();
      expect(result.data?.deletePost).toBe(true);
      expect((await storedPost(post.id)).status).toBe('REMOVED');
    });

    it('rejects removal by non-owners and treats missing or already Removed Posts as not found', async () => {
      const post = await seedPost({ postType: 'RESCUE' });

      const forbidden = await removePost(post, other);
      expect(errorCode(forbidden)).toBe('FORBIDDEN');
      expect((await storedPost(post.id)).status).toBe('ACTIVE');

      await removePost(post);
      const repeated = await removePost(post);
      expect(errorCode(repeated)).toBe('NOT_FOUND');

      const missing = await removePost({ id: NONEXISTENT_POST_ID } as Post);
      expect(errorCode(missing)).toBe('NOT_FOUND');
    });
  });

  // ─── Isolation continuity ───────────────────────────────────────────────

  describe('isolation continuity', () => {
    it('keeps a closed or Removed Post invisible to an isolated viewer in either Block direction', async () => {
      const closedPost = await seedPost({ postType: 'RESCUE' });
      await closePost(closedPost, owner, 'RESOLVED');
      const removedPost = await seedPost({ postType: 'ADOPTION' });
      await removePost(removedPost);

      for (const direction of ['viewer-blocks', 'owner-blocks'] as const) {
        await dbHelper.db.delete(blocks);
        if (direction === 'viewer-blocks') {
          await dbHelper.db.insert(blocks).values({ blockerId: viewer.id, blockedId: owner.id });
        } else {
          await dbHelper.db.insert(blocks).values({ blockerId: owner.id, blockedId: viewer.id });
        }

        const closedDirect = await runGql<DirectPostData>(DIRECT_POST, { id: closedPost.id }, viewer);
        expect(closedDirect.data?.post).toBeNull();
        const removedDirect = await runGql<DirectPostData>(DIRECT_POST, { id: removedPost.id }, viewer);
        expect(removedDirect.data?.post).toBeNull();

        const closedDetail = await runGql(RESCUE_DETAIL, { postId: closedPost.id }, viewer);
        expect(errorCode(closedDetail)).toBe('NOT_FOUND');
        expect(closedDetail.errors?.[0].message).not.toMatch(/block/i);
      }

      await dbHelper.db.delete(blocks);
      const unblocked = await runGql<DirectPostData>(DIRECT_POST, { id: closedPost.id }, viewer);
      expect(unblocked.data?.post?.status).toBe('RESOLVED');
    });

    it('does not let an isolated third party close or remove another account’s Post', async () => {
      const post = await seedPost({ postType: 'RESCUE' });
      await dbHelper.db.insert(blocks).values({ blockerId: owner.id, blockedId: viewer.id });

      const closeAttempt = await closePost(post, viewer, 'RESOLVED');
      expect(errorCode(closeAttempt)).toBe('FORBIDDEN');
      const removeAttempt = await removePost(post, viewer);
      expect(errorCode(removeAttempt)).toBe('FORBIDDEN');

      expect((await storedPost(post.id)).status).toBe('ACTIVE');
    });

    it('lets the owner close and remove their own Post while a Block exists with another account', async () => {
      const post = await seedPost({ postType: 'LOST' });
      await dbHelper.db.insert(blocks).values({ blockerId: owner.id, blockedId: viewer.id });

      const closed = await closePost(post, owner, 'REUNITED');
      expect(closed.errors).toBeUndefined();
      expect((await storedPost(post.id)).status).toBe('REUNITED');

      const removed = await removePost(post, owner);
      expect(removed.errors).toBeUndefined();
      expect((await storedPost(post.id)).status).toBe('REMOVED');
    });
  });
});

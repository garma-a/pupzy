import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import DataLoader from 'dataloader';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  users,
  cities,
  posts,
  comments,
  discussionNotificationEvents,
  type User,
  type City,
  type Post,
} from '../database/schema';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';
import { CommentsResolver, CommentMediaResolver } from './comments.resolver';
import { PostsRepository } from '../posts/posts.repository';
import { CitiesRepository } from '../cities/cities.repository';
import { UsersRepository } from '../users/users.repository';
import { CitiesService } from '../cities/cities.service';
import { UsersService } from '../users/users.service';
import { UploadService } from '../upload/upload.service';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import type { GqlContext } from '../common/types/gql-context.type';

describe('Comments Ordering, Pinning, and Pagination Integration (Ticket 02)', () => {
  jest.setTimeout(120_000);

  let dbHelper: TestDatabaseHelper;
  let schema: GraphQLSchema;
  let commentsRepository: CommentsRepository;
  let commentsService: CommentsService;
  let commentsResolver: CommentsResolver;
  let commentMediaResolver: CommentMediaResolver;
  let postsRepository: PostsRepository;

  let testCity: City;
  let postAuthor: User;
  let commentAuthor1: User;
  let commentAuthor2: User;
  let testPost: Post;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    const mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(undefined),
    } as unknown as Cache;

    const mockConfig = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'PHONE_ENCRYPTION_KEY':
            return '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
          case 'COMMENT_IMAGES_ENABLED':
            return 'true';
          case 'COMMENT_MEDIA_CDN_BASE':
            return 'https://cdn.pupzy.net';
          default:
            return undefined;
        }
      }),
    } as unknown as ConfigService;

    const citiesRepo = new CitiesRepository(dbHelper.db);
    const usersRepo = new UsersRepository(dbHelper.db);
    postsRepository = new PostsRepository(dbHelper.db);
    commentsRepository = new CommentsRepository(dbHelper.db);

    const citiesService = new CitiesService(citiesRepo, mockCache);
    const usersService = new UsersService(usersRepo, citiesService, mockConfig, mockCache);
    const uploadService = new UploadService(mockConfig, mockCache, dbHelper.db);

    commentsService = new CommentsService(
      commentsRepository,
      postsRepository,
      uploadService,
      mockConfig,
      undefined,
      undefined,
      usersService,
    );

    commentsResolver = new CommentsResolver(commentsService);
    commentMediaResolver = new CommentMediaResolver(commentsService);

    const schemaFiles = [
      'src/common/graphql/enums.graphql',
      'src/users/users.graphql',
      'src/cities/cities.graphql',
      'src/posts/posts-enums.graphql',
      'src/posts/posts.graphql',
      'src/mating/mating.graphql',
      'src/upload/upload.graphql',
      'src/comments/comments.graphql',
      'src/notifications/notifications.graphql',
      'src/contacts/contacts.graphql',
      'src/adoptions/adoptions.graphql',
      'src/vet-clinics/vet-clinics.graphql',
    ];

    const typeDefs = schemaFiles.map((relPath) => fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf8'));

    schema = makeExecutableSchema({
      typeDefs,
      resolvers: {
        DateTime: {
          __parseValue(v: unknown) {
            return v;
          },
          __serialize(v: unknown) {
            return v instanceof Date ? v.toISOString() : v;
          },
        },
        Query: {
          comments: (
            _root: unknown,
            args: { postId: string; sort?: string; first?: number; after?: string },
            ctx: GqlContext,
          ) => commentsResolver.comments(args.postId, args.sort, args.first, args.after, ctx),
          replies: (_root: unknown, args: { commentId: string; first?: number; after?: string }, ctx: GqlContext) =>
            commentsResolver.replies(args.commentId, args.first, args.after, ctx),
        },
        Mutation: {
          createComment: (
            _root: unknown,
            args: { input: Parameters<typeof commentsResolver.createComment>[0] },
            ctx: GqlContext,
          ) => commentsResolver.createComment(args.input, ctx),
          createReply: (
            _root: unknown,
            args: { input: Parameters<typeof commentsResolver.createReply>[0] },
            ctx: GqlContext,
          ) => commentsResolver.createReply(args.input, ctx),
          deleteComment: (_root: unknown, args: { id: string }, ctx: GqlContext) =>
            commentsResolver.deleteComment(args.id, ctx),
          toggleCommentBoost: (_root: unknown, args: { commentId: string }, ctx: GqlContext) =>
            commentsResolver.toggleCommentBoost(args.commentId, ctx),
          pinComment: (_root: unknown, args: { commentId: string }, ctx: GqlContext) =>
            commentsResolver.pinComment(args.commentId, ctx),
          unpinComment: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            commentsResolver.unpinComment(args.postId, ctx),
        },
        Comment: {
          author: (root: Parameters<typeof commentsResolver.author>[0], _args: unknown, ctx: GqlContext) =>
            commentsResolver.author(root, ctx),
          text: (root: Parameters<typeof commentsResolver.text>[0]) => commentsResolver.text(root),
          media: (root: Parameters<typeof commentsResolver.media>[0], _args: unknown, ctx: GqlContext) =>
            commentsResolver.media(root, ctx),
          isBoostedByMe: (
            root: Parameters<typeof commentsResolver.isBoostedByMe>[0],
            _args: unknown,
            ctx: GqlContext,
          ) => commentsResolver.isBoostedByMe(root, ctx),
          boostCount: (root: Parameters<typeof commentsResolver.boostCount>[0]) => commentsResolver.boostCount(root),
          isPinned: (root: Parameters<typeof commentsResolver.isPinned>[0], _args: unknown, ctx: GqlContext) =>
            commentsResolver.isPinned(root, ctx),
        },
        CommentMedia: {
          publicUrl: (root: Parameters<typeof commentMediaResolver.publicUrl>[0]) =>
            commentMediaResolver.publicUrl(root),
        },
      },
    });
  });

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();

    [testCity] = await dbHelper.db
      .insert(cities)
      .values({
        nameEnglish: 'Cairo',
        nameArabic: 'القاهرة',
        governorate: 'Cairo',
        status: 'OFFICIAL',
        centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();

    [postAuthor] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${generateUuidV7()}`,
        email: `author-${generateUuidV7()}@pupzy.dev`,
        fullName: 'Post Author',
        cityId: testCity.id,
        createdAt: new Date(Date.now() - 48 * 3600 * 1000),
      })
      .returning();

    [commentAuthor1] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${generateUuidV7()}`,
        email: `user1-${generateUuidV7()}@pupzy.dev`,
        fullName: 'Commenter One',
        cityId: testCity.id,
        createdAt: new Date(Date.now() - 48 * 3600 * 1000),
      })
      .returning();

    [commentAuthor2] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${generateUuidV7()}`,
        email: `user2-${generateUuidV7()}@pupzy.dev`,
        fullName: 'Commenter Two',
        cityId: testCity.id,
        createdAt: new Date(Date.now() - 48 * 3600 * 1000),
      })
      .returning();

    [testPost] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId: postAuthor.id,
        title: 'Post for Comment Ordering Verification',
        description: 'Post description',
        postType: 'RESCUE',
        urgency: 'URGENT',
        cityId: testCity.id,
        status: 'ACTIVE',
        commentCount: 0,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
  });

  function createContext(userId?: string): GqlContext {
    const userLoader = new DataLoader<string, User | null>(async (ids: readonly string[]) => {
      const rows = await dbHelper.db
        .select()
        .from(users)
        .where(inArray(users.id, ids as string[]));
      const map = new Map(rows.map((u) => [u.id, u]));
      return ids.map((id) => map.get(id) || null);
    });

    const commentMediaLoader = commentsRepository.createCommentMediaByCommentIdLoader();
    const pinnedCommentLoader = commentsRepository.createPinnedCommentIdByPostIdLoader();
    const userObj = userId ? ({ id: userId, email: 'user@pupzy.dev', role: 'USER' } as unknown as User) : undefined;

    return {
      req: {
        user: userObj,
      } as unknown as GqlContext['req'],
      user: userObj,
      loaders: {
        userById: userLoader,
        commentMediaByCommentId: commentMediaLoader,
        pinnedCommentIdByPostId: pinnedCommentLoader,
        commentBoostedByMe: {
          load: jest.fn().mockResolvedValue(false),
        } as unknown as GqlContext['loaders']['commentBoostedByMe'],
      } as unknown as GqlContext['loaders'],
    };
  }

  function runGql<TData = Record<string, unknown>>(
    args: Parameters<typeof graphql>[0],
  ): Promise<ExecutionResult<TData>> {
    return graphql(args) as Promise<ExecutionResult<TData>>;
  }

  interface CommentNode {
    id: string;
    text: string;
    boostCount: number;
    isPinned: boolean;
    createdAt: string;
  }

  interface CommentsQueryResult {
    comments: {
      edges: Array<{
        cursor: string;
        node: CommentNode;
      }>;
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  }

  const COMMENTS_QUERY = `
    query GetComments($postId: ID!, $sort: CommentSort, $first: Int, $after: String) {
      comments(postId: $postId, sort: $sort, first: $first, after: $after) {
        edges {
          cursor
          node {
            id
            text
            boostCount
            isPinned
            createdAt
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  // Helper to insert a comment directly into DB with specific timestamps and boost counts
  async function seedComment(options: {
    authorId: string;
    text: string;
    createdAt: Date;
    boostCount?: number;
    id?: string;
  }): Promise<string> {
    const commentId = options.id ?? generateUuidV7();
    await dbHelper.db.insert(comments).values({
      id: commentId,
      postId: testPost.id,
      authorId: options.authorId,
      text: options.text,
      boostCount: options.boostCount ?? 0,
      createdAt: options.createdAt,
      updatedAt: options.createdAt,
      status: 'ACTIVE',
    });
    return commentId;
  }

  describe('Pinned-first Top/Newest results & Displacement Immunity', () => {
    it('pinned comment appears first under both TOP and NEWEST on Page 1', async () => {
      const t0 = new Date('2026-09-02T10:00:00Z');
      const t1 = new Date('2026-09-02T11:00:00Z');
      const t2 = new Date('2026-09-02T12:00:00Z');

      const c1Id = await seedComment({
        authorId: commentAuthor1.id,
        text: 'Low boost old',
        createdAt: t0,
        boostCount: 1,
      });
      const c2Id = await seedComment({
        authorId: commentAuthor2.id,
        text: 'High boost mid',
        createdAt: t1,
        boostCount: 20,
      });
      const c3Id = await seedComment({
        authorId: commentAuthor1.id,
        text: 'Mid boost new',
        createdAt: t2,
        boostCount: 10,
      });

      // Before pinning:
      // TOP order: c2 (20), c3 (10), c1 (1)
      const topBefore = await runGql<CommentsQueryResult>({
        schema,
        source: COMMENTS_QUERY,
        variableValues: { postId: testPost.id, sort: 'TOP', first: 10 },
        contextValue: createContext(postAuthor.id),
      });
      expect(topBefore.data?.comments.edges.map((e) => e.node.id)).toEqual([c2Id, c3Id, c1Id]);
      expect(topBefore.data?.comments.edges.every((e) => !e.node.isPinned)).toBe(true);

      // NEWEST order: c3 (t2), c2 (t1), c1 (t0)
      const newestBefore = await runGql<CommentsQueryResult>({
        schema,
        source: COMMENTS_QUERY,
        variableValues: { postId: testPost.id, sort: 'NEWEST', first: 10 },
        contextValue: createContext(postAuthor.id),
      });
      expect(newestBefore.data?.comments.edges.map((e) => e.node.id)).toEqual([c3Id, c2Id, c1Id]);

      // Post author pins c1 (the lowest boost and oldest comment)
      const pinRes = await runGql<{ pinComment: CommentNode }>({
        schema,
        source: `mutation Pin($commentId: ID!) { pinComment(commentId: $commentId) { id isPinned } }`,
        variableValues: { commentId: c1Id },
        contextValue: createContext(postAuthor.id),
      });
      expect(pinRes.errors).toBeUndefined();
      expect(pinRes.data?.pinComment.isPinned).toBe(true);

      // Now TOP order MUST have c1 first with isPinned: true, followed by c2, c3
      const topAfterPin = await runGql<CommentsQueryResult>({
        schema,
        source: COMMENTS_QUERY,
        variableValues: { postId: testPost.id, sort: 'TOP', first: 10 },
        contextValue: createContext(postAuthor.id),
      });
      expect(topAfterPin.data?.comments.edges.map((e) => e.node.id)).toEqual([c1Id, c2Id, c3Id]);
      expect(topAfterPin.data?.comments.edges[0].node.isPinned).toBe(true);
      expect(topAfterPin.data?.comments.edges[1].node.isPinned).toBe(false);
      expect(topAfterPin.data?.comments.edges[2].node.isPinned).toBe(false);

      // Now NEWEST order MUST have c1 first with isPinned: true, followed by c3, c2
      const newestAfterPin = await runGql<CommentsQueryResult>({
        schema,
        source: COMMENTS_QUERY,
        variableValues: { postId: testPost.id, sort: 'NEWEST', first: 10 },
        contextValue: createContext(postAuthor.id),
      });
      expect(newestAfterPin.data?.comments.edges.map((e) => e.node.id)).toEqual([c1Id, c3Id, c2Id]);
      expect(newestAfterPin.data?.comments.edges[0].node.isPinned).toBe(true);
    });

    it('adding a new comment cannot displace the pinned comment', async () => {
      const t0 = new Date('2026-09-02T10:00:00Z');
      const c1Id = await seedComment({
        authorId: commentAuthor1.id,
        text: 'Pinned base',
        createdAt: t0,
        boostCount: 0,
      });

      // Pin c1
      await runGql({
        schema,
        source: `mutation Pin($commentId: ID!) { pinComment(commentId: $commentId) { id isPinned } }`,
        variableValues: { commentId: c1Id },
        contextValue: createContext(postAuthor.id),
      });

      // Another user publishes a new comment via GraphQL mutation
      const createRes = await runGql<{ createComment: CommentNode }>({
        schema,
        source: `mutation Create($input: CreateCommentInput!) { createComment(input: $input) { id text isPinned } }`,
        variableValues: {
          input: {
            postId: testPost.id,
            text: 'Newly published comment after pin',
            clientRequestId: generateUuidV7(),
          },
        },
        contextValue: createContext(commentAuthor2.id),
      });
      expect(createRes.errors).toBeUndefined();
      const newCommentId = createRes.data?.createComment.id;
      expect(createRes.data?.createComment.isPinned).toBe(false);

      // Verify that under NEWEST, the pinned comment remains at index 0, and the new comment is at index 1
      const newestQuery = await runGql<CommentsQueryResult>({
        schema,
        source: COMMENTS_QUERY,
        variableValues: { postId: testPost.id, sort: 'NEWEST', first: 10 },
        contextValue: createContext(postAuthor.id),
      });
      expect(newestQuery.data?.comments.edges[0].node.id).toBe(c1Id);
      expect(newestQuery.data?.comments.edges[0].node.isPinned).toBe(true);
      expect(newestQuery.data?.comments.edges[1].node.id).toBe(newCommentId);
      expect(newestQuery.data?.comments.edges[1].node.isPinned).toBe(false);

      // Verify that under TOP, the pinned comment remains at index 0
      const topQuery = await runGql<CommentsQueryResult>({
        schema,
        source: COMMENTS_QUERY,
        variableValues: { postId: testPost.id, sort: 'TOP', first: 10 },
        contextValue: createContext(postAuthor.id),
      });
      expect(topQuery.data?.comments.edges[0].node.id).toBe(c1Id);
      expect(topQuery.data?.comments.edges[0].node.isPinned).toBe(true);
      expect(topQuery.data?.comments.edges[1].node.id).toBe(newCommentId);
    });

    it('replacing or removing a pin updates positions correctly', async () => {
      const t0 = new Date('2026-09-02T10:00:00Z');
      const t1 = new Date('2026-09-02T11:00:00Z');

      const c1Id = await seedComment({ authorId: commentAuthor1.id, text: 'Comment 1', createdAt: t0, boostCount: 10 });
      const c2Id = await seedComment({ authorId: commentAuthor2.id, text: 'Comment 2', createdAt: t1, boostCount: 20 });

      // Pin c1
      await runGql({
        schema,
        source: `mutation Pin($commentId: ID!) { pinComment(commentId: $commentId) { id isPinned } }`,
        variableValues: { commentId: c1Id },
        contextValue: createContext(postAuthor.id),
      });

      // Replace pin with c2
      const replaceRes = await runGql<{ pinComment: CommentNode }>({
        schema,
        source: `mutation Pin($commentId: ID!) { pinComment(commentId: $commentId) { id isPinned } }`,
        variableValues: { commentId: c2Id },
        contextValue: createContext(postAuthor.id),
      });
      expect(replaceRes.errors).toBeUndefined();
      expect(replaceRes.data?.pinComment.isPinned).toBe(true);

      // Query comments: c2 is at index 0 (isPinned: true), c1 is at index 1 (isPinned: false)
      const afterReplace = await runGql<CommentsQueryResult>({
        schema,
        source: COMMENTS_QUERY,
        variableValues: { postId: testPost.id, sort: 'TOP', first: 10 },
        contextValue: createContext(postAuthor.id),
      });
      expect(afterReplace.data?.comments.edges[0].node.id).toBe(c2Id);
      expect(afterReplace.data?.comments.edges[0].node.isPinned).toBe(true);
      expect(afterReplace.data?.comments.edges[1].node.id).toBe(c1Id);
      expect(afterReplace.data?.comments.edges[1].node.isPinned).toBe(false);

      // Unpin
      const unpinRes = await runGql<{ unpinComment: boolean }>({
        schema,
        source: `mutation Unpin($postId: ID!) { unpinComment(postId: $postId) }`,
        variableValues: { postId: testPost.id },
        contextValue: createContext(postAuthor.id),
      });
      expect(unpinRes.errors).toBeUndefined();
      expect(unpinRes.data?.unpinComment).toBe(true);

      // After unpin: neither comment is pinned, order is purely natural TOP (c2 has 20 boosts, c1 has 10)
      const afterUnpin = await runGql<CommentsQueryResult>({
        schema,
        source: COMMENTS_QUERY,
        variableValues: { postId: testPost.id, sort: 'TOP', first: 10 },
        contextValue: createContext(postAuthor.id),
      });
      expect(afterUnpin.data?.comments.edges[0].node.id).toBe(c2Id);
      expect(afterUnpin.data?.comments.edges[0].node.isPinned).toBe(false);
      expect(afterUnpin.data?.comments.edges[1].node.id).toBe(c1Id);
      expect(afterUnpin.data?.comments.edges[1].node.isPinned).toBe(false);
    });
  });

  describe('Deterministic Tie-Breaking & Keyset Pagination', () => {
    it('tie-breaks equal boost counts by createdAt DESC, then id DESC', async () => {
      const sameTime = new Date('2026-09-02T12:00:00Z');
      const olderTime = new Date('2026-09-02T10:00:00Z');

      // cOlder has same boost (5) but older timestamp
      const cOlder = await seedComment({
        authorId: commentAuthor1.id,
        text: 'Older 5 boosts',
        createdAt: olderTime,
        boostCount: 5,
      });

      // cId1 and cId2 have same boost (5) and same timestamp (sameTime)
      // We explicitly choose IDs to verify id DESC tie-breaker
      const idA = '01916327-0000-7000-8000-0000000000aa';
      const idB = '01916327-0000-7000-8000-0000000000bb';

      await seedComment({ id: idA, authorId: commentAuthor1.id, text: 'Id A', createdAt: sameTime, boostCount: 5 });
      await seedComment({ id: idB, authorId: commentAuthor2.id, text: 'Id B', createdAt: sameTime, boostCount: 5 });

      const topRes = await runGql<CommentsQueryResult>({
        schema,
        source: COMMENTS_QUERY,
        variableValues: { postId: testPost.id, sort: 'TOP', first: 10 },
        contextValue: createContext(postAuthor.id),
      });

      // idB > idA alphabetically, so between identical timestamp and boosts, idB comes before idA.
      // Both idB and idA come before cOlder (since sameTime > olderTime).
      expect(topRes.data?.comments.edges.map((e) => e.node.id)).toEqual([idB, idA, cOlder]);
    });

    it('paginates around pinned comment without duplicates or dropped entries', async () => {
      const t0 = new Date('2026-09-02T10:00:00Z');
      const t1 = new Date('2026-09-02T11:00:00Z');
      const t2 = new Date('2026-09-02T12:00:00Z');
      const t3 = new Date('2026-09-02T13:00:00Z');

      const pinId = await seedComment({ authorId: commentAuthor1.id, text: 'Pinned', createdAt: t0, boostCount: 1 });
      const c1 = await seedComment({ authorId: commentAuthor1.id, text: 'Reg 1', createdAt: t1, boostCount: 30 });
      const c2 = await seedComment({ authorId: commentAuthor2.id, text: 'Reg 2', createdAt: t2, boostCount: 20 });
      const c3 = await seedComment({ authorId: commentAuthor1.id, text: 'Reg 3', createdAt: t3, boostCount: 10 });

      // Pin pinId
      await runGql({
        schema,
        source: `mutation Pin($commentId: ID!) { pinComment(commentId: $commentId) { id isPinned } }`,
        variableValues: { commentId: pinId },
        contextValue: createContext(postAuthor.id),
      });

      // Complete pagination using first: 2
      // Page 1: first=2 -> returns [pinId, c1], hasNextPage=true
      const p1 = await runGql<CommentsQueryResult>({
        schema,
        source: COMMENTS_QUERY,
        variableValues: { postId: testPost.id, sort: 'TOP', first: 2 },
        contextValue: createContext(postAuthor.id),
      });
      expect(p1.data?.comments.edges.map((e) => e.node.id)).toEqual([pinId, c1]);
      expect(p1.data?.comments.edges[0].node.isPinned).toBe(true);
      expect(p1.data?.comments.edges[1].node.isPinned).toBe(false);
      expect(p1.data?.comments.pageInfo.hasNextPage).toBe(true);

      const cursor1 = p1.data?.comments.pageInfo.endCursor;

      // Page 2: after cursor1, first=2 -> returns [c2, c3], hasNextPage=false
      const p2 = await runGql<CommentsQueryResult>({
        schema,
        source: COMMENTS_QUERY,
        variableValues: { postId: testPost.id, sort: 'TOP', first: 2, after: cursor1 },
        contextValue: createContext(postAuthor.id),
      });
      expect(p2.data?.comments.edges.map((e) => e.node.id)).toEqual([c2, c3]);
      expect(p2.data?.comments.pageInfo.hasNextPage).toBe(false);

      // Verify all 4 comments were received once with zero duplicates
      const allIds = [
        ...p1.data!.comments.edges.map((e) => e.node.id),
        ...p2.data!.comments.edges.map((e) => e.node.id),
      ];
      expect(allIds).toEqual([pinId, c1, c2, c3]);
      expect(new Set(allIds).size).toBe(4);
    });

    it('paginating with first: 1 across pin boundary returns all items exactly once', async () => {
      const t0 = new Date('2026-09-02T10:00:00Z');
      const t1 = new Date('2026-09-02T11:00:00Z');

      const pinId = await seedComment({ authorId: commentAuthor1.id, text: 'Pinned', createdAt: t0, boostCount: 0 });
      const regId = await seedComment({ authorId: commentAuthor2.id, text: 'Regular', createdAt: t1, boostCount: 10 });

      // Pin pinId
      await runGql({
        schema,
        source: `mutation Pin($commentId: ID!) { pinComment(commentId: $commentId) { id isPinned } }`,
        variableValues: { commentId: pinId },
        contextValue: createContext(postAuthor.id),
      });

      // Page 1: first=1 returns ONLY the pinned comment
      const p1 = await runGql<CommentsQueryResult>({
        schema,
        source: COMMENTS_QUERY,
        variableValues: { postId: testPost.id, sort: 'TOP', first: 1 },
        contextValue: createContext(postAuthor.id),
      });
      expect(p1.data?.comments.edges).toHaveLength(1);
      expect(p1.data?.comments.edges[0].node.id).toBe(pinId);
      expect(p1.data?.comments.edges[0].node.isPinned).toBe(true);
      expect(p1.data?.comments.pageInfo.hasNextPage).toBe(true);

      const pinnedCursor = p1.data?.comments.pageInfo.endCursor;

      // Page 2: after pinnedCursor returns the regular comment
      const p2 = await runGql<CommentsQueryResult>({
        schema,
        source: COMMENTS_QUERY,
        variableValues: { postId: testPost.id, sort: 'TOP', first: 1, after: pinnedCursor },
        contextValue: createContext(postAuthor.id),
      });
      expect(p2.data?.comments.edges).toHaveLength(1);
      expect(p2.data?.comments.edges[0].node.id).toBe(regId);
      expect(p2.data?.comments.edges[0].node.isPinned).toBe(false);
      expect(p2.data?.comments.pageInfo.hasNextPage).toBe(false);
    });

    it('unpinning between Page 1 and Page 2 does NOT duplicate the unpinned comment', async () => {
      const t0 = new Date('2026-09-02T10:00:00Z');
      const t1 = new Date('2026-09-02T11:00:00Z');

      const pinId = await seedComment({
        authorId: commentAuthor1.id,
        text: 'Pin candidate',
        createdAt: t0,
        boostCount: 50,
      });
      const regId = await seedComment({ authorId: commentAuthor2.id, text: 'Regular', createdAt: t1, boostCount: 10 });

      // Pin pinId
      await runGql({
        schema,
        source: `mutation Pin($commentId: ID!) { pinComment(commentId: $commentId) { id isPinned } }`,
        variableValues: { commentId: pinId },
        contextValue: createContext(postAuthor.id),
      });

      // Client fetches Page 1 (first=1) -> gets pinId
      const p1 = await runGql<CommentsQueryResult>({
        schema,
        source: COMMENTS_QUERY,
        variableValues: { postId: testPost.id, sort: 'TOP', first: 1 },
        contextValue: createContext(postAuthor.id),
      });
      expect(p1.data?.comments.edges[0].node.id).toBe(pinId);
      const pinnedCursor = p1.data?.comments.pageInfo.endCursor;

      // Author UNPINS before client requests Page 2
      await runGql({
        schema,
        source: `mutation Unpin($postId: ID!) { unpinComment(postId: $postId) }`,
        variableValues: { postId: testPost.id },
        contextValue: createContext(postAuthor.id),
      });

      // Client requests Page 2 with after: pinnedCursor
      // Even though pinId has the highest boostCount (50) and is now unpinned,
      // the hardened Case 1 explicitly excludes cursor.id!
      const p2 = await runGql<CommentsQueryResult>({
        schema,
        source: COMMENTS_QUERY,
        variableValues: { postId: testPost.id, sort: 'TOP', first: 10, after: pinnedCursor },
        contextValue: createContext(postAuthor.id),
      });

      expect(p2.errors).toBeUndefined();
      // pinId MUST NOT be duplicated on Page 2!
      const page2Ids = p2.data?.comments.edges.map((e) => e.node.id);
      expect(page2Ids).not.toContain(pinId);
      expect(page2Ids).toContain(regId);
    });
  });

  describe('Permissions, self-boost restrictions, and pin notifications', () => {
    it('enforces self-boost restriction (cannot boost own comment)', async () => {
      const commentId = await seedComment({
        authorId: commentAuthor1.id,
        text: 'Self boost test',
        createdAt: new Date(),
      });

      // commentAuthor1 tries to boost their own comment
      const boostRes = await runGql({
        schema,
        source: `mutation Boost($commentId: ID!) { toggleCommentBoost(commentId: $commentId) { isBoostedByMe } }`,
        variableValues: { commentId },
        contextValue: createContext(commentAuthor1.id),
      });

      expect(boostRes.errors).toBeDefined();
      expect(boostRes.errors![0].message).toContain('You cannot boost your own comment or reply');

      // Different user CAN boost
      const otherBoostRes = await runGql({
        schema,
        source: `mutation Boost($commentId: ID!) { toggleCommentBoost(commentId: $commentId) { isBoostedByMe boostCount } }`,
        variableValues: { commentId },
        contextValue: createContext(commentAuthor2.id),
      });

      expect(otherBoostRes.errors).toBeUndefined();
    });

    it('rejects pin/unpin by non-post-author with ForbiddenError', async () => {
      const commentId = await seedComment({
        authorId: commentAuthor1.id,
        text: 'Forbidden pin test',
        createdAt: new Date(),
      });

      // commentAuthor1 (not post author) tries to pin
      const pinRes = await runGql({
        schema,
        source: `mutation Pin($commentId: ID!) { pinComment(commentId: $commentId) { id } }`,
        variableValues: { commentId },
        contextValue: createContext(commentAuthor1.id),
      });
      expect(pinRes.errors).toBeDefined();
      expect(pinRes.errors![0].message).toContain('Only the post author can pin comments');

      // commentAuthor1 tries to unpin
      const unpinRes = await runGql({
        schema,
        source: `mutation Unpin($postId: ID!) { unpinComment(postId: $postId) }`,
        variableValues: { postId: testPost.id },
        contextValue: createContext(commentAuthor1.id),
      });
      expect(unpinRes.errors).toBeDefined();
      expect(unpinRes.errors![0].message).toContain('Only the post author can unpin comments');
    });

    it('enqueues COMMENT_PINNED notification when non-author comment is pinned, but suppresses for own comment', async () => {
      const otherCommentId = await seedComment({
        authorId: commentAuthor1.id,
        text: 'Other user comment',
        createdAt: new Date(),
      });

      // Post author pins otherCommentId
      await runGql({
        schema,
        source: `mutation Pin($commentId: ID!) { pinComment(commentId: $commentId) { id } }`,
        variableValues: { commentId: otherCommentId },
        contextValue: createContext(postAuthor.id),
      });

      // Verify notification event is queued for commentAuthor1
      const events = await dbHelper.db
        .select()
        .from(discussionNotificationEvents)
        .where(eq(discussionNotificationEvents.recipientId, commentAuthor1.id));

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('COMMENT_PINNED');
      expect(events[0].actorId).toBe(postAuthor.id);

      // Now post author pins their OWN comment
      const ownCommentId = await seedComment({
        authorId: postAuthor.id,
        text: 'Post author own comment',
        createdAt: new Date(),
      });

      await runGql({
        schema,
        source: `mutation Pin($commentId: ID!) { pinComment(commentId: $commentId) { id } }`,
        variableValues: { commentId: ownCommentId },
        contextValue: createContext(postAuthor.id),
      });

      // Verify NO self-notification event was queued for postAuthor
      const selfEvents = await dbHelper.db
        .select()
        .from(discussionNotificationEvents)
        .where(eq(discussionNotificationEvents.recipientId, postAuthor.id));

      expect(selfEvents).toHaveLength(0);
    });
  });
});

import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema } from 'graphql';
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
  commentMedia,
  commentReports,
  commentBoosts,
  postPins,
  moderationActions,
  adminUsers,
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

describe('Comments Reachability, Counters, and Engagement Integration (Ticket 09)', () => {
  jest.setTimeout(120_000);

  let dbHelper: TestDatabaseHelper;
  let schema: GraphQLSchema;
  let commentsRepository: CommentsRepository;
  let commentsService: CommentsService;
  let commentsResolver: CommentsResolver;
  let commentMediaResolver: CommentMediaResolver;
  let postsRepository: PostsRepository;

  let testCity: City;
  let authorUser: User;
  let user2: User;
  let user3: User;
  let matureReporter1: User;
  let matureReporter2: User;
  let matureReporter3: User;
  let adminUser: { id: string; email: string; role: string };
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
          __parseValue(v: any) {
            return v;
          },
          __serialize(v: any) {
            return v instanceof Date ? v.toISOString() : v;
          },
        },
        Query: {
          comments: (_root, args) => commentsResolver.comments(args.postId, args.sort, args.first, args.after),
          replies: (_root, args) => commentsResolver.replies(args.commentId, args.first, args.after),
        },
        Mutation: {
          createComment: (_root, args, ctx) => commentsResolver.createComment(args.input, ctx),
          createReply: (_root, args, ctx) => commentsResolver.createReply(args.input, ctx),
          deleteComment: (_root, args, ctx) => commentsResolver.deleteComment(args.id, ctx),
          toggleCommentBoost: (_root, args, ctx) => commentsResolver.toggleCommentBoost(args.commentId, ctx),
          pinComment: (_root, args, ctx) => commentsResolver.pinComment(args.commentId, ctx),
          unpinComment: (_root, args, ctx) => commentsResolver.unpinComment(args.postId, ctx),
          reportComment: (_root, args, ctx) => commentsResolver.reportComment(args.input, ctx),
        },
        Comment: {
          author: (root, _args, ctx) => commentsResolver.author(root, ctx),
          text: (root) => commentsResolver.text(root),
          media: (root, _args, ctx) => commentsResolver.media(root, ctx),
          isBoostedByMe: (root, _args, ctx) => commentsResolver.isBoostedByMe(root, ctx),
          boostCount: (root) => commentsResolver.boostCount(root),
          isPinned: (root, _args, ctx) => commentsResolver.isPinned(root, ctx),
        },
        CommentMedia: {
          publicUrl: (root) => commentMediaResolver.publicUrl(root),
        },
      },
    });
  });

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();

    // 1. Seed City
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

    // 2. Seed Users
    [authorUser] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${generateUuidV7()}`,
        email: `author-${generateUuidV7()}@pupzy.dev`,
        fullName: 'Author Pupzy',
        username: `author_${generateUuidV7().slice(0, 8)}`,
        cityId: testCity.id,
        createdAt: new Date(Date.now() - 48 * 3600 * 1000),
      })
      .returning();

    [user2] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${generateUuidV7()}`,
        email: `user2-${generateUuidV7()}@pupzy.dev`,
        fullName: 'User Two',
        username: `user2_${generateUuidV7().slice(0, 8)}`,
        cityId: testCity.id,
        createdAt: new Date(Date.now() - 48 * 3600 * 1000),
      })
      .returning();

    [user3] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${generateUuidV7()}`,
        email: `user3-${generateUuidV7()}@pupzy.dev`,
        fullName: 'User Three',
        username: `user3_${generateUuidV7().slice(0, 8)}`,
        cityId: testCity.id,
        createdAt: new Date(Date.now() - 48 * 3600 * 1000),
      })
      .returning();

    [matureReporter1] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${generateUuidV7()}`,
        email: `reporter1-${generateUuidV7()}@pupzy.dev`,
        fullName: 'Mature Reporter 1',
        username: `rep1_${generateUuidV7().slice(0, 8)}`,
        cityId: testCity.id,
        createdAt: new Date(Date.now() - 48 * 3600 * 1000),
      })
      .returning();

    [matureReporter2] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${generateUuidV7()}`,
        email: `reporter2-${generateUuidV7()}@pupzy.dev`,
        fullName: 'Mature Reporter 2',
        username: `rep2_${generateUuidV7().slice(0, 8)}`,
        cityId: testCity.id,
        createdAt: new Date(Date.now() - 48 * 3600 * 1000),
      })
      .returning();

    [matureReporter3] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${generateUuidV7()}`,
        email: `reporter3-${generateUuidV7()}@pupzy.dev`,
        fullName: 'Mature Reporter 3',
        username: `rep3_${generateUuidV7().slice(0, 8)}`,
        cityId: testCity.id,
        createdAt: new Date(Date.now() - 48 * 3600 * 1000),
      })
      .returning();

    // 3. Seed Admin
    const [adminRow] = await dbHelper.db
      .insert(adminUsers)
      .values({
        email: 'admin@pupzy.dev',
        fullName: 'Pupzy Moderator',
        role: 'SUPER_ADMIN',
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz123456',
      })
      .returning();
    adminUser = { id: adminRow.id, email: adminRow.email, role: adminRow.role };

    // 4. Seed Post
    [testPost] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId: authorUser.id,
        title: 'Post for Reachability and Counters Verification',
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
    const userLoader = new DataLoader<string, any>(async (ids: readonly string[]) => {
      const rows = await dbHelper.db
        .select()
        .from(users)
        .where(inArray(users.id, ids as string[]));
      const map = new Map(rows.map((u) => [u.id, u]));
      return ids.map((id) => map.get(id) || null);
    });

    const commentMediaLoader = new DataLoader<string, any[]>(async (commentIds: readonly string[]) => {
      return commentsRepository.findMediaByCommentIds(commentIds);
    });

    const pinnedCommentLoader = commentsRepository.createPinnedCommentIdByPostIdLoader();

    return {
      req: {
        user: userId ? { id: userId } : undefined,
      } as any,
      res: {} as any,
      user: userId ? { id: userId, email: 'user@pupzy.dev', role: 'USER' } : undefined,
      loaders: {
        userById: userLoader,
        commentMediaByCommentId: commentMediaLoader,
        pinnedCommentIdByPostId: pinnedCommentLoader,
      } as any,
    };
  }

  /**
   * Helper simulating AdminJS removeComment moderation action transactionally.
   */
  async function adminRemoveComment(commentId: string, adminId: string, reason: string = 'Violates guidelines') {
    const client = dbHelper.pool;
    await client.query('BEGIN');
    try {
      const { rows } = await client.query('SELECT * FROM comments WHERE id = $1 FOR UPDATE', [commentId]);
      const row = rows[0];
      if (!row) throw new Error('Comment not found');

      const wasVisible = row.status === 'ACTIVE' || row.status === 'IMAGE_HIDDEN';

      if (!row.parent_id) {
        const { rows: replyCountRows } = await client.query(
          `SELECT count(*)::int AS count FROM comments WHERE parent_id = $1 AND status IN ('ACTIVE', 'IMAGE_HIDDEN')`,
          [row.id],
        );
        const totalDecrement = (wasVisible ? 1 : 0) + Number(replyCountRows[0]?.count || 0);
        if (totalDecrement > 0) {
          await client.query(
            `UPDATE posts SET comment_count = GREATEST(0, comment_count - $1), updated_at = now() WHERE id = $2`,
            [totalDecrement, row.post_id],
          );
        }
        await client.query(`DELETE FROM post_pins WHERE comment_id = $1`, [row.id]);
        await client.query(
          `UPDATE comments SET status = 'REMOVED', reply_count = 0, updated_at = now() WHERE id = $1`,
          [row.id],
        );
      } else {
        const { rows: parentRows } = await client.query(`SELECT status FROM comments WHERE id = $1`, [row.parent_id]);
        const parent = parentRows[0];
        if (parent && parent.status !== 'REMOVED' && wasVisible) {
          await client.query(
            `UPDATE comments SET reply_count = GREATEST(0, reply_count - 1), updated_at = now() WHERE id = $1`,
            [row.parent_id],
          );
          await client.query(
            `UPDATE posts SET comment_count = GREATEST(0, comment_count - 1), updated_at = now() WHERE id = $1`,
            [row.post_id],
          );
        }
        await client.query(`UPDATE comments SET status = 'REMOVED', updated_at = now() WHERE id = $1`, [row.id]);
      }

      await client.query(
        `INSERT INTO moderation_actions (admin_user_id, action_type, target_type, target_id, reason)
         VALUES ($1, 'COMMENT_REMOVED', 'COMMENT', $2, $3)`,
        [adminId, commentId, reason],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }

  /**
   * Helper simulating AdminJS removePost and restorePost.
   */
  async function adminRemovePost(postId: string, adminId: string, reason: string = 'Violates post guidelines') {
    await dbHelper.pool.query(
      `UPDATE posts SET status = 'REMOVED', moderation_reason = $2, moderated_at = now(), moderated_by_admin_id = $3, updated_at = now() WHERE id = $1`,
      [postId, reason, adminId],
    );
  }

  async function adminRestorePost(postId: string, adminId: string) {
    await dbHelper.pool.query(
      `UPDATE posts SET status = 'ACTIVE', moderated_at = now(), moderated_by_admin_id = $2, updated_at = now() WHERE id = $1`,
      [postId, adminId],
    );
  }

  it('AC 1 & AC 2: Parent permanent removal eliminates phantom reply counts, unlinks replies, and blocks engagement', async () => {
    // 1. Create a parent comment via GraphQL
    const createParentResult = await graphql({
      schema,
      source: `
        mutation CreateComment($input: CreateCommentInput!) {
          createComment(input: $input) {
            id
            text
            status
            replyCount
          }
        }
      `,
      variableValues: {
        input: {
          clientRequestId: 'cr-parent-1',
          postId: testPost.id,
          text: 'Top-level parent with discussion',
        },
      },
      contextValue: createContext(authorUser.id),
    });

    expect(createParentResult.errors).toBeUndefined();
    const parentId = createParentResult.data!.createComment.id;

    // 2. Create 2 replies under this parent comment
    const createReply1Result = await graphql({
      schema,
      source: `
        mutation CreateReply($input: CreateReplyInput!) {
          createReply(input: $input) {
            id
            text
          }
        }
      `,
      variableValues: {
        input: {
          clientRequestId: 'cr-reply-1',
          commentId: parentId,
          text: 'First reply',
        },
      },
      contextValue: createContext(user2.id),
    });
    expect(createReply1Result.errors).toBeUndefined();
    const reply1Id = createReply1Result.data!.createReply.id;

    const createReply2Result = await graphql({
      schema,
      source: `
        mutation CreateReply($input: CreateReplyInput!) {
          createReply(input: $input) {
            id
            text
          }
        }
      `,
      variableValues: {
        input: {
          clientRequestId: 'cr-reply-2',
          commentId: parentId,
          text: 'Second reply',
        },
      },
      contextValue: createContext(user3.id),
    });
    expect(createReply2Result.errors).toBeUndefined();
    const reply2Id = createReply2Result.data!.createReply.id;

    // Verify post commentCount is 3 and parent replyCount is 2
    const [postBeforeRemoval] = await dbHelper.db.select().from(posts).where(eq(posts.id, testPost.id));
    expect(postBeforeRemoval.commentCount).toBe(3);

    const [parentBeforeRemoval] = await dbHelper.db.select().from(comments).where(eq(comments.id, parentId));
    expect(parentBeforeRemoval.replyCount).toBe(2);

    // 3. Admin permanently removes parent comment
    await adminRemoveComment(parentId, adminUser.id, 'Spam parent thread');

    // Verify post commentCount is now 0 (parent + 2 replies deducted). AC 2: No phantom count of 2 left!
    const [postAfterRemoval] = await dbHelper.db.select().from(posts).where(eq(posts.id, testPost.id));
    expect(postAfterRemoval.commentCount).toBe(0);

    const [parentAfterRemoval] = await dbHelper.db.select().from(comments).where(eq(comments.id, parentId));
    expect(parentAfterRemoval.status).toBe('REMOVED');
    expect(parentAfterRemoval.replyCount).toBe(0);

    // 4. AC 1: Verify GraphQL reads make the parent and replies inaccessible
    const commentsQueryResult = await graphql({
      schema,
      source: `
        query GetComments($postId: ID!) {
          comments(postId: $postId) {
            edges {
              node {
                id
                text
              }
            }
          }
        }
      `,
      variableValues: { postId: testPost.id },
      contextValue: createContext(),
    });
    expect(commentsQueryResult.errors).toBeUndefined();
    expect(commentsQueryResult.data!.comments.edges).toHaveLength(0);

    // Querying replies for the removed parent returns NotFoundError
    const repliesQueryResult = await graphql({
      schema,
      source: `
        query GetReplies($commentId: ID!) {
          replies(commentId: $commentId) {
            edges {
              node {
                id
                text
              }
            }
          }
        }
      `,
      variableValues: { commentId: parentId },
      contextValue: createContext(),
    });
    expect(repliesQueryResult.errors).toBeDefined();
    expect(repliesQueryResult.errors![0].message).toContain('not found');

    // 5. AC 1: Inaccessible replies reject Boosts
    const boostReplyResult = await graphql({
      schema,
      source: `
        mutation Boost($commentId: ID!) {
          toggleCommentBoost(commentId: $commentId) {
            isBoostedByMe
            boostCount
          }
        }
      `,
      variableValues: { commentId: reply1Id },
      contextValue: createContext(authorUser.id),
    });
    expect(boostReplyResult.errors).toBeDefined();
    expect(boostReplyResult.errors![0].message).toContain('not found');

    // 6. AC 1: Inaccessible replies reject Reports
    const reportReplyResult = await graphql({
      schema,
      source: `
        mutation Report($input: ReportCommentInput!) {
          reportComment(input: $input)
        }
      `,
      variableValues: {
        input: {
          commentId: reply1Id,
          reason: 'SPAM',
          details: 'Should fail because parent is removed',
        },
      },
      contextValue: createContext(matureReporter1.id),
    });
    expect(reportReplyResult.errors).toBeDefined();
    expect(reportReplyResult.errors![0].message).toContain('not found');

    // 7. AC 1: Cannot create new replies under removed parent
    const createReplyOnRemovedResult = await graphql({
      schema,
      source: `
        mutation CreateReply($input: CreateReplyInput!) {
          createReply(input: $input) {
            id
          }
        }
      `,
      variableValues: {
        input: {
          clientRequestId: 'cr-reply-fail-removed',
          commentId: parentId,
          text: 'Attempting to reply to removed parent',
        },
      },
      contextValue: createContext(user2.id),
    });
    expect(createReplyOnRemovedResult.errors).toBeDefined();
    expect(createReplyOnRemovedResult.errors![0].message).toContain('not found');
  });

  it('AC 3: Author-deleted parent with visible replies remains neutral structural tombstone [Deleted] with reply access preserved', async () => {
    // 1. Create parent and 2 replies
    const parentComment = await commentsService.createComment(authorUser.id, {
      clientRequestId: 'cr-tombstone-parent',
      postId: testPost.id,
      text: 'Parent comment to be author deleted',
    });

    const reply1 = await commentsService.createReply(user2.id, {
      clientRequestId: 'cr-tombstone-reply-1',
      commentId: parentComment.id,
      text: 'Surviving reply 1',
    });

    const reply2 = await commentsService.createReply(user3.id, {
      clientRequestId: 'cr-tombstone-reply-2',
      commentId: parentComment.id,
      text: 'Surviving reply 2',
    });

    // 2. Author deletes parent comment
    const deleteResult = await graphql({
      schema,
      source: `
        mutation Delete($id: ID!) {
          deleteComment(id: $id)
        }
      `,
      variableValues: { id: parentComment.id },
      contextValue: createContext(authorUser.id),
    });
    expect(deleteResult.errors).toBeUndefined();
    expect(deleteResult.data!.deleteComment).toBe(true);

    // 3. Verify post commentCount is 2 (parent was decremented by 1, replies remain counted!)
    const [postAfterParentDelete] = await dbHelper.db.select().from(posts).where(eq(posts.id, testPost.id));
    expect(postAfterParentDelete.commentCount).toBe(2);

    const [parentRow] = await dbHelper.db.select().from(comments).where(eq(comments.id, parentComment.id));
    expect(parentRow.status).toBe('DELETED');
    expect(parentRow.replyCount).toBe(2);

    // 4. Query top-level comments via GraphQL: parent renders as [Deleted] tombstone with author null
    const commentsQueryResult = await graphql({
      schema,
      source: `
        query GetComments($postId: ID!) {
          comments(postId: $postId) {
            edges {
              node {
                id
                text
                author {
                  id
                }
                replyCount
              }
            }
          }
        }
      `,
      variableValues: { postId: testPost.id },
      contextValue: createContext(),
    });
    expect(commentsQueryResult.errors).toBeUndefined();
    const edges = commentsQueryResult.data!.comments.edges;
    expect(edges).toHaveLength(1);
    expect(edges[0].node.id).toBe(parentComment.id);
    expect(edges[0].node.text).toBe('[Deleted]');
    expect(edges[0].node.author).toBeNull();
    expect(edges[0].node.replyCount).toBe(2);

    // 5. Query replies under tombstone: both replies remain fully readable
    const repliesQueryResult = await graphql({
      schema,
      source: `
        query GetReplies($commentId: ID!) {
          replies(commentId: $commentId) {
            edges {
              node {
                id
                text
                author {
                  id
                  fullName
                }
              }
            }
          }
        }
      `,
      variableValues: { commentId: parentComment.id },
      contextValue: createContext(),
    });
    expect(repliesQueryResult.errors).toBeUndefined();
    const replyEdges = repliesQueryResult.data!.replies.edges;
    expect(replyEdges).toHaveLength(2);
    expect(replyEdges[0].node.text).toBe('Surviving reply 1');
    expect(replyEdges[0].node.author.fullName).toBe('User Two');
    expect(replyEdges[1].node.text).toBe('Surviving reply 2');
    expect(replyEdges[1].node.author.fullName).toBe('User Three');

    // 6. Replies under tombstone accept engagement (e.g. authorUser boosts reply 1)
    const boostReplyResult = await graphql({
      schema,
      source: `
        mutation Boost($commentId: ID!) {
          toggleCommentBoost(commentId: $commentId) {
            isBoostedByMe
            boostCount
          }
        }
      `,
      variableValues: { commentId: reply1.id },
      contextValue: createContext(authorUser.id),
    });
    expect(boostReplyResult.errors).toBeUndefined();
    expect(boostReplyResult.data!.toggleCommentBoost.isBoostedByMe).toBe(true);
    expect(boostReplyResult.data!.toggleCommentBoost.boostCount).toBe(1);

    // 7. Delete reply 1: replyCount drops to 1, post commentCount drops to 1
    await commentsService.deleteComment(user2.id, reply1.id);
    const [postAfterReply1Delete] = await dbHelper.db.select().from(posts).where(eq(posts.id, testPost.id));
    expect(postAfterReply1Delete.commentCount).toBe(1);
    const [parentAfterReply1Delete] = await dbHelper.db
      .select()
      .from(comments)
      .where(eq(comments.id, parentComment.id));
    expect(parentAfterReply1Delete.replyCount).toBe(1);

    // 8. Delete reply 2 (the last reply): replyCount drops to 0, post commentCount drops to 0
    await commentsService.deleteComment(user3.id, reply2.id);
    const [postAfterReply2Delete] = await dbHelper.db.select().from(posts).where(eq(posts.id, testPost.id));
    expect(postAfterReply2Delete.commentCount).toBe(0);
    const [parentAfterReply2Delete] = await dbHelper.db
      .select()
      .from(comments)
      .where(eq(comments.id, parentComment.id));
    expect(parentAfterReply2Delete.replyCount).toBe(0);

    // Now that replyCount === 0, tombstone disappears from public comment feeds
    const emptyFeedResult = await graphql({
      schema,
      source: `
        query GetComments($postId: ID!) {
          comments(postId: $postId) {
            edges {
              node {
                id
              }
            }
          }
        }
      `,
      variableValues: { postId: testPost.id },
      contextValue: createContext(),
    });
    expect(emptyFeedResult.data!.comments.edges).toHaveLength(0);
  });

  it('AC 3: Temporarily whole-hidden parent with surviving replies remains neutral tombstone [Hidden]', async () => {
    // 1. Create parent and 2 replies
    const parentComment = await commentsService.createComment(authorUser.id, {
      clientRequestId: 'cr-hidden-parent',
      postId: testPost.id,
      text: 'Parent comment to be whole hidden by reports',
    });

    await commentsService.createReply(user2.id, {
      clientRequestId: 'cr-hidden-reply-1',
      commentId: parentComment.id,
      text: 'Reply 1 under hidden parent',
    });

    await commentsService.createReply(user3.id, {
      clientRequestId: 'cr-hidden-reply-2',
      commentId: parentComment.id,
      text: 'Reply 2 under hidden parent',
    });

    // Post commentCount is 3
    const [postBeforeHide] = await dbHelper.db.select().from(posts).where(eq(posts.id, testPost.id));
    expect(postBeforeHide.commentCount).toBe(3);

    // 2. Submit 3 qualifying reports to whole-hide parent comment
    await commentsRepository.reportComment({
      commentId: parentComment.id,
      reporterId: matureReporter1.id,
      reason: 'SPAM',
      details: 'Report 1',
    });
    await commentsRepository.reportComment({
      commentId: parentComment.id,
      reporterId: matureReporter2.id,
      reason: 'SCAM',
      details: 'Report 2',
    });
    await commentsRepository.reportComment({
      commentId: parentComment.id,
      reporterId: matureReporter3.id,
      reason: 'OTHER',
      details: 'Report 3',
    });

    // Parent is now HIDDEN. Post commentCount drops by 1 to 2 (replies remain counted)
    const [parentRow] = await dbHelper.db.select().from(comments).where(eq(comments.id, parentComment.id));
    expect(parentRow.status).toBe('HIDDEN');
    expect(parentRow.replyCount).toBe(2);

    const [postAfterHide] = await dbHelper.db.select().from(posts).where(eq(posts.id, testPost.id));
    expect(postAfterHide.commentCount).toBe(2);

    // 3. Query via GraphQL: renders as [Hidden] tombstone with author masked
    const commentsQueryResult = await graphql({
      schema,
      source: `
        query GetComments($postId: ID!) {
          comments(postId: $postId) {
            edges {
              node {
                id
                text
                author {
                  id
                }
                replyCount
              }
            }
          }
        }
      `,
      variableValues: { postId: testPost.id },
      contextValue: createContext(),
    });
    expect(commentsQueryResult.errors).toBeUndefined();
    const edges = commentsQueryResult.data!.comments.edges;
    expect(edges).toHaveLength(1);
    expect(edges[0].node.text).toBe('[Hidden]');
    expect(edges[0].node.author).toBeNull();
    expect(edges[0].node.replyCount).toBe(2);

    // Replies remain readable
    const repliesResult = await graphql({
      schema,
      source: `
        query GetReplies($commentId: ID!) {
          replies(commentId: $commentId) {
            edges {
              node {
                id
                text
              }
            }
          }
        }
      `,
      variableValues: { commentId: parentComment.id },
      contextValue: createContext(),
    });
    expect(repliesResult.errors).toBeUndefined();
    expect(repliesResult.data!.replies.edges).toHaveLength(2);
  });

  it('AC 4: Author deletion of reply under already removed parent does not double-decrement post commentCount', async () => {
    // 1. Create parent and reply
    const parentComment = await commentsService.createComment(authorUser.id, {
      clientRequestId: 'cr-double-dec-parent',
      postId: testPost.id,
      text: 'Parent comment',
    });

    const reply = await commentsService.createReply(user2.id, {
      clientRequestId: 'cr-double-dec-reply',
      commentId: parentComment.id,
      text: 'Reply to test double decrement',
    });

    // 2. Admin removes parent comment -> post commentCount becomes 0
    await adminRemoveComment(parentComment.id, adminUser.id, 'Permanent removal');

    const [postAfterParentRemoval] = await dbHelper.db.select().from(posts).where(eq(posts.id, testPost.id));
    expect(postAfterParentRemoval.commentCount).toBe(0);

    // 3. Author of the reply deletes their reply
    const deleteReplyResult = await commentsService.deleteComment(user2.id, reply.id);
    expect(deleteReplyResult).toBe(true);

    // Verify reply status is DELETED
    const [replyRow] = await dbHelper.db.select().from(comments).where(eq(comments.id, reply.id));
    expect(replyRow.status).toBe('DELETED');

    // Verify post commentCount is STILL 0 (never negative, never double-decremented!)
    const [postAfterReplyDelete] = await dbHelper.db.select().from(posts).where(eq(posts.id, testPost.id));
    expect(postAfterReplyDelete.commentCount).toBe(0);
  });

  it('AC 4: Concurrent child transitions maintain exact, nonnegative counters under high contention', async () => {
    // 1. Create parent comment
    const parentComment = await commentsService.createComment(authorUser.id, {
      clientRequestId: 'cr-concurrent-parent',
      postId: testPost.id,
      text: 'Parent for concurrency test',
    });

    // 2. Create 8 replies under parent
    const replyIds: string[] = [];
    for (let i = 0; i < 8; i++) {
      const rep = await commentsService.createReply(user2.id, {
        clientRequestId: `cr-concurrent-reply-${i}`,
        commentId: parentComment.id,
        text: `Concurrent reply ${i}`,
      });
      replyIds.push(rep.id);
    }

    const [postBefore] = await dbHelper.db.select().from(posts).where(eq(posts.id, testPost.id));
    expect(postBefore.commentCount).toBe(9); // 1 parent + 8 replies

    // 3. Concurrently delete 4 of the replies
    const deletePromises = replyIds.slice(0, 4).map((id) => commentsService.deleteComment(user2.id, id));
    await Promise.all(deletePromises);

    // 4. Verify post commentCount is exactly 5 (1 parent + 4 active replies)
    const [postAfter] = await dbHelper.db.select().from(posts).where(eq(posts.id, testPost.id));
    expect(postAfter.commentCount).toBe(5);

    const [parentAfter] = await dbHelper.db.select().from(comments).where(eq(comments.id, parentComment.id));
    expect(parentAfter.replyCount).toBe(4);
  });

  it('AC 5: Post removal and restoration: restoring a post does NOT revive individually removed/deleted comments or invalid pins', async () => {
    // 1. Create 3 comments beneath testPost
    const c1 = await commentsService.createComment(authorUser.id, {
      clientRequestId: 'cr-post-state-c1',
      postId: testPost.id,
      text: 'Comment 1 to be pinned',
    });

    const c2 = await commentsService.createComment(user2.id, {
      clientRequestId: 'cr-post-state-c2',
      postId: testPost.id,
      text: 'Comment 2 to be author deleted',
    });

    const c3 = await commentsService.createComment(user3.id, {
      clientRequestId: 'cr-post-state-c3',
      postId: testPost.id,
      text: 'Comment 3 to be admin removed',
    });

    // 2. Pin comment 1
    await commentsService.pinComment(authorUser.id, c1.id);
    const pinnedBefore = await commentsRepository.findPinnedCommentForPost(testPost.id);
    expect(pinnedBefore?.id).toBe(c1.id);

    // 3. Author deletes comment 2
    await commentsService.deleteComment(user2.id, c2.id);

    // 4. Admin permanently removes comment 3
    await adminRemoveComment(c3.id, adminUser.id, 'Administrative removal');

    // 5. Admin removes the entire post
    await adminRemovePost(testPost.id, adminUser.id, 'Post violated policy');

    // While post is REMOVED, findPinnedCommentForPost must return null
    const pinnedWhileRemoved = await commentsRepository.findPinnedCommentForPost(testPost.id);
    expect(pinnedWhileRemoved).toBeNull();

    // 6. Admin restores post
    await adminRestorePost(testPost.id, adminUser.id);

    // Check individual comment statuses
    const [rowC1] = await dbHelper.db.select().from(comments).where(eq(comments.id, c1.id));
    expect(rowC1.status).toBe('ACTIVE');

    const [rowC2] = await dbHelper.db.select().from(comments).where(eq(comments.id, c2.id));
    expect(rowC2.status).toBe('DELETED'); // Remains deleted!

    const [rowC3] = await dbHelper.db.select().from(comments).where(eq(comments.id, c3.id));
    expect(rowC3.status).toBe('REMOVED'); // Remains permanently removed!

    // Active comment 1 is still pinned because it was not removed
    const pinnedAfter = await commentsRepository.findPinnedCommentForPost(testPost.id);
    expect(pinnedAfter?.id).toBe(c1.id);

    // 7. Now test: if pinned comment c1 is individually removed by admin, its pin is deleted and post restoration never revives it
    await adminRemoveComment(c1.id, adminUser.id, 'Remove pinned comment');

    const [pinRow] = await dbHelper.db.select().from(postPins).where(eq(postPins.commentId, c1.id));
    expect(pinRow).toBeUndefined();

    // Cycle post removal and restoration
    await adminRemovePost(testPost.id, adminUser.id, 'Cycle removal');
    await adminRestorePost(testPost.id, adminUser.id);

    const pinnedFinal = await commentsRepository.findPinnedCommentForPost(testPost.id);
    expect(pinnedFinal).toBeNull(); // Pin is permanently gone
  });

  it('AC 6: Operational reconciliation repairs drifted counters using reachability definition without counting child rows under removed parents', async () => {
    // 1. Thread A: Active parent with 2 active replies -> 3 reachable items
    const parentA = await commentsService.createComment(authorUser.id, {
      clientRequestId: 'cr-recon-parent-a',
      postId: testPost.id,
      text: 'Thread A Parent (ACTIVE)',
    });
    await commentsService.createReply(user2.id, {
      clientRequestId: 'cr-recon-reply-a1',
      commentId: parentA.id,
      text: 'Thread A Reply 1 (ACTIVE)',
    });
    await commentsService.createReply(user3.id, {
      clientRequestId: 'cr-recon-reply-a2',
      commentId: parentA.id,
      text: 'Thread A Reply 2 (ACTIVE)',
    });

    // 2. Thread B: Author-deleted parent with 2 active replies -> 2 reachable items (replies only)
    const parentB = await commentsService.createComment(authorUser.id, {
      clientRequestId: 'cr-recon-parent-b',
      postId: testPost.id,
      text: 'Thread B Parent (to be deleted)',
    });
    await commentsService.createReply(user2.id, {
      clientRequestId: 'cr-recon-reply-b1',
      commentId: parentB.id,
      text: 'Thread B Reply 1 (ACTIVE)',
    });
    await commentsService.createReply(user3.id, {
      clientRequestId: 'cr-recon-reply-b2',
      commentId: parentB.id,
      text: 'Thread B Reply 2 (ACTIVE)',
    });
    await commentsService.deleteComment(authorUser.id, parentB.id);

    // 3. Thread C: Permanently REMOVED parent with active replies in DB -> 0 reachable items!
    const parentC = await commentsService.createComment(authorUser.id, {
      clientRequestId: 'cr-recon-parent-c',
      postId: testPost.id,
      text: 'Thread C Parent (to be removed)',
    });
    await commentsService.createReply(user2.id, {
      clientRequestId: 'cr-recon-reply-c1',
      commentId: parentC.id,
      text: 'Thread C Reply 1',
    });
    await commentsService.createReply(user3.id, {
      clientRequestId: 'cr-recon-reply-c2',
      commentId: parentC.id,
      text: 'Thread C Reply 2',
    });
    // Mark parent C as REMOVED (leaving child rows ACTIVE to test that reconciliation correctly ignores them)
    await dbHelper.pool.query(`UPDATE comments SET status = 'REMOVED', reply_count = 0 WHERE id = $1`, [parentC.id]);

    // 4. Thread D: Whole-hidden parent with 1 active reply -> 1 reachable item
    const parentD = await commentsService.createComment(authorUser.id, {
      clientRequestId: 'cr-recon-parent-d',
      postId: testPost.id,
      text: 'Thread D Parent',
    });
    await commentsService.createReply(user2.id, {
      clientRequestId: 'cr-recon-reply-d1',
      commentId: parentD.id,
      text: 'Thread D Reply 1',
    });
    await dbHelper.pool.query(`UPDATE comments SET status = 'HIDDEN' WHERE id = $1`, [parentD.id]);

    // Add a boost to parent A
    await commentsService.toggleCommentBoost(user2.id, parentA.id);

    // Expected reachable comment count for testPost:
    // Thread A: 1 parent + 2 replies = 3
    // Thread B: 0 parent + 2 replies = 2
    // Thread C: 0 parent + 0 replies (parent is REMOVED!) = 0
    // Thread D: 0 parent + 1 reply = 1
    // Total expected = 3 + 2 + 0 + 1 = 6.

    // 5. Intentionally corrupt counters in PostgreSQL to simulate drift / interrupted operations
    await dbHelper.pool.query(`UPDATE posts SET comment_count = 999 WHERE id = $1`, [testPost.id]);
    await dbHelper.pool.query(`UPDATE comments SET reply_count = 888 WHERE id = $1`, [parentA.id]);
    await dbHelper.pool.query(`UPDATE comments SET reply_count = 777 WHERE id = $1`, [parentC.id]);
    await dbHelper.pool.query(`UPDATE comments SET boost_count = 555 WHERE id = $1`, [parentB.id]);

    // 6. Run operational reconciliation
    const repairResult = await commentsService.reconcileCommentCounters({ postId: testPost.id });

    expect(repairResult.postsRepaired).toBe(1);
    expect(repairResult.commentsRepaired).toBe(3);

    // 7. Verify post commentCount is exactly 6 (does NOT count the 2 active replies under removed parent C)
    const [repairedPost] = await dbHelper.db.select().from(posts).where(eq(posts.id, testPost.id));
    expect(repairedPost.commentCount).toBe(6);

    // Verify parent A replyCount repaired to 2 and boostCount is 1
    const [repairedParentA] = await dbHelper.db.select().from(comments).where(eq(comments.id, parentA.id));
    expect(repairedParentA.replyCount).toBe(2);
    expect(repairedParentA.boostCount).toBe(1);

    // Verify parent B boostCount repaired to 0
    const [repairedParentB] = await dbHelper.db.select().from(comments).where(eq(comments.id, parentB.id));
    expect(repairedParentB.boostCount).toBe(0);

    // Verify parent C (REMOVED) replyCount repaired to 0
    const [repairedParentC] = await dbHelper.db.select().from(comments).where(eq(comments.id, parentC.id));
    expect(repairedParentC.replyCount).toBe(0);

    // 8. Subsequent reconciliation run does not perform any redundant updates
    const idempotentResult = await commentsService.reconcileCommentCounters({ postId: testPost.id });
    expect(idempotentResult.postsRepaired).toBe(0);
    expect(idempotentResult.commentsRepaired).toBe(0);
  });
});

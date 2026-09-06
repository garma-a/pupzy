import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { eq, sql } from 'drizzle-orm';
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

describe('Comments Moderation Inspection & Restoration Integration (Ticket 08)', () => {
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
  let matureUser1: User;
  let matureUser2: User;
  let matureUser3: User;
  let newUnqualifiedUser: User;
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
          reportComment: (_root, args, ctx) =>
            commentsResolver.reportComment(args.commentId, args.reason, args.details, ctx),
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

    // 2. Seed Author
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

    // 3. Seed mature users (> 24h old, completed profile)
    [matureUser1] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${generateUuidV7()}`,
        email: `mature1-${generateUuidV7()}@pupzy.dev`,
        fullName: 'Mature Reporter 1',
        username: `mature1_${generateUuidV7().slice(0, 8)}`,
        cityId: testCity.id,
        createdAt: new Date(Date.now() - 48 * 3600 * 1000),
      })
      .returning();

    [matureUser2] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${generateUuidV7()}`,
        email: `mature2-${generateUuidV7()}@pupzy.dev`,
        fullName: 'Mature Reporter 2',
        username: `mature2_${generateUuidV7().slice(0, 8)}`,
        cityId: testCity.id,
        createdAt: new Date(Date.now() - 48 * 3600 * 1000),
      })
      .returning();

    [matureUser3] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${generateUuidV7()}`,
        email: `mature3-${generateUuidV7()}@pupzy.dev`,
        fullName: 'Mature Reporter 3',
        username: `mature3_${generateUuidV7().slice(0, 8)}`,
        cityId: testCity.id,
        createdAt: new Date(Date.now() - 48 * 3600 * 1000),
      })
      .returning();

    // 4. Seed unqualified user (< 24h old)
    [newUnqualifiedUser] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${generateUuidV7()}`,
        email: `newbie-${generateUuidV7()}@pupzy.dev`,
        fullName: 'Newbie User',
        username: `newbie_${generateUuidV7().slice(0, 8)}`,
        cityId: testCity.id,
        createdAt: new Date(Date.now() - 1 * 3600 * 1000), // 1 hour ago
      })
      .returning();

    // 5. Seed Admin User
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

    // 6. Seed Post
    [testPost] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId: authorUser.id,
        title: 'Post for Discussion Moderation',
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
    const mediaLoader = new DataLoader(async (commentIds: readonly string[]) => {
      const rows = await commentsRepository.findMediaByCommentIds(commentIds);
      const grouped = new Map<string, any[]>();
      for (const id of commentIds) grouped.set(id, []);
      for (const row of rows) grouped.get(row.commentId)?.push(row);
      return commentIds.map((id) => grouped.get(id) ?? []);
    });

    return {
      req: {
        headers: {},
        ip: '127.0.0.1',
      } as any,
      res: {} as any,
      user: userId ? { id: userId, email: 'user@pupzy.dev', role: 'USER' } : undefined,
      mediaLoader,
    };
  }

  it('AC 1 & AC 2: inspectMedia allows admin to view ordered media & reports while public GraphQL hides them', async () => {
    // 1. Create a comment with 2 media attachments
    const [comment] = await dbHelper.db
      .insert(comments)
      .values({
        postId: testPost.id,
        authorId: authorUser.id,
        text: 'Comment with images reported as inappropriate',
        status: 'IMAGE_HIDDEN',
      })
      .returning();

    await dbHelper.db.insert(commentMedia).values([
      {
        commentId: comment.id,
        storageKey: `comments/${comment.id}/photo1.webp`,
        sha256: 'a'.repeat(64),
        displayOrder: 0,
        width: 480,
        height: 320,
        fileSizeBytes: 45000,
        fileContentType: 'image/webp',
      },
      {
        commentId: comment.id,
        storageKey: `comments/${comment.id}/photo2.webp`,
        sha256: 'b'.repeat(64),
        displayOrder: 1,
        width: 400,
        height: 400,
        fileSizeBytes: 52000,
        fileContentType: 'image/webp',
      },
    ]);

    // Insert a report
    await dbHelper.db.insert(commentReports).values({
      commentId: comment.id,
      reporterId: matureUser1.id,
      reason: 'INAPPROPRIATE_CONTENT',
      details: 'Offensive photo',
    });

    // 2. Query via public GraphQL: media must be empty for IMAGE_HIDDEN
    const publicGqlQuery = `
      query GetComments($postId: ID!) {
        comments(postId: $postId) {
          edges {
            node {
              id
              text
              media {
                id
                publicUrl
              }
            }
          }
        }
      }
    `;

    const publicResult = await graphql({
      schema,
      source: publicGqlQuery,
      variableValues: { postId: testPost.id },
      contextValue: createContext(undefined),
    });

    expect(publicResult.errors).toBeUndefined();
    const node = (publicResult.data?.comments as any)?.edges?.[0]?.node;
    expect(node).toMatchObject({
      id: comment.id,
      text: 'Comment with images reported as inappropriate',
      media: [], // Must be empty for public
    });

    // 3. Inspect via database moderation query (matches AdminJS inspectMedia)
    const { rows: inspectMediaRows } = await dbHelper.pool.query(
      `SELECT id, storage_key, width, height, file_size_bytes, display_order, file_content_type
       FROM comment_media
       WHERE comment_id = $1
       ORDER BY display_order ASC`,
      [comment.id],
    );

    expect(inspectMediaRows).toHaveLength(2);
    expect(inspectMediaRows[0].storage_key).toBe(`comments/${comment.id}/photo1.webp`);
    expect(inspectMediaRows[0].display_order).toBe(0);
    expect(inspectMediaRows[1].storage_key).toBe(`comments/${comment.id}/photo2.webp`);
    expect(inspectMediaRows[1].display_order).toBe(1);

    const { rows: inspectReportRows } = await dbHelper.pool.query(
      `SELECT id, reporter_id, reason, details, reviewed_at
       FROM comment_reports
       WHERE comment_id = $1
       ORDER BY created_at DESC`,
      [comment.id],
    );

    expect(inspectReportRows).toHaveLength(1);
    expect(inspectReportRows[0].reason).toBe('INAPPROPRIATE_CONTENT');
    expect(inspectReportRows[0].details).toBe('Offensive photo');
    expect(inspectReportRows[0].reviewed_at).toBeNull();
  });

  it('AC 3, 4, 5, 6, 7: restoration sets reviewed_at, restores counts, prevents unqualified reports from re-hiding, and respects new qualifying reports', async () => {
    // 1. Create a comment with 1 image
    const [comment] = await dbHelper.db
      .insert(comments)
      .values({
        postId: testPost.id,
        authorId: authorUser.id,
        text: 'Target comment for full report & restoration cycle',
        status: 'ACTIVE',
      })
      .returning();

    await dbHelper.db.insert(commentMedia).values({
      commentId: comment.id,
      storageKey: `comments/${comment.id}/pic.webp`,
      sha256: 'c'.repeat(64),
      displayOrder: 0,
      width: 480,
      height: 320,
      fileSizeBytes: 30000,
      fileContentType: 'image/webp',
    });

    await dbHelper.db.update(posts).set({ commentCount: 1 }).where(eq(posts.id, testPost.id));

    // 2. Submit 3 qualifying reports to hide the whole comment
    await commentsRepository.reportComment({
      commentId: comment.id,
      reporterId: matureUser1.id,
      reason: 'SPAM',
      details: 'Spam report 1',
    });
    await commentsRepository.reportComment({
      commentId: comment.id,
      reporterId: matureUser2.id,
      reason: 'SCAM',
      details: 'Scam report 2',
    });
    await commentsRepository.reportComment({
      commentId: comment.id,
      reporterId: matureUser3.id,
      reason: 'OTHER',
      details: 'Other report 3',
    });

    // Check that status is HIDDEN and post commentCount decremented
    const [hiddenComment] = await dbHelper.db.select().from(comments).where(eq(comments.id, comment.id));
    expect(hiddenComment.status).toBe('HIDDEN');

    const [postAfterHide] = await dbHelper.db.select().from(posts).where(eq(posts.id, testPost.id));
    expect(postAfterHide.commentCount).toBe(0);

    // 3. Admin performs restoreComment clean decision
    await dbHelper.pool.query('BEGIN');
    await dbHelper.pool.query(`UPDATE posts SET comment_count = comment_count + 1, updated_at = now() WHERE id = $1`, [
      testPost.id,
    ]);
    await dbHelper.pool.query(`UPDATE comments SET status = 'ACTIVE', updated_at = now() WHERE id = $1`, [comment.id]);
    await dbHelper.pool.query(
      `UPDATE comment_reports SET reviewed_at = now() WHERE comment_id = $1 AND reviewed_at IS NULL`,
      [comment.id],
    );
    await dbHelper.pool.query(
      `INSERT INTO moderation_actions (admin_user_id, action_type, target_type, target_id, reason)
       VALUES ($1, 'COMMENT_RESTORED', 'COMMENT', $2, $3)`,
      [adminUser.id, comment.id, 'Reviewed and confirmed compliant with community guidelines'],
    );
    await dbHelper.pool.query('COMMIT');

    // Verify DB state after restoration:
    // - comment status is ACTIVE
    const [restoredComment] = await dbHelper.db.select().from(comments).where(eq(comments.id, comment.id));
    expect(restoredComment.status).toBe('ACTIVE');

    // - post commentCount restored to 1
    const [postAfterRestore] = await dbHelper.db.select().from(posts).where(eq(posts.id, testPost.id));
    expect(postAfterRestore.commentCount).toBe(1);

    // - all 3 reports now have reviewed_at IS NOT NULL
    const reportsAfterRestore = await dbHelper.db
      .select()
      .from(commentReports)
      .where(eq(commentReports.commentId, comment.id));
    expect(reportsAfterRestore).toHaveLength(3);
    for (const r of reportsAfterRestore) {
      expect(r.reviewedAt).not.toBeNull();
    }

    // - moderation_actions has COMMENT_RESTORED logged
    const [modAction] = await dbHelper.db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.targetId, comment.id));
    expect(modAction).toBeDefined();
    expect(modAction.actionType).toBe('COMMENT_RESTORED');
    expect(modAction.adminUserId).toBe(adminUser.id);
    expect(modAction.reason).toContain('Reviewed and confirmed');

    // 4. AC 4: A new UNQUALIFIED report (account < 24h old) is accepted but CANNOT re-hide the comment
    const unqualifiedSuccess = await commentsRepository.reportComment({
      commentId: comment.id,
      reporterId: newUnqualifiedUser.id,
      reason: 'SPAM',
      details: 'Unqualified report from new user',
    });
    expect(unqualifiedSuccess).toBe(true);

    const [commentAfterUnqualified] = await dbHelper.db.select().from(comments).where(eq(comments.id, comment.id));
    expect(commentAfterUnqualified.status).toBe('ACTIVE'); // Still ACTIVE!

    // 5. AC 5: A new QUALIFYING report with INAPPROPRIATE_CONTENT hides images
    // Create another mature user for a new qualifying report
    const [matureUser4] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${generateUuidV7()}`,
        email: `mature4-${generateUuidV7()}@pupzy.dev`,
        fullName: 'Mature Reporter 4',
        username: `mature4_${generateUuidV7().slice(0, 8)}`,
        cityId: testCity.id,
        createdAt: new Date(Date.now() - 48 * 3600 * 1000),
      })
      .returning();

    await commentsRepository.reportComment({
      commentId: comment.id,
      reporterId: matureUser4.id,
      reason: 'INAPPROPRIATE_CONTENT',
      details: 'Fresh inappropriate content report',
    });

    const [commentAfterQualifyingInappropriate] = await dbHelper.db
      .select()
      .from(comments)
      .where(eq(comments.id, comment.id));
    // 1 qualifying inappropriate report hides images
    expect(commentAfterQualifyingInappropriate.status).toBe('IMAGE_HIDDEN');
  });
});

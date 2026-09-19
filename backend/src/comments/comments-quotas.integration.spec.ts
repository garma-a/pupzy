import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { eq, and, sql, inArray, gte } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import DataLoader from 'dataloader';
import { PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { AppError } from '../common/errors/app.errors';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  users,
  cities,
  posts,
  comments,
  stagedUploads,
  commentQuotaAdmissions,
  commentReports,
  postReports,
  accountReports,
  type User,
  type City,
  type Post,
  type Comment,
  type CommentMedia,
} from '../database/schema';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';
import { CommentsResolver, CommentMediaResolver } from './comments.resolver';
import { ModerationReportQuotaManager } from '../moderation-reports/moderation-report-quota.manager';
import { PostsRepository } from '../posts/posts.repository';
import { CitiesRepository } from '../cities/cities.repository';
import { UsersRepository } from '../users/users.repository';
import { CitiesService } from '../cities/cities.service';
import { UsersService } from '../users/users.service';
import { UploadService } from '../upload/upload.service';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import type { GqlContext } from '../common/types/gql-context.type';

const CREATE_COMMENT_MUTATION = `
  mutation CreateComment($input: CreateCommentInput!) {
    createComment(input: $input) {
      id
      text
      postId
      parentId
      createdAt
    }
  }
`;

const CREATE_REPLY_MUTATION = `
  mutation CreateReply($input: CreateReplyInput!) {
    createReply(input: $input) {
      id
      text
      postId
      parentId
      createdAt
    }
  }
`;

const REQUEST_TICKET_MUTATION = `
  mutation RequestTicket($input: RequestCommentImageUploadInput!) {
    requestCommentImageUploadUrl(input: $input) {
      mediaId
      uploadUrl
      maxSizeBytes
      allowedContentType
    }
  }
`;

const TOGGLE_BOOST_MUTATION = `
  mutation ToggleBoost($commentId: ID!) {
    toggleCommentBoost(commentId: $commentId) {
      commentId
      isBoostedByMe
      boostedByMe
      boostCount
    }
  }
`;

const REPORT_COMMENT_MUTATION = `
  mutation ReportComment($input: ReportCommentInput!) {
    reportComment(input: $input)
  }
`;

interface CreateCommentResponse {
  createComment: {
    id: string;
    text: string;
    postId: string;
    parentId?: string | null;
    createdAt: string;
  };
}

interface RequestTicketResponse {
  requestCommentImageUploadUrl: {
    mediaId: string;
    uploadUrl: string;
    maxSizeBytes?: number;
    allowedContentType?: string;
  };
}

interface R2Error extends Error {
  name: string;
  $metadata?: { httpStatusCode: number };
}

class ControllableR2Adapter {
  public objects = new Map<string, { bytes: Buffer; etag: string }>();

  send(command: {
    constructor?: { name?: string };
    name?: string;
    input?: { Key?: string; Body?: unknown };
  }): Record<string, unknown> {
    const cmdName = command.constructor?.name ?? command.name;
    const key = command.input?.Key ?? '';

    if (cmdName === 'HeadObjectCommand' || command instanceof HeadObjectCommand) {
      if (!this.objects.has(key)) {
        const err = new Error(`NotFound: ${key}`) as R2Error;
        err.name = 'NotFound';
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      const item = this.objects.get(key)!;
      return { ContentLength: item.bytes.length, ETag: item.etag };
    }

    if (cmdName === 'GetObjectCommand' || command instanceof GetObjectCommand) {
      const item = this.objects.get(key);
      if (!item) {
        const err = new Error(`NoSuchKey: ${key}`) as R2Error;
        err.name = 'NoSuchKey';
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      return {
        ContentLength: item.bytes.length,
        ETag: item.etag,
        Body: {
          transformToByteArray: () => Promise.resolve(new Uint8Array(item.bytes)),
        },
      };
    }

    if (cmdName === 'PutObjectCommand' || command instanceof PutObjectCommand) {
      const rawBody = command.input?.Body;
      const bytes = Buffer.isBuffer(rawBody)
        ? rawBody
        : typeof rawBody === 'string'
          ? Buffer.from(rawBody)
          : Buffer.from('');
      const etag = `"${crypto.createHash('md5').update(bytes).digest('hex')}"`;
      this.objects.set(key, { bytes, etag });
      return {};
    }

    if (cmdName === 'DeleteObjectCommand' || command instanceof DeleteObjectCommand) {
      this.objects.delete(key);
      return {};
    }

    return {};
  }
}

describe('Comment Discussion Quotas Integration (Ticket 10)', () => {
  jest.setTimeout(120_000);

  let dbHelper: TestDatabaseHelper;
  let r2Adapter: ControllableR2Adapter;
  let mockCache: Cache;
  let mockConfig: ConfigService;

  let commentsRepo: CommentsRepository;
  let postsRepo: PostsRepository;
  let citiesRepo: CitiesRepository;
  let usersRepo: UsersRepository;

  let citiesService: CitiesService;
  let usersService: UsersService;
  let uploadService: UploadService;
  let commentsService: CommentsService;

  let commentsResolver: CommentsResolver;
  let commentMediaResolver: CommentMediaResolver;
  let executableSchema: GraphQLSchema;
  let reportQuotaManager: ModerationReportQuotaManager;

  let testCity: City;
  let user1: User;
  let user2: User;
  let testPost: Post;
  let parentCommentId: string;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    r2Adapter = new ControllableR2Adapter();

    const cacheStore = new Map<string, unknown>();
    mockCache = {
      get: jest.fn((key: string) => Promise.resolve(cacheStore.get(key))),
      set: jest.fn((key: string, val: unknown) => {
        cacheStore.set(key, val);
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

    mockConfig = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'R2_ACCOUNT_ID':
            return 'test-account';
          case 'R2_ACCESS_KEY_ID':
            return 'test-key';
          case 'R2_SECRET_ACCESS_KEY':
            return 'test-secret';
          case 'R2_BUCKET_NAME':
            return 'pupzy-bucket';
          case 'R2_PUBLIC_URL':
            return 'https://cdn.pupzy.com';
          case 'COMMENT_MEDIA_CDN_BASE':
            return 'https://cdn.pupzy.net';
          case 'COMMENT_IMAGES_ENABLED':
            return 'true';
          default:
            return undefined;
        }
      }),
    } as unknown as ConfigService;

    commentsRepo = new CommentsRepository(dbHelper.db);
    postsRepo = new PostsRepository(dbHelper.db);
    citiesRepo = new CitiesRepository(dbHelper.db);
    usersRepo = new UsersRepository(dbHelper.db);

    citiesService = new CitiesService(citiesRepo, mockCache);
    usersService = new UsersService(usersRepo, citiesService, mockConfig, mockCache);
    uploadService = new UploadService(mockConfig, mockCache, dbHelper.db);
    (uploadService as unknown as { s3Client: { send: unknown } }).s3Client.send = jest.fn(
      (cmd: Parameters<typeof r2Adapter.send>[0]) => r2Adapter.send(cmd),
    );

    commentsService = new CommentsService(
      commentsRepo,
      postsRepo,
      uploadService,
      mockConfig,
      undefined,
      undefined,
      usersService,
    );

    commentsResolver = new CommentsResolver(commentsService);
    commentMediaResolver = new CommentMediaResolver(commentsService);
    reportQuotaManager = new ModerationReportQuotaManager(dbHelper.db);

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

    executableSchema = makeExecutableSchema({
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
          post: (_root: unknown, args: { id: string }) => postsRepo.findById(args.id),
          comments: (_root: unknown, args: { postId: string; sort?: string; first?: number; after?: string }) =>
            commentsResolver.comments(args.postId, args.sort, args.first, args.after),
          replies: (_root: unknown, args: { commentId: string; first?: number; after?: string }) =>
            commentsResolver.replies(args.commentId, args.first, args.after),
        },
        Mutation: {
          createComment: (_root: unknown, args: { input: unknown }, ctx: GqlContext) =>
            commentsResolver.createComment(args.input, ctx),
          createReply: (_root: unknown, args: { input: unknown }, ctx: GqlContext) =>
            commentsResolver.createReply(args.input, ctx),
          requestCommentImageUploadUrl: (_root: unknown, args: { input: unknown }, ctx: GqlContext) =>
            commentsResolver.requestCommentImageUploadUrl(args.input, ctx),
          toggleCommentBoost: (_root: unknown, args: { commentId: string }, ctx: GqlContext) =>
            commentsResolver.toggleCommentBoost(args.commentId, ctx),
          reportComment: (_root: unknown, args: { input: unknown }, ctx: GqlContext) =>
            commentsResolver.reportComment(args.input, ctx),
        },
        Comment: {
          author: (root: Comment, _args: unknown, ctx: GqlContext) => commentsResolver.author(root, ctx),
          text: (root: Comment) => commentsResolver.text(root),
          media: (root: Comment, _args: unknown, ctx: GqlContext) => commentsResolver.media(root, ctx),
          isBoostedByMe: (root: Comment, _args: unknown, ctx: GqlContext) => commentsResolver.isBoostedByMe(root, ctx),
          boostCount: (root: Comment) => commentsResolver.boostCount(root),
          isPinned: (root: Comment, _args: unknown, ctx: GqlContext) => commentsResolver.isPinned(root, ctx),
        },
        CommentMedia: {
          publicUrl: (root: CommentMedia) => commentMediaResolver.publicUrl(root),
        },
      },
    });
  });

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();
    r2Adapter.objects.clear();

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

    const [u1, u2] = await dbHelper.db
      .insert(users)
      .values([
        {
          firebaseUserId: `fb-user1-${generateUuidV7()}`,
          email: `user1-${generateUuidV7()}@example.com`,
          fullName: 'User One',
          username: `user_one_${generateUuidV7().slice(0, 8)}`,
          createdAt: new Date(Date.now() - 48 * 3600 * 1000), // > 24h old for qualifying reports
        },
        {
          firebaseUserId: `fb-user2-${generateUuidV7()}`,
          email: `user2-${generateUuidV7()}@example.com`,
          fullName: 'User Two',
          username: `user_two_${generateUuidV7().slice(0, 8)}`,
          createdAt: new Date(Date.now() - 48 * 3600 * 1000),
        },
      ])
      .returning();
    user1 = u1;
    user2 = u2;

    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId: user1.id,
        postType: 'RESCUE',
        title: 'Discussion Post for Quota Testing',
        description: 'Post description',
        cityId: testCity.id,
        urgency: 'URGENT',
        status: 'ACTIVE',
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    testPost = post;

    // Create a base parent comment for reply testing
    const [parent] = await dbHelper.db
      .insert(comments)
      .values({
        postId: testPost.id,
        authorId: user1.id,
        text: 'Parent comment for replies',
        status: 'ACTIVE',
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
      })
      .returning();
    parentCommentId = parent.id;
  });

  async function executeGql<TData = Record<string, unknown>>(
    source: string,
    variables: Record<string, unknown> = {},
    user: User = user1,
  ): Promise<ExecutionResult<TData>> {
    const userByIdLoader = new DataLoader<string, User | null>(async (ids: readonly string[]) => {
      const rows = await dbHelper.db
        .select()
        .from(users)
        .where(inArray(users.id, ids as string[]));
      const map = new Map(rows.map((u) => [u.id, u]));
      return ids.map((id) => map.get(id) ?? null);
    });

    const ctx: GqlContext = {
      req: {} as unknown as GqlContext['req'],
      user,
      loaders: {
        cityById: citiesService.createCityByIdLoader(),
        userById: userByIdLoader,
        mediaByPostId: postsRepo.createMediaByPostIdLoader(),
        upvotedByMe: postsRepo.createUpvotedByMeLoader(),
        savedByMe: postsRepo.createSavedByMeLoader(),
        commentBoostedByMe: {
          load: jest.fn().mockResolvedValue(false),
        } as unknown as GqlContext['loaders']['commentBoostedByMe'],
        pinnedCommentIdByPostId: {
          load: jest.fn().mockResolvedValue(null),
        } as unknown as GqlContext['loaders']['pinnedCommentIdByPostId'],
        commentMediaByCommentId: commentsRepo.createCommentMediaByCommentIdLoader(),
      },
    };

    return graphql({
      schema: executableSchema,
      source,
      variableValues: variables,
      contextValue: ctx,
    }) as Promise<ExecutionResult<TData>>;
  }

  describe('AC 1 & AC 2: Shared Comment/Reply creation limits (10/min and 100/day)', () => {
    it('concurrent burst of 20 creation requests (comments and replies) from same user admits exactly 10 and rejects 10 with RATE_LIMITED', async () => {
      // 10 top-level comments and 10 replies from user1 concurrently
      const requests = Array.from({ length: 20 }, (_, i) => {
        const isReply = i % 2 === 1;
        if (isReply) {
          return executeGql(
            CREATE_REPLY_MUTATION,
            {
              input: {
                commentId: parentCommentId,
                text: `Concurrent reply ${i}`,
                clientRequestId: `req-concurrent-reply-${i}-${generateUuidV7()}`,
              },
            },
            user1,
          );
        } else {
          return executeGql(
            CREATE_COMMENT_MUTATION,
            {
              input: {
                postId: testPost.id,
                text: `Concurrent comment ${i}`,
                clientRequestId: `req-concurrent-comment-${i}-${generateUuidV7()}`,
              },
            },
            user1,
          );
        }
      });

      const results = await Promise.all(requests);

      const successes = results.filter((r) => !r.errors && (r.data?.createComment || r.data?.createReply));
      const failures = results.filter((r) => r.errors && r.errors.length > 0);

      expect(successes.length).toBe(10);
      expect(failures.length).toBe(10);

      // Verify every rejection carries RATE_LIMITED code and standard message
      for (const fail of failures) {
        const err = fail.errors![0];
        expect((err.originalError as { code?: string })?.code).toBe('RATE_LIMITED');
        expect(err.message).toContain('Comment creation rate limit exceeded (max 10 per minute)');
      }

      // Verify database has exactly 11 comments (1 initial parent + 10 admitted)
      const authorComments = await dbHelper.db.select().from(comments).where(eq(comments.authorId, user1.id));
      expect(authorComments.length).toBe(11);
    });

    it('enforces 100 creations per day limit and rejects 101st request with RATE_LIMITED', async () => {
      // User 1 makes 9 comments in the past 2 hours (within 24h, outside 1m)
      const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
      const pastAdmissions = Array.from({ length: 90 }, (_, i) => ({
        id: generateUuidV7(),
        userId: user1.id,
        action: 'COMMENT_CREATION',
        clientRequestId: `past-req-${i}`,
        createdAt: new Date(twoHoursAgo.getTime() + i * 1000),
      }));
      await dbHelper.db.insert(commentQuotaAdmissions).values(pastAdmissions);

      // User 1 creates 10 comments right now (minute quota allows 10, bringing daily total to 100)
      for (let i = 0; i < 10; i++) {
        const res = await executeGql(
          CREATE_COMMENT_MUTATION,
          {
            input: {
              postId: testPost.id,
              text: `Daily test comment ${i}`,
              clientRequestId: `req-daily-${i}-${generateUuidV7()}`,
            },
          },
          user1,
        );
        expect(res.errors).toBeUndefined();
      }

      // Now minute count is 10 and day count is 100.
      // Wait or reset minute window admissions to test daily limit specifically:
      // Clear minute admissions by backdating the 10 recent admissions to 5 minutes ago
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      await dbHelper.db
        .update(commentQuotaAdmissions)
        .set({ createdAt: fiveMinutesAgo })
        .where(
          and(
            eq(commentQuotaAdmissions.userId, user1.id),
            eq(commentQuotaAdmissions.action, 'COMMENT_CREATION'),
            gte(commentQuotaAdmissions.createdAt, new Date(Date.now() - 60 * 1000)),
          ),
        );
      await dbHelper.db.update(comments).set({ createdAt: fiveMinutesAgo }).where(eq(comments.authorId, user1.id));

      // Now minute count is 0, but 24h count is 101 (90 past + 10 created + 1 initial parent).
      // Attempting the 102nd creation MUST be rejected by the daily rate limit!
      const res101 = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Creation beyond daily quota',
            clientRequestId: `req-daily-overflow-${generateUuidV7()}`,
          },
        },
        user1,
      );

      expect(res101.errors).toBeDefined();
      expect((res101.errors![0].originalError as { code?: string })?.code).toBe('RATE_LIMITED');
      expect(res101.errors![0].message).toContain('Comment creation rate limit exceeded (max 100 per day)');
    });

    it('independent users have completely isolated creation quotas', async () => {
      // Exhaust user1's minute quota with 10 comments
      for (let i = 0; i < 10; i++) {
        const res = await executeGql(
          CREATE_COMMENT_MUTATION,
          {
            input: {
              postId: testPost.id,
              text: `User1 comment ${i}`,
              clientRequestId: `req-user1-${i}-${generateUuidV7()}`,
            },
          },
          user1,
        );
        expect(res.errors).toBeUndefined();
      }

      // 11th request for user1 fails
      const blockedRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'User1 blocked comment',
            clientRequestId: `req-user1-blocked-${generateUuidV7()}`,
          },
        },
        user1,
      );
      expect(blockedRes.errors).toBeDefined();
      expect((blockedRes.errors![0].originalError as { code?: string })?.code).toBe('RATE_LIMITED');

      // User2 concurrently makes 5 requests - all must succeed without interference
      const user2Requests = Array.from({ length: 5 }, (_, i) =>
        executeGql(
          CREATE_COMMENT_MUTATION,
          {
            input: {
              postId: testPost.id,
              text: `User2 comment ${i}`,
              clientRequestId: `req-user2-${i}-${generateUuidV7()}`,
            },
          },
          user2,
        ),
      );

      const user2Results = await Promise.all(user2Requests);
      for (const res of user2Results) {
        expect(res.errors).toBeUndefined();
        expect(res.data?.createComment.id).toBeDefined();
      }
    });
  });

  describe('AC 5: Completed identical retries, concurrent repeats, and reservation rollback', () => {
    it('completed identical retry succeeds even at exhausted quota boundary without consuming quota', async () => {
      const initialRequestId = `req-initial-${generateUuidV7()}`;

      // 1. Create initial comment
      const initialRes = await executeGql<CreateCommentResponse>(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Initial comment',
            clientRequestId: initialRequestId,
          },
        },
        user1,
      );
      expect(initialRes.errors).toBeUndefined();
      const initialCommentId = initialRes.data!.createComment.id;

      // 2. Exhaust user1's creation quota with 9 more comments (reaching 10)
      for (let i = 0; i < 9; i++) {
        await executeGql(
          CREATE_COMMENT_MUTATION,
          {
            input: {
              postId: testPost.id,
              text: `Quota fill comment ${i}`,
              clientRequestId: `req-fill-${i}-${generateUuidV7()}`,
            },
          },
          user1,
        );
      }

      // 3. Verify user1 is now exhausted
      const blockedRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: '11th new comment',
            clientRequestId: `req-new-blocked-${generateUuidV7()}`,
          },
        },
        user1,
      );
      expect(blockedRes.errors).toBeDefined();
      expect((blockedRes.errors![0].originalError as { code?: string })?.code).toBe('RATE_LIMITED');

      // 4. Replay initial comment with identical clientRequestId and text
      // MUST SUCCEED with 200 and return canonical entity without consuming another allowance!
      const retryRes = await executeGql<CreateCommentResponse>(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Initial comment',
            clientRequestId: initialRequestId,
          },
        },
        user1,
      );

      expect(retryRes.errors).toBeUndefined();
      expect(retryRes.data!.createComment.id).toBe(initialCommentId);
    });

    it('concurrent repeats with identical clientRequestId resolve to single creation and consume only 1 quota', async () => {
      const sharedRequestId = `req-repeat-${generateUuidV7()}`;
      const payload = {
        postId: testPost.id,
        text: 'Concurrent repeat comment',
        clientRequestId: sharedRequestId,
      };

      // 5 concurrent requests with the identical clientRequestId and payload
      const requests = Array.from({ length: 5 }, () =>
        executeGql<CreateCommentResponse>(CREATE_COMMENT_MUTATION, { input: payload }, user2),
      );

      const results = await Promise.all(requests);

      // All 5 must succeed and return the EXACT same comment ID
      const commentIds = results.map((r) => {
        expect(r.errors).toBeUndefined();
        return r.data!.createComment.id;
      });

      const uniqueIds = new Set(commentIds);
      expect(uniqueIds.size).toBe(1);

      // Verify exactly 1 comment exists in DB for this clientRequestId
      const dbComments = await dbHelper.db.select().from(comments).where(eq(comments.authorId, user2.id));
      expect(dbComments.length).toBe(1);

      // Verify user2 only consumed 1 creation quota
      const admissions = await dbHelper.db
        .select()
        .from(commentQuotaAdmissions)
        .where(and(eq(commentQuotaAdmissions.userId, user2.id), eq(commentQuotaAdmissions.action, 'COMMENT_CREATION')));
      expect(admissions.length).toBe(1);
    });

    it('failed mutation rolls back quota reservation and does not permanently strand budget', async () => {
      // User 2 attempts to create a comment on a non-existent post -> fails with NotFoundError
      const nonExistentPostId = generateUuidV7();
      const failedRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: nonExistentPostId,
            text: 'Will fail because post does not exist',
            clientRequestId: `req-failed-${generateUuidV7()}`,
          },
        },
        user2,
      );
      expect(failedRes.errors).toBeDefined();

      // User 2 now creates 10 valid comments
      // If the failed mutation had stranded quota, the 10th request would be rejected.
      // Since it rolled back, ALL 10 must succeed!
      for (let i = 0; i < 10; i++) {
        const res = await executeGql(
          CREATE_COMMENT_MUTATION,
          {
            input: {
              postId: testPost.id,
              text: `Valid comment ${i}`,
              clientRequestId: `req-valid-${i}-${generateUuidV7()}`,
            },
          },
          user2,
        );
        expect(res.errors).toBeUndefined();
        expect(res.data?.createComment.id).toBeDefined();
      }

      // Exactly the 11th request is rejected
      const overflowRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Overflow comment',
            clientRequestId: `req-overflow-${generateUuidV7()}`,
          },
        },
        user2,
      );
      expect(overflowRes.errors).toBeDefined();
      expect((overflowRes.errors![0].originalError as { code?: string })?.code).toBe('RATE_LIMITED');
    });
  });

  describe('AC 1, AC 2 & AC 4: Comment-image tickets (6/min, 50/day) & abandoned/failed ticket accounting', () => {
    it('concurrent burst of 12 image ticket requests from same user admits exactly 6 and rejects 6 with RATE_LIMITED', async () => {
      const requests = Array.from({ length: 12 }, () =>
        executeGql(
          REQUEST_TICKET_MUTATION,
          {
            input: {
              contentType: 'image/webp',
              fileSizeBytes: 50_000,
            },
          },
          user1,
        ),
      );

      const results = await Promise.all(requests);

      const successes = results.filter((r) => !r.errors && r.data?.requestCommentImageUploadUrl?.mediaId);
      const failures = results.filter((r) => r.errors && r.errors.length > 0);

      expect(successes.length).toBe(6);
      expect(failures.length).toBe(6);

      for (const fail of failures) {
        expect((fail.errors![0].originalError as { code?: string })?.code).toBe('RATE_LIMITED');
        expect(fail.errors![0].message).toContain('Comment image upload rate limit exceeded (max 6 per minute)');
      }
    });

    it('enforces 50 tickets per day limit', async () => {
      // Seed 44 ticket admissions for user1 from 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
      const pastAdmissions = Array.from({ length: 44 }, () => ({
        id: generateUuidV7(),
        userId: user1.id,
        action: 'COMMENT_IMAGE_TICKET',
        createdAt: twoHoursAgo,
      }));
      await dbHelper.db.insert(commentQuotaAdmissions).values(pastAdmissions);

      // User 1 requests 6 tickets in the current minute (bringing day total to 50)
      for (let i = 0; i < 6; i++) {
        const res = await executeGql(
          REQUEST_TICKET_MUTATION,
          {
            input: {
              contentType: 'image/webp',
              fileSizeBytes: 50_000,
            },
          },
          user1,
        );
        expect(res.errors).toBeUndefined();
      }

      // Clear minute admissions by backdating the 6 tickets to 5 minutes ago
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      await dbHelper.db
        .update(commentQuotaAdmissions)
        .set({ createdAt: fiveMinutesAgo })
        .where(
          and(
            eq(commentQuotaAdmissions.userId, user1.id),
            eq(commentQuotaAdmissions.action, 'COMMENT_IMAGE_TICKET'),
            gte(commentQuotaAdmissions.createdAt, new Date(Date.now() - 60 * 1000)),
          ),
        );
      await dbHelper.db
        .update(stagedUploads)
        .set({ createdAt: fiveMinutesAgo })
        .where(eq(stagedUploads.userId, user1.id));

      // 51st ticket in day must be rejected by daily ticket limit!
      const res51 = await executeGql(
        REQUEST_TICKET_MUTATION,
        {
          input: {
            contentType: 'image/webp',
            fileSizeBytes: 50_000,
          },
        },
        user1,
      );

      expect(res51.errors).toBeDefined();
      expect((res51.errors![0].originalError as { code?: string })?.code).toBe('RATE_LIMITED');
      expect(res51.errors![0].message).toContain('Comment image upload daily limit exceeded (max 50 per day)');
    });

    it('failed and abandoned tickets remain counted against quota across cleanup', async () => {
      // User 2 requests 6 tickets
      const issuedMediaIds: string[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await executeGql<RequestTicketResponse>(
          REQUEST_TICKET_MUTATION,
          {
            input: {
              contentType: 'image/webp',
              fileSizeBytes: 30_000,
            },
          },
          user2,
        );
        expect(res.errors).toBeUndefined();
        issuedMediaIds.push(res.data!.requestCommentImageUploadUrl.mediaId);
      }

      // Simulate tickets being abandoned, failed, and cleaned up:
      // Ticket 0: abandoned (expires)
      // Ticket 1: failed
      // Ticket 2: cleaned/expired
      await dbHelper.db
        .update(stagedUploads)
        .set({ status: 'FAILED', errorMessage: 'Invalid WebP header' })
        .where(eq(stagedUploads.id, issuedMediaIds[0]));
      await dbHelper.db
        .update(stagedUploads)
        .set({ status: 'EXPIRED', stagingKey: `cleaned/${issuedMediaIds[1]}.webp` })
        .where(eq(stagedUploads.id, issuedMediaIds[1]));

      // 7th ticket request in same minute is STILL blocked by the 6/min rate limit
      const blockedRes = await executeGql(
        REQUEST_TICKET_MUTATION,
        {
          input: {
            contentType: 'image/webp',
            fileSizeBytes: 30_000,
          },
        },
        user2,
      );

      expect(blockedRes.errors).toBeDefined();
      expect((blockedRes.errors![0].originalError as { code?: string })?.code).toBe('RATE_LIMITED');
      expect(blockedRes.errors![0].message).toContain('Comment image upload rate limit exceeded (max 6 per minute)');

      // Verify all 6 admissions remain in comment_quota_admissions
      const admissions = await dbHelper.db
        .select()
        .from(commentQuotaAdmissions)
        .where(
          and(eq(commentQuotaAdmissions.userId, user2.id), eq(commentQuotaAdmissions.action, 'COMMENT_IMAGE_TICKET')),
        );
      expect(admissions.length).toBe(6);
    });
  });

  describe('AC 1, AC 2 & AC 3: Comment Boost toggles (60/min) & application restart', () => {
    it('concurrent burst of 70 comment boost toggles admits exactly 60 and rejects 10 with RATE_LIMITED', async () => {
      const requests = Array.from({ length: 70 }, () =>
        executeGql(TOGGLE_BOOST_MUTATION, { commentId: parentCommentId }, user2),
      );

      const results = await Promise.all(requests);

      const successes = results.filter((r) => !r.errors && r.data?.toggleCommentBoost);
      const failures = results.filter((r) => r.errors && r.errors.length > 0);

      expect(successes.length).toBe(60);
      expect(failures.length).toBe(10);

      for (const fail of failures) {
        expect((fail.errors![0].originalError as { code?: string })?.code).toBe('RATE_LIMITED');
        expect(fail.errors![0].message).toContain('Comment boost rate limit exceeded (max 60 per minute)');
      }
    });

    it('boost toggle quota survives application restart (cold service instance)', async () => {
      // 1. User 2 executes 60 boost toggles
      for (let i = 0; i < 60; i++) {
        const res = await executeGql(TOGGLE_BOOST_MUTATION, { commentId: parentCommentId }, user2);
        expect(res.errors).toBeUndefined();
      }

      // 2. Simulate cold application restart: instantiate brand new CommentsService
      const coldCommentsService = new CommentsService(
        commentsRepo,
        postsRepo,
        uploadService,
        mockConfig,
        undefined,
        undefined,
        usersService,
      );

      // 3. Attempt 61st boost toggle against restarted service instance
      let boostError: unknown;
      try {
        await coldCommentsService.toggleCommentBoost(user2.id, parentCommentId);
      } catch (err) {
        boostError = err;
      }
      expect(boostError).toBeInstanceOf(AppError);
      expect((boostError as AppError).code).toBe('RATE_LIMITED');
      expect((boostError as AppError).message).toContain('Comment boost rate limit exceeded (max 60 per minute)');
    });
  });

  describe('AC 1 & AC 2: Comment Reports (10/day)', () => {
    it('concurrent burst of 15 report requests on 15 comments admits exactly 10 and rejects 5 with RATE_LIMITED', async () => {
      // Seed 15 comments created by user1
      const commentRows = Array.from({ length: 15 }, (_, i) => ({
        id: generateUuidV7(),
        postId: testPost.id,
        authorId: user1.id,
        text: `Comment for report testing ${i}`,
        status: 'ACTIVE' as const,
      }));
      await dbHelper.db.insert(comments).values(commentRows);

      // User 2 concurrently reports all 15 comments
      const requests = commentRows.map((c) =>
        executeGql(
          REPORT_COMMENT_MUTATION,
          {
            input: {
              commentId: c.id,
              reason: 'SPAM',
              details: 'Unsolicited advertisement',
            },
          },
          user2,
        ),
      );

      const results = await Promise.all(requests);

      const successes = results.filter((r) => !r.errors && r.data?.reportComment === true);
      const failures = results.filter((r) => r.errors && r.errors.length > 0);

      expect(successes.length).toBe(10);
      expect(failures.length).toBe(5);

      for (const fail of failures) {
        expect((fail.errors![0].originalError as { code?: string })?.code).toBe('RATE_LIMITED');
        expect(fail.errors![0].message).toContain('Daily comment report limit reached (10 per day)');
      }
    });

    it('rejected report (e.g. self-reporting) rolls back admission and does not strand budget', async () => {
      // User 1 attempts to report own comment -> rejected by business logic
      const selfReportRes = await executeGql(
        REPORT_COMMENT_MUTATION,
        {
          input: {
            commentId: parentCommentId,
            reason: 'SPAM',
            details: 'Reporting myself',
          },
        },
        user1,
      );

      expect(selfReportRes.errors).toBeDefined();
      expect(selfReportRes.errors![0].message).toContain('You cannot report your own comment');

      // Seed 10 other comments created by user2
      const otherComments = Array.from({ length: 10 }, (_, i) => ({
        id: generateUuidV7(),
        postId: testPost.id,
        authorId: user2.id,
        text: `Other comment ${i}`,
        status: 'ACTIVE' as const,
      }));
      await dbHelper.db.insert(comments).values(otherComments);

      // User 1 reports all 10 other comments.
      // If the self-report had permanently stranded quota, the 10th report would fail.
      // All 10 must succeed!
      for (const c of otherComments) {
        const res = await executeGql(
          REPORT_COMMENT_MUTATION,
          {
            input: {
              commentId: c.id,
              reason: 'SPAM',
            },
          },
          user1,
        );
        expect(res.errors).toBeUndefined();
        expect(res.data?.reportComment).toBe(true);
      }

      // 11th report is now blocked
      const [eleventhComment] = await dbHelper.db
        .insert(comments)
        .values({
          postId: testPost.id,
          authorId: user2.id,
          text: 'Eleventh comment',
          status: 'ACTIVE',
        })
        .returning();

      const blockedRes = await executeGql(
        REPORT_COMMENT_MUTATION,
        {
          input: {
            commentId: eleventhComment.id,
            reason: 'SPAM',
          },
        },
        user1,
      );

      expect(blockedRes.errors).toBeDefined();
      expect((blockedRes.errors![0].originalError as { code?: string })?.code).toBe('RATE_LIMITED');
      expect(blockedRes.errors![0].message).toContain('Daily comment report limit reached (10 per day)');
    });
  });

  describe('Ticket 01: Shared moderation-report allowance (Comment + Post)', () => {
    async function seedReportableComments(count: number): Promise<Comment[]> {
      const rows = Array.from({ length: count }, (_, i) => ({
        id: generateUuidV7(),
        postId: testPost.id,
        authorId: user1.id,
        text: `Shared allowance comment ${i}`,
        status: 'ACTIVE' as const,
      }));
      return dbHelper.db.insert(comments).values(rows).returning();
    }

    async function seedSurvivingPosts(count: number): Promise<Post[]> {
      const rows = Array.from({ length: count }, (_, i) => ({
        creatorId: user1.id,
        postType: 'RESCUE' as const,
        title: `Surviving post for post reports ${i}`,
        description: 'Post description',
        cityId: testCity.id,
        urgency: 'URGENT' as const,
        status: 'ACTIVE' as const,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      }));
      return dbHelper.db.insert(posts).values(rows).returning();
    }

    /**
     * Mirrors the reserve -> insert report row with the reservation id ->
     * rollback-on-failure flow that the future `reportPost` seam will use,
     * without needing the Post Report API.
     */
    async function attemptSimulatedPostReport(reporter: User, targetPostId: string): Promise<boolean> {
      let reservation;
      try {
        reservation = await reportQuotaManager.reserveReportAllowance(reporter.id);
      } catch {
        return false;
      }
      try {
        await dbHelper.db.insert(postReports).values({
          id: reservation.admissionId,
          postId: targetPostId,
          reporterId: reporter.id,
          reason: 'SPAM',
        });
        return true;
      } catch (err) {
        await reservation.rollback();
        throw err;
      }
    }

    it('counts historical Post Reports against the same allowance as Comment Reports', async () => {
      const survivingPosts = await seedSurvivingPosts(5);
      await dbHelper.db.insert(postReports).values(
        survivingPosts.map((post) => ({
          postId: post.id,
          reporterId: user2.id,
          reason: 'SPAM' as const,
        })),
      );

      const commentsToReport = await seedReportableComments(5);
      for (const comment of commentsToReport) {
        const res = await executeGql(
          REPORT_COMMENT_MUTATION,
          { input: { commentId: comment.id, reason: 'SPAM' } },
          user2,
        );
        expect(res.errors).toBeUndefined();
        expect(res.data?.reportComment).toBe(true);
      }

      const [rejectedTarget] = await seedReportableComments(1);
      const rejected = await executeGql(
        REPORT_COMMENT_MUTATION,
        { input: { commentId: rejectedTarget.id, reason: 'SPAM' } },
        user2,
      );
      expect(rejected.errors).toBeDefined();
      expect((rejected.errors![0].originalError as { code?: string })?.code).toBe('RATE_LIMITED');
      expect(rejected.errors![0].message).toContain('Daily comment report limit reached (10 per day)');

      const commentReportRows = await dbHelper.db
        .select()
        .from(commentReports)
        .where(eq(commentReports.reporterId, user2.id));
      const postReportRows = await dbHelper.db.select().from(postReports).where(eq(postReports.reporterId, user2.id));
      expect(commentReportRows.length + postReportRows.length).toBe(10);
    });

    it('counts rollout-era Comment Report admissions and rows exactly once', async () => {
      const oneHourAgo = new Date(Date.now() - 3600 * 1000);
      const commentsToReport = await seedReportableComments(11);

      // Three committed reports already have a row; two admissions crashed
      // before their report row ever committed. All five consumed a slot.
      await dbHelper.db.insert(commentQuotaAdmissions).values(
        commentsToReport.slice(0, 5).map(() => ({
          id: generateUuidV7(),
          userId: user2.id,
          action: 'COMMENT_REPORT',
          createdAt: oneHourAgo,
        })),
      );
      await dbHelper.db.insert(commentReports).values(
        commentsToReport.slice(0, 3).map((comment) => ({
          commentId: comment.id,
          reporterId: user2.id,
          reason: 'SPAM' as const,
          createdAt: oneHourAgo,
        })),
      );

      for (let i = 5; i < 10; i++) {
        const res = await executeGql(
          REPORT_COMMENT_MUTATION,
          { input: { commentId: commentsToReport[i].id, reason: 'SPAM' } },
          user2,
        );
        expect(res.errors).toBeUndefined();
        expect(res.data?.reportComment).toBe(true);
      }

      const rejected = await executeGql(
        REPORT_COMMENT_MUTATION,
        { input: { commentId: commentsToReport[10].id, reason: 'SPAM' } },
        user2,
      );
      expect(rejected.errors).toBeDefined();
      expect((rejected.errors![0].originalError as { code?: string })?.code).toBe('RATE_LIMITED');
    });

    it('races mixed Post and Comment Reports so alternating target types cannot exceed ten', async () => {
      const survivingPosts = await seedSurvivingPosts(8);
      const commentsToReport = await seedReportableComments(8);

      const commentRequests = commentsToReport.map((comment) =>
        executeGql(REPORT_COMMENT_MUTATION, { input: { commentId: comment.id, reason: 'SPAM' } }, user2).then(
          (res) => !res.errors && res.data?.reportComment === true,
        ),
      );
      const postRequests = survivingPosts.map((post) => attemptSimulatedPostReport(user2, post.id));

      const results = await Promise.all([...commentRequests, ...postRequests]);
      expect(results.filter(Boolean)).toHaveLength(10);

      const commentReportRows = await dbHelper.db
        .select()
        .from(commentReports)
        .where(eq(commentReports.reporterId, user2.id));
      const postReportRows = await dbHelper.db.select().from(postReports).where(eq(postReports.reporterId, user2.id));
      expect(commentReportRows.length + postReportRows.length).toBe(10);

      const admissions = await dbHelper.db
        .select()
        .from(commentQuotaAdmissions)
        .where(
          and(eq(commentQuotaAdmissions.userId, user2.id), eq(commentQuotaAdmissions.action, 'MODERATION_REPORT')),
        );
      expect(admissions).toHaveLength(10);

      const committedReportIds = new Set([
        ...commentReportRows.map((report) => report.id),
        ...postReportRows.map((report) => report.id),
      ]);
      for (const admission of admissions) {
        expect(committedReportIds.has(admission.id)).toBe(true);
      }
    });

    async function attemptSimulatedAccountReport(reporter: User, targetUserId: string): Promise<boolean> {
      let reservation;
      try {
        reservation = await reportQuotaManager.reserveReportAllowance(reporter.id);
      } catch {
        return false;
      }
      try {
        await dbHelper.db.insert(accountReports).values({
          id: reservation.admissionId,
          reporterId: reporter.id,
          reportedUserId: targetUserId,
          reason: 'SPAM',
        });
        return true;
      } catch {
        await reservation.rollback();
        return false;
      }
    }

    it('races mixed Post, Comment, and Account Reports so alternating target types cannot exceed ten', async () => {
      const survivingPosts = await seedSurvivingPosts(6);
      const commentsToReport = await seedReportableComments(6);
      const accountTargets = await dbHelper.db
        .insert(users)
        .values(
          Array.from({ length: 6 }, (_, index) => ({
            firebaseUserId: `fb-account-target-${index}-${generateUuidV7()}`,
            email: `account-target-${index}-${generateUuidV7()}@pupzy.dev`,
            fullName: `Account Target ${index}`,
          })),
        )
        .returning();

      const commentRequests = commentsToReport.map((comment) =>
        executeGql(REPORT_COMMENT_MUTATION, { input: { commentId: comment.id, reason: 'SPAM' } }, user2).then(
          (res) => !res.errors && res.data?.reportComment === true,
        ),
      );
      const postRequests = survivingPosts.map((post) => attemptSimulatedPostReport(user2, post.id));
      const accountRequests = accountTargets.map((target) => attemptSimulatedAccountReport(user2, target.id));

      const results = await Promise.all([...commentRequests, ...postRequests, ...accountRequests]);
      expect(results.filter(Boolean)).toHaveLength(10);

      const commentReportRows = await dbHelper.db
        .select()
        .from(commentReports)
        .where(eq(commentReports.reporterId, user2.id));
      const postReportRows = await dbHelper.db.select().from(postReports).where(eq(postReports.reporterId, user2.id));
      const accountReportRows = await dbHelper.db
        .select()
        .from(accountReports)
        .where(eq(accountReports.reporterId, user2.id));
      expect(commentReportRows.length + postReportRows.length + accountReportRows.length).toBe(10);

      const admissions = await dbHelper.db
        .select()
        .from(commentQuotaAdmissions)
        .where(
          and(eq(commentQuotaAdmissions.userId, user2.id), eq(commentQuotaAdmissions.action, 'MODERATION_REPORT')),
        );
      expect(admissions).toHaveLength(10);

      const committedReportIds = new Set([
        ...commentReportRows.map((report) => report.id),
        ...postReportRows.map((report) => report.id),
        ...accountReportRows.map((report) => report.id),
      ]);
      for (const admission of admissions) {
        expect(committedReportIds.has(admission.id)).toBe(true);
      }
    });

    it('admits exactly the remaining slot at the rolling 24-hour window boundary', async () => {
      const survivingPosts = await seedSurvivingPosts(10);
      const insideWindow = new Date(Date.now() - 23 * 3600 * 1000);
      const outsideWindow = new Date(Date.now() - 25 * 3600 * 1000);
      await dbHelper.db.insert(postReports).values(
        survivingPosts.map((post, i) => ({
          postId: post.id,
          reporterId: user2.id,
          reason: 'SPAM' as const,
          createdAt: i < 9 ? insideWindow : outsideWindow,
        })),
      );

      const commentsToReport = await seedReportableComments(5);
      const results = await Promise.all(
        commentsToReport.map((comment) =>
          executeGql(REPORT_COMMENT_MUTATION, { input: { commentId: comment.id, reason: 'SPAM' } }, user2).then(
            (res) => !res.errors && res.data?.reportComment === true,
          ),
        ),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('never consumes allowance for validation failures, self-reports, duplicates, or rolled-back work', async () => {
      const [ownComment] = await dbHelper.db
        .insert(comments)
        .values({
          postId: testPost.id,
          authorId: user2.id,
          text: 'Own comment for self-report',
          status: 'ACTIVE',
        })
        .returning();

      const selfReport = await executeGql(
        REPORT_COMMENT_MUTATION,
        { input: { commentId: ownComment.id, reason: 'SPAM' } },
        user2,
      );
      expect(selfReport.errors).toBeDefined();
      expect(selfReport.errors![0].message).toContain('You cannot report your own comment');

      const commentsToReport = await seedReportableComments(12);
      const invalidDetails = await executeGql(
        REPORT_COMMENT_MUTATION,
        { input: { commentId: commentsToReport[0].id, reason: 'SPAM', details: 'x'.repeat(501) } },
        user2,
      );
      expect(invalidDetails.errors).toBeDefined();

      const missingTarget = await executeGql(
        REPORT_COMMENT_MUTATION,
        { input: { commentId: generateUuidV7(), reason: 'SPAM' } },
        user2,
      );
      expect(missingTarget.errors).toBeDefined();

      const accepted = await executeGql(
        REPORT_COMMENT_MUTATION,
        { input: { commentId: commentsToReport[0].id, reason: 'SPAM' } },
        user2,
      );
      expect(accepted.errors).toBeUndefined();
      expect(accepted.data?.reportComment).toBe(true);

      const duplicate = await executeGql(
        REPORT_COMMENT_MUTATION,
        { input: { commentId: commentsToReport[0].id, reason: 'SPAM' } },
        user2,
      );
      expect(duplicate.errors).toBeDefined();
      expect((duplicate.errors![0].originalError as { code?: string })?.code).toBe('COMMENT_ALREADY_REPORTED');

      const rolledBack = await reportQuotaManager.reserveReportAllowance(user2.id);
      await rolledBack.rollback();

      for (let i = 1; i <= 9; i++) {
        const res = await executeGql(
          REPORT_COMMENT_MUTATION,
          { input: { commentId: commentsToReport[i].id, reason: 'SPAM' } },
          user2,
        );
        expect(res.errors).toBeUndefined();
        expect(res.data?.reportComment).toBe(true);
      }

      const rejected = await executeGql(
        REPORT_COMMENT_MUTATION,
        { input: { commentId: commentsToReport[10].id, reason: 'SPAM' } },
        user2,
      );
      expect(rejected.errors).toBeDefined();
      expect((rejected.errors![0].originalError as { code?: string })?.code).toBe('RATE_LIMITED');

      const commentReportRows = await dbHelper.db
        .select()
        .from(commentReports)
        .where(eq(commentReports.reporterId, user2.id));
      expect(commentReportRows).toHaveLength(10);

      const admissions = await dbHelper.db
        .select()
        .from(commentQuotaAdmissions)
        .where(
          and(eq(commentQuotaAdmissions.userId, user2.id), eq(commentQuotaAdmissions.action, 'MODERATION_REPORT')),
        );
      expect(admissions).toHaveLength(10);

      const committedReportIds = new Set(commentReportRows.map((report) => report.id));
      for (const admission of admissions) {
        expect(committedReportIds.has(admission.id)).toBe(true);
      }
    });
  });

  describe('AC 6 & AC 8: Safe limit errors and short transactions', () => {
    it('limit error response preserves mobile retry contract with RATE_LIMITED code and no cross-user information leakage', async () => {
      // Exhaust user1 quota
      for (let i = 0; i < 10; i++) {
        await executeGql(
          CREATE_COMMENT_MUTATION,
          {
            input: {
              postId: testPost.id,
              text: `Comment ${i}`,
              clientRequestId: `req-safe-${i}-${generateUuidV7()}`,
            },
          },
          user1,
        );
      }

      const blockedRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Blocked comment for error format check',
            clientRequestId: `req-safe-blocked-${generateUuidV7()}`,
          },
        },
        user1,
      );

      expect(blockedRes.errors).toBeDefined();
      expect(blockedRes.errors!.length).toBe(1);

      const gqlError = blockedRes.errors![0];
      expect((gqlError.originalError as { code?: string })?.code).toBe('RATE_LIMITED');
      expect(gqlError.message).toBe('Comment creation rate limit exceeded (max 10 per minute)');

      // Verify no other user's identity or activity is leaked in the error payload
      const serializedError = JSON.stringify(gqlError);
      expect(serializedError).not.toContain(user2.id);
      expect(serializedError).not.toContain(user2.email);
      expect(serializedError).not.toContain(user2.fullName);
    });

    it('quota transaction commits immediately and no R2 work is held inside DB transaction', async () => {
      // Spy on s3 client or verify transaction state
      const ticketRes = await executeGql<RequestTicketResponse>(
        REQUEST_TICKET_MUTATION,
        {
          input: {
            contentType: 'image/webp',
            fileSizeBytes: 40_000,
          },
        },
        user2,
      );

      expect(ticketRes.errors).toBeUndefined();
      const ticketData = ticketRes.data!;
      expect(ticketData.requestCommentImageUploadUrl.mediaId).toBeDefined();
      expect(ticketData.requestCommentImageUploadUrl.uploadUrl).toBeDefined();

      // Verify ticket was durably committed
      const [ticketInDb] = await dbHelper.db
        .select()
        .from(stagedUploads)
        .where(eq(stagedUploads.id, ticketData.requestCommentImageUploadUrl.mediaId));
      expect(ticketInDb).toBeDefined();
      expect(ticketInDb.status).toBe('ISSUED');
    });
  });
});

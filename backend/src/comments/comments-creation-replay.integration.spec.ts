import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { graphql, GraphQLSchema } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { eq, sql, inArray } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import DataLoader from 'dataloader';
import { HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  users,
  cities,
  posts,
  comments,
  commentMedia,
  stagedUploads,
  commentIdempotency,
  type User,
  type City,
  type Post,
} from '../database/schema';
import { CommentsRepository, isUniqueViolation } from './comments.repository';
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
import { ConflictError, NotFoundError } from '../common/errors/app.errors';

interface R2Object {
  bytes: Buffer;
  etag: string;
}

class ControllableR2Adapter {
  public objects = new Map<string, R2Object>();

  putObject(key: string, bytes: Buffer, etag?: string): void {
    const computedEtag = etag ?? `"${crypto.createHash('md5').update(bytes).digest('hex')}"`;
    this.objects.set(key, { bytes, etag: computedEtag });
  }

  hasObject(key: string): boolean {
    return this.objects.has(key);
  }

  reset(): void {
    this.objects.clear();
  }

  async send(command: any): Promise<any> {
    const cmdName = command.constructor?.name ?? command.name;
    const key = command.input?.Key;

    if (cmdName === 'HeadObjectCommand' || command instanceof HeadObjectCommand) {
      if (!this.objects.has(key)) {
        const err: any = new Error(`NotFound: ${key}`);
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
        const err: any = new Error(`NoSuchKey: ${key}`);
        err.name = 'NoSuchKey';
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      return {
        ContentLength: item.bytes.length,
        ETag: item.etag,
        Body: {
          transformToByteArray: async () => new Uint8Array(item.bytes),
        },
      };
    }

    if (cmdName === 'PutObjectCommand' || command instanceof PutObjectCommand) {
      const bytes = Buffer.isBuffer(command.input?.Body) ? command.input.Body : Buffer.from(command.input?.Body ?? '');
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

describe('Comment Creation Replays Integration (Ticket 06)', () => {
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

  let testCity: City;
  let authorUser: User;
  let replyUser: User;
  let testPost: Post;

  let validWebp: Buffer;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    validWebp = await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 100, g: 150, b: 200 } },
    })
      .webp()
      .toBuffer();

    r2Adapter = new ControllableR2Adapter();

    const cacheStore = new Map<string, any>();
    mockCache = {
      get: jest.fn((key: string) => Promise.resolve(cacheStore.get(key))),
      set: jest.fn((key: string, val: any) => {
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
    (uploadService as any).s3Client.send = jest.fn((cmd) => r2Adapter.send(cmd));

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
          __parseValue(v: any) {
            return v;
          },
          __serialize(v: any) {
            return v instanceof Date ? v.toISOString() : v;
          },
        },
        Query: {
          post: (_root, args) => postsRepo.findById(args.id),
          comments: (_root, args) => commentsResolver.comments(args.postId, args.sort, args.first, args.after),
          replies: (_root, args) => commentsResolver.replies(args.commentId, args.first, args.after),
        },
        Mutation: {
          createComment: (_root, args, ctx) => commentsResolver.createComment(args.input, ctx),
          createReply: (_root, args, ctx) => commentsResolver.createReply(args.input, ctx),
          deleteComment: (_root, args, ctx) => commentsResolver.deleteComment(args.id, ctx),
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
    r2Adapter.reset();

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
          firebaseUserId: `fb-${generateUuidV7()}`,
          email: `author-${generateUuidV7()}@example.com`,
          fullName: 'Comment Author',
          username: 'author_user',
        },
        {
          firebaseUserId: `fb-${generateUuidV7()}`,
          email: `reply-${generateUuidV7()}@example.com`,
          fullName: 'Reply User',
          username: 'reply_user',
        },
      ])
      .returning();
    authorUser = u1;
    replyUser = u2;

    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId: authorUser.id,
        postType: 'RESCUE',
        title: 'Rescue post for test',
        description: 'Testing comment visibility replays',
        cityId: testCity.id,
        urgency: 'URGENT',
        status: 'ACTIVE',
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    testPost = post;
  });

  async function executeGql(source: string, variables: Record<string, any> = {}, user: User = authorUser) {
    const userByIdLoader = new DataLoader(async (ids: readonly string[]) => {
      const rows = await dbHelper.db
        .select()
        .from(users)
        .where(inArray(users.id, ids as string[]));
      const map = new Map(rows.map((u) => [u.id, u]));
      return ids.map((id) => map.get(id) ?? null);
    });

    const ctx: GqlContext = {
      req: {} as any,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      } as any,
      loaders: {
        cityById: citiesService.createCityByIdLoader(),
        userById: userByIdLoader,
        mediaByPostId: postsRepo.createMediaByPostIdLoader(),
        upvotedByMe: postsRepo.createUpvotedByMeLoader(),
        savedByMe: postsRepo.createSavedByMeLoader(),
        commentBoostedByMe: { load: jest.fn().mockResolvedValue(false) } as any,
        pinnedCommentIdByPostId: { load: jest.fn().mockResolvedValue(null) } as any,
        commentMediaByCommentId: commentsRepo.createCommentMediaByCommentIdLoader(),
      },
    };

    return graphql({
      schema: executableSchema,
      source,
      variableValues: variables,
      contextValue: ctx,
    });
  }

  async function stageCommentImage(user: User, imageBytes: Buffer): Promise<{ mediaId: string; stagingKey: string }> {
    const mediaId = generateUuidV7();
    const stagingKey = `staging/${user.id}/${mediaId}.webp`;

    await dbHelper.db.insert(stagedUploads).values({
      id: mediaId,
      userId: user.id,
      purpose: 'COMMENT_IMAGE',
      stagingKey,
      declaredContentType: 'image/webp',
      declaredFileSizeBytes: imageBytes.length,
      status: 'ISSUED',
      expiresAt: new Date(Date.now() + 900_000),
    });

    r2Adapter.putObject(stagingKey, imageBytes);

    return { mediaId, stagingKey };
  }

  const CREATE_COMMENT_MUTATION = `
    mutation CreateComment($input: CreateCommentInput!) {
      createComment(input: $input) {
        id
        postId
        parentId
        text
        status
        replyCount
        boostCount
        author {
          id
          fullName
        }
        media {
          id
          publicUrl
          width
          height
          displayOrder
        }
      }
    }
  `;

  const CREATE_REPLY_MUTATION = `
    mutation CreateReply($input: CreateReplyInput!) {
      createReply(input: $input) {
        id
        postId
        parentId
        text
        status
        replyCount
        boostCount
        author {
          id
          fullName
        }
      }
    }
  `;

  const DELETE_COMMENT_MUTATION = `
    mutation DeleteComment($id: ID!) {
      deleteComment(id: $id)
    }
  `;

  // --- AC 1: Identical concurrent creates & conflicting payloads ---
  describe('AC 1: Concurrent identical creates & conflicting payload detection', () => {
    it('concurrent identical createComment requests return one canonical entity and single DB row', async () => {
      const clientRequestId = `req-concurrent-${generateUuidV7()}`;
      const input = {
        postId: testPost.id,
        text: 'Concurrent comment submission',
        clientRequestId,
      };

      // Run 5 identical requests concurrently against PostgreSQL
      const results = await Promise.all([
        executeGql(CREATE_COMMENT_MUTATION, { input }, authorUser),
        executeGql(CREATE_COMMENT_MUTATION, { input }, authorUser),
        executeGql(CREATE_COMMENT_MUTATION, { input }, authorUser),
        executeGql(CREATE_COMMENT_MUTATION, { input }, authorUser),
        executeGql(CREATE_COMMENT_MUTATION, { input }, authorUser),
      ]);

      // All 5 must succeed without error
      for (const res of results) {
        expect(res.errors).toBeUndefined();
        expect(res.data?.createComment).toBeDefined();
      }

      // All 5 must resolve to the EXACT same canonical comment ID
      const canonicalId = (results[0].data as any).createComment.id;
      for (const res of results) {
        expect((res.data as any).createComment.id).toBe(canonicalId);
        expect((res.data as any).createComment.text).toBe('Concurrent comment submission');
        expect((res.data as any).createComment.status).toBe('ACTIVE');
      }

      // Exactly 1 comment row and 1 idempotency record in PostgreSQL
      const dbComments = await dbHelper.db.select().from(comments).where(eq(comments.id, canonicalId));
      expect(dbComments).toHaveLength(1);

      const dbIdempotency = await dbHelper.db
        .select()
        .from(commentIdempotency)
        .where(eq(commentIdempotency.clientRequestId, clientRequestId));
      expect(dbIdempotency).toHaveLength(1);
    });

    it('concurrent identical createReply requests return one canonical entity and increment replyCount once', async () => {
      // Create top-level parent first
      const parentRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Parent comment',
            clientRequestId: generateUuidV7(),
          },
        },
        authorUser,
      );
      const parentId = (parentRes.data as any).createComment.id;

      const clientRequestId = `reply-concurrent-${generateUuidV7()}`;
      const input = {
        commentId: parentId,
        text: 'Concurrent reply submission',
        clientRequestId,
      };

      // Run 5 identical reply requests concurrently
      const results = await Promise.all([
        executeGql(CREATE_REPLY_MUTATION, { input }, replyUser),
        executeGql(CREATE_REPLY_MUTATION, { input }, replyUser),
        executeGql(CREATE_REPLY_MUTATION, { input }, replyUser),
        executeGql(CREATE_REPLY_MUTATION, { input }, replyUser),
        executeGql(CREATE_REPLY_MUTATION, { input }, replyUser),
      ]);

      for (const res of results) {
        expect(res.errors).toBeUndefined();
      }

      const canonicalReplyId = (results[0].data as any).createReply.id;
      for (const res of results) {
        expect((res.data as any).createReply.id).toBe(canonicalReplyId);
        expect((res.data as any).createReply.text).toBe('Concurrent reply submission');
      }

      // Exactly 1 reply row in DB
      const dbReplies = await dbHelper.db.select().from(comments).where(eq(comments.id, canonicalReplyId));
      expect(dbReplies).toHaveLength(1);

      // Parent replyCount must be exactly 1, not 5
      const [parentDb] = await dbHelper.db.select().from(comments).where(eq(comments.id, parentId));
      expect(parentDb.replyCount).toBe(1);
    });

    it('differing canonical payload with same clientRequestId throws ConflictError without creating duplicate rows', async () => {
      const clientRequestId = `conf-req-${generateUuidV7()}`;

      // First create
      const firstRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Original message',
            clientRequestId,
          },
        },
        authorUser,
      );
      expect(firstRes.errors).toBeUndefined();

      // Second create with DIFFERENT payload but SAME clientRequestId
      const secondRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Tampered different message',
            clientRequestId,
          },
        },
        authorUser,
      );

      expect(secondRes.errors).toBeDefined();
      expect(secondRes.errors![0].message).toContain('Client request ID was previously used with different parameters');
      expect((secondRes.errors![0].originalError as any)?.code).toBe('CONFLICT');

      // Ensure no second row was inserted
      const allComments = await dbHelper.db.select().from(comments);
      expect(allComments).toHaveLength(1);
      expect(allComments[0].text).toBe('Original message');
    });
  });

  // --- AC 2, 3, 4, 5: Replays respect current visibility and tombstones ---
  describe('AC 2, 3, 4, 5: Replay visibility, tombstones, and reachability', () => {
    it('replay after author deletion with surviving replies renders as structural tombstone (text masked, author null, media empty)', async () => {
      const { mediaId } = await stageCommentImage(authorUser, validWebp);
      const clientRequestId = `del-tomb-${generateUuidV7()}`;

      // 1. Create parent comment with image
      const createRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Secret parent text before deletion',
            mediaIds: [mediaId],
            clientRequestId,
          },
        },
        authorUser,
      );
      expect(createRes.errors).toBeUndefined();
      const commentId = (createRes.data as any).createComment.id;

      // 2. Add reply so parent has surviving reply
      const replyRes = await executeGql(
        CREATE_REPLY_MUTATION,
        {
          input: {
            commentId,
            text: 'Surviving reply beneath parent',
            clientRequestId: generateUuidV7(),
          },
        },
        replyUser,
      );
      expect(replyRes.errors).toBeUndefined();

      // 3. Author deletes the parent comment
      const delRes = await executeGql(DELETE_COMMENT_MUTATION, { id: commentId }, authorUser);
      expect(delRes.errors).toBeUndefined();
      expect((delRes.data as any).deleteComment).toBe(true);

      // Verify DB status is DELETED and replyCount is 1
      const [dbParent] = await dbHelper.db.select().from(comments).where(eq(comments.id, commentId));
      expect(dbParent.status).toBe('DELETED');
      expect(dbParent.replyCount).toBe(1);

      // 4. Replay creation with original clientRequestId
      const replayRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Secret parent text before deletion',
            mediaIds: [mediaId],
            clientRequestId,
          },
        },
        authorUser,
      );

      expect(replayRes.errors).toBeUndefined();
      const replayData = (replayRes.data as any).createComment;
      expect(replayData.id).toBe(commentId);
      expect(replayData.status).toBe('DELETED');
      // Privacy invariant: text masked to [Deleted]
      expect(replayData.text).toBe('[Deleted]');
      // Privacy invariant: author identity stripped to null
      expect(replayData.author).toBeNull();
      // Privacy invariant: media stripped to empty array
      expect(replayData.media).toEqual([]);
      expect(replayData.replyCount).toBe(1);
    });

    it('replay after author deletion with 0 replies throws NotFoundError and leaks nothing', async () => {
      const clientRequestId = `del-zero-${generateUuidV7()}`;

      // 1. Create comment with 0 replies
      const createRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Will be deleted with no replies',
            clientRequestId,
          },
        },
        authorUser,
      );
      const commentId = (createRes.data as any).createComment.id;

      // 2. Delete comment
      await executeGql(DELETE_COMMENT_MUTATION, { id: commentId }, authorUser);

      // 3. Replay creation with original clientRequestId
      const replayRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Will be deleted with no replies',
            clientRequestId,
          },
        },
        authorUser,
      );

      expect(replayRes.errors).toBeDefined();
      expect(replayRes.errors![0].message).toContain(`Comment with id "${commentId}" was not found`);
      expect((replayRes.errors![0].originalError as any)?.code).toBe('NOT_FOUND');
      expect(replayRes.data?.createComment).toBeFalsy();
    });

    it('replay after moderator whole hiding (HIDDEN) with surviving replies returns structural tombstone ([Hidden])', async () => {
      const clientRequestId = `hide-tomb-${generateUuidV7()}`;

      // 1. Create comment
      const createRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Abusive parent text',
            clientRequestId,
          },
        },
        authorUser,
      );
      const commentId = (createRes.data as any).createComment.id;

      // 2. Add reply
      await executeGql(
        CREATE_REPLY_MUTATION,
        {
          input: {
            commentId,
            text: 'Reply to reported comment',
            clientRequestId: generateUuidV7(),
          },
        },
        replyUser,
      );

      // 3. Simulate moderator hiding the comment
      await dbHelper.db
        .update(comments)
        .set({ status: 'HIDDEN', updatedAt: new Date() })
        .where(eq(comments.id, commentId));

      // 4. Replay creation
      const replayRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Abusive parent text',
            clientRequestId,
          },
        },
        authorUser,
      );

      expect(replayRes.errors).toBeUndefined();
      const replayData = (replayRes.data as any).createComment;
      expect(replayData.id).toBe(commentId);
      expect(replayData.status).toBe('HIDDEN');
      expect(replayData.text).toBe('[Hidden]');
      expect(replayData.author).toBeNull();
      expect(replayData.media).toEqual([]);
      expect(replayData.replyCount).toBe(1);
    });

    it('replay after moderator whole hiding (HIDDEN) with 0 replies throws NotFoundError', async () => {
      const clientRequestId = `hide-zero-${generateUuidV7()}`;

      const createRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Hidden comment with no replies',
            clientRequestId,
          },
        },
        authorUser,
      );
      const commentId = (createRes.data as any).createComment.id;

      await dbHelper.db
        .update(comments)
        .set({ status: 'HIDDEN', updatedAt: new Date() })
        .where(eq(comments.id, commentId));

      const replayRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Hidden comment with no replies',
            clientRequestId,
          },
        },
        authorUser,
      );

      expect(replayRes.errors).toBeDefined();
      expect(replayRes.errors![0].message).toContain(`Comment with id "${commentId}" was not found`);
      expect((replayRes.errors![0].originalError as any)?.code).toBe('NOT_FOUND');
    });

    it('replay after image hiding (IMAGE_HIDDEN): text and author preserved, but media stripped to empty array', async () => {
      const { mediaId } = await stageCommentImage(authorUser, validWebp);
      const clientRequestId = `img-hide-${generateUuidV7()}`;

      const createRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Inappropriate image attached here',
            mediaIds: [mediaId],
            clientRequestId,
          },
        },
        authorUser,
      );
      const commentId = (createRes.data as any).createComment.id;

      // Simulate image hiding
      await dbHelper.db
        .update(comments)
        .set({ status: 'IMAGE_HIDDEN', updatedAt: new Date() })
        .where(eq(comments.id, commentId));

      const replayRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Inappropriate image attached here',
            mediaIds: [mediaId],
            clientRequestId,
          },
        },
        authorUser,
      );

      expect(replayRes.errors).toBeUndefined();
      const replayData = (replayRes.data as any).createComment;
      expect(replayData.id).toBe(commentId);
      expect(replayData.status).toBe('IMAGE_HIDDEN');
      // Original text preserved
      expect(replayData.text).toBe('Inappropriate image attached here');
      // Author preserved
      expect(replayData.author).toMatchObject({
        id: authorUser.id,
        fullName: 'Comment Author',
      });
      // Forbidden media stripped!
      expect(replayData.media).toEqual([]);
    });

    it('replay after permanent removal (REMOVED) throws NotFoundError', async () => {
      const clientRequestId = `perm-rem-${generateUuidV7()}`;

      const createRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Permanently removed content',
            clientRequestId,
          },
        },
        authorUser,
      );
      const commentId = (createRes.data as any).createComment.id;

      await dbHelper.db
        .update(comments)
        .set({ status: 'REMOVED', updatedAt: new Date() })
        .where(eq(comments.id, commentId));

      const replayRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Permanently removed content',
            clientRequestId,
          },
        },
        authorUser,
      );

      expect(replayRes.errors).toBeDefined();
      expect(replayRes.errors![0].message).toContain(`Comment with id "${commentId}" was not found`);
      expect((replayRes.errors![0].originalError as any)?.code).toBe('NOT_FOUND');
    });

    it('replay after Post removal throws NotFoundError("Post") and exposes no discussion', async () => {
      const clientRequestId = `post-rem-${generateUuidV7()}`;

      const createRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Comment on a post that will be removed',
            clientRequestId,
          },
        },
        authorUser,
      );
      expect(createRes.errors).toBeUndefined();

      // Mark post as REMOVED
      await dbHelper.db.update(posts).set({ status: 'REMOVED' }).where(eq(posts.id, testPost.id));

      const replayRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Comment on a post that will be removed',
            clientRequestId,
          },
        },
        authorUser,
      );

      expect(replayRes.errors).toBeDefined();
      expect(replayRes.errors![0].message).toContain(`Post with id "${testPost.id}" was not found`);
      expect((replayRes.errors![0].originalError as any)?.code).toBe('NOT_FOUND');
    });

    it('reply replay when parent comment is removed or deleted/hidden without surviving replies throws NotFoundError', async () => {
      // 1. Create parent
      const parentRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Parent for reply test',
            clientRequestId: generateUuidV7(),
          },
        },
        authorUser,
      );
      const parentId = (parentRes.data as any).createComment.id;

      // 2. Create reply
      const replyClientRequestId = `reply-under-parent-${generateUuidV7()}`;
      const replyRes = await executeGql(
        CREATE_REPLY_MUTATION,
        {
          input: {
            commentId: parentId,
            text: 'Reply content',
            clientRequestId: replyClientRequestId,
          },
        },
        replyUser,
      );
      expect(replyRes.errors).toBeUndefined();
      const replyId = (replyRes.data as any).createReply.id;

      // Case A: Parent is REMOVED
      await dbHelper.db.update(comments).set({ status: 'REMOVED' }).where(eq(comments.id, parentId));

      let replayRes = await executeGql(
        CREATE_REPLY_MUTATION,
        {
          input: {
            commentId: parentId,
            text: 'Reply content',
            clientRequestId: replyClientRequestId,
          },
        },
        replyUser,
      );
      expect(replayRes.errors).toBeDefined();
      expect(replayRes.errors![0].message).toContain(`Comment with id "${replyId}" was not found`);

      // Case B: Parent is DELETED and has replyCount === 0
      await dbHelper.db.update(comments).set({ status: 'DELETED', replyCount: 0 }).where(eq(comments.id, parentId));

      replayRes = await executeGql(
        CREATE_REPLY_MUTATION,
        {
          input: {
            commentId: parentId,
            text: 'Reply content',
            clientRequestId: replyClientRequestId,
          },
        },
        replyUser,
      );
      expect(replayRes.errors).toBeDefined();
      expect(replayRes.errors![0].message).toContain(`Comment with id "${replyId}" was not found`);
    });

    it('reply replay when reply itself is deleted or hidden throws NotFoundError', async () => {
      // 1. Create parent
      const parentRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Active parent',
            clientRequestId: generateUuidV7(),
          },
        },
        authorUser,
      );
      const parentId = (parentRes.data as any).createComment.id;

      // 2. Create reply
      const replyClientRequestId = `reply-self-del-${generateUuidV7()}`;
      const replyRes = await executeGql(
        CREATE_REPLY_MUTATION,
        {
          input: {
            commentId: parentId,
            text: 'Reply to be deleted',
            clientRequestId: replyClientRequestId,
          },
        },
        replyUser,
      );
      const replyId = (replyRes.data as any).createReply.id;

      // 3. Delete reply
      await executeGql(DELETE_COMMENT_MUTATION, { id: replyId }, replyUser);

      // 4. Replay reply creation
      const replayRes = await executeGql(
        CREATE_REPLY_MUTATION,
        {
          input: {
            commentId: parentId,
            text: 'Reply to be deleted',
            clientRequestId: replyClientRequestId,
          },
        },
        replyUser,
      );

      expect(replayRes.errors).toBeDefined();
      expect(replayRes.errors![0].message).toContain(`Comment with id "${replyId}" was not found`);
      expect((replayRes.errors![0].originalError as any)?.code).toBe('NOT_FOUND');
    });
  });

  // --- AC 6: Quota boundary & application restart ---
  describe('AC 6: Retries safe at exhausted quota boundaries and surviving restarts', () => {
    it('completed identical retry succeeds when creation quota is exhausted (10/min)', async () => {
      // 1. First comment successfully created
      const initialClientRequestId = `first-req-${generateUuidV7()}`;
      const firstRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Initial comment before quota exhaustion',
            clientRequestId: initialClientRequestId,
          },
        },
        authorUser,
      );
      expect(firstRes.errors).toBeUndefined();
      const firstCommentId = (firstRes.data as any).createComment.id;

      // 2. Author creates 9 more comments (reaching the 10/min rate limit)
      for (let i = 2; i <= 10; i++) {
        const res = await executeGql(
          CREATE_COMMENT_MUTATION,
          {
            input: {
              postId: testPost.id,
              text: `Comment number ${i}`,
              clientRequestId: generateUuidV7(),
            },
          },
          authorUser,
        );
        expect(res.errors).toBeUndefined();
      }

      // Verify 11th new creation is blocked by rate limit
      const blockedRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: '11th comment should fail',
            clientRequestId: generateUuidV7(),
          },
        },
        authorUser,
      );
      expect(blockedRes.errors).toBeDefined();
      expect(blockedRes.errors![0].message).toContain('Comment creation rate limit exceeded');
      expect((blockedRes.errors![0].originalError as any)?.code).toBe('RATE_LIMITED');

      // 3. NOW replay the FIRST comment with its identical clientRequestId
      // It MUST succeed and NOT be blocked by the rate limit!
      const retryRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Initial comment before quota exhaustion',
            clientRequestId: initialClientRequestId,
          },
        },
        authorUser,
      );

      expect(retryRes.errors).toBeUndefined();
      expect((retryRes.data as any).createComment.id).toBe(firstCommentId);
      expect((retryRes.data as any).createComment.text).toBe('Initial comment before quota exhaustion');
    });

    it('idempotent replay survives application restart (cold service instance)', async () => {
      const clientRequestId = `restart-req-${generateUuidV7()}`;

      // 1. Create comment on service instance 1
      const firstRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Created before simulated service restart',
            clientRequestId,
          },
        },
        authorUser,
      );
      expect(firstRes.errors).toBeUndefined();
      const commentId = (firstRes.data as any).createComment.id;

      // 2. Simulate complete application restart by instantiating a brand new CommentsService
      const restartedCommentsService = new CommentsService(
        commentsRepo,
        postsRepo,
        uploadService,
        mockConfig,
        undefined,
        undefined,
        usersService,
      );

      // 3. Replay creation against restarted service
      const replayResult = await restartedCommentsService.createComment(authorUser.id, {
        postId: testPost.id,
        text: 'Created before simulated service restart',
        clientRequestId,
      });

      expect(replayResult.id).toBe(commentId);
      expect(replayResult.text).toBe('Created before simulated service restart');
      expect(replayResult.status).toBe('ACTIVE');
    });
  });

  // --- AC 7: Safe handling of wrapped database conflicts ---
  describe('AC 7: Safe handling of wrapped database conflicts', () => {
    it('isUniqueViolation helper detects 23505 across direct and wrapped formats', () => {
      expect(isUniqueViolation({ code: '23505' })).toBe(true);
      expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true);
      expect(isUniqueViolation({ driverError: { code: '23505' } })).toBe(true);
      expect(isUniqueViolation(new Error('duplicate key value violates unique constraint "uq_foo"'))).toBe(true);
      expect(isUniqueViolation({ message: '23505: unique constraint violation' })).toBe(true);
      expect(isUniqueViolation(new Error('other random error'))).toBe(false);
      expect(isUniqueViolation(null)).toBe(false);
      expect(isUniqueViolation(undefined)).toBe(false);
    });

    it('recovers safely and returns fresh entity when database transaction hits wrapped unique conflict', async () => {
      const clientRequestId = `wrapped-conflict-${generateUuidV7()}`;

      // Create comment first
      const createRes = await executeGql(
        CREATE_COMMENT_MUTATION,
        {
          input: {
            postId: testPost.id,
            text: 'Original created text',
            clientRequestId,
          },
        },
        authorUser,
      );
      expect(createRes.errors).toBeUndefined();
      const createdId = (createRes.data as any).createComment.id;

      // Simulate a concurrent call where createCommentWithCounter throws a wrapped 23505 error
      const originalMethod = commentsRepo.createCommentWithCounter.bind(commentsRepo);
      let simulated = false;
      jest.spyOn(commentsRepo, 'createCommentWithCounter').mockImplementationOnce(async (params) => {
        simulated = true;
        const wrappedError: any = new Error('Database query execution failed');
        wrappedError.driverError = { code: '23505', message: 'duplicate key value violates unique constraint' };
        throw wrappedError;
      });

      // Execute via commentsService
      const result = await commentsService.createComment(authorUser.id, {
        postId: testPost.id,
        text: 'Original created text',
        clientRequestId,
      });

      expect(simulated).toBe(false); // Because idempotency check ran FIRST and resolved!
      expect(result.id).toBe(createdId);

      // Now force createComment to run past the idempotency check by stubbing findIdempotencyRecord once
      jest.spyOn(commentsRepo, 'findIdempotencyRecord').mockResolvedValueOnce(null);
      jest.spyOn(commentsRepo, 'createCommentWithCounter').mockImplementationOnce(async (params) => {
        const wrappedError: any = new Error('Database query execution failed');
        wrappedError.cause = { code: '23505', message: 'unique constraint error' };
        throw wrappedError;
      });

      const recoveredResult = await commentsService.createComment(authorUser.id, {
        postId: testPost.id,
        text: 'Original created text',
        clientRequestId,
      });

      expect(recoveredResult.id).toBe(createdId);
      expect(recoveredResult.text).toBe('Original created text');
    });
  });
});

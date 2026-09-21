import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { and, eq, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  blocks,
  cities,
  commentIdempotency,
  commentMedia,
  commentQuotaAdmissions,
  comments,
  lostPosts,
  mediaDeletionWork,
  posts,
  stagedUploads,
  users,
  type City,
  type Comment,
  type CommentMedia,
  type Post,
  type User,
} from '../database/schema';
import { CommentsRepository, type FinalizedCommentMedia } from './comments.repository';
import { CommentsService } from './comments.service';
import { CommentsResolver, CommentMediaResolver } from './comments.resolver';
import { PostsRepository } from '../posts/posts.repository';
import { CitiesRepository } from '../cities/cities.repository';
import { UsersRepository } from '../users/users.repository';
import { CitiesService } from '../cities/cities.service';
import { UsersService } from '../users/users.service';
import { UploadService } from '../upload/upload.service';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { AppError } from '../common/errors/app.errors';
import type { GqlContext } from '../common/types/gql-context.type';

interface R2Object {
  bytes: Buffer;
  etag: string;
}

interface R2Error extends Error {
  name: string;
  $metadata?: { httpStatusCode: number };
}

interface S3CommandLike {
  constructor?: { name?: string };
  name?: string;
  input?: { Key?: string; Body?: unknown };
}

interface S3ClientHolder {
  s3Client: { send: (cmd: unknown) => Promise<unknown> };
}

type PostType = 'RESCUE' | 'LOST' | 'ADOPTION' | 'PRODUCT' | 'MATING';
type LostReportType = 'LOST_PET' | 'FOUND_STRAY';

interface CreateCommentData {
  createComment: {
    id: string;
    postId: string;
    text: string;
    status: string;
    media: Array<{ id: string; publicUrl: string; displayOrder: number }>;
  };
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

  send(command: S3CommandLike): Promise<Record<string, unknown>> {
    const cmdName = command.constructor?.name ?? command.name;
    const key = command.input?.Key ?? '';

    if (cmdName === 'HeadObjectCommand' || command instanceof HeadObjectCommand) {
      if (!this.objects.has(key)) {
        const err = new Error(`NotFound: ${key}`) as R2Error;
        err.name = 'NotFound';
        err.$metadata = { httpStatusCode: 404 };
        return Promise.reject(err);
      }
      const item = this.objects.get(key)!;
      return Promise.resolve({ ContentLength: item.bytes.length, ETag: item.etag });
    }

    if (cmdName === 'GetObjectCommand' || command instanceof GetObjectCommand) {
      const item = this.objects.get(key);
      if (!item) {
        const err = new Error(`NoSuchKey: ${key}`) as R2Error;
        err.name = 'NoSuchKey';
        err.$metadata = { httpStatusCode: 404 };
        return Promise.reject(err);
      }
      return Promise.resolve({
        ContentLength: item.bytes.length,
        ETag: item.etag,
        Body: {
          transformToByteArray: () => Promise.resolve(new Uint8Array(item.bytes)),
        },
      });
    }

    if (cmdName === 'PutObjectCommand' || command instanceof PutObjectCommand) {
      const body = command.input?.Body;
      const bytes = Buffer.isBuffer(body) ? body : typeof body === 'string' ? Buffer.from(body) : Buffer.from('');
      const etag = `"${crypto.createHash('md5').update(bytes).digest('hex')}"`;
      this.objects.set(key, { bytes, etag });
      return Promise.resolve({});
    }

    if (cmdName === 'DeleteObjectCommand' || command instanceof DeleteObjectCommand) {
      this.objects.delete(key);
      return Promise.resolve({});
    }

    return Promise.resolve({});
  }
}

describe('Community Evidence: image Comments restricted to RESCUE and LOST (Ticket 04)', () => {
  jest.setTimeout(180_000);

  let dbHelper: TestDatabaseHelper;
  let r2Adapter: ControllableR2Adapter;
  let mockCache: Cache;
  let mockConfig: ConfigService;

  let commentsRepo: CommentsRepository;
  let postsRepo: PostsRepository;
  let commentsService: CommentsService;
  let commentsResolver: CommentsResolver;

  let executableSchema: GraphQLSchema;
  let testCity: City;
  let owner: User;
  let commenter: User;
  let outsider: User;

  let validWebp1: Buffer;
  let validWebp2: Buffer;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    validWebp1 = await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 120, g: 150, b: 200 } },
    })
      .webp()
      .toBuffer();

    validWebp2 = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 80, g: 210, b: 120 } },
    })
      .webp()
      .toBuffer();

    r2Adapter = new ControllableR2Adapter();

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
          case 'COMMENT_IMAGES_ENABLED':
            return 'true';
          default:
            return undefined;
        }
      }),
    } as unknown as ConfigService;

    const citiesRepo = new CitiesRepository(dbHelper.db);
    const usersRepo = new UsersRepository(dbHelper.db);
    postsRepo = new PostsRepository(dbHelper.db);
    commentsRepo = new CommentsRepository(dbHelper.db);

    const citiesService = new CitiesService(citiesRepo, mockCache);
    const usersService = new UsersService(usersRepo, citiesService, mockConfig, mockCache);
    const uploadService = new UploadService(mockConfig, mockCache, dbHelper.db);
    (uploadService as unknown as S3ClientHolder).s3Client.send = jest.fn((cmd: unknown) =>
      r2Adapter.send(cmd as S3CommandLike),
    );

    const isolationPolicy = new AccountIsolationPolicy(dbHelper.db);

    commentsService = new CommentsService(
      commentsRepo,
      postsRepo,
      uploadService,
      mockConfig,
      undefined,
      undefined,
      usersService,
      isolationPolicy,
    );

    commentsResolver = new CommentsResolver(commentsService);
    const commentMediaResolver = new CommentMediaResolver(commentsService);

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
          __parseValue: (v: unknown) => v,
          __serialize: (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string)),
        },
        Mutation: {
          createComment: (_root: unknown, args: { input: unknown }, ctx: GqlContext) =>
            commentsResolver.createComment(args.input, ctx),
          createReply: (_root: unknown, args: { input: unknown }, ctx: GqlContext) =>
            commentsResolver.createReply(args.input, ctx),
          deleteComment: (_root: unknown, args: { id: string }, ctx: GqlContext) =>
            commentsResolver.deleteComment(args.id, ctx),
          pinComment: (_root: unknown, args: { commentId: string }, ctx: GqlContext) =>
            commentsResolver.pinComment(args.commentId, ctx),
          unpinComment: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            commentsResolver.unpinComment(args.postId, ctx),
        },
        Comment: {
          media: (root: Comment, _args: unknown, ctx: GqlContext) => commentsResolver.media(root, ctx),
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

    owner = await seedUser('owner');
    commenter = await seedUser('commenter');
    outsider = await seedUser('outsider');
  });

  async function seedUser(label: string): Promise<User> {
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `firebase-${label}-${generateUuidV7()}`,
        email: `${label}-${generateUuidV7()}@pupzy.dev`,
        fullName: `Evidence ${label}`,
      })
      .returning();
    return user;
  }

  async function seedPost(params: {
    postType: PostType;
    status?: Post['status'];
    reportType?: LostReportType;
  }): Promise<Post> {
    const isUrgencyType = params.postType === 'RESCUE' || params.postType === 'LOST';
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId: owner.id,
        postType: params.postType,
        title: `Evidence ${params.postType} ${generateUuidV7().slice(-4)}`,
        description: 'Community Evidence fixture',
        status: params.status ?? 'ACTIVE',
        moderationStatus: 'CLEAN',
        urgency: isUrgencyType ? 'URGENT' : undefined,
        cityId: testCity.id,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();

    if (params.postType === 'LOST') {
      const reportType = params.reportType ?? 'LOST_PET';
      await dbHelper.db.insert(lostPosts).values({
        postId: post.id,
        reportType,
        species: 'DOG',
        ...(reportType === 'LOST_PET'
          ? { dateLastSeen: '2026-08-01' }
          : { currentCondition: 'HEALTHY', isCurrentlySafeWithReporter: true, dateFound: '2026-08-02' }),
      });
    }

    return post;
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

  function createContext(user: User): GqlContext {
    return {
      req: {} as GqlContext['req'],
      user,
      loaders: {
        userById: {} as GqlContext['loaders']['userById'],
        cityById: {} as GqlContext['loaders']['cityById'],
        mediaByPostId: {} as GqlContext['loaders']['mediaByPostId'],
        upvotedByMe: {} as GqlContext['loaders']['upvotedByMe'],
        savedByMe: {} as GqlContext['loaders']['savedByMe'],
        commentBoostedByMe: {
          load: jest.fn().mockResolvedValue(false),
        } as unknown as GqlContext['loaders']['commentBoostedByMe'],
        pinnedCommentIdByPostId: {
          load: jest.fn().mockResolvedValue(null),
        } as unknown as GqlContext['loaders']['pinnedCommentIdByPostId'],
        commentMediaByCommentId: commentsRepo.createCommentMediaByCommentIdLoader(),
      },
    };
  }

  function executeGql<TData = Record<string, unknown>>(
    source: string,
    variables: Record<string, unknown> = {},
    user: User = commenter,
  ): Promise<ExecutionResult<TData>> {
    return graphql({
      schema: executableSchema,
      source,
      variableValues: variables,
      contextValue: createContext(user),
    }) as Promise<ExecutionResult<TData>>;
  }

  function errorCode(result: ExecutionResult<unknown>): string | undefined {
    const err = result.errors?.[0];
    return (
      (err?.originalError as AppError | undefined)?.code ?? (err?.extensions as { code?: string } | undefined)?.code
    );
  }

  const CREATE_COMMENT_MUTATION = `
    mutation CreateComment($input: CreateCommentInput!) {
      createComment(input: $input) {
        id
        postId
        text
        status
        media {
          id
          publicUrl
          displayOrder
        }
      }
    }
  `;

  const DELETE_COMMENT_MUTATION = `mutation DeleteComment($id: ID!) { deleteComment(id: $id) }`;

  const PIN_COMMENT_MUTATION = `mutation PinComment($commentId: ID!) {
    pinComment(commentId: $commentId) { id isPinned }
  }`;

  function fakeFinalizedMedia(commentId: string): FinalizedCommentMedia {
    const mediaId = generateUuidV7();
    return {
      id: mediaId,
      commentId,
      storageKey: `comments/${commentId}/${mediaId}.webp`,
      sha256: 'a'.repeat(64),
      width: 10,
      height: 10,
      fileSizeBytes: 100,
      fileContentType: 'image/webp',
      displayOrder: 0,
    };
  }

  it('publishes image Comments on RESCUE', async () => {
    const post = await seedPost({ postType: 'RESCUE' });
    const { mediaId, stagingKey } = await stageCommentImage(commenter, validWebp1);

    const res = await executeGql<CreateCommentData>(CREATE_COMMENT_MUTATION, {
      input: {
        postId: post.id,
        text: 'Rescue evidence photo',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId],
      },
    });

    expect(res.errors).toBeUndefined();
    const commentData = res.data!.createComment;
    expect(commentData.media).toHaveLength(1);
    expect(commentData.media[0].id).toBe(mediaId);

    const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(ticket.status).toBe('FINALIZED');
    expect(r2Adapter.hasObject(`comments/${commentData.id}/${mediaId}.webp`)).toBe(true);
    expect(r2Adapter.hasObject(stagingKey)).toBe(false);

    const [postRow] = await dbHelper.db.select().from(posts).where(eq(posts.id, post.id));
    expect(postRow.status).toBe('ACTIVE');
    expect(postRow.commentCount).toBe(1);
  });

  it('publishes two image Comments on LOST_PET and one on FOUND_STRAY', async () => {
    const lostPet = await seedPost({ postType: 'LOST', reportType: 'LOST_PET' });
    const foundStray = await seedPost({ postType: 'LOST', reportType: 'FOUND_STRAY' });

    const first = await stageCommentImage(commenter, validWebp1);
    const second = await stageCommentImage(commenter, validWebp2);
    const lostRes = await executeGql<CreateCommentData>(CREATE_COMMENT_MUTATION, {
      input: {
        postId: lostPet.id,
        text: 'Two photos of the missing pet area',
        clientRequestId: generateUuidV7(),
        mediaIds: [first.mediaId, second.mediaId],
      },
    });

    expect(lostRes.errors).toBeUndefined();
    expect(lostRes.data!.createComment.media).toHaveLength(2);

    const third = await stageCommentImage(commenter, validWebp1);
    const strayRes = await executeGql<CreateCommentData>(CREATE_COMMENT_MUTATION, {
      input: {
        postId: foundStray.id,
        text: 'Photo of the found stray',
        clientRequestId: generateUuidV7(),
        mediaIds: [third.mediaId],
      },
    });

    expect(strayRes.errors).toBeUndefined();
    expect(strayRes.data!.createComment.media).toHaveLength(1);
  });

  it.each(['ADOPTION', 'PRODUCT', 'MATING'] as const)(
    'rejects image publication on %s before staging is finalized',
    async (postType) => {
      const post = await seedPost({ postType });
      const { mediaId, stagingKey } = await stageCommentImage(commenter, validWebp1);

      const res = await executeGql(CREATE_COMMENT_MUTATION, {
        input: {
          postId: post.id,
          text: 'Photo evidence on a restricted type',
          clientRequestId: generateUuidV7(),
          mediaIds: [mediaId],
        },
      });

      expect(errorCode(res)).toBe('COMMENT_MEDIA_NOT_ALLOWED');
      expect(res.errors?.[0].message).toContain('rescue and lost/found');

      expect(await dbHelper.db.select().from(comments).where(eq(comments.postId, post.id))).toHaveLength(0);
      expect(await dbHelper.db.select().from(commentMedia)).toHaveLength(0);

      const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('ISSUED');
      expect(r2Adapter.hasObject(stagingKey)).toBe(true);
      expect(Array.from(r2Adapter.objects.keys()).filter((key) => key.startsWith('comments/'))).toHaveLength(0);
    },
  );

  it('keeps a rejected staged upload retryable on an allowed Post type', async () => {
    const adoption = await seedPost({ postType: 'ADOPTION' });
    const rescue = await seedPost({ postType: 'RESCUE' });
    const { mediaId } = await stageCommentImage(commenter, validWebp1);

    const rejected = await executeGql(CREATE_COMMENT_MUTATION, {
      input: {
        postId: adoption.id,
        text: 'Rejected first',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId],
      },
    });
    expect(errorCode(rejected)).toBe('COMMENT_MEDIA_NOT_ALLOWED');

    const accepted = await executeGql<CreateCommentData>(CREATE_COMMENT_MUTATION, {
      input: {
        postId: rescue.id,
        text: 'Retry succeeds',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId],
      },
    });

    expect(accepted.errors).toBeUndefined();
    expect(accepted.data!.createComment.media).toHaveLength(1);
  });

  it('keeps text Comments available on every Post type and completed/expired statuses', async () => {
    const matrix: Array<{ post: Post }> = [
      { post: await seedPost({ postType: 'RESCUE' }) },
      { post: await seedPost({ postType: 'LOST', reportType: 'LOST_PET' }) },
      { post: await seedPost({ postType: 'LOST', reportType: 'FOUND_STRAY' }) },
      { post: await seedPost({ postType: 'ADOPTION' }) },
      { post: await seedPost({ postType: 'PRODUCT', status: 'EXPIRED' }) },
      { post: await seedPost({ postType: 'MATING', status: 'RESOLVED' }) },
    ];

    for (const { post } of matrix) {
      const res = await executeGql<CreateCommentData>(CREATE_COMMENT_MUTATION, {
        input: {
          postId: post.id,
          text: `Text discussion on ${post.postType} ${post.status}`,
          clientRequestId: generateUuidV7(),
        },
      });

      expect(res.errors).toBeUndefined();
      expect(res.data!.createComment.media).toHaveLength(0);
    }
  });

  it('preserves the two-image bound and duplicate-media rejection on allowed types', async () => {
    const post = await seedPost({ postType: 'RESCUE' });
    const first = await stageCommentImage(commenter, validWebp1);
    const second = await stageCommentImage(commenter, validWebp2);
    const third = await stageCommentImage(commenter, validWebp1);

    const tooMany = await executeGql(CREATE_COMMENT_MUTATION, {
      input: {
        postId: post.id,
        text: 'Three images',
        clientRequestId: generateUuidV7(),
        mediaIds: [first.mediaId, second.mediaId, third.mediaId],
      },
    });
    expect(errorCode(tooMany)).toBe('VALIDATION_ERROR');
    expect(tooMany.errors?.[0].message).toContain('Maximum 2 images');

    const duplicate = await executeGql(CREATE_COMMENT_MUTATION, {
      input: {
        postId: post.id,
        text: 'Duplicate images',
        clientRequestId: generateUuidV7(),
        mediaIds: [first.mediaId, first.mediaId],
      },
    });
    expect(errorCode(duplicate)).toBe('VALIDATION_ERROR');
    expect(duplicate.errors?.[0].message).toContain('Duplicate media IDs');

    expect(await dbHelper.db.select().from(comments).where(eq(comments.postId, post.id))).toHaveLength(0);
  });

  it('keeps Replies text-only on a restricted Post type', async () => {
    const post = await seedPost({ postType: 'MATING' });
    const { mediaId } = await stageCommentImage(commenter, validWebp1);

    const created = await executeGql<CreateCommentData>(CREATE_COMMENT_MUTATION, {
      input: {
        postId: post.id,
        text: 'Parent discussion comment',
        clientRequestId: generateUuidV7(),
      },
    });
    expect(created.errors).toBeUndefined();
    const commentId = created.data!.createComment.id;

    const reply = await executeGql(
      `mutation CreateReply($input: CreateReplyInput!) { createReply(input: $input) { id parentId text } }`,
      { input: { commentId, text: 'Text-only reply', clientRequestId: generateUuidV7() } },
      outsider,
    );
    expect(reply.errors).toBeUndefined();

    await expect(
      commentsResolver.createReply(
        { commentId, text: 'Reply with media', clientRequestId: generateUuidV7(), mediaIds: [mediaId] },
        createContext(outsider),
      ),
    ).rejects.toThrow('Replies cannot contain media');
  });

  it('preserves author-only deletion and media cleanup for image Comments', async () => {
    const post = await seedPost({ postType: 'RESCUE' });
    const { mediaId } = await stageCommentImage(commenter, validWebp1);
    const created = await executeGql<CreateCommentData>(CREATE_COMMENT_MUTATION, {
      input: {
        postId: post.id,
        text: 'Evidence to moderate',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId],
      },
    });
    expect(created.errors).toBeUndefined();
    const commentId = created.data!.createComment.id;
    const storageKey = `comments/${commentId}/${mediaId}.webp`;

    const foreignDelete = await executeGql(DELETE_COMMENT_MUTATION, { id: commentId }, outsider);
    expect(errorCode(foreignDelete)).toBe('FORBIDDEN');

    const ownerDelete = await executeGql(DELETE_COMMENT_MUTATION, { id: commentId }, commenter);
    expect(ownerDelete.errors).toBeUndefined();
    expect(ownerDelete.data!.deleteComment).toBe(true);

    const [commentRow] = await dbHelper.db.select().from(comments).where(eq(comments.id, commentId));
    expect(commentRow.status).toBe('DELETED');
    expect(await dbHelper.db.select().from(commentMedia).where(eq(commentMedia.commentId, commentId))).toHaveLength(0);

    const deletionRows = await dbHelper.db
      .select()
      .from(mediaDeletionWork)
      .where(eq(mediaDeletionWork.storageKey, storageKey));
    expect(deletionRows.length).toBeGreaterThan(0);

    const [postRow] = await dbHelper.db.select().from(posts).where(eq(posts.id, post.id));
    expect(postRow.commentCount).toBe(0);
  });

  it('keeps owner pinning and Post state untouched by image Comment activity', async () => {
    const post = await seedPost({ postType: 'RESCUE' });
    const { mediaId } = await stageCommentImage(commenter, validWebp1);
    const created = await executeGql<CreateCommentData>(CREATE_COMMENT_MUTATION, {
      input: {
        postId: post.id,
        text: 'Pinnable evidence',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId],
      },
    });
    const commentId = created.data!.createComment.id;

    const pinned = await executeGql<{ pinComment: { id: string; isPinned: boolean } }>(
      PIN_COMMENT_MUTATION,
      { commentId },
      owner,
    );
    expect(pinned.errors).toBeUndefined();
    expect(pinned.data!.pinComment.isPinned).toBe(true);

    const [postRow] = await dbHelper.db.select().from(posts).where(eq(posts.id, post.id));
    expect(postRow.status).toBe('ACTIVE');
  });

  it('enforces the image restriction inside the committing transaction', async () => {
    const adoption = await seedPost({ postType: 'ADOPTION' });
    const commentId = generateUuidV7();
    const clientRequestId = generateUuidV7();

    await expect(
      commentsRepo.createCommentWithCounter({
        commentId,
        postId: adoption.id,
        authorId: commenter.id,
        text: 'Commit-time image comment',
        clientRequestId,
        requestHash: 'commit-time-hash',
        mediaItems: [fakeFinalizedMedia(commentId)],
      }),
    ).rejects.toMatchObject({ code: 'COMMENT_MEDIA_NOT_ALLOWED' });

    expect(await dbHelper.db.select().from(comments).where(eq(comments.postId, adoption.id))).toHaveLength(0);
    expect(await dbHelper.db.select().from(commentMedia)).toHaveLength(0);
    expect(
      await dbHelper.db
        .select()
        .from(commentIdempotency)
        .where(
          and(eq(commentIdempotency.authorId, commenter.id), eq(commentIdempotency.clientRequestId, clientRequestId)),
        ),
    ).toHaveLength(0);
  });

  it('allows media through the same commit boundary on RESCUE', async () => {
    const rescue = await seedPost({ postType: 'RESCUE' });
    const commentId = generateUuidV7();

    const comment = await commentsRepo.createCommentWithCounter({
      commentId,
      postId: rescue.id,
      authorId: commenter.id,
      text: 'Commit-time image comment on rescue',
      clientRequestId: generateUuidV7(),
      requestHash: 'allowed-commit-time-hash',
      mediaItems: [fakeFinalizedMedia(commentId)],
    });

    expect(comment.id).toBe(commentId);
    expect(await dbHelper.db.select().from(commentMedia).where(eq(commentMedia.commentId, commentId))).toHaveLength(1);
  });

  it('keeps historical image Comments on restricted Post types readable and replayable', async () => {
    const adoption = await seedPost({ postType: 'ADOPTION' });
    const commentId = generateUuidV7();
    const mediaId = generateUuidV7();
    const text = 'Historic evidence photo';
    const clientRequestId = 'historical-image-comment';

    const [historical] = await dbHelper.db
      .insert(comments)
      .values({ id: commentId, postId: adoption.id, authorId: commenter.id, text, status: 'ACTIVE' })
      .returning();

    await dbHelper.db.insert(commentMedia).values({
      id: mediaId,
      commentId,
      storageKey: `comments/${commentId}/${mediaId}.webp`,
      sha256: 'b'.repeat(64),
      width: 10,
      height: 10,
      fileSizeBytes: 100,
      fileContentType: 'image/webp',
      displayOrder: 0,
    });

    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ postId: adoption.id, text, mediaIds: [mediaId] }))
      .digest('hex');

    await dbHelper.db.insert(commentIdempotency).values({
      authorId: commenter.id,
      clientRequestId,
      requestHash,
      commentId,
      responsePayload: historical,
    });

    const res = await executeGql<CreateCommentData>(CREATE_COMMENT_MUTATION, {
      input: { postId: adoption.id, text, clientRequestId, mediaIds: [mediaId] },
    });

    expect(res.errors).toBeUndefined();
    expect(res.data!.createComment.id).toBe(commentId);
    expect(res.data!.createComment.media).toHaveLength(1);
    expect(await dbHelper.db.select().from(commentMedia).where(eq(commentMedia.commentId, commentId))).toHaveLength(1);
  });

  it('does not consume comment creation quota for rejected image attempts', async () => {
    const adoption = await seedPost({ postType: 'ADOPTION' });
    const { mediaId } = await stageCommentImage(commenter, validWebp1);

    for (let attempt = 0; attempt < 11; attempt++) {
      const res = await executeGql(CREATE_COMMENT_MUTATION, {
        input: {
          postId: adoption.id,
          text: `Rejected attempt ${attempt}`,
          clientRequestId: generateUuidV7(),
          mediaIds: [mediaId],
        },
      });
      expect(errorCode(res)).toBe('COMMENT_MEDIA_NOT_ALLOWED');
    }

    const admissions = await dbHelper.db
      .select()
      .from(commentQuotaAdmissions)
      .where(
        and(eq(commentQuotaAdmissions.userId, commenter.id), eq(commentQuotaAdmissions.action, 'COMMENT_CREATION')),
      );
    expect(admissions).toHaveLength(0);

    const textRes = await executeGql<CreateCommentData>(CREATE_COMMENT_MUTATION, {
      input: {
        postId: adoption.id,
        text: 'Text comment after rejections',
        clientRequestId: generateUuidV7(),
      },
    });
    expect(textRes.errors).toBeUndefined();
  });

  it('keeps account isolation ahead of the image restriction', async () => {
    const adoption = await seedPost({ postType: 'ADOPTION' });
    await dbHelper.db.insert(blocks).values({ blockerId: owner.id, blockedId: commenter.id });
    const { mediaId } = await stageCommentImage(commenter, validWebp1);

    const res = await executeGql(CREATE_COMMENT_MUTATION, {
      input: {
        postId: adoption.id,
        text: 'Isolated attempt',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId],
      },
    });

    expect(errorCode(res)).toBe('NOT_FOUND');
  });
});

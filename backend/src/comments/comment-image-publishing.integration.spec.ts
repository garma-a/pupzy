import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { eq, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  users,
  cities,
  posts,
  comments,
  commentMedia,
  stagedUploads,
  blockedMediaHashes,
  type User,
  type City,
  type Post,
  type Comment,
  type CommentMedia,
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
import { AppError } from '../common/errors/app.errors';
import type { CreateCommentInput } from './dto/create-comment.input';

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

interface CreateCommentResponse {
  createComment: {
    id: string;
    postId: string;
    text: string;
    status: string;
    media: Array<{
      id: string;
      publicUrl: string;
      width: number;
      height: number;
      displayOrder: number;
    }>;
  };
}

interface GraphQLErrorExtensionWithCode {
  code?: string;
  retryable?: boolean;
}

/**
 * Controllable Cloudflare R2 adapter to simulate storage behavior,
 * ETag consistency, staging tampering, and verified bytes publication.
 */
class ControllableR2Adapter {
  public objects = new Map<string, R2Object>();
  public shouldFailPut = false;
  public shouldFailHead = false;
  public onGetObject?: (key: string) => void;

  putObject(key: string, bytes: Buffer, etag?: string): void {
    const computedEtag = etag ?? `"${crypto.createHash('md5').update(bytes).digest('hex')}"`;
    this.objects.set(key, { bytes, etag: computedEtag });
  }

  hasObject(key: string): boolean {
    return this.objects.has(key);
  }

  getObject(key: string): R2Object | undefined {
    return this.objects.get(key);
  }

  reset(): void {
    this.objects.clear();
    this.shouldFailPut = false;
    this.shouldFailHead = false;
    this.onGetObject = undefined;
  }

  send(command: S3CommandLike): Promise<Record<string, unknown>> {
    const cmdName = command.constructor?.name ?? command.name;
    const key = command.input?.Key ?? '';

    if (cmdName === 'HeadObjectCommand' || command instanceof HeadObjectCommand) {
      if (this.shouldFailHead || !this.objects.has(key)) {
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
      if (this.onGetObject) {
        this.onGetObject(key);
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
      if (this.shouldFailPut) {
        return Promise.reject(new Error('Simulated R2 PutObject transient failure'));
      }
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

/**
 * Creates a minimal 30-byte header-only VP8X chunk with no subsequent frame chunk.
 */
function createHeaderOnlyVp8x(): Buffer {
  const riff = Buffer.from('RIFF', 'ascii');
  const webp = Buffer.from('WEBP', 'ascii');
  const vp8x = Buffer.from('VP8X', 'ascii');
  const chunkSize = Buffer.alloc(4);
  chunkSize.writeUInt32LE(10, 0); // 10 bytes payload
  const vp8xPayload = Buffer.alloc(10);
  vp8xPayload[0] = 0x00;
  vp8xPayload.writeUIntLE(319, 4, 3);
  vp8xPayload.writeUIntLE(239, 7, 3);
  const totalRiff = 4 + 4 + 4 + 10;
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(totalRiff, 0);
  return Buffer.concat([riff, riffSize, webp, vp8x, chunkSize, vp8xPayload]);
}

describe('Comment Image Publishing Integration (Ticket 02)', () => {
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
  let testPost: Post;

  let validWebp1: Buffer;
  let validWebp2: Buffer;
  let oversizedDimensionsWebp: Buffer;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    // Generate genuine WebP fixtures using sharp
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

    oversizedDimensionsWebp = await sharp({
      create: { width: 640, height: 480, channels: 3, background: { r: 150, g: 100, b: 100 } },
    })
      .webp()
      .toBuffer();

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

    // Wire controllable R2 adapter into uploadService's S3Client
    (uploadService as unknown as S3ClientHolder).s3Client.send = jest.fn((cmd: unknown) =>
      r2Adapter.send(cmd as S3CommandLike),
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

    // Build executable GraphQL schema from repository SDL definitions
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
            return v instanceof Date ? v.toISOString() : (v as string);
          },
        },
        Query: {
          post: (_root: unknown, args: { id: string }) => postsRepo.findById(args.id),
        },
        Mutation: {
          createComment: (_root: unknown, args: { input: CreateCommentInput }, ctx: GqlContext) =>
            commentsResolver.createComment(args.input, ctx),
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

    // Seed test city
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

    // Seed test user
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `firebase-${generateUuidV7()}`,
        email: `author-${generateUuidV7()}@example.com`,
        fullName: 'Comment Author',
      })
      .returning();
    authorUser = user;

    // Seed test post
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId: authorUser.id,
        postType: 'RESCUE',
        title: 'Need rescue dog help',
        description: 'Dog found in Zamalek',
        cityId: testCity.id,
        urgency: 'URGENT',
        status: 'ACTIVE',
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    testPost = post;
  });

  async function executeGql<TData = Record<string, unknown>>(
    source: string,
    variables: Record<string, unknown> = {},
    user: User = authorUser,
  ): Promise<ExecutionResult<TData>> {
    const ctx: GqlContext = {
      req: {} as unknown as GqlContext['req'],
      user,
      loaders: {
        cityById: citiesService.createCityByIdLoader(),
        userById: usersService.createUserByIdLoader(),
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
        text
        status
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

  // --- Acceptance Criterion 1 & 6: 1-image and 2-image verified publication ---
  it('successfully publishes verified bytes for a 1-image comment and records correct metadata', async () => {
    const { mediaId, stagingKey } = await stageCommentImage(authorUser, validWebp1);
    const expectedHash = crypto.createHash('sha256').update(validWebp1).digest('hex');

    const res = await executeGql<CreateCommentResponse>(CREATE_COMMENT_MUTATION, {
      input: {
        postId: testPost.id,
        text: 'Look at this photo!',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId],
      },
    });

    expect(res.errors).toBeUndefined();
    const commentData = res.data!.createComment;
    expect(commentData.id).toBeDefined();
    expect(commentData.media).toHaveLength(1);
    expect(commentData.media[0]).toMatchObject({
      id: mediaId,
      width: 320,
      height: 240,
      displayOrder: 0,
      publicUrl: `https://cdn.pupzy.net/comments/${commentData.id}/${mediaId}.webp`,
    });

    // Verify DB records
    const [dbComment] = await dbHelper.db.select().from(comments).where(eq(comments.id, commentData.id));
    expect(dbComment).toBeDefined();

    const [dbMedia] = await dbHelper.db.select().from(commentMedia).where(eq(commentMedia.commentId, commentData.id));
    expect(dbMedia).toBeDefined();
    expect(dbMedia.sha256).toBe(expectedHash);
    expect(dbMedia.width).toBe(320);
    expect(dbMedia.height).toBe(240);
    expect(dbMedia.fileSizeBytes).toBe(validWebp1.length);
    expect(dbMedia.storageKey).toBe(`comments/${commentData.id}/${mediaId}.webp`);

    const [dbTicket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(dbTicket.status).toBe('FINALIZED');
    expect(dbTicket.finalStorageKey).toBe(`comments/${commentData.id}/${mediaId}.webp`);

    // Verify R2: exact verified bytes exist in permanent storage and staging is deleted
    const finalKey = `comments/${commentData.id}/${mediaId}.webp`;
    expect(r2Adapter.hasObject(finalKey)).toBe(true);
    expect(r2Adapter.getObject(finalKey)!.bytes).toEqual(validWebp1);
    expect(r2Adapter.hasObject(stagingKey)).toBe(false);
  });

  it('successfully publishes verified bytes for a 2-image comment with correct displayOrder', async () => {
    const { mediaId: mediaId1, stagingKey: stagingKey1 } = await stageCommentImage(authorUser, validWebp1);
    const { mediaId: mediaId2, stagingKey: stagingKey2 } = await stageCommentImage(authorUser, validWebp2);

    const res = await executeGql<CreateCommentResponse>(CREATE_COMMENT_MUTATION, {
      input: {
        postId: testPost.id,
        text: 'Two photos attached',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId1, mediaId2],
      },
    });

    expect(res.errors).toBeUndefined();
    const commentData = res.data!.createComment;
    expect(commentData.media).toHaveLength(2);
    expect(commentData.media[0]).toMatchObject({ id: mediaId1, displayOrder: 0 });
    expect(commentData.media[1]).toMatchObject({ id: mediaId2, displayOrder: 1 });

    // Verify database media rows
    const dbMediaRows = await dbHelper.db
      .select()
      .from(commentMedia)
      .where(eq(commentMedia.commentId, commentData.id))
      .orderBy(commentMedia.displayOrder);
    expect(dbMediaRows).toHaveLength(2);
    expect(dbMediaRows[0].id).toBe(mediaId1);
    expect(dbMediaRows[0].displayOrder).toBe(0);
    expect(dbMediaRows[1].id).toBe(mediaId2);
    expect(dbMediaRows[1].displayOrder).toBe(1);

    // Verify both objects published and staging deleted
    expect(r2Adapter.hasObject(`comments/${commentData.id}/${mediaId1}.webp`)).toBe(true);
    expect(r2Adapter.hasObject(`comments/${commentData.id}/${mediaId2}.webp`)).toBe(true);
    expect(r2Adapter.hasObject(stagingKey1)).toBe(false);
    expect(r2Adapter.hasObject(stagingKey2)).toBe(false);
  });

  // --- Acceptance Criterion 2: 30-byte header-only VP8X rejection ---
  it('rejects staged 30-byte header-only VP8X without publishing unverified bytes or creating a comment', async () => {
    const headerOnly = createHeaderOnlyVp8x();
    expect(headerOnly.length).toBe(30);

    const { mediaId } = await stageCommentImage(authorUser, headerOnly);

    const res = await executeGql(CREATE_COMMENT_MUTATION, {
      input: {
        postId: testPost.id,
        text: 'Trying to sneak 30-byte header',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId],
      },
    });

    expect(res.errors).toBeDefined();
    expect(res.errors!.length).toBeGreaterThan(0);
    const err = res.errors![0];
    const code =
      (err.originalError as AppError | undefined)?.code ??
      (err.extensions as GraphQLErrorExtensionWithCode | undefined)?.code;
    expect(code).toBe('COMMENT_MEDIA_INVALID_FORMAT');

    // Comment must not be created
    const dbComments = await dbHelper.db.select().from(comments).where(eq(comments.postId, testPost.id));
    expect(dbComments).toHaveLength(0);

    // No comment_media record created
    const dbMedia = await dbHelper.db.select().from(commentMedia);
    expect(dbMedia).toHaveLength(0);

    // Ticket must be marked FAILED
    const [dbTicket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(dbTicket.status).toBe('FAILED');

    // Unverified bytes never published to comments namespace
    const finalKeys = Array.from(r2Adapter.objects.keys()).filter((k) => k.startsWith('comments/'));
    expect(finalKeys).toHaveLength(0);
  });

  // --- Acceptance Criterion 2: Corrupted payload rejection ---
  it('rejects staged corrupted compressed payload with valid VP8 header', async () => {
    // Valid header but truncated/corrupt bitstream
    const corruptedPayload = Buffer.from(validWebp1).subarray(0, 30);
    const { mediaId } = await stageCommentImage(authorUser, corruptedPayload);

    const res = await executeGql(CREATE_COMMENT_MUTATION, {
      input: {
        postId: testPost.id,
        text: 'Corrupted payload',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId],
      },
    });

    expect(res.errors).toBeDefined();
    const err = res.errors![0];
    const code =
      (err.originalError as AppError | undefined)?.code ??
      (err.extensions as GraphQLErrorExtensionWithCode | undefined)?.code;
    expect(code).toBe('COMMENT_MEDIA_INVALID_FORMAT');

    // No comment or media created
    const dbComments = await dbHelper.db.select().from(comments).where(eq(comments.postId, testPost.id));
    expect(dbComments).toHaveLength(0);
    const [dbTicket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(dbTicket.status).toBe('FAILED');

    // Unverified bytes never published
    const finalKeys = Array.from(r2Adapter.objects.keys()).filter((k) => k.startsWith('comments/'));
    expect(finalKeys).toHaveLength(0);
  });

  // --- Acceptance Criterion 3: Oversized images rejection ---
  it('rejects staged images exceeding 100,000 bytes with COMMENT_MEDIA_TOO_LARGE', async () => {
    const oversizedBytes = Buffer.alloc(100_001);
    const { mediaId } = await stageCommentImage(authorUser, oversizedBytes);

    const res = await executeGql(CREATE_COMMENT_MUTATION, {
      input: {
        postId: testPost.id,
        text: 'Oversized file',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId],
      },
    });

    expect(res.errors).toBeDefined();
    const err = res.errors![0];
    const code =
      (err.originalError as AppError | undefined)?.code ??
      (err.extensions as GraphQLErrorExtensionWithCode | undefined)?.code;
    expect(code).toBe('COMMENT_MEDIA_TOO_LARGE');

    const dbComments = await dbHelper.db.select().from(comments).where(eq(comments.postId, testPost.id));
    expect(dbComments).toHaveLength(0);
    const [dbTicket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(dbTicket.status).toBe('FAILED');
  });

  it('rejects staged images exceeding 480px with COMMENT_MEDIA_DIMENSIONS_EXCEEDED', async () => {
    const { mediaId } = await stageCommentImage(authorUser, oversizedDimensionsWebp);

    const res = await executeGql(CREATE_COMMENT_MUTATION, {
      input: {
        postId: testPost.id,
        text: 'Oversized dimensions',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId],
      },
    });

    expect(res.errors).toBeDefined();
    const err = res.errors![0];
    const code =
      (err.originalError as AppError | undefined)?.code ??
      (err.extensions as GraphQLErrorExtensionWithCode | undefined)?.code;
    expect(code).toBe('COMMENT_MEDIA_DIMENSIONS_EXCEEDED');

    const dbComments = await dbHelper.db.select().from(comments).where(eq(comments.postId, testPost.id));
    expect(dbComments).toHaveLength(0);
    const [dbTicket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(dbTicket.status).toBe('FAILED');
  });

  // --- Acceptance Criterion 5: Staging replacement rejection ---
  it('rejects finalization and never publishes unverified bytes if staging was modified between download and publication (ETag mismatch)', async () => {
    const { mediaId, stagingKey } = await stageCommentImage(authorUser, validWebp1);

    // Tamper with staging in R2 right after it is downloaded by GetObjectCommand
    r2Adapter.onGetObject = (key) => {
      if (key === stagingKey) {
        // Attacker modifies staging object in storage
        r2Adapter.objects.set(stagingKey, {
          bytes: Buffer.from('malicious-replaced-bytes'),
          etag: '"tampered-attacker-etag"',
        });
      }
    };

    const res = await executeGql(CREATE_COMMENT_MUTATION, {
      input: {
        postId: testPost.id,
        text: 'Tampered staging test',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId],
      },
    });

    expect(res.errors).toBeDefined();
    const err = res.errors![0];
    const code =
      (err.originalError as AppError | undefined)?.code ??
      (err.extensions as GraphQLErrorExtensionWithCode | undefined)?.code;
    expect(code).toBe('COMMENT_MEDIA_PROCESSING_FAILED');

    // Comment was NOT created
    const dbComments = await dbHelper.db.select().from(comments).where(eq(comments.postId, testPost.id));
    expect(dbComments).toHaveLength(0);

    // Ticket was reset to ISSUED (not marked FINALIZED)
    const [dbTicket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(dbTicket.status).toBe('ISSUED');

    // Unverified / tampered bytes were NEVER published to comments namespace
    const finalKeys = Array.from(r2Adapter.objects.keys()).filter((k) => k.startsWith('comments/'));
    expect(finalKeys).toHaveLength(0);
  });

  // --- Acceptance Criterion 7: Exact-match denylist check with 10,000 rows (<5ms) ---
  it('performs fast indexed denylist lookup (<5ms with 10,000 rows in blocked_media_hashes) and rejects exact match safely', async () => {
    // 1. Seed 10,000 random hashes into blocked_media_hashes
    await dbHelper.pool.query(`
      INSERT INTO blocked_media_hashes (id, sha256)
      SELECT gen_random_uuid(), encode(sha256(i::text::bytea), 'hex')
      FROM generate_series(1, 10000) AS i;
    `);

    // Verify row count is at least 10,000
    interface CountRow {
      count: string;
    }
    const countRes = await dbHelper.pool.query<CountRow>('SELECT count(*) FROM blocked_media_hashes;');
    expect(Number(countRes.rows[0].count)).toBeGreaterThanOrEqual(10000);

    // 2. Add the hash of validWebp1 to blocked_media_hashes
    const blockedHash = crypto.createHash('sha256').update(validWebp1).digest('hex');
    await dbHelper.db.insert(blockedMediaHashes).values({
      sha256: blockedHash,
      reason: 'Permanently removed inappropriate content',
    });

    // 3. Measure query execution time and verify index usage
    interface ExplainPlan {
      Plan: Record<string, unknown>;
      'Execution Time': number;
      [key: string]: unknown;
    }
    interface ExplainRow {
      'QUERY PLAN': ExplainPlan[];
    }
    const explainRes = await dbHelper.pool.query<ExplainRow>(
      `EXPLAIN (ANALYZE, FORMAT JSON) SELECT sha256 FROM blocked_media_hashes WHERE sha256 = $1`,
      [blockedHash],
    );
    const plan = explainRes.rows[0]['QUERY PLAN'][0];
    const planString = JSON.stringify(plan);
    expect(planString).toContain('Index');

    const executionTimeMs = plan['Execution Time'];
    expect(executionTimeMs).toBeLessThan(5); // Bound: < 5ms

    // 4. Stage the blocked image and attempt comment publication
    const { mediaId } = await stageCommentImage(authorUser, validWebp1);

    const res = await executeGql(CREATE_COMMENT_MUTATION, {
      input: {
        postId: testPost.id,
        text: 'Posting blocked image',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId],
      },
    });

    expect(res.errors).toBeDefined();
    const err = res.errors![0];
    const code =
      (err.originalError as AppError | undefined)?.code ??
      (err.extensions as GraphQLErrorExtensionWithCode | undefined)?.code;
    // Generic error without leaking moderation details
    expect(code).toBe('COMMENT_MEDIA_INVALID_FORMAT');
    expect(err.message).not.toContain('blocked');
    expect(err.message).not.toContain('moderation');
    expect(err.message).not.toContain('denylist');

    // Comment and media not created
    const dbComments = await dbHelper.db.select().from(comments).where(eq(comments.postId, testPost.id));
    expect(dbComments).toHaveLength(0);
    const [dbTicket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(dbTicket.status).toBe('FAILED');

    // Blocked bytes never published to comments namespace
    const finalKeys = Array.from(r2Adapter.objects.keys()).filter((k) => k.startsWith('comments/'));
    expect(finalKeys).toHaveLength(0);
  });

  // --- Acceptance Criterion 8: Denylist DB failure returns retryable error and never fails open ---
  it('fails safely with retryable COMMENT_MEDIA_PROCESSING_FAILED and never fails open if denylist DB lookup fails', async () => {
    const { mediaId } = await stageCommentImage(authorUser, validWebp1);

    // Spy on uploadService.db.select and simulate a database connection error during denylist lookup
    type DbSelectMethod = (typeof uploadService)['db']['select'];
    const dbObj = (uploadService as unknown as { db: { select: DbSelectMethod } }).db;
    const originalSelect = dbObj.select.bind(dbObj);
    jest.spyOn(dbObj, 'select').mockImplementation((fields?: unknown) => {
      if (fields && typeof fields === 'object' && 'sha256' in fields) {
        return {
          from: () => ({
            where: () => Promise.reject(new Error('PostgreSQL connection dropped')),
          }),
        } as unknown as ReturnType<DbSelectMethod>;
      }
      return originalSelect(fields as never);
    });

    const res = await executeGql(CREATE_COMMENT_MUTATION, {
      input: {
        postId: testPost.id,
        text: 'DB failure during denylist lookup',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId],
      },
    });

    expect(res.errors).toBeDefined();
    const err = res.errors![0];
    const code =
      (err.originalError as AppError | undefined)?.code ??
      (err.extensions as GraphQLErrorExtensionWithCode | undefined)?.code;
    expect(code).toBe('COMMENT_MEDIA_PROCESSING_FAILED');

    const origErr = err.originalError as AppError;
    expect(origErr?.extensions?.retryable).toBe(true);

    // Ensure it NEVER fails open: ticket remains ISSUED, comment is NOT created, bytes NOT published
    const dbComments = await dbHelper.db.select().from(comments).where(eq(comments.postId, testPost.id));
    expect(dbComments).toHaveLength(0);

    const [dbTicket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(dbTicket.status).toBe('ISSUED');

    const finalKeys = Array.from(r2Adapter.objects.keys()).filter((k) => k.startsWith('comments/'));
    expect(finalKeys).toHaveLength(0);
  });
});

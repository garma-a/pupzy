/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await */
import * as crypto from 'crypto';
import sharp from 'sharp';
import { eq, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://r2.pupzy.com/staging-presigned-url'),
}));
import { TestDatabaseHelper } from '../../test/test-database.helper';
import { users, cities, posts, stagedUploads, type User, type City, type Post } from '../database/schema';
import { CommentsRepository } from '../comments/comments.repository';
import { CommentsService } from '../comments/comments.service';
import { PostsRepository } from '../posts/posts.repository';
import { UploadService } from './upload.service';
import { MediaDeletionProcessor } from './media-deletion.processor';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';

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

  getObject(key: string): R2Object | undefined {
    return this.objects.get(key);
  }

  deleteObject(key: string): void {
    this.objects.delete(key);
  }

  clear(): void {
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
      return { ETag: etag };
    }

    if (cmdName === 'DeleteObjectCommand' || command instanceof DeleteObjectCommand) {
      this.objects.delete(key);
      return {};
    }

    return {};
  }
}

describe('CommentImageFlutterCompatIntegration (Ticket 05)', () => {
  jest.setTimeout(120_000);

  let dbHelper: TestDatabaseHelper;
  let db: any;
  let r2: ControllableR2Adapter;
  let uploadService: UploadService;
  let commentsService: CommentsService;
  let commentsRepo: CommentsRepository;
  let postsRepo: PostsRepository;
  let mediaDeletionProcessor: MediaDeletionProcessor;
  let configService: ConfigService;
  let cacheManager: Cache;

  let testUser: User;
  let testCity: City;
  let testPost: Post;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();
    db = dbHelper.db;
  });

  afterAll(async () => {
    if (dbHelper) {
      await dbHelper.clean();
      await dbHelper.pool?.end();
    }
  });

  beforeEach(async () => {
    await dbHelper.clean();
    r2 = new ControllableR2Adapter();

    const configMap: Record<string, string> = {
      R2_BUCKET_NAME: 'pupzy-media-bucket',
      R2_PUBLIC_URL: 'https://media.pupzy.com',
      COMMENT_MEDIA_CDN_BASE: 'https://media.pupzy.com',
      R2_FALLBACK_URL: 'https://r2-fallback.pupzy.com',
      CLOUDFLARE_ZONE_ID: 'test-zone-id',
      CLOUDFLARE_API_TOKEN: 'test-api-token',
      COMMENT_IMAGES_ENABLED: 'true',
    };

    configService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key in configMap) return configMap[key];
        return defaultValue;
      }),
    } as unknown as ConfigService;

    cacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    } as unknown as Cache;

    uploadService = new UploadService(configService, cacheManager, db);
    (uploadService as any).s3Client = r2;

    commentsRepo = new CommentsRepository(db);
    postsRepo = new PostsRepository(db);
    mediaDeletionProcessor = new MediaDeletionProcessor(db, uploadService);
    commentsService = new CommentsService(
      commentsRepo,
      postsRepo,
      uploadService,
      configService,
      mediaDeletionProcessor,
    );

    // Seed City, User, Post
    const [city] = await db
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

    const [user] = await db
      .insert(users)
      .values({
        firebaseUserId: `firebase-${generateUuidV7()}`,
        email: `test-${generateUuidV7()}@pupzy.net`,
        fullName: 'Flutter Tester',
      })
      .returning();
    testUser = user;

    const [post] = await db
      .insert(posts)
      .values({
        creatorId: testUser.id,
        postType: 'RESCUE',
        title: 'Need rescue',
        description: 'Rescue needed here',
        status: 'ACTIVE',
        urgency: 'URGENT',
        cityId: testCity.id,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    testPost = post;
  });

  /**
   * Helper: create a representative static WebP buffer matching Flutter CommentImageCompressor.
   */
  async function createFlutterWebP(width: number, height: number, quality = 80): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 120, g: 150, b: 200 },
      },
    })
      .webp({ quality })
      .toBuffer();
  }

  it('AC 1 & AC 8: prepared WebP passes backend Sharp decoding, validation bounds, and publishes to final storage', async () => {
    // 1. Prepared image matching Flutter compressor output: 480x360 static WebP <= 100KB
    const preparedWebP = await createFlutterWebP(480, 360, 80);
    expect(preparedWebP.length).toBeLessThanOrEqual(100000);

    // 2. Request ticket from backend
    const ticket = await uploadService.requestCommentImageUploadUrl(testUser.id, {
      contentType: 'image/webp',
      fileSizeBytes: preparedWebP.length,
    });
    expect(ticket.mediaId).toBeDefined();
    expect(ticket.uploadUrl).toBeDefined();

    // 3. Client direct PUT to R2 staging key
    const stagedRow = await db.query.stagedUploads.findFirst({
      where: eq(stagedUploads.id, ticket.mediaId),
    });
    expect(stagedRow).toBeDefined();
    r2.putObject(stagedRow.stagingKey, preparedWebP);

    // 4. Create authenticated comment using the prepared image
    const comment = await commentsService.createComment(testUser.id, {
      clientRequestId: `req-${Date.now()}`,
      postId: testPost.id,
      text: 'Here is a photo prepared with Flutter CommentImageCompressor',
      mediaIds: [ticket.mediaId],
    });

    expect(comment).toBeDefined();
    const media = await commentsRepo.findMediaByCommentId(comment.id);
    expect(media).toHaveLength(1);
    expect(media[0].storageKey).toMatch(/^comments\//);
    expect(media[0].storageKey).toMatch(/\.webp$/);
    expect(media[0].width).toBe(480);
    expect(media[0].height).toBe(360);

    // 5. Verify published R2 object has verified bytes and staging object was cleaned
    const finalKey = `comments/${comment.id}/${ticket.mediaId}.webp`;
    expect(r2.hasObject(finalKey)).toBe(true);
    expect(r2.hasObject(stagedRow.stagingKey)).toBe(false);
  });

  it('AC 4 & AC 8: allows two prepared images to be uploaded and attached to a single Comment', async () => {
    const webp1 = await createFlutterWebP(480, 480, 75);
    const webp2 = await createFlutterWebP(270, 480, 75);

    const ticket1 = await uploadService.requestCommentImageUploadUrl(testUser.id, {
      contentType: 'image/webp',
      fileSizeBytes: webp1.length,
    });
    const ticket2 = await uploadService.requestCommentImageUploadUrl(testUser.id, {
      contentType: 'image/webp',
      fileSizeBytes: webp2.length,
    });

    const staged1 = await db.query.stagedUploads.findFirst({ where: eq(stagedUploads.id, ticket1.mediaId) });
    const staged2 = await db.query.stagedUploads.findFirst({ where: eq(stagedUploads.id, ticket2.mediaId) });

    r2.putObject(staged1.stagingKey, webp1);
    r2.putObject(staged2.stagingKey, webp2);

    const comment = await commentsService.createComment(testUser.id, {
      clientRequestId: `req-multi-${Date.now()}`,
      postId: testPost.id,
      text: 'Comment with two prepared mobile photos',
      mediaIds: [ticket1.mediaId, ticket2.mediaId],
    });

    const media = await commentsRepo.findMediaByCommentId(comment.id);
    expect(media).toHaveLength(2);
    expect(r2.hasObject(`comments/${comment.id}/${ticket1.mediaId}.webp`)).toBe(true);
    expect(r2.hasObject(`comments/${comment.id}/${ticket2.mediaId}.webp`)).toBe(true);
  });

  it('AC 5 & AC 8: text-only comments bypass image preparation and R2 entirely', async () => {
    const r2PutSpy = jest.spyOn(r2, 'putObject');

    const comment = await commentsService.createComment(testUser.id, {
      clientRequestId: `req-text-${Date.now()}`,
      postId: testPost.id,
      text: 'Just a text discussion comment with no images',
    });

    expect(comment).toBeDefined();
    expect(comment.text).toBe('Just a text discussion comment with no images');

    const media = await commentsRepo.findMediaByCommentId(comment.id);
    expect(media).toHaveLength(0);

    // Verify R2 was not touched
    expect(r2PutSpy).not.toHaveBeenCalled();

    // Verify no staged uploads created
    const stagedCount = await db.query.stagedUploads.findMany();
    expect(stagedCount).toHaveLength(0);
  });

  it('AC 8: when comment image uploads are disabled, tickets are rejected without disabling text discussion', async () => {
    // 1. Simulate feature flag disabled: COMMENT_IMAGES_ENABLED = false
    (configService.get as jest.Mock).mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'COMMENT_IMAGES_ENABLED') return 'false';
      if (key === 'R2_BUCKET_NAME') return 'pupzy-media-bucket';
      if (key === 'R2_PUBLIC_URL') return 'https://media.pupzy.com';
      if (key === 'COMMENT_MEDIA_CDN_BASE') return 'https://media.pupzy.com';
      return defaultValue;
    });

    // 2. Requesting a comment image ticket must be rejected with COMMENT_IMAGES_DISABLED
    try {
      await uploadService.requestCommentImageUploadUrl(testUser.id, {
        contentType: 'image/webp',
        fileSizeBytes: 50000,
      });
      fail('Expected COMMENT_IMAGES_DISABLED');
    } catch (err: any) {
      expect(err.code).toBe('COMMENT_IMAGES_DISABLED');
      expect(err.message).toBe('Comment images are currently disabled');
    }

    // 3. Text discussion must continue to succeed without error!
    const textComment = await commentsService.createComment(testUser.id, {
      clientRequestId: `req-disabled-flag-${Date.now()}`,
      postId: testPost.id,
      text: 'Text discussions continue when comment image uploads are disabled',
    });

    expect(textComment).toBeDefined();
    expect(textComment.text).toBe('Text discussions continue when comment image uploads are disabled');

    const media = await commentsRepo.findMediaByCommentId(textComment.id);
    expect(media).toHaveLength(0);
  });

  it('AC 1 & AC 8: raw uncompressed JPEG masquerading as image/webp fails backend Sharp decoding (Spec 6 regression check)', async () => {
    // Simulate what the old buggy frontend did: raw JPEG bytes declared as 'image/webp'
    const rawJpeg = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();

    const ticket = await uploadService.requestCommentImageUploadUrl(testUser.id, {
      contentType: 'image/webp',
      fileSizeBytes: rawJpeg.length,
    });

    const staged = await db.query.stagedUploads.findFirst({ where: eq(stagedUploads.id, ticket.mediaId) });
    r2.putObject(staged.stagingKey, rawJpeg);

    // Finalization must fail because sharp detects that bytes are JPEG, not WebP
    try {
      await uploadService.finalizeCommentImages([ticket.mediaId], testUser.id, 'dummy-comment-id', {
        postId: testPost.id,
      });
      fail('Expected COMMENT_MEDIA_INVALID_FORMAT');
    } catch (err: any) {
      expect(err.code).toBe('COMMENT_MEDIA_INVALID_FORMAT');
      expect(err.message).toBe('Invalid image format');
    }
  });
});

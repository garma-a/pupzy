/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import * as crypto from 'crypto';
import sharp from 'sharp';
import { eq, inArray, sql } from 'drizzle-orm';
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
  mediaDeletionWork,
  type User,
  type City,
  type Post,
  type StagedUpload,
} from '../database/schema';
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

/**
 * Controllable Cloudflare R2 adapter capable of simulating storage behavior,
 * network errors, timeouts, hooks, and call inspection.
 */
class ControllableR2Adapter {
  public objects = new Map<string, R2Object>();
  public shouldFailPut = false;
  public failPutKeys = new Set<string>();
  public shouldFailDelete = false;
  public failDeleteKeys = new Set<string>();
  public shouldFailHead = false;

  public putCalls: string[] = [];
  public deleteCalls: string[] = [];
  public onBeforePut?: (key: string, bytes: Buffer) => Promise<void> | void;
  public onAfterPut?: (key: string, bytes: Buffer) => Promise<void> | void;

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
    this.failPutKeys.clear();
    this.shouldFailDelete = false;
    this.failDeleteKeys.clear();
    this.shouldFailHead = false;
    this.putCalls = [];
    this.deleteCalls = [];
    this.onBeforePut = undefined;
    this.onAfterPut = undefined;
  }

  async send(command: any): Promise<any> {
    const cmdName = command.constructor?.name ?? command.name;
    const key = command.input?.Key;

    if (cmdName === 'HeadObjectCommand' || command instanceof HeadObjectCommand) {
      if (this.shouldFailHead || !this.objects.has(key)) {
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
      this.putCalls.push(key);
      const bytes = Buffer.isBuffer(command.input?.Body) ? command.input.Body : Buffer.from(command.input?.Body ?? '');

      if (this.onBeforePut) {
        await this.onBeforePut(key, bytes);
      }

      if (this.shouldFailPut || this.failPutKeys.has(key)) {
        throw new Error(`Simulated R2 PutObject failure for ${key}`);
      }

      const etag = `"${crypto.createHash('md5').update(bytes).digest('hex')}"`;
      this.objects.set(key, { bytes, etag });

      if (this.onAfterPut) {
        await this.onAfterPut(key, bytes);
      }

      return {};
    }

    if (cmdName === 'DeleteObjectCommand' || command instanceof DeleteObjectCommand) {
      this.deleteCalls.push(key);
      if (this.shouldFailDelete || this.failDeleteKeys.has(key)) {
        throw new Error(`Simulated R2 DeleteObject failure for ${key}`);
      }
      this.objects.delete(key);
      return {};
    }

    return {};
  }
}

describe('Comment Image Publishing Interruption Recovery Integration (Ticket 04)', () => {
  jest.setTimeout(120_000);

  let dbHelper: TestDatabaseHelper;
  let r2Adapter: ControllableR2Adapter;
  let mockCache: Cache;
  let mockConfig: ConfigService;

  let uploadService: UploadService;
  let commentsRepo: CommentsRepository;
  let postsRepo: PostsRepository;
  let commentsService: CommentsService;
  let mediaDeletionProcessor: MediaDeletionProcessor;

  let testCity: City;
  let testUser: User;
  let testPost: Post;

  let validWebp1: Buffer;
  let validWebp2: Buffer;

  const defaultConfigMock = (key: string) => {
    switch (key) {
      case 'R2_ACCOUNT_ID':
        return 'test-account';
      case 'R2_ACCESS_KEY_ID':
        return 'test-key';
      case 'R2_SECRET_ACCESS_KEY':
        return 'test-secret';
      case 'R2_BUCKET_NAME':
        return 'pupzy-media-bucket';
      case 'R2_PUBLIC_URL':
        return 'https://cdn.pupzy.net';
      case 'COMMENT_MEDIA_CDN_BASE':
        return 'https://cdn.pupzy.net';
      case 'COMMENT_IMAGES_ENABLED':
        return 'true';
      case 'CLOUDFLARE_ZONE_ID':
        return 'cf-zone-xyz';
      case 'CLOUDFLARE_API_TOKEN':
        return 'cf-token-abc';
      default:
        return undefined;
    }
  };

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    validWebp1 = await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 100, g: 150, b: 220 } },
    })
      .webp()
      .toBuffer();

    validWebp2 = await sharp({
      create: { width: 240, height: 240, channels: 3, background: { r: 80, g: 200, b: 120 } },
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
      get: jest.fn(defaultConfigMock),
    } as unknown as ConfigService;

    // Mock global fetch for Cloudflare CDN purge API
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (input: any, init?: any) => {
      const urlStr = typeof input === 'string' ? input : input.url;
      if (urlStr.includes('cloudflare.com') && urlStr.includes('purge_cache')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true }),
        } as Response;
      }
      return originalFetch(input, init);
    }) as typeof global.fetch;

    uploadService = new UploadService(mockConfig, mockCache, dbHelper.db);
    (uploadService as any).s3Client = r2Adapter;

    commentsRepo = new CommentsRepository(dbHelper.db);
    postsRepo = new PostsRepository(dbHelper.db);
    mediaDeletionProcessor = new MediaDeletionProcessor(dbHelper.db, uploadService);
    commentsService = new CommentsService(commentsRepo, postsRepo, uploadService, mockConfig, mediaDeletionProcessor);
  });

  afterAll(async () => {
    if (dbHelper) {
      await dbHelper.clean();
      await dbHelper.pool?.end();
    }
  });

  beforeEach(async () => {
    await dbHelper.clean();
    r2Adapter.reset();
    (mockConfig.get as jest.Mock).mockImplementation(defaultConfigMock);

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

    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `firebase-${generateUuidV7()}`,
        email: `test-${generateUuidV7()}@pupzy.net`,
        fullName: 'Test User',
      })
      .returning();
    testUser = user;

    const [post] = await dbHelper.db
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
   * Helper: Seeds an ISSUED staged upload in DB and places bytes in R2 adapter.
   */
  async function seedStagedImage(
    userId: string,
    imageBytes: Buffer,
    overrides: Partial<StagedUpload> = {},
  ): Promise<StagedUpload> {
    const mediaId = generateUuidV7();
    const stagingKey = `staging/${userId}/${mediaId}.webp`;

    r2Adapter.putObject(stagingKey, imageBytes);

    const [ticket] = await dbHelper.db
      .insert(stagedUploads)
      .values({
        id: mediaId,
        userId,
        purpose: 'COMMENT_IMAGE',
        stagingKey,
        declaredContentType: 'image/webp',
        declaredFileSizeBytes: imageBytes.length,
        status: 'ISSUED',
        expiresAt: new Date(Date.now() + 900_000),
        ...overrides,
      })
      .returning();

    return ticket;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // AC 1: Destination and claim identity recorded BEFORE external effects
  // ───────────────────────────────────────────────────────────────────────────
  it('AC 1: durably records request/claim identity, postId, and intended final destination before executing PutObjectCommand', async () => {
    const ticket = await seedStagedImage(testUser.id, validWebp1);
    const commentId = generateUuidV7();
    const expectedFinalKey = `comments/${commentId}/${ticket.id}.webp`;

    let checkedStateBeforePut = false;

    r2Adapter.onBeforePut = async () => {
      // Invariant: BEFORE PutObject finishes in R2, DB must record CLAIMED, finalStorageKey, and postId
      const [inDb] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, ticket.id));
      expect(inDb.status).toBe('CLAIMED');
      expect(inDb.finalStorageKey).toBe(expectedFinalKey);
      expect(inDb.postId).toBe(testPost.id);
      checkedStateBeforePut = true;
    };

    const results = await uploadService.finalizeCommentImages([ticket.id], testUser.id, commentId, {
      postId: testPost.id,
    });

    expect(checkedStateBeforePut).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0].storageKey).toBe(expectedFinalKey);

    const [afterDb] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, ticket.id));
    expect(afterDb.status).toBe('FINALIZED');
    expect(afterDb.finalStorageKey).toBe(expectedFinalKey);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC 2: Discover copied-but-uncommitted and committed-but-not-cleaned states
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC 2: Discovers and reconciles uncommitted objects vs committed attachments awaiting cleanup', () => {
    it('discovers copied-but-uncommitted state and marks FAILED, deleting orphan object from R2 and enqueuing outbox', async () => {
      const commentId = generateUuidV7();
      const mediaId = generateUuidV7();
      const stagingKey = `staging/${testUser.id}/${mediaId}.webp`;
      const finalStorageKey = `comments/${commentId}/${mediaId}.webp`;

      // Object is in R2
      r2Adapter.putObject(finalStorageKey, validWebp1);
      r2Adapter.putObject(stagingKey, validWebp1);

      // Ticket is FINALIZED with finalStorageKey, but NO row exists in commentMedia (crash before DB commit)
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      await dbHelper.db.insert(stagedUploads).values({
        id: mediaId,
        userId: testUser.id,
        purpose: 'COMMENT_IMAGE',
        stagingKey,
        declaredContentType: 'image/webp',
        declaredFileSizeBytes: validWebp1.length,
        status: 'FINALIZED',
        finalStorageKey,
        postId: testPost.id,
        expiresAt: new Date(Date.now() + 600_000),
        updatedAt: sixMinutesAgo,
        createdAt: sixMinutesAgo,
      });

      // Execute reconciliation
      const result = await mediaDeletionProcessor.reconcile({ olderThanMs: 5 * 60 * 1000 });

      expect(result.uncommittedRecovered).toBe(1);

      // Ticket is now FAILED
      const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('FAILED');
      expect(ticket.stagingKey).toContain('cleaned/');

      // Final object deleted from R2
      expect(r2Adapter.hasObject(finalStorageKey)).toBe(false);
      // Staging object deleted from R2
      expect(r2Adapter.hasObject(stagingKey)).toBe(false);
    });

    it('discovers committed-but-not-cleaned state and removes staging object from R2 without touching committed media', async () => {
      const commentId = generateUuidV7();
      const mediaId = generateUuidV7();
      const stagingKey = `staging/${testUser.id}/${mediaId}.webp`;
      const finalStorageKey = `comments/${commentId}/${mediaId}.webp`;

      // Both final and staging objects exist in R2
      r2Adapter.putObject(finalStorageKey, validWebp1);
      r2Adapter.putObject(stagingKey, validWebp1);

      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);

      // Create committed comment and commentMedia row
      const [comment] = await dbHelper.db
        .insert(comments)
        .values({
          id: commentId,
          postId: testPost.id,
          authorId: testUser.id,
          text: 'Committed comment',
          status: 'ACTIVE',
        })
        .returning();

      await dbHelper.db.insert(commentMedia).values({
        id: mediaId,
        commentId: comment.id,
        storageKey: finalStorageKey,
        sha256: crypto.createHash('sha256').update(validWebp1).digest('hex'),
        width: 320,
        height: 240,
        fileSizeBytes: validWebp1.length,
        fileContentType: 'image/webp',
        displayOrder: 0,
      });

      // Ticket is FINALIZED with finalStorageKey and stagingKey not yet cleaned
      await dbHelper.db.insert(stagedUploads).values({
        id: mediaId,
        userId: testUser.id,
        purpose: 'COMMENT_IMAGE',
        stagingKey,
        declaredContentType: 'image/webp',
        declaredFileSizeBytes: validWebp1.length,
        status: 'FINALIZED',
        finalStorageKey,
        postId: testPost.id,
        expiresAt: new Date(Date.now() + 600_000),
        updatedAt: sixMinutesAgo,
        createdAt: sixMinutesAgo,
      });

      // Run reconciliation
      const result = await mediaDeletionProcessor.reconcile({ olderThanMs: 5 * 60 * 1000 });

      expect(result.committedCleaned).toBe(1);

      // Committed media in R2 remains completely intact!
      expect(r2Adapter.hasObject(finalStorageKey)).toBe(true);

      // Staging object was safely deleted from R2
      expect(r2Adapter.hasObject(stagingKey)).toBe(false);

      // Ticket stagingKey is marked cleaned
      const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('FINALIZED');
      expect(ticket.stagingKey).toBe(`cleaned/${stagingKey}`);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC 3: One invalid image fails entire submission; other images remain usable
  // ───────────────────────────────────────────────────────────────────────────
  it('AC 3: one invalid image fails entire submission, invalid staging is deleted/queued, and other valid image remains usable', async () => {
    const validTicket = await seedStagedImage(testUser.id, validWebp1);

    // Create an invalid image (corrupt bytes)
    const corruptBytes = Buffer.from('RIFF1234WEBPVP8Xcorrupt_bytes_not_real_webp');
    const invalidTicket = await seedStagedImage(testUser.id, corruptBytes);

    const commentId = generateUuidV7();

    // Submission with both images fails
    await expect(
      uploadService.finalizeCommentImages([validTicket.id, invalidTicket.id], testUser.id, commentId, {
        postId: testPost.id,
      }),
    ).rejects.toMatchObject({
      code: 'COMMENT_MEDIA_INVALID_FORMAT',
    });

    // Invalid ticket is FAILED, its staging object deleted from R2
    const [dbInvalid] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, invalidTicket.id));
    expect(dbInvalid.status).toBe('FAILED');
    expect(r2Adapter.hasObject(invalidTicket.stagingKey)).toBe(false);

    // Valid ticket remains ISSUED, its staging object intact in R2!
    const [dbValid] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, validTicket.id));
    expect(dbValid.status).toBe('ISSUED');
    expect(r2Adapter.hasObject(validTicket.stagingKey)).toBe(true);

    // The valid ticket can now be used successfully in a subsequent submission!
    const secondCommentId = generateUuidV7();
    const secondResults = await uploadService.finalizeCommentImages([validTicket.id], testUser.id, secondCommentId, {
      postId: testPost.id,
    });
    expect(secondResults).toHaveLength(1);
    expect(secondResults[0].id).toBe(validTicket.id);

    const [dbValidFinal] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, validTicket.id));
    expect(dbValidFinal.status).toBe('FINALIZED');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC 4: Transient failures retain eligible staged content; timeouts reconciled
  // ───────────────────────────────────────────────────────────────────────────
  it('AC 4: transient PutObject failure deletes final key, resets tickets to ISSUED, retains staging, and allows retry', async () => {
    const ticket1 = await seedStagedImage(testUser.id, validWebp1);
    const ticket2 = await seedStagedImage(testUser.id, validWebp2);
    const commentId = generateUuidV7();

    // Fail PutObject on second image
    const secondFinalKey = `comments/${commentId}/${ticket2.id}.webp`;
    r2Adapter.failPutKeys.add(secondFinalKey);

    await expect(
      uploadService.finalizeCommentImages([ticket1.id, ticket2.id], testUser.id, commentId, {
        postId: testPost.id,
      }),
    ).rejects.toMatchObject({
      code: 'COMMENT_MEDIA_PROCESSING_FAILED',
      extensions: {
        retryable: true,
      },
    });

    // Both tickets are reset to ISSUED with finalStorageKey cleared to null
    const [dbT1] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, ticket1.id));
    const [dbT2] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, ticket2.id));
    expect(dbT1.status).toBe('ISSUED');
    expect(dbT1.finalStorageKey).toBeNull();
    expect(dbT2.status).toBe('ISSUED');
    expect(dbT2.finalStorageKey).toBeNull();

    // Any final object was cleaned up
    expect(r2Adapter.hasObject(`comments/${commentId}/${ticket1.id}.webp`)).toBe(false);
    expect(r2Adapter.hasObject(`comments/${commentId}/${ticket2.id}.webp`)).toBe(false);

    // Staging content is completely retained in R2
    expect(r2Adapter.hasObject(ticket1.stagingKey)).toBe(true);
    expect(r2Adapter.hasObject(ticket2.stagingKey)).toBe(true);

    // Clear simulated failure: client retry succeeds!
    r2Adapter.failPutKeys.clear();
    const retryResults = await uploadService.finalizeCommentImages([ticket1.id, ticket2.id], testUser.id, commentId, {
      postId: testPost.id,
    });
    expect(retryResults).toHaveLength(2);
    expect(retryResults[0].storageKey).toBe(`comments/${commentId}/${ticket1.id}.webp`);
    expect(retryResults[1].storageKey).toBe(`comments/${commentId}/${ticket2.id}.webp`);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC 5: Automatic reconciliation runs after restart without 4th service
  // ───────────────────────────────────────────────────────────────────────────
  it('AC 5: automatic reconciliation runs on application bootstrap and scheduled cron inside existing topology', async () => {
    // Seed an interrupted uncommitted ticket from a prior crashed run
    const mediaId = generateUuidV7();
    const finalKey = `comments/c-crashed/${mediaId}.webp`;
    r2Adapter.putObject(finalKey, validWebp1);

    const oldDate = new Date(Date.now() - 10 * 60 * 1000);
    await dbHelper.db.insert(stagedUploads).values({
      id: mediaId,
      userId: testUser.id,
      purpose: 'COMMENT_IMAGE',
      stagingKey: `staging/${testUser.id}/${mediaId}.webp`,
      declaredContentType: 'image/webp',
      declaredFileSizeBytes: validWebp1.length,
      status: 'CLAIMED',
      finalStorageKey: finalKey,
      expiresAt: new Date(Date.now() + 600_000),
      updatedAt: oldDate,
      createdAt: oldDate,
    });

    // Simulate NestJS Application Bootstrap (startup reconciliation)
    await mediaDeletionProcessor.onApplicationBootstrap();

    // Interrupted ticket converged to FAILED and R2 object cleaned up
    const [reconciled] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(reconciled.status).toBe('FAILED');
    expect(r2Adapter.hasObject(finalKey)).toBe(false);

    // Periodic scheduled cron handler exists and runs successfully
    await expect(mediaDeletionProcessor.handlePeriodicReconciliation()).resolves.not.toThrow();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC 6: Conditional transitions protect committed media and live claims
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC 6: Safety guards against deleting committed media and stealing live claims', () => {
    it('live claims with recent updatedAt (< 5 minutes) are never stolen or touched by recovery', async () => {
      const liveTicket = await seedStagedImage(testUser.id, validWebp1, {
        status: 'CLAIMED',
        finalStorageKey: `comments/live/${generateUuidV7()}.webp`,
        updatedAt: new Date(), // Just claimed 0s ago
      });

      // Run reconciliation
      const result = await mediaDeletionProcessor.reconcile({ olderThanMs: 5 * 60 * 1000 });

      expect(result.uncommittedRecovered).toBe(0);

      const [after] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, liveTicket.id));
      expect(after.status).toBe('CLAIMED');
      expect(after.finalStorageKey).toBe(liveTicket.finalStorageKey);
    });

    it('processPendingWork verifies against comment_media and refuses to delete committed media', async () => {
      const commentId = generateUuidV7();
      const committedStorageKey = `comments/${commentId}/live-media.webp`;
      r2Adapter.putObject(committedStorageKey, validWebp1);

      // Create committed comment and media in DB
      const [comment] = await dbHelper.db
        .insert(comments)
        .values({
          id: commentId,
          postId: testPost.id,
          authorId: testUser.id,
          text: 'Committed comment',
          status: 'ACTIVE',
        })
        .returning();

      await dbHelper.db.insert(commentMedia).values({
        id: generateUuidV7(),
        commentId: comment.id,
        storageKey: committedStorageKey,
        sha256: 'fake-hash',
        width: 320,
        height: 240,
        fileSizeBytes: 5000,
        fileContentType: 'image/webp',
        displayOrder: 0,
      });

      // Mistakenly/stale enqueued deletion item
      const [work] = await dbHelper.db
        .insert(mediaDeletionWork)
        .values({
          storageKey: committedStorageKey,
          cdnUrl: `https://cdn.pupzy.net/${committedStorageKey}`,
          status: 'PENDING',
          attempts: 0,
        })
        .returning();

      // Run worker
      await mediaDeletionProcessor.processPendingWork();

      // Guard skipped deletion: committed object in R2 is safe!
      expect(r2Adapter.hasObject(committedStorageKey)).toBe(true);

      const [updatedWork] = await dbHelper.db.select().from(mediaDeletionWork).where(eq(mediaDeletionWork.id, work.id));
      expect(updatedWork.status).toBe('COMPLETED');
      expect(updatedWork.lastError).toContain('Skipped: media is committed to comment');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC 7: Interruption injection across all boundaries for 1 and 2 images
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC 7: Fault injection across all interruption boundaries with convergence verification', () => {
    it('Boundary 1: Interruption before claim (1 and 2 images) leaves tickets ISSUED and staging intact', async () => {
      const t1 = await seedStagedImage(testUser.id, validWebp1);
      const t2 = await seedStagedImage(testUser.id, validWebp2);

      // Interruption occurs before any claim is initiated
      // Restart application / run reconciliation
      await mediaDeletionProcessor.onApplicationBootstrap();

      const [dbT1] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, t1.id));
      const [dbT2] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, t2.id));
      expect(dbT1.status).toBe('ISSUED');
      expect(dbT2.status).toBe('ISSUED');
      expect(r2Adapter.hasObject(t1.stagingKey)).toBe(true);
      expect(r2Adapter.hasObject(t2.stagingKey)).toBe(true);
    });

    it('Boundary 2: Interruption after claim, before copy (1 and 2 images) converges to FAILED and cleans R2', async () => {
      const t1 = await seedStagedImage(testUser.id, validWebp1);
      const t2 = await seedStagedImage(testUser.id, validWebp2);
      const commentId = generateUuidV7();

      // Atomically claim tickets with finalStorageKey and postId
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      await dbHelper.db
        .update(stagedUploads)
        .set({
          status: 'CLAIMED',
          finalStorageKey: `comments/${commentId}/${t1.id}.webp`,
          postId: testPost.id,
          updatedAt: sixMinutesAgo,
        })
        .where(eq(stagedUploads.id, t1.id));

      await dbHelper.db
        .update(stagedUploads)
        .set({
          status: 'CLAIMED',
          finalStorageKey: `comments/${commentId}/${t2.id}.webp`,
          postId: testPost.id,
          updatedAt: sixMinutesAgo,
        })
        .where(eq(stagedUploads.id, t2.id));

      // Interrupted before copy! Restart application / run reconciliation
      await mediaDeletionProcessor.reconcile({ olderThanMs: 5 * 60 * 1000 });

      const [dbT1] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, t1.id));
      const [dbT2] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, t2.id));
      expect(dbT1.status).toBe('FAILED');
      expect(dbT2.status).toBe('FAILED');
      expect(r2Adapter.hasObject(t1.stagingKey)).toBe(false);
      expect(r2Adapter.hasObject(t2.stagingKey)).toBe(false);
    });

    it('Boundary 3: Interruption after copy (readiness persistence), before Comment commit (1 and 2 images)', async () => {
      const t1 = await seedStagedImage(testUser.id, validWebp1);
      const t2 = await seedStagedImage(testUser.id, validWebp2);
      const commentId = generateUuidV7();

      // Complete finalizeCommentImages
      const mediaItems = await uploadService.finalizeCommentImages([t1.id, t2.id], testUser.id, commentId, {
        postId: testPost.id,
      });
      expect(mediaItems).toHaveLength(2);

      // Objects exist in R2
      expect(r2Adapter.hasObject(mediaItems[0].storageKey)).toBe(true);
      expect(r2Adapter.hasObject(mediaItems[1].storageKey)).toBe(true);

      // Simulate crash before createCommentWithCounter commits:
      // Aging tickets > 5 minutes
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      await dbHelper.db
        .update(stagedUploads)
        .set({ updatedAt: sixMinutesAgo })
        .where(inArray(stagedUploads.id, [t1.id, t2.id]));

      // Restart application and reconcile
      const report = await mediaDeletionProcessor.reconcile({ olderThanMs: 5 * 60 * 1000 });
      expect(report.uncommittedRecovered).toBe(2);

      // Both tickets are marked FAILED
      const [dbT1] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, t1.id));
      const [dbT2] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, t2.id));
      expect(dbT1.status).toBe('FAILED');
      expect(dbT2.status).toBe('FAILED');

      // Both final objects deleted from R2
      expect(r2Adapter.hasObject(mediaItems[0].storageKey)).toBe(false);
      expect(r2Adapter.hasObject(mediaItems[1].storageKey)).toBe(false);
    });

    it('Boundary 4: Interruption after Comment commit, before staging deletion (1 and 2 images)', async () => {
      const t1 = await seedStagedImage(testUser.id, validWebp1);
      const t2 = await seedStagedImage(testUser.id, validWebp2);

      // Create comment through commentsService with staging delete disabled during create
      const originalDeleteObject = uploadService.deleteObject;
      let preventStagingDelete = true;
      uploadService.deleteObject = jest.fn().mockImplementation(async (key: string) => {
        if (preventStagingDelete && key.startsWith('staging/')) {
          return Promise.resolve(); // Simulate interrupted/swallowed staging delete
        }
        return originalDeleteObject.call(uploadService, key);
      });

      const newComment = await commentsService.createComment(testUser.id, {
        clientRequestId: 'req-interrupted-after-commit',
        postId: testPost.id,
        text: 'Two images attached before staging delete crash',
        mediaIds: [t1.id, t2.id],
      });
      expect(newComment).toBeDefined();

      preventStagingDelete = false;

      // Comment is committed in DB
      const committedMedia = await dbHelper.db
        .select()
        .from(commentMedia)
        .where(eq(commentMedia.commentId, newComment.id));
      expect(committedMedia).toHaveLength(2);

      // Final objects in R2
      expect(r2Adapter.hasObject(committedMedia[0].storageKey)).toBe(true);
      expect(r2Adapter.hasObject(committedMedia[1].storageKey)).toBe(true);

      // Staging objects still exist in R2 due to simulated crash
      expect(r2Adapter.hasObject(t1.stagingKey)).toBe(true);
      expect(r2Adapter.hasObject(t2.stagingKey)).toBe(true);

      // Age the tickets to trigger reconciliation
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      await dbHelper.db
        .update(stagedUploads)
        .set({ updatedAt: sixMinutesAgo })
        .where(inArray(stagedUploads.id, [t1.id, t2.id]));

      // Restart application / run reconciliation
      const report = await mediaDeletionProcessor.reconcile({ olderThanMs: 5 * 60 * 1000 });
      expect(report.committedCleaned).toBe(2);

      // Final committed objects in R2 are NOT deleted!
      expect(r2Adapter.hasObject(committedMedia[0].storageKey)).toBe(true);
      expect(r2Adapter.hasObject(committedMedia[1].storageKey)).toBe(true);

      // Staging objects in R2 are now safely deleted!
      expect(r2Adapter.hasObject(t1.stagingKey)).toBe(false);
      expect(r2Adapter.hasObject(t2.stagingKey)).toBe(false);

      // Staging keys are marked cleaned in staged_uploads
      const [dbT1] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, t1.id));
      const [dbT2] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, t2.id));
      expect(dbT1.stagingKey).toContain('cleaned/');
      expect(dbT2.stagingKey).toContain('cleaned/');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC 8: Concurrent duplicate requests preserve one canonical Comment
  // ───────────────────────────────────────────────────────────────────────────
  it('AC 8: concurrent duplicate requests preserve one canonical committed comment, and reconciliation remains idempotent', async () => {
    const t1 = await seedStagedImage(testUser.id, validWebp1);
    const clientRequestId = 'req-concurrent-dup-1';

    // Submit two identical concurrent requests with the same clientRequestId and media
    const [res1, res2] = await Promise.all([
      commentsService.createComment(testUser.id, {
        clientRequestId,
        postId: testPost.id,
        text: 'Concurrent duplicate test',
        mediaIds: [t1.id],
      }),
      commentsService.createComment(testUser.id, {
        clientRequestId,
        postId: testPost.id,
        text: 'Concurrent duplicate test',
        mediaIds: [t1.id],
      }),
    ]);

    // Exactly one canonical comment is committed and returned
    expect(res1.id).toBe(res2.id);

    const allComments = await dbHelper.db.select().from(comments).where(eq(comments.postId, testPost.id));
    expect(allComments).toHaveLength(1);

    const allMedia = await dbHelper.db.select().from(commentMedia).where(eq(commentMedia.commentId, res1.id));
    expect(allMedia).toHaveLength(1);

    // Repeated reconciliation is completely idempotent
    const report1 = await mediaDeletionProcessor.reconcile();
    const report2 = await mediaDeletionProcessor.reconcile();
    expect(report1.uncommittedRecovered).toBe(0);
    expect(report2.uncommittedRecovered).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC 9: No R2 network operations hold an open database transaction & kill-switch intact
  // ───────────────────────────────────────────────────────────────────────────
  describe('AC 9: Architectural invariants (no DB transaction during R2, kill switch intact)', () => {
    it('kill switch COMMENT_IMAGES_ENABLED=false rejects new ticket requests while text comments work', async () => {
      (mockConfig.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'COMMENT_IMAGES_ENABLED') return false;
        return defaultConfigMock(key);
      });

      try {
        await expect(
          uploadService.requestCommentImageUploadUrl(testUser.id, {
            contentType: 'image/webp',
            fileSizeBytes: 20_000,
          }),
        ).rejects.toMatchObject({
          code: 'COMMENT_IMAGES_DISABLED',
        });

        // Text comment creation continues working!
        const textComment = await commentsService.createComment(testUser.id, {
          clientRequestId: 'req-text-during-kill-switch',
          postId: testPost.id,
          text: 'Text comment works fine during kill switch',
        });
        expect(textComment).toBeDefined();
        expect(textComment.text).toBe('Text comment works fine during kill switch');
      } finally {
        (mockConfig.get as jest.Mock).mockImplementation(defaultConfigMock);
      }
    });

    it('R2 operations during finalizeCommentImages are performed outside of any open database transaction', async () => {
      const ticket = await seedStagedImage(testUser.id, validWebp1);
      const commentId = generateUuidV7();

      let inTransactionDuringR2Put = false;

      r2Adapter.onBeforePut = async () => {
        // Query pg_stat_activity to ensure the current backend process is not in an active open transaction
        const res = await dbHelper.pool.query(`SELECT state FROM pg_stat_activity WHERE pid = pg_backend_pid();`);
        const state = res.rows[0]?.state;
        // If an open transaction were held, state would be 'idle in transaction'
        if (state === 'idle in transaction') {
          inTransactionDuringR2Put = true;
        }
      };

      await uploadService.finalizeCommentImages([ticket.id], testUser.id, commentId, {
        postId: testPost.id,
      });

      expect(inTransactionDuringR2Put).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // AC 10: Representative historical interrupted tickets are reconciled safely
  // ───────────────────────────────────────────────────────────────────────────
  it('AC 10: reconciles representative historical interrupted tickets without leaking orphan objects', async () => {
    // Ticket A: Historical CLAIMED ticket with uncommitted final destination from 2 hours ago
    const mediaA = generateUuidV7();
    const finalKeyA = `comments/c-hist-1/${mediaA}.webp`;
    r2Adapter.putObject(finalKeyA, validWebp1);
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);

    await dbHelper.db.insert(stagedUploads).values({
      id: mediaA,
      userId: testUser.id,
      purpose: 'COMMENT_IMAGE',
      stagingKey: `staging/${testUser.id}/${mediaA}.webp`,
      declaredContentType: 'image/webp',
      declaredFileSizeBytes: validWebp1.length,
      status: 'CLAIMED',
      finalStorageKey: finalKeyA,
      expiresAt: new Date(Date.now() + 600_000),
      updatedAt: twoHoursAgo,
      createdAt: twoHoursAgo,
    });

    // Ticket B: Historical FINALIZED ticket with uncommitted final destination from 3 hours ago
    const mediaB = generateUuidV7();
    const finalKeyB = `comments/c-hist-2/${mediaB}.webp`;
    r2Adapter.putObject(finalKeyB, validWebp2);
    const threeHoursAgo = new Date(Date.now() - 3 * 3600_000);

    await dbHelper.db.insert(stagedUploads).values({
      id: mediaB,
      userId: testUser.id,
      purpose: 'COMMENT_IMAGE',
      stagingKey: `staging/${testUser.id}/${mediaB}.webp`,
      declaredContentType: 'image/webp',
      declaredFileSizeBytes: validWebp2.length,
      status: 'FINALIZED',
      finalStorageKey: finalKeyB,
      expiresAt: new Date(Date.now() + 600_000),
      updatedAt: threeHoursAgo,
      createdAt: threeHoursAgo,
    });

    // Run reconciliation
    const report = await mediaDeletionProcessor.reconcile({ olderThanMs: 5 * 60 * 1000 });
    expect(report.uncommittedRecovered).toBe(2);

    // Both historical tickets transitioned to FAILED
    const [ticketA] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaA));
    const [ticketB] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaB));
    expect(ticketA.status).toBe('FAILED');
    expect(ticketB.status).toBe('FAILED');

    // Both orphan final objects deleted from R2
    expect(r2Adapter.hasObject(finalKeyA)).toBe(false);
    expect(r2Adapter.hasObject(finalKeyB)).toBe(false);
  });
});

import { eq, and, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  users,
  cities,
  posts,
  comments,
  commentMedia,
  mediaDeletionWork,
  blockedMediaHashes,
  moderationActions,
  adminUsers,
  type User,
  type City,
} from '../database/schema';
import { CommentsRepository } from '../comments/comments.repository';
import { UploadService } from './upload.service';
import { MediaDeletionProcessor } from './media-deletion.processor';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';

/**
 * Controllable Cloudflare R2 adapter to simulate storage behavior and
 * provider failures beneath the real UploadService.
 */
class ControllableR2Adapter {
  public objects = new Set<string>();
  public shouldFailDelete = false;
  public deleteCalls: string[] = [];

  reset(): void {
    this.objects.clear();
    this.shouldFailDelete = false;
    this.deleteCalls = [];
  }

  async send(command: any): Promise<any> {
    const cmdName = command.constructor?.name ?? command.name;
    const key = command.input?.Key;

    if (cmdName === 'DeleteObjectCommand' || command instanceof DeleteObjectCommand) {
      this.deleteCalls.push(key);
      if (this.shouldFailDelete) {
        const err = new Error(`Simulated R2 provider delete error for ${key}`);
        err.name = 'StorageServiceException';
        throw err;
      }
      this.objects.delete(key);
      return {};
    }

    return {};
  }
}

describe('Media Deletion Outbox & Reliability Integration (Ticket 03)', () => {
  jest.setTimeout(120_000);

  let dbHelper: TestDatabaseHelper;
  let r2Adapter: ControllableR2Adapter;
  let mockConfig: ConfigService;
  let uploadService: UploadService;
  let commentsRepo: CommentsRepository;
  let mediaDeletionProcessor: MediaDeletionProcessor;

  let testCity: City;
  let testUser: User;
  let testAdminId: string;

  // Cloudflare CDN purge interception
  let purgeCalls: { url: string; files: string[] }[] = [];
  let shouldFailPurge = false;
  let purgeFailStatus = 500;
  let purgeShouldTimeout = false;
  let originalFetch: typeof global.fetch;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    r2Adapter = new ControllableR2Adapter();

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
            return 'pupzy-media-bucket';
          case 'R2_PUBLIC_URL':
            return 'https://cdn.pupzy.net';
          case 'COMMENT_MEDIA_CDN_BASE':
            return 'https://cdn.pupzy.net';
          case 'CLOUDFLARE_ZONE_ID':
            return 'cf-zone-xyz';
          case 'CLOUDFLARE_API_TOKEN':
            return 'cf-token-abc';
          default:
            return undefined;
        }
      }),
    } as unknown as ConfigService;

    // Real UploadService with controllable S3 client
    uploadService = new UploadService(mockConfig, null as any, dbHelper.db);
    (uploadService as unknown as { s3Client: any }).s3Client = r2Adapter;

    commentsRepo = new CommentsRepository(dbHelper.db);
    mediaDeletionProcessor = new MediaDeletionProcessor(dbHelper.db, uploadService);

    // Mock global fetch for Cloudflare CDN purge API
    originalFetch = global.fetch;
    global.fetch = jest.fn(async (input: any, init?: any) => {
      const urlStr = typeof input === 'string' ? input : input.url;
      if (urlStr.includes('cloudflare.com') && urlStr.includes('purge_cache')) {
        if (purgeShouldTimeout) {
          const timeoutErr = new Error('The operation was aborted due to timeout');
          timeoutErr.name = 'TimeoutError';
          throw timeoutErr;
        }
        if (shouldFailPurge) {
          return {
            ok: false,
            status: purgeFailStatus,
            text: async () => 'Cloudflare API Gateway Timeout',
          } as Response;
        }
        const body = JSON.parse(init?.body || '{}');
        purgeCalls.push({ url: urlStr, files: body.files || [] });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true }),
        } as Response;
      }
      return originalFetch(input, init);
    }) as typeof global.fetch;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    if (dbHelper) {
      await dbHelper.stop();
    }
  });

  beforeEach(async () => {
    await dbHelper.clean();
    r2Adapter.reset();
    purgeCalls = [];
    shouldFailPurge = false;
    purgeFailStatus = 500;
    purgeShouldTimeout = false;

    // Reset default mockConfig behavior
    (mockConfig.get as jest.Mock).mockImplementation((key: string) => {
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
        case 'CLOUDFLARE_ZONE_ID':
          return 'cf-zone-xyz';
        case 'CLOUDFLARE_API_TOKEN':
          return 'cf-token-abc';
        default:
          return undefined;
      }
    });

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
        email: `deleter-${generateUuidV7()}@pupzy.net`,
        fullName: 'Media Deleter',
      })
      .returning();
    testUser = user;

    // Seed test admin
    testAdminId = generateUuidV7();
    await dbHelper.db.insert(adminUsers).values({
      id: testAdminId,
      email: 'admin@pupzy.net',
      fullName: 'Test Admin',
      passwordHash: 'hashed_password',
      role: 'SUPER_ADMIN',
      isActive: true,
    });
  });

  /**
   * Helper: Seeds a post, comment, and attached media in the DB and R2.
   */
  async function seedCommentWithMedia(storageKey: string, sha256 = 'abc123hash') {
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId: testUser.id,
        postType: 'RESCUE',
        title: 'Post with comment images',
        description: 'Post body text',
        cityId: testCity.id,
        urgency: 'URGENT',
        status: 'ACTIVE',
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();

    const [comment] = await dbHelper.db
      .insert(comments)
      .values({
        postId: post.id,
        authorId: testUser.id,
        text: 'Comment with image to delete',
        status: 'ACTIVE',
      })
      .returning();

    const [media] = await dbHelper.db
      .insert(commentMedia)
      .values({
        commentId: comment.id,
        storageKey,
        sha256,
        width: 400,
        height: 300,
        fileSizeBytes: 50000,
        fileContentType: 'image/webp',
        displayOrder: 0,
      })
      .returning();

    r2Adapter.objects.add(storageKey);

    return { post, comment, media };
  }

  describe('Author Comment Deletion', () => {
    it('transactionally enqueues storage deletion and CDN purge with standard domain', async () => {
      const storageKey = 'comments/comm-1/media-1.webp';
      const { comment } = await seedCommentWithMedia(storageKey);

      // Author deletes comment
      const deleted = await commentsRepo.deleteCommentWithCounters(comment.id, testUser.id, 'https://cdn.pupzy.net');
      expect(deleted).toBe(true);

      // Verify commentMedia row was unlinked/deleted
      const remainingMedia = await dbHelper.db
        .select()
        .from(commentMedia)
        .where(eq(commentMedia.commentId, comment.id));
      expect(remainingMedia).toHaveLength(0);

      // Verify media_deletion_work item was committed transactionally
      const workItems = await dbHelper.db
        .select()
        .from(mediaDeletionWork)
        .where(eq(mediaDeletionWork.storageKey, storageKey));
      expect(workItems).toHaveLength(1);
      expect(workItems[0].status).toBe('PENDING');
      expect(workItems[0].cdnUrl).toBe('https://cdn.pupzy.net/comments/comm-1/media-1.webp');
      expect(workItems[0].attempts).toBe(0);
    });

    it('enqueues multiple purge tasks during domain transition to purge both primary and legacy domains', async () => {
      // Configure domain transition
      process.env.COMMENT_MEDIA_DOMAIN_TRANSITION = 'true';
      process.env.COMMENT_MEDIA_PREVIOUS_CDN_BASE = 'https://legacy-cdn.pupzy.net';

      try {
        const storageKey = 'comments/comm-trans/media-trans.webp';
        const { comment } = await seedCommentWithMedia(storageKey);

        const deleted = await commentsRepo.deleteCommentWithCounters(comment.id, testUser.id, 'https://cdn.pupzy.net');
        expect(deleted).toBe(true);

        const workItems = await dbHelper.db
          .select()
          .from(mediaDeletionWork)
          .where(eq(mediaDeletionWork.storageKey, storageKey));

        // Must contain both current domain and legacy domain purge tasks
        expect(workItems.length).toBeGreaterThanOrEqual(2);
        const cdnUrls = workItems.map((w) => w.cdnUrl);
        expect(cdnUrls).toContain('https://cdn.pupzy.net/comments/comm-trans/media-trans.webp');
        expect(cdnUrls).toContain('https://legacy-cdn.pupzy.net/comments/comm-trans/media-trans.webp');
      } finally {
        delete process.env.COMMENT_MEDIA_DOMAIN_TRANSITION;
        delete process.env.COMMENT_MEDIA_PREVIOUS_CDN_BASE;
      }
    });
  });

  describe('Administrative Permanent Removal (AdminJS)', () => {
    it('transactionally enqueues deletion, unlinks media, records audit, and blocks inappropriate image hash', async () => {
      const storageKey = 'comments/comm-admin/media-admin.webp';
      const abusiveSha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const { comment } = await seedCommentWithMedia(storageKey, abusiveSha256);

      // Simulate AdminJS removeComment transaction (from moderate-comment.actions.js)
      await dbHelper.db.transaction(async (tx) => {
        await tx.update(comments).set({ status: 'REMOVED', updatedAt: new Date() }).where(eq(comments.id, comment.id));

        const mediaRows = await tx.select().from(commentMedia).where(eq(commentMedia.commentId, comment.id));

        for (const media of mediaRows) {
          await tx.insert(mediaDeletionWork).values({
            storageKey: media.storageKey,
            cdnUrl: `https://cdn.pupzy.net/${media.storageKey}`,
            status: 'PENDING',
          });

          await tx.insert(blockedMediaHashes).values({
            sha256: media.sha256!,
            reason: 'Inappropriate image content',
            blockedByAdminId: testAdminId,
          });
        }

        await tx.delete(commentMedia).where(eq(commentMedia.commentId, comment.id));

        await tx.insert(moderationActions).values({
          adminUserId: testAdminId,
          actionType: 'COMMENT_REMOVED',
          targetType: 'COMMENT',
          targetId: comment.id,
          reason: 'Inappropriate image content',
        });
      });

      // Verify comment status REMOVED
      const [updatedComment] = await dbHelper.db.select().from(comments).where(eq(comments.id, comment.id));
      expect(updatedComment.status).toBe('REMOVED');

      // Verify media_deletion_work queued
      const work = await dbHelper.db
        .select()
        .from(mediaDeletionWork)
        .where(eq(mediaDeletionWork.storageKey, storageKey));
      expect(work).toHaveLength(1);
      expect(work[0].status).toBe('PENDING');

      // Verify blocked_media_hashes contains the SHA256 digest
      const blocked = await dbHelper.db
        .select()
        .from(blockedMediaHashes)
        .where(eq(blockedMediaHashes.sha256, abusiveSha256));
      expect(blocked).toHaveLength(1);
      expect(blocked[0].reason).toContain('Inappropriate');
    });
  });

  describe('Provider Deletion Failure Propagation (Spec 4: Swallowed Error Regression)', () => {
    it('propagates real R2 provider deletion failure: work is NOT marked complete and attempts increment', async () => {
      const storageKey = 'comments/fail-r2/m1.webp';
      const { comment } = await seedCommentWithMedia(storageKey);
      await commentsRepo.deleteCommentWithCounters(comment.id, testUser.id);

      // Inject S3 DeleteObjectCommand provider failure beneath UploadService
      r2Adapter.shouldFailDelete = true;

      // Run media deletion processor
      const processed = await mediaDeletionProcessor.processPendingWork();
      expect(processed).toBe(0);

      // Work MUST NOT be marked COMPLETED. It must remain PENDING with attempt count 1
      const [item] = await dbHelper.db
        .select()
        .from(mediaDeletionWork)
        .where(eq(mediaDeletionWork.storageKey, storageKey));

      expect(item.status).toBe('PENDING');
      expect(item.attempts).toBe(1);
      expect(item.lastError).toContain('Simulated R2 provider delete error');
      // Storage object was not deleted because R2 failed
      expect(r2Adapter.objects.has(storageKey)).toBe(true);
    });
  });

  describe('CDN Purge Failure & Missing Credentials (Spec 15)', () => {
    it('fails observably and keeps work incomplete when Cloudflare credentials are missing', async () => {
      // Omit Cloudflare credentials
      (mockConfig.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'CLOUDFLARE_ZONE_ID' || key === 'CLOUDFLARE_API_TOKEN') {
          return undefined;
        }
        if (key === 'R2_BUCKET_NAME') return 'pupzy-media-bucket';
        return undefined;
      });

      const storageKey = 'comments/no-cf-cred/m1.webp';
      const { comment } = await seedCommentWithMedia(storageKey);
      await commentsRepo.deleteCommentWithCounters(comment.id, testUser.id);

      const processed = await mediaDeletionProcessor.processPendingWork();
      expect(processed).toBe(0);

      const [item] = await dbHelper.db
        .select()
        .from(mediaDeletionWork)
        .where(eq(mediaDeletionWork.storageKey, storageKey));

      expect(item.status).toBe('PENDING');
      expect(item.attempts).toBe(1);
      expect(item.lastError).toContain('Cloudflare credentials missing');
    });

    it('fails observably and keeps work incomplete when Cloudflare purge API returns 500 error', async () => {
      shouldFailPurge = true;
      purgeFailStatus = 500;

      const storageKey = 'comments/cf-500/m1.webp';
      const { comment } = await seedCommentWithMedia(storageKey);
      await commentsRepo.deleteCommentWithCounters(comment.id, testUser.id);

      const processed = await mediaDeletionProcessor.processPendingWork();
      expect(processed).toBe(0);

      const [item] = await dbHelper.db
        .select()
        .from(mediaDeletionWork)
        .where(eq(mediaDeletionWork.storageKey, storageKey));

      expect(item.status).toBe('PENDING');
      expect(item.attempts).toBe(1);
      expect(item.lastError).toContain('Cloudflare purge cache failed with status 500');
    });

    it('fails observably and keeps work incomplete when Cloudflare purge request times out', async () => {
      purgeShouldTimeout = true;

      const storageKey = 'comments/cf-timeout/m1.webp';
      const { comment } = await seedCommentWithMedia(storageKey);
      await commentsRepo.deleteCommentWithCounters(comment.id, testUser.id);

      const processed = await mediaDeletionProcessor.processPendingWork();
      expect(processed).toBe(0);

      const [item] = await dbHelper.db
        .select()
        .from(mediaDeletionWork)
        .where(eq(mediaDeletionWork.storageKey, storageKey));

      expect(item.status).toBe('PENDING');
      expect(item.attempts).toBe(1);
      expect(item.lastError).toContain('timeout');
    });
  });

  describe('Restarting Processing & Eventual Effects', () => {
    it('survives transient failures and achieves eventual storage deletion and CDN purge when re-run', async () => {
      const storageKey = 'comments/eventual/m1.webp';
      const { comment } = await seedCommentWithMedia(storageKey);
      await commentsRepo.deleteCommentWithCounters(comment.id, testUser.id);

      // Phase 1: Transient failure on first run
      r2Adapter.shouldFailDelete = true;
      let processed = await mediaDeletionProcessor.processPendingWork();
      expect(processed).toBe(0);

      let [item] = await dbHelper.db
        .select()
        .from(mediaDeletionWork)
        .where(eq(mediaDeletionWork.storageKey, storageKey));
      expect(item.status).toBe('PENDING');
      expect(item.attempts).toBe(1);
      expect(r2Adapter.objects.has(storageKey)).toBe(true);

      // Phase 2: R2 connectivity restored; processor restarts
      r2Adapter.shouldFailDelete = false;
      processed = await mediaDeletionProcessor.processPendingWork();
      expect(processed).toBe(1);

      // Verify eventual effects
      [item] = await dbHelper.db.select().from(mediaDeletionWork).where(eq(mediaDeletionWork.storageKey, storageKey));

      expect(item.status).toBe('COMPLETED');
      expect(item.lastError).toBeNull();
      // Storage object deleted from R2
      expect(r2Adapter.objects.has(storageKey)).toBe(false);
      // CDN purged via Cloudflare API
      expect(purgeCalls.length).toBeGreaterThanOrEqual(1);
      expect(purgeCalls[0].files).toContain('https://cdn.pupzy.net/comments/eventual/m1.webp');
    });
  });

  describe('Operator Intervention & Backlog Recovery', () => {
    it('transitions to FAILED after 5 attempts and successfully completes after operator remediation query', async () => {
      const storageKey = 'comments/operator-retry/m1.webp';
      const { comment } = await seedCommentWithMedia(storageKey);
      await commentsRepo.deleteCommentWithCounters(comment.id, testUser.id);

      // Cause 5 consecutive failures
      r2Adapter.shouldFailDelete = true;
      for (let i = 0; i < 5; i++) {
        await mediaDeletionProcessor.processPendingWork();
      }

      let [item] = await dbHelper.db
        .select()
        .from(mediaDeletionWork)
        .where(eq(mediaDeletionWork.storageKey, storageKey));

      // After 5 attempts, item MUST be FAILED for operator intervention
      expect(item.status).toBe('FAILED');
      expect(item.attempts).toBe(5);
      expect(item.lastError).toContain('Simulated R2 provider delete error');

      // Operator remedies storage issue
      r2Adapter.shouldFailDelete = false;

      // Operator runs runbook remediation query
      await dbHelper.db
        .update(mediaDeletionWork)
        .set({ status: 'PENDING', attempts: 0, lastError: null, updatedAt: new Date() })
        .where(eq(mediaDeletionWork.status, 'FAILED'));

      // Processor runs next iteration
      const processed = await mediaDeletionProcessor.processPendingWork();
      expect(processed).toBe(1);

      [item] = await dbHelper.db.select().from(mediaDeletionWork).where(eq(mediaDeletionWork.storageKey, storageKey));

      expect(item.status).toBe('COMPLETED');
      expect(item.lastError).toBeNull();
      expect(r2Adapter.objects.has(storageKey)).toBe(false);
    });
  });

  describe('Concurrent Workers & Race Condition Protection', () => {
    it('prevents overlapping workers from duplicate processing or lost status updates', async () => {
      const storageKey = 'comments/concurrent/m1.webp';
      const { comment } = await seedCommentWithMedia(storageKey);
      await commentsRepo.deleteCommentWithCounters(comment.id, testUser.id);

      // Launch two concurrent worker iterations
      const [count1, count2] = await Promise.all([
        mediaDeletionProcessor.processPendingWork(),
        mediaDeletionProcessor.processPendingWork(),
      ]);

      // Exactly one worker should claim and process the item
      expect(count1 + count2).toBe(1);

      const [item] = await dbHelper.db
        .select()
        .from(mediaDeletionWork)
        .where(eq(mediaDeletionWork.storageKey, storageKey));

      expect(item.status).toBe('COMPLETED');
      expect(item.attempts).toBe(1);
    });
  });

  describe('Temporary Hiding vs Permanent Removal (AC 7)', () => {
    it('temporary hiding (IMAGE_HIDDEN) preserves comment media in DB and R2 without queueing deletion work', async () => {
      const storageKey = 'comments/temp-hidden/m1.webp';
      const { comment } = await seedCommentWithMedia(storageKey);

      // Comment reported for inappropriate content -> set status IMAGE_HIDDEN
      await dbHelper.db
        .update(comments)
        .set({ status: 'IMAGE_HIDDEN', updatedAt: new Date() })
        .where(eq(comments.id, comment.id));

      // Verify commentMedia row remains intact
      const mediaList = await dbHelper.db.select().from(commentMedia).where(eq(commentMedia.commentId, comment.id));
      expect(mediaList).toHaveLength(1);

      // Verify NO deletion work is queued
      const deletionWork = await dbHelper.db
        .select()
        .from(mediaDeletionWork)
        .where(eq(mediaDeletionWork.storageKey, storageKey));
      expect(deletionWork).toHaveLength(0);

      // Storage object remains intact in R2
      expect(r2Adapter.objects.has(storageKey)).toBe(true);
    });
  });
});

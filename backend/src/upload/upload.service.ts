import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { eq, and, gt, gte, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import { stagedUploads, type StagedUpload, type StagedUploadPurpose } from '../database/schema';
import * as schema from '../database/schema';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { NotFoundError, AppError } from '../common/errors/app.errors';
import { validateCommentImage } from '../comments/validators/comment-image.validator';

/**
 * UploadService — manages media uploads to Cloudflare R2 via presigned URLs.
 *
 * ## Two-Phase Upload Flow (staging → final)
 *
 * Media follows a two-phase lifecycle to prevent orphaned files in the final
 * namespace and to decouple the upload from post creation:
 *
 * 1. **Staging** (`generatePresignedUrl`):
 *    The client requests a presigned PUT URL. The durable ticket is committed
 *    to PostgreSQL (`staged_uploads`) before returning the URL. The file is uploaded to
 *    a `staging/{userId}/{mediaId}.{ext}` key.
 *
 * 2. **Finalization** (`finalizeMedia`):
 *    When the post is created, the server moves the staged file to its
 *    permanent location at `posts/{postId}/{mediaId}.{ext}` using a
 *    server-side copy + delete. Only files attached to a valid post appear
 *    in the public namespace.
 *
 * PostgreSQL is the authority for owner-bound, purpose-bound, expiring,
 * single-use tickets. Process-local cache is optional acceleration only.
 */
@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly publicUrl: string;

  /**
   * Maps an allowed MIME type to its canonical file extension.
   * Only called with validated content types from the Zod schema.
   */
  private static mimeToExtension(contentType: string): string {
    switch (contentType) {
      case 'image/jpeg':
        return '.jpg';
      case 'image/png':
        return '.png';
      case 'image/webp':
        return '.webp';
      default:
        return '.webp';
    }
  }

  constructor(
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Inject(DATABASE_TOKEN) private readonly db: NodePgDatabase<typeof schema>,
  ) {
    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.get('R2_ACCESS_KEY_ID')!,
        secretAccessKey: config.get('R2_SECRET_ACCESS_KEY')!,
      },
    });
    this.bucketName = config.get<string>('R2_BUCKET_NAME')!;
    this.publicUrl = config.get<string>('R2_PUBLIC_URL')!;
  }

  /**
   * Generates a presigned PUT URL for the client to upload an image directly to R2.
   *
   * The upload ticket is durably committed to PostgreSQL before the presigned URL
   * is returned to ensure uploads survive restarts and deployments.
   *
   * @param userId - Authenticated user's ID, used to namespace staging keys.
   * @param contentType - MIME type declared by the client (e.g. `image/webp`).
   * @param fileSizeBytes - Exact byte count the client will upload.
   * @param purpose - Target domain for upload ticket (default: `POST_MEDIA`).
   * @returns Object containing the `mediaId`, `uploadUrl`, `expiresAt`, and `stagingKey`.
   */
  async generatePresignedUrl(
    userId: string,
    contentType: string,
    fileSizeBytes: number,
    purpose: StagedUploadPurpose = 'POST_MEDIA',
  ): Promise<{
    mediaId: string;
    uploadUrl: string;
    expiresAt: Date;
    stagingKey: string;
  }> {
    const mediaId = generateUuidV7();
    const ext = UploadService.mimeToExtension(contentType);
    const stagingKey = `staging/${userId}/${mediaId}${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: stagingKey,
      ContentType: contentType,
      ContentLength: fileSizeBytes,
    });

    /** 10-minute expiry for client upload URL */
    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 600 });
    const expiresAt = new Date(Date.now() + 600_000);
    /** 15-minute expiry for durable ticket to allow slow client post creation */
    const ticketExpiresAt = new Date(Date.now() + 900_000);

    // Commit ticket durably in PostgreSQL BEFORE returning
    await this.db.insert(stagedUploads).values({
      id: mediaId,
      userId,
      purpose,
      stagingKey,
      declaredContentType: contentType,
      declaredFileSizeBytes: fileSizeBytes,
      status: 'ISSUED',
      expiresAt: ticketExpiresAt,
    });

    // Optional cache acceleration — failure to populate cache never breaks the flow
    await Promise.all([
      this.cacheManager.set(`media_ct:${mediaId}`, contentType, 900_000),
      this.cacheManager.set(`media_owner:${mediaId}`, userId, 900_000),
      this.cacheManager.set(`media_staging_key:${mediaId}`, stagingKey, 900_000),
      this.cacheManager.set(`media_purpose:${mediaId}`, purpose, 900_000),
    ]).catch((err) => {
      this.logger.warn(`Failed to set staging cache for mediaId ${mediaId}: ${err}`);
    });

    return {
      mediaId,
      uploadUrl,
      expiresAt,
      stagingKey,
    };
  }

  /**
   * Atomically claims a staged upload ticket for a post.
   * Ensures single-use under concurrent creation attempts without holding open transactions.
   */
  async claimMedia(
    mediaId: string,
    userId: string,
    postId: string,
    purpose: StagedUploadPurpose = 'POST_MEDIA',
  ): Promise<StagedUpload> {
    const now = new Date();
    const [claimed] = await this.db
      .update(stagedUploads)
      .set({
        status: 'CLAIMED',
        postId,
        updatedAt: now,
      })
      .where(
        and(
          eq(stagedUploads.id, mediaId),
          eq(stagedUploads.userId, userId),
          eq(stagedUploads.purpose, purpose),
          eq(stagedUploads.status, 'ISSUED'),
          gt(stagedUploads.expiresAt, now),
        ),
      )
      .returning();

    if (!claimed) {
      throw new NotFoundError('Staged media', mediaId);
    }

    return claimed;
  }

  /**
   * Verifies a user-owned staged upload and predicts its final URLs.
   * Atomically claims the ticket if currently ISSUED.
   */
  async getExpectedMediaUrls(
    mediaId: string,
    userId: string,
    postId: string,
    purpose: StagedUploadPurpose = 'POST_MEDIA',
  ): Promise<{
    publicUrl: string;
    cloudflareStorageKey: string;
    fileContentType: string;
  }> {
    // Look up ticket in PostgreSQL — authority regardless of cache state
    const [existing] = await this.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId)).limit(1);

    // Reject without revealing existence or ownership facts
    if (
      !existing ||
      existing.userId !== userId ||
      existing.purpose !== purpose ||
      existing.expiresAt.getTime() <= Date.now()
    ) {
      throw new NotFoundError('Staged media', mediaId);
    }

    let ticket: StagedUpload;
    if (existing.status === 'ISSUED') {
      ticket = await this.claimMedia(mediaId, userId, postId, purpose);
    } else if (existing.status === 'CLAIMED' && existing.postId === postId) {
      ticket = existing;
    } else {
      // Already claimed by another post, finalized, or failed
      throw new NotFoundError('Staged media', mediaId);
    }

    const ext = UploadService.mimeToExtension(ticket.declaredContentType);
    const stagingKey = ticket.stagingKey;

    // Verify staged object exists in R2 without holding open DB transaction
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: stagingKey,
        }),
      );
    } catch {
      await this.db
        .update(stagedUploads)
        .set({
          status: 'FAILED',
          errorMessage: 'Staged object not found in R2',
          updatedAt: new Date(),
        })
        .where(eq(stagedUploads.id, mediaId));
      throw new NotFoundError('Staged media', mediaId);
    }

    const finalKey = `posts/${postId}/${mediaId}${ext}`;
    return {
      publicUrl: `${this.publicUrl}/${finalKey}`,
      cloudflareStorageKey: finalKey,
      fileContentType: ticket.declaredContentType,
    };
  }

  /**
   * Moves a staged upload to its permanent location under the post's namespace.
   *
   * 1. **Verify** — `HeadObjectCommand` confirms staging object exists in R2.
   * 2. **Copy** — `CopyObjectCommand` copies object to permanent location.
   * 3. **Delete** — `DeleteObjectCommand` removes original staging object.
   * 4. **Update DB** — durably records finalization state.
   */
  async finalizeMedia(
    mediaId: string,
    userId: string,
    postId: string,
    purpose: StagedUploadPurpose = 'POST_MEDIA',
  ): Promise<{
    publicUrl: string;
    cloudflareStorageKey: string;
  }> {
    const [ticket] = await this.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId)).limit(1);

    if (!ticket || ticket.userId !== userId || ticket.purpose !== purpose) {
      throw new NotFoundError('Staged media', mediaId);
    }

    // Idempotent retry: already finalized for this post
    if (ticket.status === 'FINALIZED' && ticket.finalStorageKey && ticket.postId === postId) {
      return {
        publicUrl: `${this.publicUrl}/${ticket.finalStorageKey}`,
        cloudflareStorageKey: ticket.finalStorageKey,
      };
    }

    // If ticket was not claimed yet, claim it for this postId
    if (ticket.status === 'ISSUED') {
      await this.claimMedia(mediaId, userId, postId, purpose);
    } else if (ticket.status !== 'CLAIMED' || ticket.postId !== postId) {
      throw new NotFoundError('Staged media', mediaId);
    }

    const ext = UploadService.mimeToExtension(ticket.declaredContentType);
    const stagingKey = ticket.stagingKey;
    const finalKey = `posts/${postId}/${mediaId}${ext}`;

    // Step 1: Verify staged upload actually exists
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: stagingKey,
        }),
      );
    } catch {
      await this.db
        .update(stagedUploads)
        .set({
          status: 'FAILED',
          errorMessage: 'Staged object not found in R2 during finalization',
          updatedAt: new Date(),
        })
        .where(eq(stagedUploads.id, mediaId));
      throw new NotFoundError(`Staged media "${mediaId}" — upload may have expired or was never completed`);
    }

    // Step 2: Copy to permanent location
    try {
      await this.s3Client.send(
        new CopyObjectCommand({
          Bucket: this.bucketName,
          CopySource: `${this.bucketName}/${stagingKey}`,
          Key: finalKey,
        }),
      );
    } catch (err) {
      await this.db
        .update(stagedUploads)
        .set({
          status: 'FAILED',
          errorMessage: `CopyObject failed: ${err instanceof Error ? err.message : String(err)}`,
          updatedAt: new Date(),
        })
        .where(eq(stagedUploads.id, mediaId));
      throw err;
    }

    // Step 3: Remove staging object to avoid orphaned duplicates
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: stagingKey,
        }),
      );
    } catch (err) {
      this.logger.warn(`Failed to delete staging object ${stagingKey} after copy: ${err}`);
    }

    // Step 4: Durably record finalization state
    await this.db
      .update(stagedUploads)
      .set({
        status: 'FINALIZED',
        finalStorageKey: finalKey,
        updatedAt: new Date(),
      })
      .where(eq(stagedUploads.id, mediaId));

    // Step 5: Clean up cached keys
    await Promise.all([
      this.cacheManager.del(`media_ct:${mediaId}`),
      this.cacheManager.del(`media_owner:${mediaId}`),
      this.cacheManager.del(`media_staging_key:${mediaId}`),
      this.cacheManager.del(`media_purpose:${mediaId}`),
    ]).catch(() => {});

    return {
      publicUrl: `${this.publicUrl}/${finalKey}`,
      cloudflareStorageKey: finalKey,
    };
  }

  /**
   * Marks media items as failed if post creation database transaction fails.
   */
  async markMediaFailed(mediaIds: string[], errorMessage: string): Promise<void> {
    if (!mediaIds || mediaIds.length === 0) return;
    await this.db
      .update(stagedUploads)
      .set({
        status: 'FAILED',
        errorMessage,
        updatedAt: new Date(),
      })
      .where(inArray(stagedUploads.id, mediaIds));
  }

  /**
   * Generates a presigned Cloudflare R2 upload URL for a Comment image.
   *
   * Rate limits: 6/min and 50/day per authenticated user (Postgres-backed).
   * Kill switch: COMMENT_IMAGES_ENABLED=false rejects ticket issuance.
   *
   * Authoritative constraints: static WebP, 100,000 bytes, 480x480 max dimensions.
   */
  async requestCommentImageUploadUrl(
    userId: string,
    input: { contentType: string; fileSizeBytes: number },
  ): Promise<{
    mediaId: string;
    uploadUrl: string;
    expiresAt: Date;
    maxSizeBytes: number;
    maxWidth: number;
    maxHeight: number;
    allowedContentType: string;
    mimeType?: string;
  }> {
    // 1. Kill switch check
    const enabled = this.config.get<string | boolean>('COMMENT_IMAGES_ENABLED');
    if (enabled === false || enabled === 'false') {
      throw new AppError('Comment images are currently disabled', 'COMMENT_IMAGES_DISABLED');
    }

    // 2. Validate declared contentType and size
    if (input.contentType !== 'image/webp') {
      throw new AppError('Only static WebP images are allowed', 'COMMENT_MEDIA_INVALID_FORMAT');
    }
    if (input.fileSizeBytes > 100_000) {
      throw new AppError('File size exceeds 100,000 bytes', 'COMMENT_MEDIA_TOO_LARGE');
    }

    const now = new Date();

    // 3. Rate limiting: 6 per minute
    const oneMinuteAgo = new Date(now.getTime() - 60_000);
    const [minResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(stagedUploads)
      .where(
        and(
          eq(stagedUploads.userId, userId),
          eq(stagedUploads.purpose, 'COMMENT_IMAGE'),
          gte(stagedUploads.createdAt, oneMinuteAgo),
        ),
      );

    if ((minResult?.count ?? 0) >= 6) {
      throw new AppError('Comment image upload rate limit exceeded (max 6 per minute)', 'RATE_LIMITED');
    }

    // 4. Rate limiting: 50 per day (failed and abandoned count toward it)
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
    const [dayResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(stagedUploads)
      .where(
        and(
          eq(stagedUploads.userId, userId),
          eq(stagedUploads.purpose, 'COMMENT_IMAGE'),
          gte(stagedUploads.createdAt, oneDayAgo),
        ),
      );

    if ((dayResult?.count ?? 0) >= 50) {
      throw new AppError('Comment image upload daily limit exceeded (max 50 per day)', 'RATE_LIMITED');
    }

    // 5. Generate ticket and presigned URL
    const mediaId = generateUuidV7();
    const stagingKey = `staging/${userId}/${mediaId}.webp`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: stagingKey,
      ContentType: 'image/webp',
      ContentLength: input.fileSizeBytes,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 600 });
    const expiresAt = new Date(now.getTime() + 600_000);
    const ticketExpiresAt = new Date(now.getTime() + 900_000);

    // Commit ticket durably in PostgreSQL BEFORE returning
    await this.db.insert(stagedUploads).values({
      id: mediaId,
      userId,
      purpose: 'COMMENT_IMAGE',
      stagingKey,
      declaredContentType: 'image/webp',
      declaredFileSizeBytes: input.fileSizeBytes,
      status: 'ISSUED',
      expiresAt: ticketExpiresAt,
    });

    return {
      mediaId,
      uploadUrl,
      expiresAt,
      maxSizeBytes: 100_000,
      maxWidth: 480,
      maxHeight: 480,
      mimeType: 'image/webp',
      allowedContentType: 'image/webp',
    };
  }

  /**
   * Derives public CDN URL for a storage key.
   */
  getPublicCdnUrl(storageKey: string): string {
    const base =
      process.env.COMMENT_MEDIA_CDN_BASE ||
      this.config.get<string>('COMMENT_MEDIA_CDN_BASE') ||
      process.env.R2_PUBLIC_URL ||
      this.config.get<string>('R2_PUBLIC_URL') ||
      'https://cdn.pupzy.net';
    const cleanBase = base.replace(/\/+$/, '');
    const cleanKey = storageKey.replace(/^\/+/, '');
    return `${cleanBase}/${cleanKey}`;
  }

  /**
   * Purges a CDN cache URL via Cloudflare API.
   * Idempotent; logs and succeeds if Cloudflare credentials are not configured.
   */
  async purgeCdn(cdnUrl: string): Promise<void> {
    const zoneId = this.config.get<string>('CLOUDFLARE_ZONE_ID');
    const apiToken = this.config.get<string>('CLOUDFLARE_API_TOKEN');

    if (zoneId && apiToken) {
      try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ files: [cdnUrl] }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Cloudflare purge cache failed with status ${res.status}: ${text}`);
        }
      } catch (err) {
        this.logger.error(`Failed to purge CDN for ${cdnUrl}: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    } else {
      this.logger.log(`CDN purge simulated for ${cdnUrl} (no credentials configured)`);
    }
  }

  /**
   * Validates and finalizes up to 2 staged Comment image uploads.
   *
   * 1. Validates all images outside DB transaction:
   *    - Checks ownership, COMMENT_IMAGE purpose, non-expiry, single-use.
   *    - Fetches bytes from R2 stagingKey.
   *    - Strict WebP binary validation (<=100KB, <=480x480, single-frame static, stripped metadata).
   *    - If any image fails validation, deletes THAT invalid staged object immediately, marks it FAILED,
   *      and throws structured error with `mediaPosition` and safe error code.
   *      Other valid unconsumed staged objects remain eligible until expiry!
   *    - If transient R2 error occurs, retains eligible staging and returns retryable error.
   * 2. Once all images pass validation:
   *    - Atomically claims tickets in PostgreSQL.
   *    - Copies objects to `comments/{commentId}/{mediaId}.webp`.
   *    - Returns finalized descriptors (including stagingKey for post-commit cleanup).
   */
  async finalizeCommentImages(
    mediaIds: string[],
    userId: string,
    commentId: string,
  ): Promise<
    Array<{
      id: string;
      commentId: string;
      storageKey: string;
      stagingKey: string;
      sha256: string;
      width: number;
      height: number;
      fileSizeBytes: number;
      fileContentType: string;
      displayOrder: number;
    }>
  > {
    if (!mediaIds || mediaIds.length === 0) {
      return [];
    }

    if (new Set(mediaIds).size !== mediaIds.length) {
      throw new AppError('Duplicate media IDs provided', 'VALIDATION_ERROR');
    }

    if (mediaIds.length > 2) {
      throw new AppError('Maximum 2 images allowed per comment', 'VALIDATION_ERROR');
    }

    // Step 1: Validate all images outside DB transactions
    const validatedItems: Array<{
      ticket: StagedUpload;
      validated: ReturnType<typeof validateCommentImage>;
      position: number;
    }> = [];

    for (let position = 0; position < mediaIds.length; position++) {
      const mediaId = mediaIds[position];
      const [ticket] = await this.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId)).limit(1);

      if (!ticket || ticket.userId !== userId || ticket.purpose !== 'COMMENT_IMAGE') {
        throw new AppError('Media is not available', 'COMMENT_MEDIA_NOT_AVAILABLE', {
          mediaPosition: position,
          retryable: false,
        });
      }

      if (ticket.status === 'FINALIZED' || ticket.status === 'CLAIMED') {
        throw new AppError('Media has already been used', 'COMMENT_MEDIA_ALREADY_USED', {
          mediaPosition: position,
          retryable: false,
        });
      }

      if (ticket.status === 'FAILED' || ticket.status === 'EXPIRED' || ticket.expiresAt.getTime() <= Date.now()) {
        throw new AppError('Media is not available', 'COMMENT_MEDIA_NOT_AVAILABLE', {
          mediaPosition: position,
          retryable: false,
        });
      }

      // Fetch bytes from R2
      let objectBytes: Buffer;
      try {
        const response = await this.s3Client.send(
          new GetObjectCommand({
            Bucket: this.bucketName,
            Key: ticket.stagingKey,
          }),
        );
        if (!response.Body) {
          throw new Error('Empty body from storage');
        }
        const byteArray = await response.Body.transformToByteArray();
        objectBytes = Buffer.from(byteArray);
      } catch (err: unknown) {
        const s3Err = err as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (s3Err?.name === 'NoSuchKey' || s3Err?.$metadata?.httpStatusCode === 404) {
          await this.db
            .update(stagedUploads)
            .set({ status: 'FAILED', errorMessage: 'Staged object not found in R2', updatedAt: new Date() })
            .where(eq(stagedUploads.id, mediaId));
          throw new AppError('Media is not available', 'COMMENT_MEDIA_NOT_AVAILABLE', {
            mediaPosition: position,
            retryable: false,
          });
        }
        // Transient error: do NOT delete, ticket stays ISSUED
        this.logger.error(
          `Transient error fetching staged object ${ticket.stagingKey}: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw new AppError('Failed to process staged media', 'COMMENT_MEDIA_PROCESSING_FAILED', {
          mediaPosition: position,
          retryable: true,
        });
      }

      // Check byte size <= 100,000
      if (objectBytes.length > 100_000) {
        // Immediate deletion of invalid staged object
        await this.deleteObject(ticket.stagingKey);
        await this.db
          .update(stagedUploads)
          .set({ status: 'FAILED', errorMessage: 'File size exceeds 100,000 bytes', updatedAt: new Date() })
          .where(eq(stagedUploads.id, mediaId));
        throw new AppError('File size exceeds 100,000 bytes', 'COMMENT_MEDIA_TOO_LARGE', {
          mediaPosition: position,
          retryable: false,
        });
      }

      // WebP binary validation
      let validated: ReturnType<typeof validateCommentImage>;
      try {
        validated = validateCommentImage(objectBytes);
      } catch (err) {
        // Immediate deletion of invalid staged object
        await this.deleteObject(ticket.stagingKey);
        await this.db
          .update(stagedUploads)
          .set({
            status: 'FAILED',
            errorMessage: err instanceof Error ? err.message : String(err),
            updatedAt: new Date(),
          })
          .where(eq(stagedUploads.id, mediaId));
        if (err instanceof AppError) {
          throw new AppError(err.message, err.code, { mediaPosition: position, retryable: false });
        }
        throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT', {
          mediaPosition: position,
          retryable: false,
        });
      }

      validatedItems.push({ ticket, validated, position });
    }

    // Step 2: All images are valid! Atomically claim tickets and copy to final R2 destination
    const claimedIds: string[] = [];
    const copiedFinalKeys: string[] = [];
    const results: Array<{
      id: string;
      commentId: string;
      storageKey: string;
      stagingKey: string;
      sha256: string;
      width: number;
      height: number;
      fileSizeBytes: number;
      fileContentType: string;
      displayOrder: number;
    }> = [];

    for (const item of validatedItems) {
      const { ticket, validated, position } = item;
      const finalStorageKey = `comments/${commentId}/${ticket.id}.webp`;

      // Atomically claim in DB
      const [claimed] = await this.db
        .update(stagedUploads)
        .set({ status: 'CLAIMED', updatedAt: new Date() })
        .where(
          and(
            eq(stagedUploads.id, ticket.id),
            eq(stagedUploads.userId, userId),
            eq(stagedUploads.purpose, 'COMMENT_IMAGE'),
            eq(stagedUploads.status, 'ISSUED'),
            gt(stagedUploads.expiresAt, new Date()),
          ),
        )
        .returning();

      if (!claimed) {
        // Rollback previous claims in this batch
        if (claimedIds.length > 0) {
          await this.db
            .update(stagedUploads)
            .set({ status: 'ISSUED', updatedAt: new Date() })
            .where(inArray(stagedUploads.id, claimedIds));
        }
        // Delete copied final keys
        for (const key of copiedFinalKeys) {
          await this.deleteObject(key);
        }
        throw new AppError('Media has already been used', 'COMMENT_MEDIA_ALREADY_USED', {
          mediaPosition: position,
          retryable: false,
        });
      }
      claimedIds.push(ticket.id);

      // Copy to final location
      try {
        await this.s3Client.send(
          new CopyObjectCommand({
            Bucket: this.bucketName,
            CopySource: `${this.bucketName}/${ticket.stagingKey}`,
            Key: finalStorageKey,
          }),
        );
      } catch (err) {
        // Rollback claims
        await this.db
          .update(stagedUploads)
          .set({ status: 'ISSUED', updatedAt: new Date() })
          .where(inArray(stagedUploads.id, claimedIds));
        // Delete copied final keys
        for (const key of copiedFinalKeys) {
          await this.deleteObject(key);
        }
        this.logger.error(
          `Transient error copying staged object ${ticket.stagingKey} to ${finalStorageKey}: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw new AppError('Failed to finalize media in storage', 'COMMENT_MEDIA_PROCESSING_FAILED', {
          mediaPosition: position,
          retryable: true,
        });
      }
      copiedFinalKeys.push(finalStorageKey);

      results.push({
        id: ticket.id,
        commentId,
        storageKey: finalStorageKey,
        stagingKey: ticket.stagingKey,
        sha256: validated.sha256,
        width: validated.width,
        height: validated.height,
        fileSizeBytes: validated.fileSizeBytes,
        fileContentType: 'image/webp',
        displayOrder: position,
      });
    }

    // Mark all claimed tickets as FINALIZED
    for (const item of results) {
      await this.db
        .update(stagedUploads)
        .set({
          status: 'FINALIZED',
          finalStorageKey: item.storageKey,
          updatedAt: new Date(),
        })
        .where(eq(stagedUploads.id, item.id));
    }

    return results;
  }

  /**
   * Validates and finalizes a staged Comment image upload (single-image convenience wrapper).
   */
  async finalizeCommentImage(
    mediaId: string,
    userId: string,
    commentId: string,
  ): Promise<{
    id: string;
    commentId: string;
    storageKey: string;
    stagingKey?: string;
    sha256: string;
    width: number;
    height: number;
    fileSizeBytes: number;
    fileContentType: string;
    displayOrder: number;
  }> {
    const results = await this.finalizeCommentImages([mediaId], userId, commentId);
    return results[0];
  }

  /**
   * Deletes an object from R2 (e.g. for rollback on DB failure).
   */
  async deleteObject(key: string): Promise<void> {
    try {
      await this.s3Client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }));
    } catch (err) {
      this.logger.warn(`Failed to delete object ${key}: ${err}`);
    }
  }
}

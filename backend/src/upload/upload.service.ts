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
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { eq, and, gt, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import { stagedUploads, type StagedUpload, type StagedUploadPurpose } from '../database/schema';
import * as schema from '../database/schema';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { NotFoundError } from '../common/errors/app.errors';

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
}

import { Injectable, Inject, Optional, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  S3Client,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DATABASE_TOKEN } from '../database/database.provider';
import { users, accountDeletions, isAccountDeletionBlockedStatus } from '../database/schema';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { NotFoundError, ForbiddenError } from '../common/errors/app.errors';
import { MediaFinalizationRepository } from './media-finalization.repository';

/**
 * UploadService — manages media uploads to Cloudflare R2 via presigned URLs.
 *
 * ## Two-Phase Upload Flow (staging → final)
 *
 * Media follows a two-phase lifecycle to prevent orphaned files in the final
 * namespace and to decouple the upload from post creation:
 *
 * 1. **Staging** (`generatePresignedUrl`):
 *    The client requests a presigned PUT URL. The file is uploaded to a
 *    `staging/{userId}/{mediaId}.{ext}` key. This key is isolated per user
 *    so one user cannot overwrite another's staging files.
 *
 * 2. **Finalization** (`finalizeMedia`):
 *    When the post is created, the server moves the staged file to its
 *    permanent location at `posts/{postId}/{mediaId}.{ext}` using a
 *    server-side copy + delete. This ensures only files attached to a valid
 *    post appear in the public namespace.
 *
 * If the user never creates a post, staged files can be garbage-collected
 * via an R2 lifecycle rule (e.g. delete objects in `staging/` older than 24h).
 */
@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly publicUrl: string;

  /**
   * Network bounds for every R2 command so storage outages cannot pin
   * application work indefinitely. Together with the bounded retry count this
   * keeps a finalization inside its durable obligation lease.
   */
  private static readonly R2_CONNECTION_TIMEOUT_MS = 3_000;
  private static readonly R2_REQUEST_TIMEOUT_MS = 15_000;
  private static readonly R2_MAX_ATTEMPTS = 3;

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
    @Optional() @Inject(DATABASE_TOKEN) private readonly db?: NodePgDatabase<Record<string, unknown>>,
    @Inject(MediaFinalizationRepository)
    private readonly mediaFinalizationRepository?: MediaFinalizationRepository,
  ) {
    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.get('R2_ACCESS_KEY_ID')!,
        secretAccessKey: config.get('R2_SECRET_ACCESS_KEY')!,
      },
      maxAttempts: UploadService.R2_MAX_ATTEMPTS,
      /**
       * Bound every R2 call. Timeouts keep storage outages from pinning
       * application work (including durable finalization obligations) forever.
       * The AWS SDK ignores request timeouts unless `throwOnRequestTimeout` is set.
       */
      requestHandler: {
        connectionTimeout: UploadService.R2_CONNECTION_TIMEOUT_MS,
        requestTimeout: UploadService.R2_REQUEST_TIMEOUT_MS,
        throwOnRequestTimeout: true,
      },
    });
    this.bucketName = config.get<string>('R2_BUCKET_NAME')!;
    this.publicUrl = config.get<string>('R2_PUBLIC_URL')!;
  }

  /**
   * Generates a presigned PUT URL for the client to upload an image directly to R2.
   *
   * The file lands in a staging namespace (`staging/{userId}/{mediaId}.{ext}`)
   * and is NOT publicly accessible until {@link finalizeMedia} moves it to
   * the permanent `posts/` namespace.
   *
   * The presigned URL embeds `ContentType` and `ContentLength` conditions,
   * so R2 will reject uploads that don't match the declared MIME type and size.
   *
   * @param userId - Authenticated user's ID, used to namespace staging keys.
   * @param contentType - MIME type declared by the client (e.g. `image/webp`).
   * @param fileSizeBytes - Exact byte count the client will upload.
   * @returns Object containing the `mediaId`, `uploadUrl`, `expiresAt`, and `stagingKey`.
   */
  async generatePresignedUrl(
    userId: string,
    contentType: string,
    fileSizeBytes: number,
  ): Promise<{
    mediaId: string;
    uploadUrl: string;
    expiresAt: Date;
    stagingKey: string;
  }> {
    const mediaId = generateUuidV7();
    const ext = UploadService.mimeToExtension(contentType);
    const stagingKey = `staging/${userId}/${mediaId}${ext}`;

    const expiresInSeconds = 600;
    let signingDate = new Date();
    let graceUntil = new Date(signingDate.getTime() + expiresInSeconds * 1000);

    // 0. Serialize with account deletion acceptance: lock the user row FOR UPDATE.
    // If the account is banned, deleted, or pending deletion, refuse upload URL issuance.
    // Durably persist uploadGraceUntil before generating and returning the signed URL.
    if (this.db) {
      await this.db.transaction(async (tx) => {
        const [userRow] = await tx
          .select({
            id: users.id,
            isBanned: users.isBanned,
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');

        if (!userRow || userRow.isBanned) {
          throw new ForbiddenError('ACCOUNT_DELETED');
        }

        const [deletionRecord] = await tx
          .select({
            id: accountDeletions.id,
            status: accountDeletions.status,
          })
          .from(accountDeletions)
          .where(eq(accountDeletions.userId, userId))
          .for('update');

        if (deletionRecord && isAccountDeletionBlockedStatus(deletionRecord.status)) {
          throw new ForbiddenError('ACCOUNT_DELETED');
        }

        // Bind the persisted deadline and signature to the exact same timestamp AFTER acquiring lock
        signingDate = new Date();
        graceUntil = new Date(signingDate.getTime() + expiresInSeconds * 1000);

        await tx.update(users).set({ uploadGraceUntil: graceUntil }).where(eq(users.id, userId));
      });
    }

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: stagingKey,
      ContentType: contentType,
      ContentLength: fileSizeBytes,
    });

    /** 10-minute expiry — bound to the exact same signing timestamp as persisted in the database. */
    const uploadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds,
      signingDate,
    });

    // Bind the short-lived staging capability to both its owner and MIME type.
    // Post creation verifies these values before it creates a media row.
    // Also record the grace expiry so account deletion accounts for in-flight signed URLs.
    // Staging attachability is limited to 10 minutes (600_000 ms) to match the grace window.
    await Promise.all([
      this.cacheManager.set(`media_ct:${mediaId}`, contentType, 600_000),
      this.cacheManager.set(`media_owner:${mediaId}`, userId, 600_000),
      this.cacheManager.set(`user_last_upload_grace:${userId}`, graceUntil.getTime(), 600_000),
    ]);

    return {
      mediaId,
      uploadUrl,
      expiresAt: graceUntil,
      stagingKey,
    };
  }

  /**
   * Returns the expiry timestamp of the latest outstanding presigned upload URL for a user.
   * Falls back to PostgreSQL if the process-local or Redis cache misses, ensuring protection
   * survives server restarts.
   */
  async getLastUploadGraceUntil(userId: string): Promise<Date | null> {
    const expiry = await this.cacheManager.get<number>(`user_last_upload_grace:${userId}`);
    if (expiry) {
      return new Date(expiry);
    }
    if (this.db) {
      try {
        const rows = await this.db
          .select({ uploadGraceUntil: users.uploadGraceUntil })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (rows.length > 0 && rows[0].uploadGraceUntil) {
          return rows[0].uploadGraceUntil;
        }
      } catch (err) {
        this.logger.warn(
          `Failed to query uploadGraceUntil from database for user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return null;
  }

  /**
   * Moves a staged upload to its permanent location under the post's namespace.
   *
   * This is called server-side during post creation — the client never touches
   * the final key directly. The method performs three steps:
   *
   * 1. **Verify** — `HeadObjectCommand` confirms the staging object exists.
   *    If the client never completed the upload, we throw `NotFoundError`
   *    rather than creating a post with a broken image.
   *
   * 2. **Copy** — `CopyObjectCommand` copies the object from staging to its
   *    final key (`posts/{postId}/{mediaId}.{ext}`).
   *
   * 3. **Delete** — `DeleteObjectCommand` removes the original staging object.
   *
   * @param mediaId - UUID returned by {@link generatePresignedUrl}.
   * @param userId - Authenticated user's ID (must match the staging namespace).
   * @param postId - The newly created post's ID for the final key namespace.
   * @returns Object with the `publicUrl` and `cloudflareStorageKey` for DB storage.
   *
   * @throws {NotFoundError} if the staging object does not exist in R2.
   */
  async finalizeMedia(
    mediaId: string,
    userId: string,
    postId: string,
  ): Promise<{
    publicUrl: string;
    cloudflareStorageKey: string;
  }> {
    const contentType = (await this.cacheManager.get<string>(`media_ct:${mediaId}`)) ?? 'image/webp';
    const ext = UploadService.mimeToExtension(contentType);
    const stagingKey = `staging/${userId}/${mediaId}${ext}`;
    const finalKey = `posts/${postId}/${mediaId}${ext}`;

    const executeFinalization = async (obligationId: string | null) => {
      // Heartbeat the durable obligation before each storage call so a live
      // finalization is never mistaken for a crashed one while it copies.
      const heartbeat = async (): Promise<void> => {
        if (obligationId && this.mediaFinalizationRepository) {
          await this.mediaFinalizationRepository.touch(obligationId);
        }
      };

      // Step 1: Verify the staged upload actually exists
      await heartbeat();
      try {
        await this.s3Client.send(
          new HeadObjectCommand({
            Bucket: this.bucketName,
            Key: stagingKey,
          }),
        );
      } catch {
        throw new NotFoundError(`Staged media "${mediaId}" — upload may have expired or was never completed`);
      }

      // Step 2: Copy to permanent location
      await heartbeat();
      await this.s3Client.send(
        new CopyObjectCommand({
          Bucket: this.bucketName,
          CopySource: `${this.bucketName}/${stagingKey}`,
          Key: finalKey,
        }),
      );

      // Step 3: Remove the staging object to avoid orphaned duplicates
      await heartbeat();
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: stagingKey,
        }),
      );

      // Step 4: Clean up cached content type
      await this.cacheManager.del(`media_ct:${mediaId}`);

      return {
        publicUrl: `${this.publicUrl}/${finalKey}`,
        cloudflareStorageKey: finalKey,
      };
    };

    // Step 0: Serialize the start of finalization with account deletion acceptance,
    // and durably record the obligation in the same short transaction. The user row
    // lock is held only for that transaction; the R2 calls run outside any database
    // transaction so stalled storage cannot exhaust the connection pool, while the
    // obligation row guarantees account deletion waits for or compensates the copy.
    let obligationId: string | null = null;
    try {
      obligationId = await this.beginFinalizationObligation(userId, mediaId, stagingKey, finalKey);
    } catch (err) {
      // Only a blocked account justifies destroying the staged upload. A transient
      // database error leaves staging untouched so the media can still be finalized.
      if (err instanceof ForbiddenError) {
        await this.deleteObjectQuietly(stagingKey, 'staged object');
      }
      throw err;
    }

    // Steps 1-3: Head, copy, and staging delete with bounded timeouts, outside
    // any database transaction.
    let result: { publicUrl: string; cloudflareStorageKey: string };
    try {
      result = await executeFinalization(obligationId);
    } catch (err) {
      await this.settleFinalizationObligation(obligationId, finalKey, userId);
      throw err;
    }

    // Step 4: Settle the obligation. When acceptance raced the copy, the
    // permanent object is deleted and the obligation is cleared only after that
    // succeeds; otherwise the row stays for account deletion or cron to retry.
    const accountBlocked = await this.settleFinalizationObligation(obligationId, finalKey, userId);
    if (accountBlocked) {
      throw new ForbiddenError('ACCOUNT_DELETED');
    }

    return result;
  }

  /**
   * Verifies the creator may still finalize media and durably records an
   * `IN_FLIGHT` obligation in the same transaction. The user row lock serializes
   * this check with account deletion acceptance, so either the obligation is
   * visible to the deletion sweep or the copy is rejected outright.
   *
   * @returns The obligation ID, or null when durable tracking is unavailable.
   * @throws {ForbiddenError} when the creator is banned or an account deletion
   * is accepted, so no permanent object may be created.
   */
  private async beginFinalizationObligation(
    userId: string,
    mediaId: string,
    stagingKey: string,
    finalKey: string,
  ): Promise<string | null> {
    if (!this.db) return null;

    const obligationId = generateUuidV7();

    await this.db.transaction(async (tx) => {
      const [userRow] = await tx
        .select({
          id: users.id,
          isBanned: users.isBanned,
        })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');

      if (!userRow || userRow.isBanned) {
        throw new ForbiddenError('ACCOUNT_DELETED');
      }

      const [deletionRecord] = await tx
        .select({ id: accountDeletions.id, status: accountDeletions.status })
        .from(accountDeletions)
        .where(eq(accountDeletions.userId, userId))
        .orderBy(sql`${accountDeletions.createdAt} DESC`)
        .limit(1);

      if (deletionRecord && isAccountDeletionBlockedStatus(deletionRecord.status)) {
        throw new ForbiddenError('ACCOUNT_DELETED');
      }

      if (this.mediaFinalizationRepository) {
        await this.mediaFinalizationRepository.create(
          {
            id: obligationId,
            userId,
            mediaId,
            stagingKey,
            finalKey,
            status: 'IN_FLIGHT',
          },
          tx,
        );
      }
    });

    return this.mediaFinalizationRepository ? obligationId : null;
  }

  /**
   * Resolves a finalization obligation after the R2 work has finished or failed.
   *
   * - Live account: the row is removed; the permanent object (if any) belongs to
   *   a surviving post and account deletion later captures its key from `post_media`.
   * - Blocked account: the row moves to `COMPENSATION_REQUIRED`, the permanent
   *   object is deleted, and only then is the row removed. A failed deletion keeps
   *   the row so account deletion or the maintenance cron retries it.
   * - Unknown account state (database read failed): the row is left `IN_FLIGHT`;
   *   deletion treats it as fresh until the lease expires, then cleans it.
   *
   * @returns true when the account is deletion-blocked.
   */
  private async settleFinalizationObligation(
    obligationId: string | null,
    finalKey: string,
    userId: string,
  ): Promise<boolean> {
    let accountBlocked: boolean | null = null;
    try {
      accountBlocked = !(await this.isFinalizationAllowed(userId));
    } catch (err) {
      this.logger.warn(
        `Could not re-check account state for media finalization ${obligationId ?? '(untracked)'}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!obligationId || !this.mediaFinalizationRepository) {
      if (accountBlocked === true) {
        await this.deleteObjectQuietly(finalKey, 'permanent object');
        return true;
      }
      return false;
    }

    if (accountBlocked === false) {
      await this.removeFinalizationObligation(obligationId);
      return false;
    }

    if (accountBlocked === true) {
      try {
        await this.mediaFinalizationRepository.markCompensationRequired(obligationId);
      } catch (err) {
        this.logger.error(
          `Failed to mark media finalization ${obligationId} as compensation-required: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      try {
        await this.deleteObject(finalKey);
        await this.mediaFinalizationRepository.delete(obligationId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to compensate permanent object "${finalKey}" for obligation ${obligationId}; account deletion will retry: ${message}`,
        );
        try {
          await this.mediaFinalizationRepository.recordError(obligationId, message);
        } catch (recordErr) {
          this.logger.error(
            `Failed to persist compensation error for obligation ${obligationId}: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`,
          );
        }
      }
      return true;
    }

    // accountBlocked === null — leave the obligation in place for deletion to
    // resolve after the lease, or for the cron to reconcile as an orphan.
    return false;
  }

  /** Removes an obligation, logging rather than masking a storage/finalization error. */
  private async removeFinalizationObligation(obligationId: string): Promise<void> {
    if (!this.mediaFinalizationRepository) return;
    try {
      await this.mediaFinalizationRepository.delete(obligationId);
    } catch (err) {
      this.logger.warn(
        `Failed to clear media finalization obligation ${obligationId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Re-reads durable account state to confirm the media finalization is still
   * authorized after the R2 copy completed.
   */
  private async isFinalizationAllowed(userId: string): Promise<boolean> {
    if (!this.db) return true;

    const [userRow] = await this.db.select({ isBanned: users.isBanned }).from(users).where(eq(users.id, userId));

    if (!userRow || userRow.isBanned) return false;

    const [deletionRecord] = await this.db
      .select({ id: accountDeletions.id, status: accountDeletions.status })
      .from(accountDeletions)
      .where(eq(accountDeletions.userId, userId))
      .orderBy(sql`${accountDeletions.createdAt} DESC`)
      .limit(1);

    return !deletionRecord || !isAccountDeletionBlockedStatus(deletionRecord.status);
  }

  /** Deletes a single object, propagating failures so callers can retry durably. */
  private async deleteObject(key: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }),
    );
  }

  /**
   * Best-effort object deletion for blocked or compensated finalizations.
   * Deletion failures are logged but do not mask the authorization error: any
   * surviving staging object is covered by the staged-prefix sweep, and any
   * surviving permanent object is covered by the durable obligation layer.
   */
  private async deleteObjectQuietly(key: string, objectKind: string): Promise<void> {
    try {
      await this.deleteObject(key);
    } catch (err) {
      this.logger.warn(
        `Failed to delete ${objectKind} "${key}" after a blocked finalization: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Verifies a user-owned staged upload and predicts its final URLs.
   * Useful for DB insertion before moving the actual bytes.
   */
  async getExpectedMediaUrls(
    mediaId: string,
    userId: string,
    postId: string,
  ): Promise<{
    publicUrl: string;
    cloudflareStorageKey: string;
    fileContentType: string;
  }> {
    const [contentType, ownerId] = await Promise.all([
      this.cacheManager.get<string>(`media_ct:${mediaId}`),
      this.cacheManager.get<string>(`media_owner:${mediaId}`),
    ]);
    if (!contentType || ownerId !== userId) {
      throw new NotFoundError('Staged media', mediaId);
    }

    const ext = UploadService.mimeToExtension(contentType);
    const stagingKey = `staging/${userId}/${mediaId}${ext}`;
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: stagingKey,
        }),
      );
    } catch {
      throw new NotFoundError('Staged media', mediaId);
    }

    const finalKey = `posts/${postId}/${mediaId}${ext}`;
    return {
      publicUrl: `${this.publicUrl}/${finalKey}`,
      cloudflareStorageKey: finalKey,
      fileContentType: contentType,
    };
  }

  /**
   * Deletes a batch of storage keys from R2.
   * Throws if any object fails to delete, so cleanup targets are durably preserved for retry.
   */
  async deleteObjects(keys: string[]): Promise<void> {
    if (!keys || keys.length === 0) return;
    const batchSize = 1000;
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      try {
        const response = await this.s3Client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucketName,
            Delete: {
              Objects: batch.map((key) => ({ Key: key })),
              Quiet: true,
            },
          }),
        );
        if (response.Errors && response.Errors.length > 0) {
          const failedKeys = response.Errors.map((e) => e.Key).filter(Boolean);
          throw new Error(
            `R2 bulk delete returned ${response.Errors.length} object errors. Failed keys: ${failedKeys.slice(0, 5).join(', ')}`,
          );
        }
      } catch (err: unknown) {
        this.logger.warn(
          `Bulk delete failed, falling back to individual deletes: ${err instanceof Error ? err.message : String(err)}`,
        );
        const failedKeys: string[] = [];
        for (const key of batch) {
          try {
            await this.s3Client.send(
              new DeleteObjectCommand({
                Bucket: this.bucketName,
                Key: key,
              }),
            );
          } catch (individualErr: unknown) {
            this.logger.error(
              `Failed to delete object "${key}": ${individualErr instanceof Error ? individualErr.message : String(individualErr)}`,
            );
            failedKeys.push(key);
          }
        }
        if (failedKeys.length > 0) {
          throw new Error(
            `Failed to delete ${failedKeys.length} storage objects: ${failedKeys.slice(0, 5).join(', ')}`,
          );
        }
      }
    }
  }

  /**
   * Deletes all objects under a given key prefix (e.g. `staging/{userId}/`).
   * Propagates errors so callers never falsely assume complete deletion.
   */
  async deletePrefix(prefix: string): Promise<number> {
    let totalDeleted = 0;
    let continuationToken: string | undefined;

    do {
      const listResponse = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      const keys =
        listResponse.Contents?.map((o) => o.Key).filter((k): k is string => typeof k === 'string' && k.length > 0) ??
        [];
      if (keys.length > 0) {
        await this.deleteObjects(keys);
        totalDeleted += keys.length;
      }

      continuationToken = listResponse.IsTruncated ? listResponse.NextContinuationToken : undefined;
    } while (continuationToken);

    return totalDeleted;
  }
}

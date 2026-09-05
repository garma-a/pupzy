import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { eq, or, and, lt, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import { mediaDeletionWork, stagedUploads, commentMedia } from '../database/schema';
import { UploadService } from './upload.service';

/**
 * MediaDeletionProcessor — handles durable outbox processing for media deletion
 * (R2 deletion and CDN purge) as well as hourly cleanup of abandoned staging.
 *
 * Runs inside the main API / AdminJS topology (no fourth service needed).
 */
@Injectable()
export class MediaDeletionProcessor {
  private readonly logger = new Logger(MediaDeletionProcessor.name);

  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: NodePgDatabase<typeof schema>,
    private readonly uploadService: UploadService,
  ) {}

  /**
   * Processes pending media deletion outbox items.
   * Runs every minute in the background, or can be triggered directly.
   * Deletes object from R2 and purges CDN cache.
   * Retries idempotently with max 5 attempts before marking FAILED for operator intervention.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processPendingWork(): Promise<number> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Pick PENDING items or PROCESSING items stuck for > 5 minutes
    const pendingItems = await this.db
      .select()
      .from(mediaDeletionWork)
      .where(
        or(
          eq(mediaDeletionWork.status, 'PENDING'),
          and(eq(mediaDeletionWork.status, 'PROCESSING'), lt(mediaDeletionWork.updatedAt, fiveMinutesAgo)),
        ),
      )
      .limit(50);

    if (pendingItems.length === 0) {
      return 0;
    }

    let processedCount = 0;

    for (const item of pendingItems) {
      // Atomic conditional claim: ensures overlapping workers cannot race or double-claim
      const [claimed] = await this.db
        .update(mediaDeletionWork)
        .set({
          status: 'PROCESSING',
          attempts: sql`${mediaDeletionWork.attempts} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mediaDeletionWork.id, item.id),
            or(
              eq(mediaDeletionWork.status, 'PENDING'),
              and(eq(mediaDeletionWork.status, 'PROCESSING'), lt(mediaDeletionWork.updatedAt, fiveMinutesAgo)),
            ),
          ),
        )
        .returning();

      if (!claimed) {
        // Another worker claimed or completed this item; skip safely
        continue;
      }

      const nextAttempts = claimed.attempts;

      try {
        // Step 1: Delete from R2 (idempotent)
        await this.uploadService.deleteObject(claimed.storageKey);

        // Step 2: Purge CDN cache (idempotent)
        await this.uploadService.purgeCdn(claimed.cdnUrl);

        // Step 3: Mark COMPLETED conditionally ensuring row is still PROCESSING
        await this.db
          .update(mediaDeletionWork)
          .set({
            status: 'COMPLETED',
            lastError: null,
            updatedAt: new Date(),
          })
          .where(and(eq(mediaDeletionWork.id, claimed.id), eq(mediaDeletionWork.status, 'PROCESSING')));

        processedCount++;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to process media deletion work ${claimed.id} (attempt ${nextAttempts}): ${errorMessage}`,
        );

        if (nextAttempts >= 5) {
          // Visible for operator intervention
          await this.db
            .update(mediaDeletionWork)
            .set({
              status: 'FAILED',
              lastError: errorMessage,
              updatedAt: new Date(),
            })
            .where(and(eq(mediaDeletionWork.id, claimed.id), eq(mediaDeletionWork.status, 'PROCESSING')));
        } else {
          // Retryable
          await this.db
            .update(mediaDeletionWork)
            .set({
              status: 'PENDING',
              lastError: errorMessage,
              updatedAt: new Date(),
            })
            .where(and(eq(mediaDeletionWork.id, claimed.id), eq(mediaDeletionWork.status, 'PROCESSING')));
        }
      }
    }

    return processedCount;
  }

  /**
   * Hourly cleanup of expired unconsumed staged uploads.
   * Deletes staging objects from R2 and marks status = 'EXPIRED'.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredStaging(): Promise<number> {
    const now = new Date();

    const expiredRows = await this.db
      .select()
      .from(stagedUploads)
      .where(and(inArray(stagedUploads.status, ['ISSUED', 'CLAIMED']), lt(stagedUploads.expiresAt, now)))
      .limit(100);

    if (expiredRows.length === 0) {
      return 0;
    }

    let cleanedCount = 0;

    for (const row of expiredRows) {
      // Delete staging object from R2
      await this.uploadService.deleteObject(row.stagingKey).catch((err) => {
        this.logger.warn(`Failed to delete expired staging object ${row.stagingKey}: ${err}`);
      });

      // If it had a finalStorageKey that was never finalized in comment_media, queue it or delete it
      if (row.finalStorageKey) {
        await this.uploadService.deleteObject(row.finalStorageKey).catch(() => {});
      }

      await this.db
        .update(stagedUploads)
        .set({
          status: 'EXPIRED',
          updatedAt: new Date(),
        })
        .where(eq(stagedUploads.id, row.id));

      cleanedCount++;
    }

    return cleanedCount;
  }

  /**
   * Idempotent reconciler: cleans expired staging, processes pending deletions,
   * and compensates any orphaned finalized objects.
   */
  async reconcile(): Promise<{
    cleanedStaging: number;
    processedDeletionWork: number;
    orphanedCompensated: number;
  }> {
    const cleanedStaging = await this.cleanupExpiredStaging();
    const processedDeletionWork = await this.processPendingWork();

    // Check for orphaned finalized objects:
    // Staged uploads that are CLAIMED or FAILED with a finalStorageKey where no row exists in commentMedia
    let orphanedCompensated = 0;
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

    const potentiallyOrphaned = await this.db
      .select()
      .from(stagedUploads)
      .where(
        and(
          eq(stagedUploads.purpose, 'COMMENT_IMAGE'),
          or(eq(stagedUploads.status, 'CLAIMED'), eq(stagedUploads.status, 'FAILED')),
          lt(stagedUploads.updatedAt, fifteenMinutesAgo),
          sql`${stagedUploads.finalStorageKey} IS NOT NULL`,
        ),
      );

    for (const orphan of potentiallyOrphaned) {
      if (orphan.finalStorageKey) {
        const [exists] = await this.db
          .select({ id: commentMedia.id })
          .from(commentMedia)
          .where(eq(commentMedia.storageKey, orphan.finalStorageKey))
          .limit(1);

        if (!exists) {
          const purgeUrls = this.uploadService.getPurgeCdnUrls
            ? this.uploadService.getPurgeCdnUrls(orphan.finalStorageKey)
            : [this.uploadService.getPublicCdnUrl(orphan.finalStorageKey)];
          for (const cdnUrl of purgeUrls) {
            await this.db.insert(mediaDeletionWork).values({
              storageKey: orphan.finalStorageKey,
              cdnUrl,
              status: 'PENDING',
              attempts: 0,
            });
          }
          orphanedCompensated++;
        }
      }
    }

    return {
      cleanedStaging,
      processedDeletionWork,
      orphanedCompensated,
    };
  }
}

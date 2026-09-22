import { Injectable, Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { eq, or, and, lt, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import { mediaDeletionWork, stagedUploads, commentMedia, users, type StagedUpload } from '../database/schema';
import { UploadService } from './upload.service';

/**
 * MediaDeletionProcessor — handles durable outbox processing for media deletion
 * (R2 deletion and CDN purge), hourly cleanup of abandoned staging, and
 * automatic reconciliation of interrupted comment image publishing.
 *
 * Runs inside the main API / AdminJS topology (no fourth service needed).
 */
@Injectable()
export class MediaDeletionProcessor implements OnApplicationBootstrap {
  private readonly logger = new Logger(MediaDeletionProcessor.name);

  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: NodePgDatabase<typeof schema>,
    private readonly uploadService: UploadService,
  ) {}

  /**
   * Automatic startup reconciliation: executes when the NestJS application starts up.
   * Ensures interrupted publishes and pending deletions converge after crash/restart.
   */
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Executing startup reconciliation for comment media publishing...');
    try {
      await this.reconcile();
    } catch (err) {
      this.logger.error(`Startup reconciliation error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Periodic reconciliation running every 5 minutes in background topology.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handlePeriodicReconciliation(): Promise<void> {
    try {
      await this.reconcile();
    } catch (err) {
      this.logger.error(`Periodic reconciliation error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

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
        // AC 6: Safety guard to prevent deleting committed media under any race or stale state
        const [committed] = await this.db
          .select({ id: commentMedia.id })
          .from(commentMedia)
          .where(eq(commentMedia.storageKey, claimed.storageKey))
          .limit(1);

        if (committed) {
          this.logger.warn(
            `Safety guard: skipping deletion of ${claimed.storageKey} because it is actively referenced in comment_media`,
          );
          await this.db
            .update(mediaDeletionWork)
            .set({
              status: 'COMPLETED',
              lastError: 'Skipped: media is committed to comment',
              updatedAt: new Date(),
            })
            .where(and(eq(mediaDeletionWork.id, claimed.id), eq(mediaDeletionWork.status, 'PROCESSING')));
          continue;
        }

        // Safety guard: never delete the profile photo an account currently
        // references. Replacement/removal queue only the superseded key, so a
        // referenced key here means the work row is stale or wrong.
        const [activeAvatar] = await this.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.profilePhotoStorageKey, claimed.storageKey))
          .limit(1);

        if (activeAvatar) {
          this.logger.warn(
            `Safety guard: skipping deletion of ${claimed.storageKey} because it is the active profile photo`,
          );
          await this.db
            .update(mediaDeletionWork)
            .set({
              status: 'COMPLETED',
              lastError: 'Skipped: media is the active profile photo',
              updatedAt: new Date(),
            })
            .where(and(eq(mediaDeletionWork.id, claimed.id), eq(mediaDeletionWork.status, 'PROCESSING')));
          continue;
        }

        // Step 1: Delete from R2 (idempotent)
        await this.uploadService.deleteObject(claimed.storageKey);

        // Step 2: Purge CDN cache (idempotent) if cdnUrl is present
        if (claimed.cdnUrl && claimed.cdnUrl.trim() !== '') {
          await this.uploadService.purgeCdn(claimed.cdnUrl);
        }

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
  async cleanupExpiredStaging(options?: { olderThanMs?: number }): Promise<number> {
    const now = new Date();
    const cutoffDate = new Date(Date.now() - (options?.olderThanMs ?? 5 * 60 * 1000));

    const expiredRows = await this.db
      .select()
      .from(stagedUploads)
      .where(
        and(
          sql`NOT (${stagedUploads.stagingKey} LIKE 'cleaned/%')`,
          or(
            and(inArray(stagedUploads.status, ['ISSUED', 'CLAIMED']), lt(stagedUploads.expiresAt, now)),
            and(eq(stagedUploads.status, 'FAILED'), lt(stagedUploads.updatedAt, cutoffDate)),
          ),
        ),
      )
      .limit(100);

    if (expiredRows.length === 0) {
      return 0;
    }

    let cleanedCount = 0;

    for (const row of expiredRows) {
      // Delete staging object from R2
      try {
        await this.uploadService.deleteObject(row.stagingKey);
      } catch (err) {
        this.logger.warn(`Failed to delete expired staging object ${row.stagingKey}: ${err}`);
        await this.uploadService.queueMediaDeletion(row.stagingKey).catch(() => {});
      }

      // If it had a finalStorageKey that was never finalized in comment_media, queue it or delete it
      if (row.finalStorageKey) {
        const [exists] = await this.db
          .select({ id: commentMedia.id })
          .from(commentMedia)
          .where(eq(commentMedia.storageKey, row.finalStorageKey))
          .limit(1);

        if (!exists) {
          try {
            await this.uploadService.deleteObject(row.finalStorageKey);
          } catch {
            await this.uploadService.queueMediaDeletion(row.finalStorageKey).catch(() => {});
          }
        }
      }

      const nextStatus = row.status === 'FAILED' ? 'FAILED' : 'EXPIRED';
      await this.db
        .update(stagedUploads)
        .set({
          status: nextStatus,
          stagingKey: `cleaned/${row.stagingKey}`,
          updatedAt: new Date(),
        })
        .where(eq(stagedUploads.id, row.id));

      cleanedCount++;
    }

    return cleanedCount;
  }

  /**
   * Idempotent reconciler: cleans expired staging, processes pending deletions,
   * compensates copied-but-uncommitted objects, and cleans committed-but-uncleaned staging.
   *
   * Runs on application startup (OnApplicationBootstrap) and every 5 minutes (@Cron).
   */
  async reconcile(options?: { olderThanMs?: number }): Promise<{
    cleanedStaging: number;
    processedDeletionWork: number;
    orphanedCompensated: number;
    uncommittedRecovered: number;
    committedCleaned: number;
    orphanedProfilePhotosRecovered: number;
  }> {
    const cleanedStaging = await this.cleanupExpiredStaging(options);

    const cutoffDate = new Date(Date.now() - (options?.olderThanMs ?? 5 * 60 * 1000));
    let uncommittedRecovered = 0;
    let committedCleaned = 0;

    // 1. Copied-but-uncommitted state (AC 2):
    // Staged uploads that are CLAIMED, FINALIZED, or FAILED with a finalStorageKey where no row exists in commentMedia
    const potentiallyUncommitted = await this.db
      .select()
      .from(stagedUploads)
      .where(
        and(
          eq(stagedUploads.purpose, 'COMMENT_IMAGE'),
          inArray(stagedUploads.status, ['CLAIMED', 'FINALIZED', 'FAILED']),
          lt(stagedUploads.updatedAt, cutoffDate),
          sql`${stagedUploads.finalStorageKey} IS NOT NULL`,
        ),
      );

    for (const orphan of potentiallyUncommitted) {
      if (!orphan.finalStorageKey) continue;

      const [exists] = await this.db
        .select({ id: commentMedia.id })
        .from(commentMedia)
        .where(eq(commentMedia.storageKey, orphan.finalStorageKey))
        .limit(1);

      if (!exists) {
        // No row in comment_media: uncommitted!
        // Atomically transition status to FAILED using conditional update
        let transitioned = orphan.status === 'FAILED';
        if (orphan.status !== 'FAILED') {
          const [updated] = await this.db
            .update(stagedUploads)
            .set({
              status: 'FAILED',
              errorMessage: 'Reconciled uncommitted comment media',
              updatedAt: new Date(),
            })
            .where(and(eq(stagedUploads.id, orphan.id), eq(stagedUploads.status, orphan.status)))
            .returning();
          transitioned = !!updated;
        }

        if (transitioned) {
          // Re-verify that comment_media was not created concurrently
          const [recheck] = await this.db
            .select({ id: commentMedia.id })
            .from(commentMedia)
            .where(eq(commentMedia.storageKey, orphan.finalStorageKey))
            .limit(1);

          if (!recheck) {
            // Attempt immediate R2 deletion of finalStorageKey
            await this.uploadService.deleteObject(orphan.finalStorageKey).catch(() => {});

            // Queue durable deletion in media_deletion_work for finalStorageKey and purge URLs
            const purgeUrls = this.uploadService.getPurgeCdnUrls
              ? this.uploadService.getPurgeCdnUrls(orphan.finalStorageKey)
              : [this.uploadService.getPublicCdnUrl(orphan.finalStorageKey)];

            for (const cdnUrl of purgeUrls) {
              const [alreadyQueued] = await this.db
                .select({ id: mediaDeletionWork.id })
                .from(mediaDeletionWork)
                .where(
                  and(eq(mediaDeletionWork.storageKey, orphan.finalStorageKey), eq(mediaDeletionWork.cdnUrl, cdnUrl)),
                )
                .limit(1);

              if (!alreadyQueued) {
                await this.db.insert(mediaDeletionWork).values({
                  storageKey: orphan.finalStorageKey,
                  cdnUrl,
                  status: 'PENDING',
                  attempts: 0,
                });
              }
            }

            // Clean staging object if not already cleaned
            if (orphan.stagingKey && !orphan.stagingKey.startsWith('cleaned/')) {
              await this.uploadService.deleteObject(orphan.stagingKey).catch(() => {});
              await this.db
                .update(stagedUploads)
                .set({
                  stagingKey: `cleaned/${orphan.stagingKey}`,
                  updatedAt: new Date(),
                })
                .where(eq(stagedUploads.id, orphan.id));
            }

            uncommittedRecovered++;
          }
        }
      }
    }

    // 2. Committed-but-not-cleaned state (AC 2):
    // Staged uploads that are FINALIZED with finalStorageKey and updatedAt < cutoffDate
    // where commentMedia DOES have a matching row
    const potentiallyCommitted = await this.db
      .select()
      .from(stagedUploads)
      .where(
        and(
          eq(stagedUploads.purpose, 'COMMENT_IMAGE'),
          eq(stagedUploads.status, 'FINALIZED'),
          lt(stagedUploads.updatedAt, cutoffDate),
          sql`${stagedUploads.finalStorageKey} IS NOT NULL`,
          sql`NOT (${stagedUploads.stagingKey} LIKE 'cleaned/%')`,
        ),
      );

    for (const committed of potentiallyCommitted) {
      if (!committed.finalStorageKey) continue;

      const [exists] = await this.db
        .select({ id: commentMedia.id })
        .from(commentMedia)
        .where(eq(commentMedia.storageKey, committed.finalStorageKey))
        .limit(1);

      if (exists) {
        // Comment was committed! Delete stagingKey from R2
        await this.uploadService.deleteObject(committed.stagingKey).catch((delErr) => {
          this.logger.warn(`Failed to delete staging object ${committed.stagingKey} during reconciliation: ${delErr}`);
        });

        await this.db
          .update(stagedUploads)
          .set({
            stagingKey: `cleaned/${committed.stagingKey}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(stagedUploads.id, committed.id),
              eq(stagedUploads.status, 'FINALIZED'),
              eq(stagedUploads.stagingKey, committed.stagingKey),
            ),
          );

        committedCleaned++;
      }
    }

    // 3. Owned profile-photo recovery: a finalized avatar the account no
    // longer references (crash between object publication and the owning row
    // update, or a compensated replacement) is reclaimed. The reference is
    // re-checked under the owner row lock and the ticket is made terminal
    // before any storage deletion, so a referenced avatar is never deleted;
    // only its leftover staging object is cleaned.
    const potentiallyOrphanedAvatars = await this.db
      .select()
      .from(stagedUploads)
      .where(
        and(
          eq(stagedUploads.purpose, 'PROFILE_PHOTO'),
          inArray(stagedUploads.status, ['CLAIMED', 'FINALIZED', 'FAILED']),
          lt(stagedUploads.updatedAt, cutoffDate),
          sql`${stagedUploads.finalStorageKey} IS NOT NULL`,
        ),
      );

    let orphanedProfilePhotosRecovered = 0;

    for (const orphan of potentiallyOrphanedAvatars) {
      if (!orphan.finalStorageKey) continue;

      const outcome = await this.reclaimOrphanedProfilePhoto(orphan);
      if (outcome === 'SKIPPED') continue;

      if (orphan.stagingKey && !orphan.stagingKey.startsWith('cleaned/')) {
        await this.uploadService.deleteObject(orphan.stagingKey).catch(() => {});
        await this.db
          .update(stagedUploads)
          .set({ stagingKey: `cleaned/${orphan.stagingKey}`, updatedAt: new Date() })
          .where(eq(stagedUploads.id, orphan.id));
      }

      if (outcome === 'RECLAIMED') {
        orphanedProfilePhotosRecovered++;
      }
    }

    // Process pending deletion work
    const processedDeletionWork = await this.processPendingWork();

    return {
      cleanedStaging,
      processedDeletionWork,
      orphanedCompensated: uncommittedRecovered,
      uncommittedRecovered,
      committedCleaned,
      orphanedProfilePhotosRecovered,
    };
  }

  /**
   * Coordinates reclaiming one finalized-but-unreferenced avatar with profile
   * activation. The owner row is locked with the same `FOR UPDATE` lock
   * `activateProfilePhoto` takes, so the reference re-check, the terminal
   * ticket transition and the durable deletion-work enqueue commit as one
   * snapshot: an activation either commits before this transaction (the
   * avatar reads as referenced and only its leftover staging is cleaned) or
   * observes the terminal ticket and is rejected instead of installing bytes
   * that are already queued for deletion. When the owner row is already gone
   * (cascaded account deletion), both the permanent and any leftover staging
   * key are enqueued in the same transaction instead of being skipped.
   *
   * Storage deletion happens only after the transaction commits; the queued
   * `media_deletion_work` row remains the durable retry path.
   */
  private async reclaimOrphanedProfilePhoto(orphan: StagedUpload): Promise<'RECLAIMED' | 'REFERENCED' | 'SKIPPED'> {
    const finalStorageKey = orphan.finalStorageKey;
    if (!finalStorageKey) return 'SKIPPED';

    const outcome = await this.db.transaction(async (tx) => {
      const enqueueAvatarDeletion = async (storageKey: string): Promise<void> => {
        // Avatars have no CDN purge policy: one storage-only deletion row,
        // deduplicated against any row already queued for the same key.
        const [alreadyQueued] = await tx
          .select({ id: mediaDeletionWork.id })
          .from(mediaDeletionWork)
          .where(and(eq(mediaDeletionWork.storageKey, storageKey), eq(mediaDeletionWork.cdnUrl, '')))
          .limit(1);

        if (!alreadyQueued) {
          await tx.insert(mediaDeletionWork).values({
            storageKey,
            cdnUrl: '',
            status: 'PENDING',
            attempts: 0,
          });
        }
      };

      const [owner] = await tx
        .select({ id: users.id, profilePhotoStorageKey: users.profilePhotoStorageKey })
        .from(users)
        .where(eq(users.id, orphan.userId))
        .for('update');

      if (!owner) {
        // The owner row cascaded away with the account between the candidate
        // scan and this reclaim (its ticket row cascaded with it). No row can
        // reference the permanent object and the terminal ticket can no longer
        // be re-selected, so queue both the permanent and any leftover staging
        // object durably instead of leaking them.
        await enqueueAvatarDeletion(finalStorageKey);
        if (orphan.stagingKey && !orphan.stagingKey.startsWith('cleaned/')) {
          await enqueueAvatarDeletion(orphan.stagingKey);
        }
        return 'RECLAIMED' as const;
      }

      if (owner.profilePhotoStorageKey === finalStorageKey) return 'REFERENCED' as const;

      const [reclaimed] = await tx
        .update(stagedUploads)
        .set({
          status: 'EXPIRED',
          errorMessage: 'Reclaimed orphaned profile photo',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stagedUploads.id, orphan.id),
            eq(stagedUploads.userId, orphan.userId),
            eq(stagedUploads.purpose, 'PROFILE_PHOTO'),
            eq(stagedUploads.finalStorageKey, finalStorageKey),
            inArray(stagedUploads.status, ['CLAIMED', 'FINALIZED', 'FAILED']),
          ),
        )
        .returning({ id: stagedUploads.id });

      if (!reclaimed) return 'SKIPPED' as const;

      await enqueueAvatarDeletion(finalStorageKey);

      // The ticket is now terminal, so it can no longer be re-selected to
      // clean leftover staging; queue it durably in the same transaction.
      if (orphan.stagingKey && !orphan.stagingKey.startsWith('cleaned/')) {
        await enqueueAvatarDeletion(orphan.stagingKey);
      }

      return 'RECLAIMED' as const;
    });

    if (outcome === 'RECLAIMED') {
      await this.uploadService.deleteObject(finalStorageKey).catch(() => {});
    }

    return outcome;
  }
}

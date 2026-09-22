import { Injectable, Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { eq, or, and, gte, lt, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import {
  mediaDeletionWork,
  stagedUploads,
  commentMedia,
  postMedia,
  mediaFinalizations,
  users,
  type StagedUpload,
  type StagedUploadStatus,
} from '../database/schema';
import { UploadService } from './upload.service';
import { MEDIA_FINALIZATION_LEASE_MS } from './media-finalization.repository';

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
   *
   * The staging object is always safe to remove for a selected candidate: an
   * expired ticket can no longer be claimed, and an in-flight finalization
   * republishes bytes it already downloaded, so a leftover staging object can
   * never be the only copy of a consumed object. Permanent objects are only
   * reclaimed through `reclaimCandidate`, which re-checks the ticket's current
   * state and the committed reference inside one transaction before any
   * storage I/O. A ticket that was finalized/activated between the candidate
   * scan and processing is therefore never deleted or marked `EXPIRED`.
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
      await this.cleanupExpiredCandidate(row);
      cleanedCount++;
    }

    return cleanedCount;
  }

  /**
   * Processes one candidate selected by `cleanupExpiredStaging`.
   *
   * The staging object is removed best-effort first (durable fallback on
   * provider failure). A candidate with a permanent object is then coordinated
   * through `reclaimCandidate`, which re-checks the ticket's current state
   * before any terminal transition or storage deletion.
   */
  private async cleanupExpiredCandidate(row: StagedUpload): Promise<void> {
    try {
      await this.uploadService.deleteObject(row.stagingKey);
    } catch (err) {
      this.logger.warn(`Failed to delete expired staging object ${row.stagingKey}: ${err}`);
      await this.uploadService.queueMediaDeletion(row.stagingKey).catch(() => {});
    }

    if (row.finalStorageKey) {
      const outcome = await this.reclaimCandidate(row, 'EXPIRED_CLEANUP');

      if (outcome === 'SKIPPED') {
        // The ticket was consumed (FINALIZED) between the candidate scan and
        // this pass, or a finalization for its permanent key is still in
        // flight; the consuming flow owns the ticket and its object. The row
        // stays re-selectable so a later pass can reclaim it if that flow
        // fails.
        this.logger.warn(
          `Skipped expired staging cleanup for ${row.id}: the ticket is still live (consumed or finalization in flight)`,
        );
        return;
      }

      // RECLAIMED (terminal ticket, deletion work queued) or REFERENCED (live
      // object kept); in both cases the leftover staging key is now handled.
      await this.markStagingKeyCleaned(row);
      return;
    }

    // No permanent object: terminalize conditionally so a ticket consumed
    // between the scan and now is never marked EXPIRED.
    const nextStatus: StagedUploadStatus = row.status === 'FAILED' ? 'FAILED' : 'EXPIRED';
    const [terminalized] = await this.db
      .update(stagedUploads)
      .set({
        status: nextStatus,
        stagingKey: `cleaned/${row.stagingKey}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stagedUploads.id, row.id),
          eq(stagedUploads.userId, row.userId),
          eq(stagedUploads.purpose, row.purpose),
          inArray(stagedUploads.status, ['ISSUED', 'CLAIMED', 'FAILED']),
        ),
      )
      .returning({ id: stagedUploads.id });

    if (!terminalized) {
      this.logger.warn(
        `Skipped expired staging cleanup for ${row.id}: the ticket changed state before it was processed`,
      );
    }
  }

  /** Marks a candidate's staging key as cleaned once the caller handled it. */
  private async markStagingKeyCleaned(row: StagedUpload): Promise<void> {
    if (row.stagingKey.startsWith('cleaned/')) return;
    await this.db
      .update(stagedUploads)
      .set({ stagingKey: `cleaned/${row.stagingKey}`, updatedAt: new Date() })
      .where(and(eq(stagedUploads.id, row.id), eq(stagedUploads.stagingKey, row.stagingKey)));
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
   * Reclaims one finalized-but-unreferenced avatar through the shared
   * coordination (orphan-recovery mode also accepts FINALIZED tickets).
   */
  private async reclaimOrphanedProfilePhoto(orphan: StagedUpload): Promise<'RECLAIMED' | 'REFERENCED' | 'SKIPPED'> {
    return this.reclaimCandidate(orphan, 'ORPHAN_RECOVERY');
  }

  /**
   * Coordinates terminalizing one staged-upload candidate with every path
   * that can still consume or activate its permanent object, then durably
   * enqueues deletion work for that object and any leftover staging object.
   *
   * `PROFILE_PHOTO` candidates are coordinated with activation by locking the
   * owner `users` row — the same `FOR UPDATE` lock `activateProfilePhoto`
   * takes — and re-checking `profile_photo_storage_key`, so the reference
   * re-check, the terminal ticket transition and the durable enqueue commit as
   * one snapshot. An activation that committed first reads as referenced and
   * only the staging object is cleaned; an activation that arrives afterwards
   * observes the terminal ticket and is rejected instead of installing bytes
   * that are already queued for deletion. When the owner row is already gone
   * (cascaded account deletion), both the permanent and any leftover staging
   * key are enqueued in the same transaction instead of being skipped.
   *
   * Other purposes are coordinated through the ticket row. The conditional
   * terminal update below makes the consuming request lose its
   * `CLAIMED → FINALIZED` transition, and `finalizeCommentImages` /
   * `finalizeMedia` discard their published object when they lose that
   * transition instead of letting a comment or post commit against bytes
   * that are queued for deletion. A committed comment image (`comment_media`
   * row) or post media object (`post_media` row) is re-checked inside this
   * transaction before any terminal transition, and an already-`FINALIZED`
   * ticket makes the conditional update match nothing so its object is left
   * alone. For `POST_MEDIA` a fresh `IN_FLIGHT` finalization obligation
   * (`media_finalizations`, the same lease account deletion trusts) also
   * keeps the candidate live, because the copy may still be publishing the
   * exact key this reclaim would delete.
   *
   * Storage deletion happens only after the transaction commits; the queued
   * `media_deletion_work` rows remain the durable retry path.
   */
  private async reclaimCandidate(
    candidate: StagedUpload,
    mode: 'EXPIRED_CLEANUP' | 'ORPHAN_RECOVERY',
  ): Promise<'RECLAIMED' | 'REFERENCED' | 'SKIPPED'> {
    const finalStorageKey = candidate.finalStorageKey;
    if (!finalStorageKey) return 'SKIPPED';

    // Orphan recovery also reclaims FINALIZED-but-never-activated avatars;
    // expired cleanup must never touch a ticket that reached a consuming state.
    const terminalizableStatuses: StagedUploadStatus[] =
      mode === 'ORPHAN_RECOVERY' ? ['CLAIMED', 'FINALIZED', 'FAILED'] : ['ISSUED', 'CLAIMED', 'FAILED'];

    const outcome = await this.db.transaction(async (tx) => {
      const enqueueDeletionWork = async (storageKey: string): Promise<void> => {
        // Avatars and post media carry no CDN purge policy (a single
        // storage-only row); comment media purges every configured domain.
        // Deduplicate against any existing row for the same key and URL.
        const purgeUrls = storageKey.startsWith('comments/')
          ? this.uploadService.getPurgeCdnUrls
            ? this.uploadService.getPurgeCdnUrls(storageKey)
            : [this.uploadService.getPublicCdnUrl(storageKey)]
          : [''];

        for (const cdnUrl of purgeUrls) {
          const [alreadyQueued] = await tx
            .select({ id: mediaDeletionWork.id })
            .from(mediaDeletionWork)
            .where(and(eq(mediaDeletionWork.storageKey, storageKey), eq(mediaDeletionWork.cdnUrl, cdnUrl)))
            .limit(1);

          if (!alreadyQueued) {
            await tx.insert(mediaDeletionWork).values({
              storageKey,
              cdnUrl,
              status: 'PENDING',
              attempts: 0,
            });
          }
        }
      };

      if (candidate.purpose === 'PROFILE_PHOTO') {
        const [owner] = await tx
          .select({ id: users.id, profilePhotoStorageKey: users.profilePhotoStorageKey })
          .from(users)
          .where(eq(users.id, candidate.userId))
          .for('update');

        if (!owner) {
          // The owner row cascaded away with the account between the candidate
          // scan and this reclaim (its ticket row cascaded with it). No row can
          // reference the permanent object and the ticket can no longer be
          // re-selected, so queue both the permanent and any leftover staging
          // object durably instead of leaking them.
          await enqueueDeletionWork(finalStorageKey);
          if (candidate.stagingKey && !candidate.stagingKey.startsWith('cleaned/')) {
            await enqueueDeletionWork(candidate.stagingKey);
          }
          return 'RECLAIMED' as const;
        }

        if (owner.profilePhotoStorageKey === finalStorageKey) return 'REFERENCED' as const;
      } else if (candidate.purpose === 'COMMENT_IMAGE') {
        // A committed comment image is live even when its ticket looks stale.
        // The reference check runs inside this transaction, and the conditional
        // ticket update below keeps a still-in-flight finalization from
        // committing after this transaction wins.
        const [committed] = await tx
          .select({ id: commentMedia.id })
          .from(commentMedia)
          .where(eq(commentMedia.storageKey, finalStorageKey))
          .limit(1);

        if (committed) return 'REFERENCED' as const;
      } else if (candidate.purpose === 'POST_MEDIA') {
        // A media object referenced by a committed post is live even when its
        // ticket looks stale; never reclaim it.
        const [committed] = await tx
          .select({ id: postMedia.id })
          .from(postMedia)
          .where(eq(postMedia.cloudflareStorageKey, finalStorageKey))
          .limit(1);

        if (committed) return 'REFERENCED' as const;

        // A fresh in-flight finalization obligation means a live copy may
        // still publish this exact key. Reclaiming now would terminalize the
        // ticket underneath that copy; `finalizeMedia` would then lose its
        // conditional transition and discard its object. Wait for the
        // obligation to settle and re-select the still-live ticket instead.
        // Staleness uses the same lease account deletion trusts.
        const freshObligationSince = new Date(Date.now() - MEDIA_FINALIZATION_LEASE_MS);
        const [inFlight] = await tx
          .select({ id: mediaFinalizations.id })
          .from(mediaFinalizations)
          .where(
            and(
              eq(mediaFinalizations.finalKey, finalStorageKey),
              eq(mediaFinalizations.status, 'IN_FLIGHT'),
              gte(mediaFinalizations.updatedAt, freshObligationSince),
            ),
          )
          .limit(1);

        if (inFlight) return 'SKIPPED' as const;
      }

      const terminalStatus: StagedUploadStatus =
        mode === 'ORPHAN_RECOVERY' || candidate.status !== 'FAILED' ? 'EXPIRED' : 'FAILED';

      const [reclaimed] = await tx
        .update(stagedUploads)
        .set({
          status: terminalStatus,
          errorMessage:
            mode === 'ORPHAN_RECOVERY' ? 'Reclaimed orphaned profile photo' : 'Reclaimed expired staged upload',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stagedUploads.id, candidate.id),
            eq(stagedUploads.userId, candidate.userId),
            eq(stagedUploads.purpose, candidate.purpose),
            eq(stagedUploads.finalStorageKey, finalStorageKey),
            inArray(stagedUploads.status, terminalizableStatuses),
          ),
        )
        .returning({ id: stagedUploads.id });

      if (!reclaimed) return 'SKIPPED' as const;

      await enqueueDeletionWork(finalStorageKey);

      // The ticket is now terminal, so it can no longer be re-selected to
      // clean leftover staging; queue it durably in the same transaction.
      if (candidate.stagingKey && !candidate.stagingKey.startsWith('cleaned/')) {
        await enqueueDeletionWork(candidate.stagingKey);
      }

      return 'RECLAIMED' as const;
    });

    if (outcome === 'RECLAIMED') {
      await this.uploadService.deleteObject(finalStorageKey).catch(() => {});
    }

    return outcome;
  }
}

import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import { ANNOUNCEMENT_FAN_OUT_BATCH_SIZE } from './admin-announcement.contract';
import { AdminAnnouncementRepository, type AnnouncementBatchOutcome } from './admin-announcement.repository';
import { PushDeliveryProcessor } from './push-delivery.processor';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

export interface AnnouncementProcessingResult {
  batchesProcessed: number;
  /** In-app notifications created in this pass. */
  notified: number;
  /** Push delivery intents created in this pass. */
  pushIntents: number;
  /** Announcements that reached SENT in this pass. */
  completed: number;
  /** Batches that rolled back and were recorded as a failed attempt. */
  failedBatches: number;
}

/** A pass gives up after this many failed batches; the cron retries after the backoff. */
const MAX_FAILED_BATCHES_PER_PASS = 3;

/**
 * AdminAnnouncementProcessor — fans an administrator's Announcement out to its
 * audience in durable background batches.
 *
 * ## Trigger
 * The admin service only writes a PENDING `announcements` row, so this worker
 * finds the work itself: at application start (resuming anything a restart
 * interrupted) and on a one-minute cron, like the other durable processors. A
 * send therefore starts within about a minute and then runs batch after batch
 * without pausing.
 *
 * ## Batches
 * Each batch is ONE transaction that locks the announcement row, creates up to
 * `ANNOUNCEMENT_FAN_OUT_BATCH_SIZE` notifications with their push delivery
 * intents, and advances the cursor and counters. A crash loses at most the
 * batch in flight, which rolls back whole; the cursor says where to resume and
 * the unique `(announcement_id, recipient_id)` guard makes a repeat harmless.
 *
 * ## Frozen audience
 * The audience is the accounts registered at or before the send (see
 * `announcements.audience_cutoff_at`), walked in id order from the cursor.
 *
 * ## Push
 * Intents are only written here. `PushDeliveryProcessor` sends them and
 * rechecks preference, account state and isolation first, like every other
 * type, and is nudged after a pass that created intents.
 */
@Injectable()
export class AdminAnnouncementProcessor implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminAnnouncementProcessor.name);
  private isProcessing = false;

  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly repository: AdminAnnouncementRepository,
    @Optional()
    @Inject(PushDeliveryProcessor)
    private readonly pushDeliveryProcessor?: PushDeliveryProcessor,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.processPendingAnnouncements();
    } catch (error) {
      this.logger.error('Unable to resume durable announcement delivery at startup', error);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processScheduledAnnouncements(): Promise<void> {
    try {
      await this.processPendingAnnouncements();
    } catch (error) {
      this.logger.error('Unable to deliver scheduled announcements', error);
    }
  }

  /**
   * Runs batches until no due announcement remains. Public for restart,
   * failure and multi-worker tests; database row locks protect competing API
   * processes.
   */
  async processPendingAnnouncements(options?: {
    maxBatches?: number;
    batchSize?: number;
  }): Promise<AnnouncementProcessingResult> {
    const result: AnnouncementProcessingResult = {
      batchesProcessed: 0,
      notified: 0,
      pushIntents: 0,
      completed: 0,
      failedBatches: 0,
    };
    if (this.isProcessing) return result;
    this.isProcessing = true;

    const maxBatches = options?.maxBatches ?? Infinity;
    const batchSize = options?.batchSize ?? ANNOUNCEMENT_FAN_OUT_BATCH_SIZE;

    try {
      while (result.batchesProcessed < maxBatches && result.failedBatches < MAX_FAILED_BATCHES_PER_PASS) {
        // Set inside the transaction so a failure can be attributed to its announcement
        // after the rollback.
        let claimedId: string | null = null;
        try {
          const outcome = await this.db.transaction(async (tx) => {
            const claimed = await this.processNextBatch(tx, batchSize, (id) => {
              claimedId = id;
            });
            return claimed;
          });
          if (!outcome) break;
          result.batchesProcessed += 1;
          result.notified += outcome.notified;
          result.pushIntents += outcome.intents;
          if (outcome.completed) result.completed += 1;
        } catch (error) {
          this.logger.error(
            `Announcement ${claimedId ?? '(none claimed)'} batch failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          if (!claimedId) break;
          result.failedBatches += 1;
          try {
            await this.repository.recordFailure(claimedId, error);
          } catch (recordError) {
            this.logger.error('Unable to record the announcement failure', recordError);
            break;
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }

    if (result.pushIntents > 0) this.pushDeliveryProcessor?.requestImmediateRun();
    return result;
  }

  /**
   * Claims the next due announcement and fans out one batch inside the
   * caller's transaction. Returns null when there is nothing to do. Public so
   * a fault-injection test can run a batch in its own transaction and abandon
   * it, which is exactly what a crash before commit does.
   */
  async processNextBatch(
    tx: DbTransaction,
    batchSize: number = ANNOUNCEMENT_FAN_OUT_BATCH_SIZE,
    onClaimed?: (announcementId: string) => void,
  ): Promise<AnnouncementBatchOutcome | null> {
    const announcement = await this.repository.claimNext(tx);
    if (!announcement) return null;
    onClaimed?.(announcement.id);
    const outcome = await this.repository.fanOutBatch(tx, announcement, batchSize);
    await this.repository.recordProgress(tx, announcement, outcome);
    return outcome;
  }
}

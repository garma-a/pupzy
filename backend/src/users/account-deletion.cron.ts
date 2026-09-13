import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AccountDeletionRepository } from './account-deletion.repository';
import { AccountDeletionService } from './account-deletion.service';

/**
 * AccountDeletionCron — handles asynchronous retries and metadata purging.
 *
 * ## Principles
 * - Uses existing API process and PostgreSQL (no Redis, no external job queue).
 * - Retries incomplete cleanups with bounded batch size and exponential backoff.
 * - Resumes pending cleanup on server boot (process restart recovery).
 * - Purges audit/security records once their retention period expires.
 */
@Injectable()
export class AccountDeletionCron implements OnApplicationBootstrap {
  private readonly logger = new Logger(AccountDeletionCron.name);
  private isProcessing = false;

  constructor(
    private readonly accountDeletionRepository: AccountDeletionRepository,
    private readonly accountDeletionService: AccountDeletionService,
  ) {}

  /**
   * Resumes interrupted work on application bootstrap.
   */
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Checking for interrupted account deletions on bootstrap...');
    await this.processPendingDeletions();
  }

  /**
   * Periodic retry check every 2 minutes.
   */
  @Cron('*/2 * * * *')
  async handleCron(): Promise<void> {
    await this.processPendingDeletions();
    await this.purgeExpiredRecords();
  }

  async processPendingDeletions(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const pendingRecords = await this.accountDeletionRepository.findPendingForRetry(20);
      if (pendingRecords.length === 0) return;

      this.logger.log(`Processing ${pendingRecords.length} pending account deletion(s)...`);

      for (const record of pendingRecords) {
        try {
          await this.accountDeletionService.executeCleanup(record);
        } catch (err) {
          const attempts = (record.storageCleanupAttempts || 0) + 1;
          const backoffSec = Math.min(300, Math.pow(2, attempts) * 5); // backoff up to 5 min
          this.logger.warn(
            `Retry failed for deletion ${record.id} (attempt ${attempts}): ${err instanceof Error ? err.message : String(err)}`,
          );

          await this.accountDeletionRepository.update(record.id, {
            storageCleanupAttempts: attempts,
            lastError: err instanceof Error ? err.message : String(err),
            nextRetryAt: new Date(Date.now() + backoffSec * 1000),
            status: attempts >= 10 ? 'FAILED' : 'PENDING',
          });
        }
      }
    } catch (err) {
      this.logger.error(`Error in processPendingDeletions: ${err instanceof Error ? err.stack : String(err)}`);
    } finally {
      this.isProcessing = false;
    }
  }

  async purgeExpiredRecords(): Promise<void> {
    try {
      const expired = await this.accountDeletionRepository.findExpiredForPurge(50);
      for (const record of expired) {
        await this.accountDeletionRepository.delete(record.id);
        this.logger.log(`Purged expired deletion audit record: ${record.id}`);
      }
    } catch (err) {
      this.logger.error(`Error in purgeExpiredRecords: ${err instanceof Error ? err.stack : String(err)}`);
    }
  }
}

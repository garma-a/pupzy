import { Injectable, Inject, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import {
  postCompletionNotificationEvents,
  postCompletionRecipients,
  notifications,
  posts,
  users,
  type PostCompletionRecipient,
} from '../database/schema';
import { withDbRetry } from '../common/utils/db-retry.util';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import { PushDeliveryRepository } from './push-delivery.repository';
import { isPushDeliveryEnabled } from './push-delivery.constants';
import {
  PostCompletionNotificationRepository,
  type ClaimedRecipientWithEvent,
} from './post-completion-notification.repository';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

export const POST_COMPLETION_BATCH_SIZE = 50;
export const POST_COMPLETION_LEASE_MS = 60_000;
export const MAX_RETRY_DELAY_MS = 5 * 60_000;
export const MAX_COMPLETION_DELIVERY_ATTEMPTS = 5;

export interface BatchProcessingResult {
  batchesProcessed: number;
  delivered: number;
  suppressed: number;
  failed: number;
}

/**
 * PostCompletionNotificationProcessor
 *
 * Delivers post completion notification events in restartable bounded batches
 * without an arbitrary cap. Supports > 500 recipients across multiple batches,
 * handles rollback, retries, and interrupted batches.
 *
 * Rechecks access, blocks, account availability, and push preferences at delivery time.
 */
@Injectable()
export class PostCompletionNotificationProcessor implements OnApplicationBootstrap {
  private readonly logger = new Logger(PostCompletionNotificationProcessor.name);
  private readonly isolationPolicy: AccountIsolationPolicy;
  private readonly pushDeliveryRepository: PushDeliveryRepository;
  private readonly repository: PostCompletionNotificationRepository;
  private isProcessing = false;

  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
    @Optional()
    @Inject(PostCompletionNotificationRepository)
    repository?: PostCompletionNotificationRepository,
    @Optional()
    @Inject(AccountIsolationPolicy)
    isolationPolicy?: AccountIsolationPolicy,
    @Optional()
    @Inject(PushDeliveryRepository)
    pushDeliveryRepository?: PushDeliveryRepository,
  ) {
    this.pushDeliveryRepository = pushDeliveryRepository ?? new PushDeliveryRepository(this.db);
    this.repository = repository ?? new PostCompletionNotificationRepository(this.db, this.pushDeliveryRepository);
    this.isolationPolicy = isolationPolicy ?? new AccountIsolationPolicy(this.db);
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.processPendingBatches();
    } catch (error) {
      this.logger.error('Unable to resume durable post completion notification delivery at startup', error);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processScheduledBatches(): Promise<void> {
    try {
      await this.processPendingBatches();
    } catch (error) {
      this.logger.error('Unable to deliver scheduled post completion notifications', error);
    }
  }

  /**
   * Processes pending post completion recipients in restartable bounded batches without a cap.
   * Public for testing restartability, fault-injection, and high-volume delivery (>500 recipients).
   */
  async processPendingBatches(options?: { maxBatches?: number; batchSize?: number }): Promise<BatchProcessingResult> {
    if (this.isProcessing) {
      return { batchesProcessed: 0, delivered: 0, suppressed: 0, failed: 0 };
    }
    this.isProcessing = true;

    const maxBatches = options?.maxBatches ?? Infinity;
    const batchSize = options?.batchSize ?? POST_COMPLETION_BATCH_SIZE;

    let batchesProcessed = 0;
    let delivered = 0;
    let suppressed = 0;
    let failed = 0;

    try {
      while (batchesProcessed < maxBatches) {
        const batch = await this.db.transaction((tx) =>
          this.repository.claimNextBatch(tx, batchSize, POST_COMPLETION_LEASE_MS),
        );

        if (batch.length === 0) break;
        batchesProcessed++;

        for (const item of batch) {
          try {
            const outcome = await this.deliverClaimedRecipient(item);
            if (outcome === 'DELIVERED') delivered++;
            else if (outcome === 'SUPPRESSED') suppressed++;
          } catch (error) {
            failed++;
            await this.requeueClaimedRecipient(item.recipient, error);
            this.logger.error(
              `Failed delivering post completion recipient ${item.recipient.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        await this.repository.completeFinishedEvents([...new Set(batch.map((item) => item.event.id))]);
      }

      return { batchesProcessed, delivered, suppressed, failed };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Delivers one claimed recipient within a retryable transaction.
   * Rechecks event state, post state, account availability, isolation/blocks, and push preferences.
   */
  private async deliverClaimedRecipient(
    item: ClaimedRecipientWithEvent,
  ): Promise<'DELIVERED' | 'SUPPRESSED' | 'SKIPPED'> {
    const { recipient, event } = item;

    return withDbRetry(() =>
      this.db.transaction(async (tx) => {
        // Re-read recipient under row lock
        const [currentRecipient] = await tx
          .select()
          .from(postCompletionRecipients)
          .where(eq(postCompletionRecipients.id, recipient.id))
          .for('update');

        if (
          !currentRecipient ||
          currentRecipient.status !== 'PROCESSING' ||
          currentRecipient.leaseToken !== recipient.leaseToken
        ) {
          return 'SKIPPED';
        }

        // Recheck event state (if superseded by a reopen, terminally suppress)
        const [currentEvent] = await tx
          .select()
          .from(postCompletionNotificationEvents)
          .where(eq(postCompletionNotificationEvents.id, event.id))
          .for('update');

        if (!currentEvent || currentEvent.status === 'SUPERSEDED') {
          await this.markSuppressed(tx, currentRecipient.id, recipient.leaseToken!);
          return 'SUPPRESSED';
        }

        // Recheck post state (if post is no longer in a completed state, e.g. reopened or removed)
        const [post] = await tx.select().from(posts).where(eq(posts.id, event.postId)).for('update');

        if (!post || post.status !== event.outcome) {
          await this.markSuppressed(tx, currentRecipient.id, recipient.leaseToken!);
          return 'SUPPRESSED';
        }

        // Recheck recipient user account availability (banned or deleted)
        const [user] = await tx.select().from(users).where(eq(users.id, currentRecipient.recipientId)).limit(1);

        if (!user || user.isBanned) {
          await this.markSuppressed(tx, currentRecipient.id, recipient.leaseToken!, 'CANCELLED');
          return 'SUPPRESSED';
        }

        // Recheck mutual account isolation (Blocks) against both the Post
        // creator and the closing actor, so a recipient isolated from the
        // creator never receives a completion notification even when an
        // administrator (not the creator) recorded the outcome.
        if (
          (await this.isolationPolicy.lockPairAndRecheck(tx, post.creatorId, currentRecipient.recipientId)) ||
          (event.closingActorId &&
            (await this.isolationPolicy.lockPairAndRecheck(tx, event.closingActorId, currentRecipient.recipientId)))
        ) {
          await this.markSuppressed(tx, currentRecipient.id, recipient.leaseToken!, 'BLOCKED');
          return 'SUPPRESSED';
        }

        // Create the in-app notification row
        const [notification] = await tx
          .insert(notifications)
          .values({
            recipientId: currentRecipient.recipientId,
            type: event.type,
            title: event.title,
            body: event.body,
            titleArabic: event.titleArabic,
            bodyArabic: event.bodyArabic,
            relatedPostId: event.postId,
          })
          .returning({ id: notifications.id, recipientId: notifications.recipientId });

        // Push preferences recheck:
        // "disabled push retains inbox and does not resurrect later"
        // If push is disabled for this user, do NOT enqueue push deliveries.
        if (user.notificationsEnabled && isPushDeliveryEnabled(event.type)) {
          await this.pushDeliveryRepository.enqueueForNotification(notification, event.closingActorId, tx);
        }

        // Mark recipient DELIVERED
        await tx
          .update(postCompletionRecipients)
          .set({
            status: 'DELIVERED',
            notificationId: notification.id,
            deliveredAt: new Date(),
            leaseToken: null,
            leaseExpiresAt: null,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(postCompletionRecipients.id, currentRecipient.id),
              eq(postCompletionRecipients.status, 'PROCESSING'),
              eq(postCompletionRecipients.leaseToken, recipient.leaseToken!),
            ),
          );

        return 'DELIVERED';
      }),
    );
  }

  private async markSuppressed(
    tx: DbTransaction,
    recipientId: string,
    leaseToken: string,
    status: 'SUPPRESSED' | 'CANCELLED' | 'BLOCKED' = 'SUPPRESSED',
  ): Promise<void> {
    await tx
      .update(postCompletionRecipients)
      .set({
        status,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(postCompletionRecipients.id, recipientId),
          eq(postCompletionRecipients.status, 'PROCESSING'),
          eq(postCompletionRecipients.leaseToken, leaseToken),
        ),
      );
  }

  private async requeueClaimedRecipient(recipient: PostCompletionRecipient, error: unknown): Promise<void> {
    const attempts = recipient.attempts;
    const isTerminal = attempts >= MAX_COMPLETION_DELIVERY_ATTEMPTS;
    const retryDelayMs = Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** Math.min(attempts, 8));
    const now = new Date();

    await this.db
      .update(postCompletionRecipients)
      .set({
        status: isTerminal ? 'FAILED' : 'PENDING',
        lastError: error instanceof Error ? error.message : String(error),
        nextAttemptAt: new Date(now.getTime() + retryDelayMs),
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(postCompletionRecipients.id, recipient.id),
          eq(postCompletionRecipients.status, 'PROCESSING'),
          eq(postCompletionRecipients.leaseToken, recipient.leaseToken!),
        ),
      );
  }
}

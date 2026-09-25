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
  MAX_COMPLETION_DELIVERY_ATTEMPTS,
  MAX_RETRY_DELAY_MS,
  POST_COMPLETION_BATCH_SIZE,
  POST_COMPLETION_LEASE_MS,
} from './post-completion-notification.constants';
import {
  PostCompletionNotificationRepository,
  type ClaimedRecipientWithEvent,
} from './post-completion-notification.repository';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

export {
  MAX_COMPLETION_DELIVERY_ATTEMPTS,
  MAX_RETRY_DELAY_MS,
  POST_COMPLETION_BATCH_SIZE,
  POST_COMPLETION_LEASE_MS,
} from './post-completion-notification.constants';

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
 * Rechecks access, creator/closing-actor blocks, account availability, and push
 * preferences at delivery time.
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
    this.repository = repository ?? new PostCompletionNotificationRepository(this.db);
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
      // A worker that crashed after its final claim leaves PROCESSING rows
      // whose attempts are exhausted. Reclaiming them is forbidden (it would
      // exceed the attempt bound), and no later claim matches them, so they
      // must be terminated before the pass starts or their events stay
      // PENDING forever.
      await this.db.transaction((tx) => this.repository.recoverExpiredMaxAttemptLeases(tx));

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
      }

      // Global completion sweep, so an event whose last recipient was
      // terminated by the recovery sweep (and therefore never claimed) can
      // still reach COMPLETED.
      await this.repository.completeFinishedEvents();

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
        // ADR 0006: cross-account operations acquire canonical account-pair
        // locks before existing Post/discussion locks. Resolve the stable
        // pair identifiers first (`creator_id` is immutable and the closing
        // actor was snapshotted at capture time), take every pair lock, and
        // only then take recipient/event/Post row locks, so this transaction
        // cannot deadlock with a comment or Block commit.
        const [postIdentity] = await tx
          .select({ creatorId: posts.creatorId })
          .from(posts)
          .where(eq(posts.id, event.postId))
          .limit(1);

        const pairs: Array<readonly [string, string]> = [];
        if (postIdentity) {
          pairs.push([postIdentity.creatorId, recipient.recipientId]);
        }
        if (event.closingActorId && event.closingActorId !== postIdentity?.creatorId) {
          pairs.push([event.closingActorId, recipient.recipientId]);
        }
        await this.isolationPolicy.lockPairs(tx, pairs);

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

        // Recheck post state. A closure delivery is valid while the Post still
        // records the captured outcome; a reopening correction is valid while
        // the Post is ACTIVE, so a re-closed or removed Post suppresses it.
        const [post] = await tx.select().from(posts).where(eq(posts.id, event.postId)).for('update');

        const isCorrectionEvent = event.type === 'POST_REOPENED' || event.type === 'RESCUE_REOPENED';
        if (!post || (isCorrectionEvent ? post.status !== 'ACTIVE' : post.status !== event.outcome)) {
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
        // administrator (not the creator) recorded the outcome. The pair
        // locks are already held from above, so no further locks are needed.
        if (
          (await this.isolationPolicy.isIsolated(post.creatorId, currentRecipient.recipientId, tx)) ||
          (event.closingActorId &&
            (await this.isolationPolicy.isIsolated(event.closingActorId, currentRecipient.recipientId, tx)))
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
        // The intent records the Post creator as its actor so the push worker's
        // send-time Block recheck closes even for an administrator-recorded
        // outcome, where the closing actor has no app-user identity.
        if (user.notificationsEnabled && isPushDeliveryEnabled(event.type)) {
          await this.pushDeliveryRepository.enqueueForNotification(notification, post.creatorId, tx);
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

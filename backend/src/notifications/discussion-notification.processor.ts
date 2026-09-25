import { Injectable, Inject, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import { discussionNotificationEvents, notifications, type DiscussionNotificationEvent } from '../database/schema';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { withDbRetry } from '../common/utils/db-retry.util';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import { PushDeliveryRepository } from './push-delivery.repository';
import { isPushDeliveryEnabled } from './push-delivery.constants';
import { PushDeliveryProcessor } from './push-delivery.processor';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

const DISCUSSION_NOTIFICATION_BATCH_SIZE = 50;
const DISCUSSION_NOTIFICATION_LEASE_MS = 60_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

/**
 * Delivers the durable discussion-notification outbox in the existing NestJS
 * API. Delivery is the atomic creation of the user's existing in-app
 * notification row plus, for push-enabled discussion types, one durable push
 * intent per registered device. The external provider is called later by the
 * push worker, never here.
 *
 * A Block committed before delivery is a terminal suppression: the event is
 * marked SUPPRESSED without an inbox row, so it never retries. The canonical
 * account-pair lock orders that check against a concurrently committing Block.
 */
@Injectable()
export class DiscussionNotificationProcessor implements OnApplicationBootstrap {
  private readonly logger = new Logger(DiscussionNotificationProcessor.name);
  private readonly isolationPolicy: AccountIsolationPolicy;
  private readonly pushDeliveryRepository: PushDeliveryRepository;
  private isProcessing = false;
  private immediateRunRequested = false;

  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
    @Optional()
    @Inject(AccountIsolationPolicy)
    isolationPolicy?: AccountIsolationPolicy,
    @Optional()
    @Inject(PushDeliveryRepository)
    pushDeliveryRepository?: PushDeliveryRepository,
    @Optional()
    @Inject(PushDeliveryProcessor)
    private readonly pushDeliveryProcessor?: PushDeliveryProcessor,
  ) {
    this.isolationPolicy = isolationPolicy ?? new AccountIsolationPolicy(this.db);
    this.pushDeliveryRepository = pushDeliveryRepository ?? new PushDeliveryRepository(this.db);
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.processPendingEvents();
    } catch (error) {
      this.logger.error('Unable to resume durable discussion notification delivery at startup', error);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processScheduledEvents(): Promise<void> {
    try {
      await this.processPendingEvents();
    } catch (error) {
      this.logger.error('Unable to deliver pending discussion notifications', error);
    }
  }

  /**
   * Starts a drain now instead of waiting for the next cron tick. Called after
   * a discussion write (comment, reply, boost, pin) commits its source event;
   * never throws. When a drain is already running one more drain follows it.
   */
  requestImmediateRun(): void {
    if (this.isProcessing) {
      this.immediateRunRequested = true;
      return;
    }
    this.processPendingEvents().catch((error) => {
      this.logger.error('Unable to deliver pending discussion notifications', error);
    });
  }

  /**
   * Claims and drains one bounded batch. This is public for restart and fault
   * injection tests; database leases protect competing API processes.
   */
  async processPendingEvents(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    try {
      let delivered = 0;
      for (let index = 0; index < DISCUSSION_NOTIFICATION_BATCH_SIZE; index++) {
        const event = await this.claimNextEvent();
        if (!event) break;

        try {
          if (await this.deliverClaimedEvent(event)) {
            delivered++;
          }
        } catch (error) {
          await this.requeueClaimedEvent(event, error);
          this.logger.error(`Unable to persist discussion notification event ${event.id}`, error);
        }
      }
      // Inbox rows written above may carry push intents — send them now
      // rather than on the push worker's next tick.
      if (delivered > 0) this.pushDeliveryProcessor?.requestImmediateRun();
      return delivered;
    } finally {
      this.isProcessing = false;
      if (this.immediateRunRequested) {
        this.immediateRunRequested = false;
        this.requestImmediateRun();
      }
    }
  }

  private async claimNextEvent(): Promise<DiscussionNotificationEvent | undefined> {
    return this.db.transaction(async (tx) => {
      const candidateResult = await tx.execute<{ id: string }>(sql`
        SELECT id
        FROM discussion_notification_events
        WHERE (
          status = 'PENDING'
          AND next_attempt_at <= now()
        ) OR (
          status = 'PROCESSING'
          AND (lease_expires_at IS NULL OR lease_expires_at < now())
        )
        ORDER BY next_attempt_at ASC, created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const candidateId = candidateResult.rows[0]?.id;
      if (!candidateId) return undefined;

      const leaseToken = generateUuidV7();
      const now = new Date();
      const [claimed] = await tx
        .update(discussionNotificationEvents)
        .set({
          status: 'PROCESSING',
          attempts: sql`${discussionNotificationEvents.attempts} + 1`,
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + DISCUSSION_NOTIFICATION_LEASE_MS),
          updatedAt: now,
        })
        .where(eq(discussionNotificationEvents.id, candidateId))
        .returning();
      return claimed;
    });
  }

  private async deliverClaimedEvent(event: DiscussionNotificationEvent): Promise<boolean> {
    return withDbRetry(() =>
      this.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(discussionNotificationEvents)
          .where(eq(discussionNotificationEvents.id, event.id))
          .for('update');
        if (
          !current ||
          current.status !== 'PROCESSING' ||
          current.leaseToken !== event.leaseToken ||
          !current.recipientId
        ) {
          return false;
        }

        // A Block committed before delivery is terminal: no inbox row is
        // created and the event never retries. The canonical pair lock makes
        // this check ordered against a concurrently committing Block.
        if (
          current.actorId &&
          (await this.isolationPolicy.lockPairAndRecheck(tx, current.actorId, current.recipientId))
        ) {
          await this.markSuppressed(tx, current.id, event.leaseToken!);
          return false;
        }

        // This insert and the DELIVERED transition share one transaction. A
        // crash yields either neither effect or both; the unique event key also
        // makes recovery harmless if a delivery attempt is repeated.
        const [notification] = await tx
          .insert(notifications)
          .values({
            recipientId: current.recipientId,
            type: current.type,
            title: current.title,
            body: current.body,
            titleArabic: current.titleArabic,
            bodyArabic: current.bodyArabic,
            relatedPostId: current.relatedPostId,
            relatedCommentId: current.relatedCommentId,
            discussionEventId: current.id,
          })
          .onConflictDoNothing()
          .returning({ id: notifications.id, recipientId: notifications.recipientId });

        // Durable push intents commit with the inbox row. A conflict means the
        // notification (and therefore its intents) already committed, so there
        // is nothing new to enqueue.
        if (notification && isPushDeliveryEnabled(current.type)) {
          await this.pushDeliveryRepository.enqueueForNotification(notification, current.actorId, tx);
        }

        const [delivered] = await tx
          .update(discussionNotificationEvents)
          .set({
            status: 'DELIVERED',
            deliveredAt: new Date(),
            leaseToken: null,
            leaseExpiresAt: null,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(discussionNotificationEvents.id, current.id),
              eq(discussionNotificationEvents.status, 'PROCESSING'),
              eq(discussionNotificationEvents.leaseToken, event.leaseToken!),
            ),
          )
          .returning({ id: discussionNotificationEvents.id });
        return !!delivered;
      }),
    );
  }

  /**
   * Marks a claimed event as terminally suppressed. Lease-guarded so a stale
   * worker can never overwrite a newer owner's state.
   */
  private async markSuppressed(tx: DbTransaction, eventId: string, leaseToken: string): Promise<void> {
    const now = new Date();
    await tx
      .update(discussionNotificationEvents)
      .set({
        status: 'SUPPRESSED',
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(discussionNotificationEvents.id, eventId),
          eq(discussionNotificationEvents.status, 'PROCESSING'),
          eq(discussionNotificationEvents.leaseToken, leaseToken),
        ),
      );
  }

  private async requeueClaimedEvent(event: DiscussionNotificationEvent, error: unknown): Promise<void> {
    const retryDelayMs = Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** Math.min(event.attempts, 8));
    const now = new Date();
    this.logger.warn(`Requeueing event ${event.id}: ${error instanceof Error ? error.message : String(error)}`);

    // Keep every failed event for observability and future recovery. The lease
    // token condition prevents a stale worker from overwriting a newer owner.
    await this.db
      .update(discussionNotificationEvents)
      .set({
        status: 'PENDING',
        lastError: 'Notification inbox persistence failed; retry scheduled',
        nextAttemptAt: new Date(now.getTime() + retryDelayMs),
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(discussionNotificationEvents.id, event.id),
          eq(discussionNotificationEvents.status, 'PROCESSING'),
          eq(discussionNotificationEvents.leaseToken, event.leaseToken!),
        ),
      );
  }
}

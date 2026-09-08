import { Injectable, Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import { discussionNotificationEvents, notifications, type DiscussionNotificationEvent } from '../database/schema';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { withDbRetry } from '../common/utils/db-retry.util';

const DISCUSSION_NOTIFICATION_BATCH_SIZE = 50;
const DISCUSSION_NOTIFICATION_LEASE_MS = 60_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

/**
 * Delivers the durable discussion-notification outbox in the existing NestJS
 * API. No external provider is involved: delivery is the atomic creation of
 * the user's existing in-app notification row.
 */
@Injectable()
export class DiscussionNotificationProcessor implements OnApplicationBootstrap {
  private readonly logger = new Logger(DiscussionNotificationProcessor.name);
  private isProcessing = false;

  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

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
      return delivered;
    } finally {
      this.isProcessing = false;
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

        // This insert and the DELIVERED transition share one transaction. A
        // crash yields either neither effect or both; the unique event key also
        // makes recovery harmless if a delivery attempt is repeated.
        await tx
          .insert(notifications)
          .values({
            recipientId: current.recipientId,
            type: current.type,
            title: current.title,
            body: current.body,
            relatedPostId: current.relatedPostId,
            relatedCommentId: current.relatedCommentId,
            discussionEventId: current.id,
          })
          .onConflictDoNothing();

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

  private async requeueClaimedEvent(event: DiscussionNotificationEvent, _error: unknown): Promise<void> {
    const retryDelayMs = Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** Math.min(event.attempts, 8));
    const now = new Date();

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

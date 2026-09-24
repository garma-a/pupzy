import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import {
  postCompletionNotificationEvents,
  notifications,
  type PostCompletionNotificationEvent,
  type PostCompletionRecipient,
} from '../database/schema';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { buildNotificationContent } from './notification-templates';
import { PushDeliveryRepository } from './push-delivery.repository';
import { isPushDeliveryEnabled } from './push-delivery.constants';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];
export type PostCompletionExecutor = NodePgDatabase<typeof schema> | DbTransaction;

export interface CaptureCompletionEventParams {
  postId: string;
  postType: string;
  outcome: string;
  closingActorId: string | null;
  title: string;
  creatorId: string;
}

export interface ReopenCompletionParams {
  postId: string;
  postTitle: string;
}

export interface ClaimedRecipientWithEvent {
  recipient: PostCompletionRecipient;
  event: PostCompletionNotificationEvent;
}

/**
 * PostCompletionNotificationRepository
 *
 * Manages atomic capture of post completion events and audience snapshots
 * in the post closure transaction, and coordinates reopening corrections
 * and batch delivery.
 */
@Injectable()
export class PostCompletionNotificationRepository {
  private readonly pushDeliveryRepository: PushDeliveryRepository;

  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
    @Optional()
    @Inject(PushDeliveryRepository)
    pushDeliveryRepository?: PushDeliveryRepository,
  ) {
    this.pushDeliveryRepository = pushDeliveryRepository ?? new PushDeliveryRepository(this.db);
  }

  /**
   * Atomically captures a completion event and stable closure-time audience snapshot
   * inside the caller's transaction.
   *
   * The audience includes:
   * - current post boosters (post_upvotes)
   * - current post savers (post_saves)
   * - existing comment and reply authors (comments with status NOT IN ('DELETED', 'REMOVED'))
   * - contact requesters of any status (contact_requests)
   * - adoption applicants of any status (adoption_applications)
   *
   * Excludes:
   * - the closing actor (closingActorId)
   * - the post creator (creatorId) to prevent duplicate notifications with admin audit/creator notifications
   * - deleted/removed contributions
   */
  async captureCompletionEvent(
    tx: DbTransaction,
    params: CaptureCompletionEventParams,
  ): Promise<{ event: PostCompletionNotificationEvent; totalRecipients: number }> {
    const { postId, postType, outcome, closingActorId, title, creatorId } = params;

    const notificationType = postType === 'RESCUE' ? 'RESCUE_COMPLETED' : 'POST_COMPLETED';
    const content = buildNotificationContent(notificationType, { postTitle: title, outcome });

    const [event] = await tx
      .insert(postCompletionNotificationEvents)
      .values({
        postId,
        postType,
        outcome,
        closingActorId,
        type: notificationType,
        title: content.title,
        body: content.body,
        titleArabic: content.titleArabic,
        bodyArabic: content.bodyArabic,
        status: 'PENDING',
        totalRecipients: 0,
      })
      .returning();

    // Snapshot deduplicated audience in a single set-oriented query inside the transaction
    const insertResult = await tx.execute(sql`
      INSERT INTO post_completion_recipients (id, event_id, post_id, recipient_id, status)
      SELECT uuidv7(), ${event.id}::uuid, ${postId}::uuid, sub.recipient_id, 'PENDING'
      FROM (
        SELECT user_id AS recipient_id FROM post_upvotes WHERE post_id = ${postId}::uuid
        UNION
        SELECT user_id AS recipient_id FROM post_saves WHERE post_id = ${postId}::uuid
        UNION
        SELECT author_id AS recipient_id FROM comments WHERE post_id = ${postId}::uuid AND status NOT IN ('DELETED', 'REMOVED')
        UNION
        SELECT requester_id AS recipient_id FROM contact_requests WHERE post_id = ${postId}::uuid
        UNION
        SELECT applicant_id AS recipient_id FROM adoption_applications WHERE target_post_id = ${postId}::uuid
      ) sub
      WHERE sub.recipient_id IS NOT NULL
        AND (${closingActorId}::uuid IS NULL OR sub.recipient_id <> ${closingActorId}::uuid)
        AND (${creatorId}::uuid IS NULL OR sub.recipient_id <> ${creatorId}::uuid)
      ON CONFLICT (event_id, recipient_id) DO NOTHING
    `);

    const totalRecipients = insertResult.rowCount ?? 0;
    // An event with no audience has nothing to deliver, so it must not stay
    // PENDING forever waiting for a worker that will never find work.
    const status = totalRecipients === 0 ? 'COMPLETED' : 'PENDING';

    await tx.execute(sql`
      UPDATE post_completion_notification_events
      SET total_recipients = ${totalRecipients}, status = ${status}, updated_at = now()
      WHERE id = ${event.id}::uuid
    `);

    return { event: { ...event, totalRecipients, status }, totalRecipients };
  }

  /**
   * Reopening correction:
   * 1. Marks obsolete active (PENDING / PROCESSING) completion events as SUPERSEDED.
   * 2. Suppresses obsolete pending / processing recipients so they are never delivered.
   * 3. Finds recipients who had closure inbox entries committed (DELIVERED) and creates
   *    localized correction notifications for them (exposing no internal admin reason).
   */
  async handleReopen(
    tx: DbTransaction,
    params: ReopenCompletionParams,
  ): Promise<{ supersededEventIds: string[]; correctedCount: number }> {
    const { postId, postTitle } = params;

    // 1. Mark active events as SUPERSEDED
    const supersededResult = await tx.execute<{ id: string }>(sql`
      UPDATE post_completion_notification_events
      SET status = 'SUPERSEDED', updated_at = now()
      WHERE post_id = ${postId}::uuid AND status IN ('PENDING', 'PROCESSING')
      RETURNING id
    `);
    const supersededEventIds = supersededResult.rows.map((r) => r.id);

    // 2. Suppress obsolete pending closure messages
    await tx.execute(sql`
      UPDATE post_completion_recipients
      SET status = 'SUPPRESSED', updated_at = now()
      WHERE post_id = ${postId}::uuid AND status IN ('PENDING', 'PROCESSING')
    `);

    // 3. Find committed closure entries that need correction
    const deliveredResult = await tx.execute<{
      id: string;
      recipient_id: string;
      event_type: string;
    }>(sql`
      SELECT r.id, r.recipient_id, e.type AS event_type
      FROM post_completion_recipients r
      JOIN post_completion_notification_events e ON e.id = r.event_id
      WHERE r.post_id = ${postId}::uuid AND r.status = 'DELIVERED'
    `);

    let correctedCount = 0;
    for (const row of deliveredResult.rows) {
      // Mark recipient as CORRECTED to avoid duplicate corrections in close/reopen cycles
      const markResult = await tx.execute(sql`
        UPDATE post_completion_recipients
        SET status = 'CORRECTED', updated_at = now()
        WHERE id = ${row.id}::uuid AND status = 'DELIVERED'
      `);
      if ((markResult.rowCount ?? 0) === 0) continue;

      const correctionType = row.event_type === 'POST_COMPLETED' ? 'POST_REOPENED' : 'RESCUE_REOPENED';
      const content = buildNotificationContent(correctionType, { postTitle });

      const [notification] = await tx
        .insert(notifications)
        .values({
          recipientId: row.recipient_id,
          type: correctionType,
          title: content.title,
          body: content.body,
          titleArabic: content.titleArabic,
          bodyArabic: content.bodyArabic,
          relatedPostId: postId,
        })
        .returning({ id: notifications.id, recipientId: notifications.recipientId });

      // Recheck push preferences for the correction notification
      const userRes = await tx.execute<{ notifications_enabled: boolean }>(sql`
        SELECT notifications_enabled FROM users WHERE id = ${row.recipient_id}::uuid
      `);
      if (userRes.rows[0]?.notifications_enabled && isPushDeliveryEnabled(correctionType)) {
        await this.pushDeliveryRepository.enqueueForNotification(notification, null, tx);
      }
      correctedCount++;
    }

    return { supersededEventIds, correctedCount };
  }

  /**
   * Marks completion events COMPLETED once every captured recipient has reached
   * a terminal state. Restartable delivery passes call this after each batch, so
   * an interrupted worker leaves the event PENDING while work remains and the
   * pass that terminates the last recipient completes it.
   */
  async completeFinishedEvents(eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return;
    await this.db.execute(sql`
      UPDATE post_completion_notification_events
      SET status = 'COMPLETED', updated_at = now()
      WHERE id = ANY(ARRAY[${sql.join(
        eventIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}])
        AND status IN ('PENDING', 'PROCESSING')
        AND NOT EXISTS (
          SELECT 1 FROM post_completion_recipients r
          WHERE r.event_id = post_completion_notification_events.id
            AND r.status IN ('PENDING', 'PROCESSING')
        )
    `);
  }

  /**
   * Claims up to batchSize recipients for delivery under a database lease.
   */
  async claimNextBatch(tx: DbTransaction, batchSize: number, leaseMs: number): Promise<ClaimedRecipientWithEvent[]> {
    const candidateResult = await tx.execute<{ id: string }>(sql`
      SELECT r.id
      FROM post_completion_recipients r
      JOIN post_completion_notification_events e ON e.id = r.event_id
      WHERE (
        r.status = 'PENDING'
        AND r.next_attempt_at <= now()
        AND e.status NOT IN ('SUPERSEDED')
      ) OR (
        r.status = 'PROCESSING'
        AND (r.lease_expires_at IS NULL OR r.lease_expires_at < now())
        AND r.attempts < 5
        AND e.status NOT IN ('SUPERSEDED')
      )
      ORDER BY r.next_attempt_at ASC, r.id ASC
      FOR UPDATE OF r SKIP LOCKED
      LIMIT ${batchSize}
    `);

    if (candidateResult.rows.length === 0) return [];

    const ids = candidateResult.rows.map((r) => r.id);
    const leaseToken = generateUuidV7();
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);

    await tx.execute(sql`
      UPDATE post_completion_recipients
      SET status = 'PROCESSING',
          attempts = attempts + 1,
          lease_token = ${leaseToken}::uuid,
          lease_expires_at = ${leaseExpiresAt},
          updated_at = ${now}
      WHERE id = ANY(ARRAY[${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}])
    `);

    const claimed = await tx.query.postCompletionRecipients.findMany({
      where: (r, { inArray }) => inArray(r.id, ids),
    });

    const eventIds = [...new Set(claimed.map((c) => c.eventId))];
    const events = await tx.query.postCompletionNotificationEvents.findMany({
      where: (e, { inArray }) => inArray(e.id, eventIds),
    });
    const eventMap = new Map(events.map((e) => [e.id, e]));

    return claimed
      .filter((r) => r.leaseToken === leaseToken && eventMap.has(r.eventId))
      .map((r) => ({
        recipient: r,
        event: eventMap.get(r.eventId)!,
      }));
  }
}

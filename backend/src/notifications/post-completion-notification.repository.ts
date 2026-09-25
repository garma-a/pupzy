import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import {
  postCompletionNotificationEvents,
  type PostCompletionNotificationEvent,
  type PostCompletionRecipient,
} from '../database/schema';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { buildNotificationContent } from './notification-templates';
import { MAX_COMPLETION_DELIVERY_ATTEMPTS } from './post-completion-notification.constants';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];
export type PostCompletionExecutor = NodePgDatabase<typeof schema> | DbTransaction;

const EXPIRED_MAX_ATTEMPT_LEASE_MESSAGE = 'Post completion delivery lease expired after the maximum number of attempts';

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
  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

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
   * Reopening correction queueing:
   * 1. Marks obsolete active (PENDING / PROCESSING) completion events as
   *    SUPERSEDED, including an undelivered correction from an earlier reopen.
   * 2. Suppresses obsolete pending / processing recipients, and any queued
   *    PENDING / PROCESSING push intents for committed closure inbox rows, so
   *    neither is ever delivered.
   * 3. Queues ONE durable correction event (`POST_REOPENED`/`RESCUE_REOPENED`,
   *    linked to the latest delivered closure event through `corrects_event_id`)
   *    whose audience is the distinct set of already-delivered closure
   *    recipients, and marks those closure rows CORRECTED.
   *
   * No access or preference check happens here: the completion worker applies
   * account availability, Blocks and push preferences under the canonical
   * account-pair locks at delivery time, which serializes a correction against
   * a concurrently committing Block (spec decisions 18/19).
   */
  async handleReopen(
    tx: DbTransaction,
    params: ReopenCompletionParams,
  ): Promise<{ supersededEventIds: string[]; correctedCount: number; correctionEventId: string | null }> {
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

    // 3. Find committed closure entries that need correction. Only closure
    //    events are correctable: a correction delivered by an earlier reopen
    //    is itself final history and must never be corrected again. The latest
    //    delivered closure event determines the uniform correction type and
    //    outcome; ordering is stable for events created in the same instant.
    const deliveredResult = await tx.execute<{
      id: string;
      recipient_id: string;
      notification_id: string | null;
      event_id: string;
      post_type: string;
      outcome: string;
    }>(sql`
      SELECT r.id, r.recipient_id, r.notification_id,
             e.id AS event_id, e.post_type, e.outcome
      FROM post_completion_recipients r
      JOIN post_completion_notification_events e ON e.id = r.event_id
      WHERE r.post_id = ${postId}::uuid
        AND r.status = 'DELIVERED'
        AND e.type IN ('POST_COMPLETED', 'RESCUE_COMPLETED')
      ORDER BY e.created_at DESC, e.id DESC
    `);

    // 3b. Suppress queued closure push intents. A committed closure inbox row
    //     may already have PENDING/PROCESSING push intents; the reopening makes
    //     that closure message obsolete, so they must never reach a device.
    //     Terminal rows (DELIVERED/FAILED/SUPPRESSED) stay untouched, and the
    //     correction push intents are created later by the delivery worker.
    const closureNotificationIds = deliveredResult.rows
      .map((row) => row.notification_id)
      .filter((id): id is string => id !== null);
    if (closureNotificationIds.length > 0) {
      await tx.execute(sql`
        UPDATE push_deliveries
        SET status = 'SUPPRESSED', updated_at = now()
        WHERE notification_id = ANY(ARRAY[${sql.join(
          closureNotificationIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}])
          AND status IN ('PENDING', 'PROCESSING')
      `);
    }

    // No delivered recipient means there is nothing to correct.
    if (deliveredResult.rows.length === 0) {
      return { supersededEventIds, correctedCount: 0, correctionEventId: null };
    }

    // 4. Queue one correction event for the whole delivered audience.
    const latestDelivered = deliveredResult.rows[0];
    const correctionType = latestDelivered.post_type === 'RESCUE' ? 'RESCUE_REOPENED' : 'POST_REOPENED';
    const content = buildNotificationContent(correctionType, { postTitle });

    const correctionEventResult = await tx.execute<{ id: string }>(sql`
      INSERT INTO post_completion_notification_events
        (post_id, post_type, outcome, closing_actor_id, type, title, body, title_arabic, body_arabic,
         status, total_recipients, corrects_event_id)
      VALUES (${postId}::uuid, ${latestDelivered.post_type}, ${latestDelivered.outcome}, NULL,
              ${correctionType}, ${content.title}, ${content.body}, ${content.titleArabic}, ${content.bodyArabic},
              'PENDING', 0, ${latestDelivered.event_id}::uuid)
      RETURNING id
    `);
    const correctionEventId = correctionEventResult.rows[0].id;

    // 5. Snapshot the correction audience from the delivered closure rows.
    const audienceResult = await tx.execute(sql`
      INSERT INTO post_completion_recipients (id, event_id, post_id, recipient_id, status)
      SELECT uuidv7(), ${correctionEventId}::uuid, ${postId}::uuid, delivered.recipient_id, 'PENDING'
      FROM (
        SELECT DISTINCT r.recipient_id
        FROM post_completion_recipients r
        JOIN post_completion_notification_events e ON e.id = r.event_id
        WHERE r.post_id = ${postId}::uuid
          AND r.status = 'DELIVERED'
          AND e.type IN ('POST_COMPLETED', 'RESCUE_COMPLETED')
      ) delivered
      ON CONFLICT (event_id, recipient_id) DO NOTHING
    `);
    const correctedCount = audienceResult.rowCount ?? 0;

    // 6. The delivered closure rows keep their inbox history but are no longer
    //    eligible for another correction in this cycle. Delivered correction
    //    rows are left untouched.
    await tx.execute(sql`
      UPDATE post_completion_recipients r
      SET status = 'CORRECTED', updated_at = now()
      WHERE r.post_id = ${postId}::uuid
        AND r.status = 'DELIVERED'
        AND EXISTS (
          SELECT 1 FROM post_completion_notification_events e
          WHERE e.id = r.event_id AND e.type IN ('POST_COMPLETED', 'RESCUE_COMPLETED')
        )
    `);

    // 7. Record the audience size on the correction event.
    await tx.execute(sql`
      UPDATE post_completion_notification_events
      SET total_recipients = ${correctedCount}, updated_at = now()
      WHERE id = ${correctionEventId}::uuid
    `);

    return { supersededEventIds, correctedCount, correctionEventId };
  }

  /**
   * Recovers recipients stranded by a worker that crashed after exhausting its
   * final claim: their lease has expired and `attempts` has reached the bound,
   * so `claimNextBatch` will never match them again. They are terminally
   * FAILED so their events can complete instead of staying PENDING forever.
   *
   * Runs in the caller's transaction before a delivery pass claims work.
   */
  async recoverExpiredMaxAttemptLeases(tx: DbTransaction): Promise<number> {
    const result = await tx.execute(sql`
      UPDATE post_completion_recipients
      SET status = 'FAILED',
          last_error = ${EXPIRED_MAX_ATTEMPT_LEASE_MESSAGE},
          lease_token = NULL,
          lease_expires_at = NULL,
          updated_at = now()
      WHERE status = 'PROCESSING'
        AND (lease_expires_at IS NULL OR lease_expires_at < now())
        AND attempts >= ${MAX_COMPLETION_DELIVERY_ATTEMPTS}
    `);
    return result.rowCount ?? 0;
  }

  /**
   * Marks every completion event COMPLETED once all of its captured recipients
   * have reached a terminal state. A global sweep at the end of each delivery
   * pass also completes events whose last recipient was terminated by the
   * recovery sweep and therefore never appeared in a claimed batch.
   */
  async completeFinishedEvents(): Promise<void> {
    await this.db.execute(sql`
      UPDATE post_completion_notification_events
      SET status = 'COMPLETED', updated_at = now()
      WHERE status IN ('PENDING', 'PROCESSING')
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
        AND r.attempts < ${MAX_COMPLETION_DELIVERY_ATTEMPTS}
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

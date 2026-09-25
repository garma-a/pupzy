import { POST_DISCUSSION_LOCK_NAMESPACE } from '../../../../src/common/contracts/post-lifecycle.contract.ts';
import { isPushDeliveryEnabled } from '../../../../src/notifications/push-delivery.constants.ts';
import { buildNotificationContent } from '../../../../src/notifications/notification-templates.ts';

const MODERATION_TABLES = new Set(['users', 'posts', 'comments']);

const RETRYABLE_SQLSTATES = new Set(['40P01', '40001']);

function retryableDatabaseError(error) {
  const seen = new Set();
  const pending = [error];
  while (pending.length > 0 && seen.size < 16) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (RETRYABLE_SQLSTATES.has(current.code)) return true;
    pending.push(current.cause, current.driverError, current.originalError);
  }
  return false;
}

function retryDelay(attempt) {
  return Math.min(100, 10 * 2 ** attempt + Math.floor(Math.random() * 10));
}

/**
 * Must be called before locking a discussion Comment. It serializes a single
 * Post's discussion writes with the Nest API: advisory Post key -> Post row ->
 * parent Comment -> target Comment. The caller still revalidates its target
 * after the locks; the preflight lookup exists only to choose the Post key.
 */
export async function lockCommentDiscussion(client, commentId) {
  const { rows: targets } = await client.query('SELECT post_id, parent_id FROM comments WHERE id = $1', [commentId]);
  const target = targets[0];
  if (!target) return null;

  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1 || $2, 0))', [
    POST_DISCUSSION_LOCK_NAMESPACE,
    target.post_id,
  ]);
  const { rows: posts } = await client.query('SELECT * FROM posts WHERE id = $1 FOR UPDATE', [target.post_id]);
  if (!posts[0]) return null;

  if (target.parent_id) {
    await client.query('SELECT id FROM comments WHERE id = $1 FOR UPDATE', [target.parent_id]);
  }

  return { post: posts[0], parentId: target.parent_id };
}

/**
 * Post moderation transitions participate in the same per-Post serialization
 * as discussion writes. The generic target lock follows this call.
 */
export async function lockPostDiscussion(client, postId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1 || $2, 0))', [
    POST_DISCUSSION_LOCK_NAMESPACE,
    postId,
  ]);
  return true;
}

/**
 * Acquires one already-bounded set of Post discussion locks in a global order.
 * Callers must keep the supplied set small; transaction-scoped locks remain
 * held until that caller commits or rolls back.
 */
export async function lockDiscussionPosts(client, postIds, batchSize = 100) {
  const ids = [...new Set(postIds)].sort();
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize);
    for (const postId of batch) {
      await lockPostDiscussion(client, postId);
    }
    await client.query('SELECT id FROM posts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [batch]);
  }
  return ids;
}

/**
 * Runs database-only work with the same narrowly scoped retry policy as
 * moderation actions. The callback and its commit are the retry boundary: no
 * cache, notification provider, or other external side effect may run here.
 */
export async function runModerationTransaction(pool, operation) {
  for (let attempt = 0; ; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original transaction error.
      }
      if (attempt < 3 && retryableDatabaseError(error)) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function runModerationAction(pool, params) {
  if (!MODERATION_TABLES.has(params.table)) {
    throw new TypeError(`Unsupported moderation table: ${params.table}`);
  }

  for (let attempt = 0; ; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (params.lockDiscussion) {
        const lock = await params.lockDiscussion(client, params.id);
        if (!lock) {
          await client.query('ROLLBACK');
          return { ok: false, error: params.table + ' row ' + params.id + ' not found' };
        }
      }

      const { rows } = await client.query('SELECT * FROM ' + params.table + ' WHERE id = $1 FOR UPDATE', [params.id]);
      const row = rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return { ok: false, error: params.table + ' row ' + params.id + ' not found' };
      }

      // Validation runs under the target row lock. It may inspect related rows
      // through the same client so type-specific rules (for example a LOST
      // Post's direction discriminator) are rechecked transactionally.
      const validationError = await params.validate?.(row, client);
      if (validationError) {
        await client.query('ROLLBACK');
        return { ok: false, error: validationError };
      }

      const mutationMetadata = await params.mutate(client, row);
      const metadata = mutationMetadata ?? params.metadata ?? null;
      const { rows: auditRows } = await client.query(
        'INSERT INTO moderation_actions ' +
          '(admin_user_id, action_type, target_type, target_id, reason, metadata) ' +
          'VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [
          params.adminUserId,
          params.actionType,
          params.targetType,
          params.id,
          params.reason ?? null,
          metadata ? JSON.stringify(metadata) : null,
        ],
      );
      const audit = auditRows[0];
      await params.afterAudit?.(client, row, audit, metadata);
      await client.query('COMMIT');
      // Cache invalidation and any other post-commit callback deliberately do
      // not live in the retry scope. Replaying a committed moderation action
      // after a callback failure could duplicate audit rows or source events.
      try {
        await params.onSuccess?.(row);
      } catch {
        // The action is already durably committed. A stale AdminJS cache is
        // preferable to presenting an erroneous failed moderation response.
      }
      return { ok: true, row, auditId: audit?.id };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original transaction error.
      }
      if (attempt < 3 && retryableDatabaseError(error)) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * Moves every still-PENDING Contact Request and Adoption Application
 * targeting the Post to the established terminal `REJECTED` state with
 * `responded_at` set. Rows are preserved and previously approved interactions
 * are never touched, matching the API's owner-closure and expiry behavior.
 * Must run inside the action's own transaction so the status change and the
 * terminations commit atomically.
 */
export async function terminatePendingInteractions(client, postId) {
  const { rows: contactRequestRows } = await client.query(
    `UPDATE contact_requests
     SET status = 'REJECTED', responded_at = now()
     WHERE post_id = $1 AND status = 'PENDING'
     RETURNING id`,
    [postId],
  );
  const { rows: adoptionApplicationRows } = await client.query(
    `UPDATE adoption_applications
     SET status = 'REJECTED', responded_at = now()
     WHERE target_post_id = $1 AND status = 'PENDING'
     RETURNING id`,
    [postId],
  );
  return {
    terminatedContactRequestCount: contactRequestRows.length,
    terminatedAdoptionApplicationCount: adoptionApplicationRows.length,
  };
}

/**
 * Reads a LOST Post's direction discriminator (`LOST_PET` / `FOUND_STRAY`).
 * Returns null when the Post has no extension row, so callers keep the
 * conservative REUNITED-only rule.
 */
export async function findLostReportType(client, postId) {
  const { rows } = await client.query(`SELECT report_type FROM lost_posts WHERE post_id = $1`, [postId]);
  return rows[0]?.report_type ?? null;
}

/**
 * Atomically closes every open Post Report for a moderated Post and returns
 * the closed report ids so the caller can correlate them in the append-only
 * moderation audit metadata. Must run inside the action's own transaction.
 */
export async function closeOpenPostReports(client, postId, adminUserId) {
  const { rows } = await client.query(
    `UPDATE post_reports
     SET reviewed_at = now(), reviewed_by_admin_id = $2, review_outcome = 'ACTION_TAKEN'
     WHERE post_id = $1 AND reviewed_at IS NULL
     RETURNING id`,
    [postId, adminUserId],
  );
  return rows.map((row) => row.id);
}

/**
 * Atomically closes every open Pupzy Account Report for a moderated account.
 * Used by the user-ban action so the queue reflects completed work.
 */
export async function closeOpenAccountReports(client, reportedUserId, adminUserId) {
  const { rows } = await client.query(
    `UPDATE account_reports
     SET reviewed_at = now(), reviewed_by_admin_id = $2, review_outcome = 'ACTION_TAKEN'
     WHERE reported_user_id = $1 AND reviewed_at IS NULL
     RETURNING id`,
    [reportedUserId, adminUserId],
  );
  return rows.map((row) => row.id);
}

/**
 * Atomically closes every open Comment Report for a Comment or Reply.
 * Comment Reports keep their existing reviewed_at closure marker only.
 */
export async function closeOpenCommentReports(client, commentId) {
  const { rows } = await client.query(
    `UPDATE comment_reports
     SET reviewed_at = now()
     WHERE comment_id = $1 AND reviewed_at IS NULL
     RETURNING id`,
    [commentId],
  );
  return rows.map((row) => row.id);
}

/**
 * Writes one durable push intent per device registered to the notification's
 * recipient, inside the same transaction as the notification insert. This
 * mirrors the Nest API's push-delivery outbox and shares its type allowlist;
 * `ON CONFLICT` makes a repeated enqueue harmless. Admin-triggered
 * notifications default to no acting user, so no Block actor is recorded;
 * callers that know the relevant Post creator (reopening corrections) pass it
 * as `actorId` so the push worker's send-time Block recheck can run.
 */
export async function enqueuePushDeliveries(client, { id, recipientId, type, actorId = null }) {
  if (!isPushDeliveryEnabled(type)) return;
  await client.query(
    `INSERT INTO push_deliveries (notification_id, recipient_id, actor_id, device_id)
     SELECT $1::uuid, $2::uuid, $3::uuid, d.id
     FROM device_registrations d
     WHERE d.user_id = $2::uuid
     ON CONFLICT (notification_id, device_id) DO NOTHING`,
    [id, recipientId, actorId],
  );
}

export function actionResponse(record, currentAdmin, result, successMessage) {
  return {
    record: record.toJSON(currentAdmin),
    notice: {
      message: result.ok ? successMessage : result.error,
      type: result.ok ? 'success' : 'error',
    },
  };
}
export function readModerationReason(value) {
  const reason = String(value ?? '').trim();
  if (reason.length > 500) {
    return { error: 'A reason must be at most 500 characters.' };
  }
  return { reason };
}

/**
 * Atomically captures a post completion event and audience snapshot for a
 * completed Post outcome. The audience is the closure-time union of Boost/save,
 * Comment/Reply, Contact Request and Adoption Application participation,
 * deduplicated; Comment/Reply authors are eligible unless their contribution is
 * `DELETED` or `REMOVED`, so `HIDDEN`/`IMAGE_HIDDEN` authors remain eligible.
 * Excludes the closing actor and the post creator
 * (the creator already receives POST_RESOLVED_BY_ADMIN).
 *
 * `closingActorId` must be a `users.id`, never an `admin_users.id`: the column
 * has a foreign key to `users`. Administrator actions record no app-user
 * closing actor because the append-only audit row already names the admin.
 */
export async function capturePostCompletion(client, { postId, postType, outcome, closingActorId, title, creatorId }) {
  const notificationType = postType === 'RESCUE' ? 'RESCUE_COMPLETED' : 'POST_COMPLETED';
  const content = buildNotificationContent(notificationType, { postTitle: title, outcome });

  const { rows: eventRows } = await client.query(
    `INSERT INTO post_completion_notification_events
       (post_id, post_type, outcome, closing_actor_id, type, title, body, title_arabic, body_arabic, status, total_recipients)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', 0)
     RETURNING id`,
    [
      postId,
      postType,
      outcome,
      closingActorId,
      notificationType,
      content.title,
      content.body,
      content.titleArabic,
      content.bodyArabic,
    ],
  );
  const eventId = eventRows[0].id;

  const insertResult = await client.query(
    `INSERT INTO post_completion_recipients (event_id, post_id, recipient_id, status)
     SELECT $1::uuid, $2::uuid, sub.recipient_id, 'PENDING'
     FROM (
       SELECT user_id AS recipient_id FROM post_upvotes WHERE post_id = $2::uuid
       UNION
       SELECT user_id AS recipient_id FROM post_saves WHERE post_id = $2::uuid
       UNION
       SELECT author_id AS recipient_id FROM comments WHERE post_id = $2::uuid AND status NOT IN ('DELETED', 'REMOVED')
       UNION
       SELECT requester_id AS recipient_id FROM contact_requests WHERE post_id = $2::uuid
       UNION
       SELECT applicant_id AS recipient_id FROM adoption_applications WHERE target_post_id = $2::uuid
     ) sub
     WHERE sub.recipient_id IS NOT NULL
       AND ($3::uuid IS NULL OR sub.recipient_id <> $3::uuid)
       AND ($4::uuid IS NULL OR sub.recipient_id <> $4::uuid)
     ON CONFLICT (event_id, recipient_id) DO NOTHING`,
    [eventId, postId, closingActorId, creatorId],
  );

  const totalRecipients = insertResult.rowCount ?? 0;
  // An event with no audience has nothing to deliver, so it must not stay
  // PENDING forever waiting for a worker that will never find work.
  await client.query(
    `UPDATE post_completion_notification_events
     SET total_recipients = $2,
         status = CASE WHEN $2::int = 0 THEN 'COMPLETED' ELSE status END,
         updated_at = now()
     WHERE id = $1`,
    [eventId, totalRecipients],
  );

  return { eventId, totalRecipients };
}

/**
 * Handles post reopening by an administrator. Mirrors the API repository's
 * durable correction queueing in SQL:
 * 1. Supersedes active completion events, including an undelivered correction
 *    queued by an earlier reopening.
 * 2. Suppresses obsolete pending/processing recipients, and any queued
 *    PENDING/PROCESSING push intents for their committed closure inbox rows.
 * 3. Queues ONE durable correction event (`POST_REOPENED`/`RESCUE_REOPENED`,
 *    linked to the latest delivered closure event through `corrects_event_id`)
 *    whose audience is the distinct set of already-delivered closure
 *    recipients, and marks those closure rows CORRECTED.
 *
 * No access or preference check happens here. The completion worker applies
 * account availability, Blocks and push preferences under the canonical
 * account-pair locks at delivery time, so a correction cannot race a
 * concurrently committing Block.
 */
export async function reopenPostCompletion(client, { postId, postTitle, postType, previousOutcome }) {
  await client.query(
    `UPDATE post_completion_notification_events
     SET status = 'SUPERSEDED', updated_at = now()
     WHERE post_id = $1::uuid AND status IN ('PENDING', 'PROCESSING')`,
    [postId],
  );

  await client.query(
    `UPDATE post_completion_recipients
     SET status = 'SUPPRESSED', updated_at = now()
     WHERE post_id = $1::uuid AND status IN ('PENDING', 'PROCESSING')`,
    [postId],
  );

  // Only closure events are correctable: a correction delivered by an earlier
  // reopen is final history and must never be corrected again.
  const { rows: deliveredRows } = await client.query(
    `SELECT r.id, r.recipient_id, r.notification_id,
            e.id AS event_id, e.post_type, e.outcome
     FROM post_completion_recipients r
     JOIN post_completion_notification_events e ON e.id = r.event_id
     WHERE r.post_id = $1::uuid
       AND r.status = 'DELIVERED'
       AND e.type IN ('POST_COMPLETED', 'RESCUE_COMPLETED')
     ORDER BY e.created_at DESC, e.id DESC`,
    [postId],
  );

  // A committed closure inbox row may already have PENDING/PROCESSING push
  // intents. The reopening makes that closure message obsolete, so suppress
  // them while leaving terminal rows (DELIVERED/FAILED/SUPPRESSED) untouched.
  // The correction push intents are created later by the delivery worker.
  const closureNotificationIds = deliveredRows.map((row) => row.notification_id).filter(Boolean);
  if (closureNotificationIds.length > 0) {
    await client.query(
      `UPDATE push_deliveries
       SET status = 'SUPPRESSED', updated_at = now()
       WHERE notification_id = ANY($1::uuid[])
         AND status IN ('PENDING', 'PROCESSING')`,
      [closureNotificationIds],
    );
  }

  // No delivered recipient means there is nothing to correct.
  if (deliveredRows.length === 0) {
    return { correctedCount: 0, correctionEventId: null };
  }

  const correctionType = postType === 'RESCUE' ? 'RESCUE_REOPENED' : 'POST_REOPENED';
  const content = buildNotificationContent(correctionType, { postTitle });

  const { rows: eventRows } = await client.query(
    `INSERT INTO post_completion_notification_events
       (post_id, post_type, outcome, closing_actor_id, type, title, body, title_arabic, body_arabic,
        status, total_recipients, corrects_event_id)
     VALUES ($1::uuid, $2, $3, NULL, $4, $5, $6, $7, $8, 'PENDING', 0, $9::uuid)
     RETURNING id`,
    [
      postId,
      postType,
      previousOutcome,
      correctionType,
      content.title,
      content.body,
      content.titleArabic,
      content.bodyArabic,
      deliveredRows[0].event_id,
    ],
  );
  const correctionEventId = eventRows[0].id;

  const insertResult = await client.query(
    `INSERT INTO post_completion_recipients (event_id, post_id, recipient_id, status)
     SELECT $1::uuid, $2::uuid, delivered.recipient_id, 'PENDING'
     FROM (
       SELECT DISTINCT r.recipient_id
       FROM post_completion_recipients r
       JOIN post_completion_notification_events e ON e.id = r.event_id
       WHERE r.post_id = $2::uuid
         AND r.status = 'DELIVERED'
         AND e.type IN ('POST_COMPLETED', 'RESCUE_COMPLETED')
     ) delivered
     ON CONFLICT (event_id, recipient_id) DO NOTHING`,
    [correctionEventId, postId],
  );
  const correctedCount = insertResult.rowCount ?? 0;

  await client.query(
    `UPDATE post_completion_recipients r
     SET status = 'CORRECTED', updated_at = now()
     WHERE r.post_id = $1::uuid
       AND r.status = 'DELIVERED'
       AND EXISTS (
         SELECT 1 FROM post_completion_notification_events e
         WHERE e.id = r.event_id AND e.type IN ('POST_COMPLETED', 'RESCUE_COMPLETED')
       )`,
    [postId],
  );

  await client.query(
    `UPDATE post_completion_notification_events
     SET total_recipients = $2, updated_at = now()
     WHERE id = $1`,
    [correctionEventId, correctedCount],
  );

  return { correctedCount, correctionEventId };
}

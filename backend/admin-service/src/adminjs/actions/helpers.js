import { POST_DISCUSSION_LOCK_NAMESPACE } from '../../../../src/common/contracts/post-lifecycle.contract.ts';

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

      const validationError = params.validate?.(row);
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

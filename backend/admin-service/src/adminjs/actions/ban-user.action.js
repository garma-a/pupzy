import {
  actionResponse,
  lockDiscussionPosts,
  readModerationReason,
  runModerationAction,
  runModerationTransaction,
} from './helpers.js';
import { isAnyAdmin } from '../rbac.js';

export const USER_BAN_POST_CASCADE_BATCH_SIZE = 100;

function isUserBanned(record) {
  if (!record) return false;
  let value;
  if (typeof record.get === 'function') {
    value = record.get('is_banned');
  }
  if (value === undefined) {
    value = record.params?.is_banned;
  }
  return value === true || value === 'true' || value === 1 || value === '1';
}

function cascadeMetadata(state, cascadedPostCount, cursorPostId = null) {
  return {
    state,
    cascadedPostCount,
    cursorPostId,
  };
}

async function updateBanAudit(client, actionId, metadata) {
  await client.query(
    `UPDATE moderation_actions
     SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
     WHERE id = $1`,
    [actionId, JSON.stringify(metadata)],
  );
}

/**
 * Commits one durable, bounded ban-cascade page. The discussion Post locks are
 * acquired before the User lock, matching Post restoration's Post -> User
 * order. The initial ban itself locks only the User, commits the audit/job,
 * then invokes these pages afterwards.
 */
export async function processUserBanPostCascadeBatch(pool, actionId) {
  return runModerationTransaction(pool, async (client) => {
    const { rows: cascadeRows } = await client.query(
      `SELECT action_id, user_id, reason, ban_marker, cursor_post_id,
              cascaded_post_count, state, notification_sent_at
       FROM user_ban_post_cascades
       WHERE action_id = $1
       FOR UPDATE`,
      [actionId],
    );
    const cascade = cascadeRows[0];
    if (!cascade) return { state: 'MISSING', cascadedPostCount: 0 };
    if (cascade.state !== 'PENDING') {
      return { state: cascade.state, cascadedPostCount: Number(cascade.cascaded_post_count) };
    }

    // This unlocked discovery query only selects a small candidate page. Every
    // selected Post is rechecked after the canonical advisory/Post locks.
    const { rows: candidateRows } = await client.query(
      `SELECT id FROM posts
       WHERE creator_id = $1
         AND status = 'ACTIVE'
         AND ($2::uuid IS NULL OR id > $2::uuid)
       ORDER BY id ASC
       LIMIT $3`,
      [cascade.user_id, cascade.cursor_post_id, USER_BAN_POST_CASCADE_BATCH_SIZE],
    );
    const postIds = candidateRows.map((post) => post.id);

    if (postIds.length > 0) {
      await lockDiscussionPosts(client, postIds, USER_BAN_POST_CASCADE_BATCH_SIZE);
    }

    // The creator's active-Post database trigger takes this same User lock
    // when an admin restores a Post. Taking it after Post locks prevents a
    // user/Post cycle while making an unban or newer ban epoch deterministic.
    const { rows: userRows } = await client.query(
      `SELECT is_banned,
              to_char(banned_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ban_marker
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [cascade.user_id],
    );
    const user = userRows[0];
    if (!user || !user.is_banned || user.ban_marker !== cascade.ban_marker) {
      await client.query(
        `UPDATE user_ban_post_cascades
         SET state = 'CANCELLED', completed_at = now(), updated_at = now()
         WHERE action_id = $1`,
        [actionId],
      );
      await updateBanAudit(client, actionId, {
        cascadedPostCount: Number(cascade.cascaded_post_count),
        postCascade: cascadeMetadata('CANCELLED', Number(cascade.cascaded_post_count), cascade.cursor_post_id),
      });
      return { state: 'CANCELLED', cascadedPostCount: Number(cascade.cascaded_post_count) };
    }

    if (postIds.length === 0) {
      const cascadedPostCount = Number(cascade.cascaded_post_count);
      if (cascadedPostCount > 0 && !cascade.notification_sent_at) {
        await client.query(
          `INSERT INTO notifications (recipient_id, type, title, body, is_read)
           VALUES ($1, 'POST_REMOVED_BY_ADMIN', 'Your posts were removed', $2, false)`,
          [cascade.user_id, `Your account was banned (${cascade.reason}) and your active posts were removed.`],
        );
      }
      await client.query(
        `UPDATE user_ban_post_cascades
         SET state = 'COMPLETED',
             notification_sent_at = CASE WHEN $2 > 0 AND notification_sent_at IS NULL THEN now() ELSE notification_sent_at END,
             completed_at = now(), updated_at = now()
         WHERE action_id = $1`,
        [actionId, cascadedPostCount],
      );
      await updateBanAudit(client, actionId, {
        cascadedPostCount,
        postCascade: cascadeMetadata('COMPLETED', cascadedPostCount, cascade.cursor_post_id),
      });
      return { state: 'COMPLETED', cascadedPostCount };
    }

    const removed = await client.query(
      `UPDATE posts
       SET status = 'REMOVED', updated_at = now()
       WHERE id = ANY($1::uuid[]) AND creator_id = $2 AND status = 'ACTIVE'`,
      [postIds, cascade.user_id],
    );
    const cascadedPostCount = Number(cascade.cascaded_post_count) + (removed.rowCount ?? 0);
    const cursorPostId = postIds[postIds.length - 1];
    await client.query(
      `UPDATE user_ban_post_cascades
       SET cursor_post_id = $2, cascaded_post_count = $3, updated_at = now()
       WHERE action_id = $1`,
      [actionId, cursorPostId, cascadedPostCount],
    );
    await updateBanAudit(client, actionId, {
      cascadedPostCount,
      postCascade: cascadeMetadata('PENDING', cascadedPostCount, cursorPostId),
    });
    return { state: 'PENDING', cascadedPostCount };
  });
}

/**
 * Continues a durable cascade. Each loop is a separate bounded PostgreSQL
 * transaction, so this may take longer for a very large account without ever
 * retaining a cross-account or whole-account transaction.
 */
export async function runUserBanPostCascade(pool, actionId, options = {}) {
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;
  let latest = { state: 'PENDING', cascadedPostCount: 0 };
  for (let batch = 0; batch < maxBatches && latest.state === 'PENDING'; batch += 1) {
    latest = await processUserBanPostCascadeBatch(pool, actionId);
  }
  return latest;
}

export function buildBanUserAction(pool, component, cache) {
  return {
    actionType: 'record',
    icon: 'Slash',
    isAccessible: isAnyAdmin,
    isVisible: (context) => {
      if (!context?.record) return false;
      return !isUserBanned(context.record);
    },
    component,
    handler: async (request, _response, context) => {
      const { record, currentAdmin } = context;
      if (request.method !== 'post') return { record: record.toJSON(currentAdmin) };

      const reasonResult = readModerationReason(request.payload?.reason);
      const reason = reasonResult.reason ?? '';
      const alsoRemovePosts = request.payload?.alsoRemovePosts === true || request.payload?.alsoRemovePosts === 'true';
      if (reasonResult.error || !reason) {
        return actionResponse(
          record,
          currentAdmin,
          {
            ok: false,
            error: reasonResult.error ?? 'A ban reason is required.',
          },
          '',
        );
      }

      const result = await runModerationAction(pool, {
        table: 'users',
        id: record.id(),
        adminUserId: currentAdmin.id,
        actionType: 'USER_BANNED',
        targetType: 'USER',
        reason,
        onSuccess: () => cache?.invalidate(),
        validate: (row) => (row.is_banned ? 'This user is already banned.' : null),
        mutate: async (client, row) => {
          const { rows } = await client.query(
            `UPDATE users
             SET is_banned = true, banned_at = now(), ban_reason = $2, banned_by_admin_id = $3,
                 updated_at = now()
             WHERE id = $1
             RETURNING to_char(banned_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ban_marker`,
            [row.id, reason, currentAdmin.id],
          );
          return {
            alsoRemovePosts,
            cascadedPostCount: 0,
            postCascade: alsoRemovePosts
              ? { state: 'PENDING', banMarker: rows[0].ban_marker }
              : { state: 'NOT_REQUESTED' },
          };
        },
        afterAudit: async (client, row, audit, metadata) => {
          if (!alsoRemovePosts) return;
          await client.query(
            `INSERT INTO user_ban_post_cascades (action_id, user_id, reason, ban_marker)
             VALUES ($1, $2, $3, $4)`,
            [audit.id, row.id, reason, metadata.postCascade.banMarker],
          );
        },
      });
      if (result.ok && alsoRemovePosts) {
        // The always-on Nest scheduler resumes any remaining durable pages.
        // Keep this AdminJS request bounded even for very large accounts.
        await runUserBanPostCascade(pool, result.auditId, { maxBatches: 1 });
      }
      return actionResponse(record, currentAdmin, result, 'User banned. Post removal continues durably if needed.');
    },
  };
}

export function buildUnbanUserAction(pool, cache) {
  return {
    actionType: 'record',
    icon: 'Check',
    guard: 'Are you sure you want to unban this user?',
    isAccessible: isAnyAdmin,
    isVisible: (context) => {
      if (!context?.record) return false;
      return isUserBanned(context.record);
    },
    component: false,
    handler: async (request, _response, context) => {
      const { record, currentAdmin } = context;
      if (request.method !== 'post') return { record: record.toJSON(currentAdmin) };

      const result = await runModerationAction(pool, {
        table: 'users',
        id: record.id(),
        adminUserId: currentAdmin.id,
        actionType: 'USER_UNBANNED',
        targetType: 'USER',
        onSuccess: () => cache?.invalidate(),
        validate: (row) => (!row.is_banned ? 'This user is not banned.' : null),
        mutate: async (client, row) => {
          await client.query(
            `UPDATE users
             SET is_banned = false, banned_at = NULL, ban_reason = NULL, banned_by_admin_id = NULL,
                 updated_at = now()
             WHERE id = $1`,
            [row.id],
          );
        },
      });
      return actionResponse(record, currentAdmin, result, 'User unbanned.');
    },
  };
}

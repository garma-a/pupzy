import { actionResponse, readModerationReason, runModerationAction } from './helpers.js';
import { isAnyAdmin } from '../rbac.js';

export function buildBanUserAction(pool, component, cache) {
  return {
    actionType: 'record',
    icon: 'Slash',
    isAccessible: isAnyAdmin,
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
          await client.query(
            `UPDATE users
             SET is_banned = true, banned_at = now(), ban_reason = $2, banned_by_admin_id = $3,
                 updated_at = now()
             WHERE id = $1`,
            [row.id, reason, currentAdmin.id],
          );

          let cascadedPostCount = 0;
          if (alsoRemovePosts) {
            const removed = await client.query(
              `UPDATE posts SET status = 'REMOVED', updated_at = now()
               WHERE creator_id = $1 AND status = 'ACTIVE'`,
              [row.id],
            );
            cascadedPostCount = removed.rowCount ?? 0;
            await client.query(
              `INSERT INTO notifications (recipient_id, type, title, body, is_read)
               SELECT $1, 'POST_REMOVED_BY_ADMIN', 'Your posts were removed', $2, false
               WHERE $3 > 0`,
              [row.id, `Your account was banned (${reason}) and your active posts were removed.`, cascadedPostCount],
            );
          }
          return { cascadedPostCount };
        },
      });
      return actionResponse(record, currentAdmin, result, 'User banned.');
    },
  };
}

export function buildUnbanUserAction(pool, cache) {
  return {
    actionType: 'record',
    icon: 'Check',
    guard: 'Are you sure you want to unban this user?',
    isAccessible: isAnyAdmin,
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

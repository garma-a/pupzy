import { actionResponse, readModerationReason, runModerationAction } from './helpers.js';
import { isAnyAdmin } from '../rbac.js';

function getRecordProperty(record, property) {
  if (!record) return undefined;
  if (typeof record.get === 'function') {
    const val = record.get(property);
    if (val !== undefined) return val;
  }
  return record.params?.[property];
}

function buildPostAction(pool, component, definition, cache) {
  return {
    actionType: 'record',
    icon: definition.icon,
    guard: definition.guard,
    component: definition.requiresForm ? component : false,
    isAccessible: isAnyAdmin,
    isVisible: definition.isVisible,
    handler: async (request, _response, context) => {
      const { record, currentAdmin } = context;
      if (request.method !== 'post') return { record: record.toJSON(currentAdmin) };

      const reasonResult = readModerationReason(request.payload?.reason);
      const reason = reasonResult.reason ?? '';
      if (reasonResult.error || (definition.reasonRequired && !reason)) {
        return actionResponse(
          record,
          currentAdmin,
          { ok: false, error: reasonResult.error ?? 'A reason is required.' },
          '',
        );
      }

      const result = await runModerationAction(pool, {
        table: 'posts',
        id: record.id(),
        adminUserId: currentAdmin.id,
        actionType: definition.actionType,
        targetType: 'POST',
        reason: reason || undefined,
        onSuccess: () => cache?.invalidate(),
        validate: definition.validate,
        mutate: (client, row) => definition.mutate(client, row, currentAdmin.id, reason),
      });
      return actionResponse(record, currentAdmin, result, definition.successMessage);
    },
  };
}

export function buildPostActions(pool, component, cache) {
  return {
    approvePost: buildPostAction(
      pool,
      component,
      {
        actionType: 'POST_APPROVED',
        icon: 'Check',
        guard: 'Approve this post as clean?',
        successMessage: 'Post approved.',
        isVisible: (context) => {
          const record = context?.record;
          if (!record) return false;
          const status = getRecordProperty(record, 'status');
          const moderationStatus = getRecordProperty(record, 'moderation_status');
          return status === 'ACTIVE' && ['PENDING_AUTO_REVIEW', 'FLAGGED'].includes(moderationStatus);
        },
        validate: (row) => {
          if (row.status !== 'ACTIVE') {
            return 'Only active posts can be approved.';
          }
          if (!['PENDING_AUTO_REVIEW', 'FLAGGED'].includes(row.moderation_status)) {
            return 'Only pending or flagged posts can be approved.';
          }
          return null;
        },
        mutate: (client, row, adminId) =>
          client.query(
            `UPDATE posts
             SET moderation_status = 'CLEAN', moderation_reason = NULL, moderated_at = now(),
                 moderated_by_admin_id = $2, updated_at = now()
             WHERE id = $1`,
            [row.id, adminId],
          ),
      },
      cache,
    ),
    flagPost: buildPostAction(
      pool,
      component,
      {
        actionType: 'POST_FLAGGED',
        icon: 'Flag',
        requiresForm: true,
        reasonRequired: true,
        successMessage: 'Post flagged.',
        isVisible: (context) => {
          const record = context?.record;
          if (!record) return false;
          const status = getRecordProperty(record, 'status');
          const moderationStatus = getRecordProperty(record, 'moderation_status');
          return status === 'ACTIVE' && ['PENDING_AUTO_REVIEW', 'CLEAN'].includes(moderationStatus);
        },
        validate: (row) => {
          if (row.status !== 'ACTIVE') {
            return 'Only active posts can be flagged.';
          }
          if (row.moderation_status === 'FLAGGED') {
            return 'This post is already flagged.';
          }
          if (!['PENDING_AUTO_REVIEW', 'CLEAN'].includes(row.moderation_status)) {
            return 'Only pending or clean posts can be flagged.';
          }
          return null;
        },
        mutate: (client, row, adminId, reason) =>
          client.query(
            `UPDATE posts
             SET moderation_status = 'FLAGGED', moderation_reason = $2, moderated_at = now(),
                 moderated_by_admin_id = $3, updated_at = now()
             WHERE id = $1`,
            [row.id, reason, adminId],
          ),
      },
      cache,
    ),
    removePost: buildPostAction(
      pool,
      component,
      {
        actionType: 'POST_REMOVED',
        icon: 'Trash2',
        requiresForm: true,
        reasonRequired: true,
        successMessage: 'Post removed.',
        isVisible: (context) => {
          const record = context?.record;
          if (!record) return false;
          const status = getRecordProperty(record, 'status');
          return status === 'ACTIVE';
        },
        validate: (row) => (row.status === 'ACTIVE' ? null : 'Only active posts can be removed.'),
        mutate: async (client, row, adminId, reason) => {
          await client.query(
            `UPDATE posts
             SET status = 'REMOVED', moderation_reason = $2, moderated_at = now(),
                 moderated_by_admin_id = $3, updated_at = now()
             WHERE id = $1`,
            [row.id, reason, adminId],
          );
          await client.query(
            `INSERT INTO notifications
               (recipient_id, type, title, body, related_post_id, is_read)
             VALUES ($1, 'POST_REMOVED_BY_ADMIN', 'Your post was removed', $2, $3, false)`,
            [row.creator_id, reason, row.id],
          );
        },
      },
      cache,
    ),
    restorePost: buildPostAction(
      pool,
      component,
      {
        actionType: 'POST_RESTORED',
        icon: 'RotateCcw',
        guard: 'Restore this post to active?',
        successMessage: 'Post restored.',
        isVisible: (context) => {
          const record = context?.record;
          if (!record) return false;
          const status = getRecordProperty(record, 'status');
          return status === 'REMOVED';
        },
        validate: (row) => (row.status === 'REMOVED' ? null : 'Only removed posts can be restored.'),
        mutate: (client, row, adminId) =>
          client.query(
            `UPDATE posts
             SET status = 'ACTIVE', moderated_at = now(), moderated_by_admin_id = $2, updated_at = now()
             WHERE id = $1`,
            [row.id, adminId],
          ),
      },
      cache,
    ),
  };
}

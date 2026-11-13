import {
  actionResponse,
  closeOpenCommentReports,
  lockCommentDiscussion,
  readModerationReason,
  runModerationAction,
} from './helpers.js';
import { commentMediaPurgeUrls } from '../comment-media-url.js';
import { isAnyAdmin } from '../rbac.js';

function getRecordProperty(record, property) {
  if (!record) return undefined;
  if (typeof record.get === 'function') {
    const val = record.get(property);
    if (val !== undefined) return val;
  }
  return record.params?.[property];
}

/** Resolves CDN purge URLs according to configured delivery policy (see `comment-media-url.js`). */
export const getCommentMediaPurgeUrls = commentMediaPurgeUrls;

/** Visible comments (not already hidden, removed or deleted) can be hidden by an administrator. */
export const canHideComment = (status) => status === 'ACTIVE' || status === 'IMAGE_HIDDEN';
/** Any comment that is not already permanently removed can be removed. */
export const canRemoveComment = (status) => status !== 'REMOVED';

function buildCommentAction(pool, component, definition, cache) {
  return {
    actionType: 'record',
    icon: definition.icon,
    component,
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
        table: 'comments',
        id: record.id(),
        adminUserId: currentAdmin.id,
        actionType: definition.actionType,
        targetType: 'COMMENT',
        reason: reason || undefined,
        onSuccess: () => cache?.invalidate(),
        lockDiscussion: lockCommentDiscussion,
        validate: definition.validate,
        mutate: (client, row) => definition.mutate(client, row, currentAdmin.id, reason),
      });
      return actionResponse(record, currentAdmin, result, definition.successMessage);
    },
  };
}

export function buildCommentActions(pool, component, cache) {
  return {
    restoreComment: buildCommentAction(
      pool,
      component,
      {
        actionType: 'COMMENT_RESTORED',
        icon: 'Check',
        successMessage: 'Comment restored.',
        isVisible: (context) => {
          const record = context?.record;
          if (!record) return false;
          const status = getRecordProperty(record, 'status');
          return status === 'IMAGE_HIDDEN' || status === 'HIDDEN';
        },
        validate: (row) => {
          if (row.status !== 'IMAGE_HIDDEN' && row.status !== 'HIDDEN') {
            return 'Only hidden comments can be restored.';
          }
          return null;
        },
        mutate: async (client, row) => {
          if (row.status === 'HIDDEN') {
            if (row.parent_id) {
              const { rows: parentRows } = await client.query(`SELECT status FROM comments WHERE id = $1`, [
                row.parent_id,
              ]);
              const parent = parentRows[0];
              if (parent && parent.status !== 'REMOVED') {
                await client.query(
                  `UPDATE comments SET reply_count = reply_count + 1, updated_at = now() WHERE id = $1`,
                  [row.parent_id],
                );
                await client.query(
                  `UPDATE posts SET comment_count = comment_count + 1, updated_at = now() WHERE id = $1`,
                  [row.post_id],
                );
              }
            } else {
              await client.query(
                `UPDATE posts SET comment_count = comment_count + 1, updated_at = now() WHERE id = $1`,
                [row.post_id],
              );
            }
          }
          await client.query(`UPDATE comments SET status = 'ACTIVE', updated_at = now() WHERE id = $1`, [row.id]);
          // Restoring is the opposite of acting on the Comment, so it leaves its reports alone: the hide or
          // removal before it already closed them, and a closed report is never reopened.
        },
      },
      cache,
    ),
    hideComment: buildCommentAction(
      pool,
      component,
      {
        actionType: 'COMMENT_HIDDEN',
        icon: 'EyeOff',
        reasonRequired: true,
        successMessage: 'Comment hidden.',
        isVisible: (context) => canHideComment(getRecordProperty(context?.record, 'status')),
        validate: (row) => (canHideComment(row.status) ? null : 'Only visible comments can be hidden.'),
        // Same effects as the API's automatic hiding (CommentsRepository.reportComment).
        mutate: async (client, row, adminId) => {
          await client.query(`UPDATE comments SET status = 'HIDDEN', updated_at = now() WHERE id = $1`, [row.id]);
          await client.query(`DELETE FROM post_pins WHERE comment_id = $1`, [row.id]);
          if (row.parent_id) {
            const { rows: parentRows } = await client.query(`SELECT status FROM comments WHERE id = $1`, [
              row.parent_id,
            ]);
            if (parentRows[0] && parentRows[0].status !== 'REMOVED') {
              await client.query(
                `UPDATE comments SET reply_count = GREATEST(0, reply_count - 1), updated_at = now() WHERE id = $1`,
                [row.parent_id],
              );
              await client.query(
                `UPDATE posts SET comment_count = GREATEST(0, comment_count - 1), updated_at = now() WHERE id = $1`,
                [row.post_id],
              );
            }
          } else {
            await client.query(
              `UPDATE posts SET comment_count = GREATEST(0, comment_count - 1), updated_at = now() WHERE id = $1`,
              [row.post_id],
            );
          }
          const closedCommentReportIds = await closeOpenCommentReports(client, row.id, adminId);
          return { closedCommentReportIds };
        },
      },
      cache,
    ),
    hideCommentImages: buildCommentAction(
      pool,
      component,
      {
        actionType: 'COMMENT_IMAGES_HIDDEN',
        icon: 'Image',
        reasonRequired: true,
        successMessage: 'Comment images hidden.',
        isVisible: (context) => getRecordProperty(context?.record, 'status') === 'ACTIVE',
        validate: async (row, client) => {
          if (row.status !== 'ACTIVE') return 'Only active comments can have their images hidden.';
          const { rows } = await client.query(`SELECT 1 FROM comment_media WHERE comment_id = $1 LIMIT 1`, [row.id]);
          return rows.length === 0 ? 'This comment has no images.' : null;
        },
        mutate: async (client, row, adminId) => {
          await client.query(`UPDATE comments SET status = 'IMAGE_HIDDEN', updated_at = now() WHERE id = $1`, [row.id]);
          const closedCommentReportIds = await closeOpenCommentReports(client, row.id, adminId);
          return { closedCommentReportIds };
        },
      },
      cache,
    ),
    removeComment: buildCommentAction(
      pool,
      component,
      {
        actionType: 'COMMENT_REMOVED',
        icon: 'Trash',
        reasonRequired: true,
        successMessage: 'Comment permanently removed.',
        isVisible: (context) => {
          const record = context?.record;
          if (!record) return false;
          const status = getRecordProperty(record, 'status');
          return status !== 'REMOVED';
        },
        validate: (row) => {
          if (row.status === 'REMOVED') {
            return 'Comment is already permanently removed.';
          }
          return null;
        },
        mutate: async (client, row, adminId, reason) => {
          const wasVisible = row.status === 'ACTIVE' || row.status === 'IMAGE_HIDDEN';

          if (!row.parent_id) {
            const { rows: replyCountRows } = await client.query(
              `SELECT count(*)::int AS count FROM comments WHERE parent_id = $1 AND status IN ('ACTIVE', 'IMAGE_HIDDEN')`,
              [row.id],
            );
            const totalDecrement = (wasVisible ? 1 : 0) + Number(replyCountRows[0]?.count || 0);
            if (totalDecrement > 0) {
              await client.query(
                `UPDATE posts SET comment_count = GREATEST(0, comment_count - $1), updated_at = now() WHERE id = $2`,
                [totalDecrement, row.post_id],
              );
            }
            await client.query(`DELETE FROM post_pins WHERE comment_id = $1`, [row.id]);
            await client.query(
              `UPDATE comments SET status = 'REMOVED', reply_count = 0, updated_at = now() WHERE id = $1`,
              [row.id],
            );
          } else {
            const { rows: parentRows } = await client.query(`SELECT status FROM comments WHERE id = $1`, [
              row.parent_id,
            ]);
            const parent = parentRows[0];
            if (parent && parent.status !== 'REMOVED' && wasVisible) {
              await client.query(
                `UPDATE comments SET reply_count = GREATEST(0, reply_count - 1), updated_at = now() WHERE id = $1`,
                [row.parent_id],
              );
              await client.query(
                `UPDATE posts SET comment_count = GREATEST(0, comment_count - 1), updated_at = now() WHERE id = $1`,
                [row.post_id],
              );
            }
            await client.query(`UPDATE comments SET status = 'REMOVED', updated_at = now() WHERE id = $1`, [row.id]);
          }

          // Find any attached media
          const { rows: mediaRows } = await client.query(`SELECT * FROM comment_media WHERE comment_id = $1`, [row.id]);

          const isInappropriate = reason.toUpperCase().includes('INAPPROPRIATE');

          for (const media of mediaRows) {
            // Queue durable R2 deletion & CDN purge work according to configured delivery policy
            const purgeUrls = getCommentMediaPurgeUrls(media.storage_key);
            for (const cdnUrl of purgeUrls) {
              await client.query(
                `INSERT INTO media_deletion_work (storage_key, cdn_url, status)
                 VALUES ($1, $2, 'PENDING')`,
                [media.storage_key, cdnUrl],
              );
            }

            // If removed as inappropriate, record SHA-256 digest in blocked_media_hashes
            if (isInappropriate && media.sha256) {
              await client.query(
                `INSERT INTO blocked_media_hashes (sha256, reason, blocked_by_admin_id)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (sha256) DO NOTHING`,
                [media.sha256, reason, adminId],
              );
            }
          }

          if (mediaRows.length > 0) {
            await client.query(`DELETE FROM comment_media WHERE comment_id = $1`, [row.id]);
          }

          // Removal and restoration both close every currently open Comment
          // Report for this Comment or Reply in the same transaction as the
          // moderation action and its audit entry.
          const closedCommentReportIds = await closeOpenCommentReports(client, row.id, adminId);
          return { closedCommentReportIds };
        },
      },
      cache,
    ),
  };
}

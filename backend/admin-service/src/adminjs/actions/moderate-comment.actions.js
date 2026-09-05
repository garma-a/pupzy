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

/**
 * Resolves CDN purge URLs according to configured delivery policy.
 * - Primary default: https://cdn.pupzy.net
 * - Fallback / override: COMMENT_MEDIA_CDN_BASE (or R2_PUBLIC_URL)
 * - Domain transitions: COMMENT_MEDIA_DOMAIN_TRANSITION=true / COMMENT_MEDIA_PREVIOUS_CDN_BASE
 */
export function getCommentMediaPurgeUrls(storageKey) {
  const primaryBase = 'https://cdn.pupzy.net';
  const configuredBase = process.env.COMMENT_MEDIA_CDN_BASE || process.env.R2_PUBLIC_URL || primaryBase;
  const cleanKey = storageKey.replace(/^\/+/, '');
  const cleanConfigured = configuredBase.replace(/\/+$/, '');
  const cleanPrimary = primaryBase.replace(/\/+$/, '');

  const urls = new Set();
  urls.add(`${cleanConfigured}/${cleanKey}`);

  const transitionEnv = process.env.COMMENT_MEDIA_DOMAIN_TRANSITION;
  const isTransition =
    transitionEnv === 'true' || transitionEnv === '1' || Boolean(process.env.COMMENT_MEDIA_PREVIOUS_CDN_BASE);

  if (isTransition) {
    urls.add(`${cleanPrimary}/${cleanKey}`);
    const prev = process.env.COMMENT_MEDIA_PREVIOUS_CDN_BASE;
    if (prev) {
      urls.add(`${prev.replace(/\/+$/, '')}/${cleanKey}`);
    }
  }

  return Array.from(urls);
}

function buildCommentAction(pool, component, definition, cache) {
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
        table: 'comments',
        id: record.id(),
        adminUserId: currentAdmin.id,
        actionType: definition.actionType,
        targetType: 'COMMENT',
        reason: reason || undefined,
        onSuccess: () => cache?.invalidate(),
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
        guard: 'Mark this comment clean and restore visibility?',
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
              await client.query(
                `UPDATE comments SET reply_count = reply_count + 1, updated_at = now() WHERE id = $1`,
                [row.parent_id],
              );
              await client.query(
                `UPDATE posts SET comment_count = comment_count + 1, updated_at = now() WHERE id = $1`,
                [row.post_id],
              );
            } else {
              await client.query(
                `UPDATE posts SET comment_count = comment_count + 1, updated_at = now() WHERE id = $1`,
                [row.post_id],
              );
            }
          }
          await client.query(`UPDATE comments SET status = 'ACTIVE', updated_at = now() WHERE id = $1`, [row.id]);
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
        requiresForm: true,
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
          if (wasVisible) {
            if (row.parent_id) {
              await client.query(
                `UPDATE comments SET reply_count = GREATEST(0, reply_count - 1), updated_at = now() WHERE id = $1`,
                [row.parent_id],
              );
              await client.query(
                `UPDATE posts SET comment_count = GREATEST(0, comment_count - 1), updated_at = now() WHERE id = $1`,
                [row.post_id],
              );
            } else {
              await client.query(
                `UPDATE posts SET comment_count = GREATEST(0, comment_count - 1), updated_at = now() WHERE id = $1`,
                [row.post_id],
              );
              await client.query(`DELETE FROM post_pins WHERE comment_id = $1`, [row.id]);
            }
          }

          await client.query(`UPDATE comments SET status = 'REMOVED', updated_at = now() WHERE id = $1`, [row.id]);

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
        },
      },
      cache,
    ),
  };
}

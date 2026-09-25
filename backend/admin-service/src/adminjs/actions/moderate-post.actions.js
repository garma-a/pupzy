import {
  actionResponse,
  capturePostCompletion,
  closeOpenPostReports,
  enqueuePushDeliveries,
  findLostReportType,
  lockPostDiscussion,
  readModerationReason,
  reopenPostCompletion,
  runModerationAction,
  terminatePendingInteractions,
} from './helpers.js';
import {
  canAdminRemove,
  canAdminReopen,
  canAdminResolve,
  canAdminRestore,
} from '../../../../src/common/contracts/post-lifecycle.contract.ts';
import { buildNotificationContent } from '../../../../src/notifications/notification-templates.ts';
import { attachLostSubtype, attachOwnerBanStatus } from '../review/post-review.js';
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
        lockDiscussion: lockPostDiscussion,
        validate: definition.validate,
        mutate: (client, row) => definition.mutate(client, row, currentAdmin.id, reason),
      });
      return actionResponse(record, currentAdmin, result, definition.successMessage);
    },
  };
}

/**
 * Type-specific Post Resolution actions. Each action targets exactly one
 * completed outcome and is only visible while the Post is `ACTIVE` and its
 * type (and, for LOST, direction) allows that outcome, so staff can never
 * choose an invalid transition. RESCUE has two outcomes: `markRescued`
 * (`RESOLVED`) and `markAnimalDeceased` (`ANIMAL_DECEASED`, which closes the
 * rescue because the animal died and is never described as rescued). The
 * outcome is revalidated under the row lock against the shared lifecycle
 * contract before anything is written.
 */
const POST_RESOLUTION_ACTIONS = Object.freeze({
  markRescued: Object.freeze({
    outcome: 'RESOLVED',
    icon: 'CheckCircle',
    guard: 'Record this rescue as resolved?',
    appliesTo: (postType) => postType === 'RESCUE',
  }),
  markAnimalDeceased: Object.freeze({
    outcome: 'ANIMAL_DECEASED',
    icon: 'AlertCircle',
    guard: 'Close this rescue because the animal died?',
    appliesTo: (postType) => postType === 'RESCUE',
  }),
  markReunited: Object.freeze({
    outcome: 'REUNITED',
    icon: 'Heart',
    guard: 'Record this lost/found case as reunited?',
    appliesTo: (postType) => postType === 'LOST',
  }),
  markResolved: Object.freeze({
    outcome: 'RESOLVED',
    icon: 'CheckSquare',
    guard: 'Record this case as resolved?',
    appliesTo: (postType, reportType) => postType === 'MATING' || (postType === 'LOST' && reportType === 'FOUND_STRAY'),
  }),
  markAdopted: Object.freeze({
    outcome: 'ADOPTED',
    icon: 'Home',
    guard: 'Record this adoption as adopted?',
    appliesTo: (postType) => postType === 'ADOPTION',
  }),
  markSold: Object.freeze({
    outcome: 'SOLD',
    icon: 'ShoppingCart',
    guard: 'Record this listing as sold?',
    appliesTo: (postType) => postType === 'PRODUCT',
  }),
});

function buildResolutionAction(pool, component, cache, definition) {
  const action = buildPostAction(
    pool,
    component,
    {
      actionType: 'POST_RESOLVED',
      icon: definition.icon,
      guard: definition.guard,
      requiresForm: true,
      reasonRequired: true,
      successMessage: 'Post resolution recorded.',
      isVisible: (context) => {
        const record = context?.record;
        if (!record) return false;
        const postType = getRecordProperty(record, 'post_type');
        const reportType = getRecordProperty(record, 'report_type');
        return (
          definition.appliesTo(postType, reportType) &&
          canAdminResolve(postType, getRecordProperty(record, 'status'), definition.outcome, reportType)
        );
      },
      validate: async (row, client) => {
        if (row.status !== 'ACTIVE') {
          return 'Only active posts can be resolved.';
        }
        const lostReportType = row.post_type === 'LOST' ? await findLostReportType(client, row.id) : null;
        if (
          !definition.appliesTo(row.post_type, lostReportType) ||
          !canAdminResolve(row.post_type, row.status, definition.outcome, lostReportType)
        ) {
          return `A "${row.post_type}" post cannot be resolved as ${definition.outcome}.`;
        }
        return null;
      },
      mutate: async (client, row) => {
        await client.query(`UPDATE posts SET status = $2, updated_at = now() WHERE id = $1`, [
          row.id,
          definition.outcome,
        ]);
        const content = buildNotificationContent('POST_RESOLVED_BY_ADMIN', {
          postTitle: row.title,
          outcome: definition.outcome,
        });
        const { rows: notificationRows } = await client.query(
          `INSERT INTO notifications
             (recipient_id, type, title, body, title_arabic, body_arabic, related_post_id, is_read)
           VALUES ($1, 'POST_RESOLVED_BY_ADMIN', $2, $3, $4, $5, $6, false)
           RETURNING id`,
          [row.creator_id, content.title, content.body, content.titleArabic, content.bodyArabic, row.id],
        );
        await enqueuePushDeliveries(client, {
          id: notificationRows[0].id,
          recipientId: row.creator_id,
          type: 'POST_RESOLVED_BY_ADMIN',
        });
        const termination = await terminatePendingInteractions(client, row.id);
        await capturePostCompletion(client, {
          postId: row.id,
          postType: row.post_type,
          outcome: definition.outcome,
          // AdminJS administrators are `admin_users` rows while the completion
          // event's `closing_actor_id` references `users`. The append-only
          // moderation audit row records the acting administrator, so an
          // administrator-recorded outcome stores no app-user closing actor.
          closingActorId: null,
          title: row.title,
          creatorId: row.creator_id,
        });
        return { outcome: definition.outcome, ...termination };
      },
    },
    cache,
  );

  // The action page loads the record through this action, so the LOST
  // discriminator must be attached here too; otherwise `markResolved` would be
  // filtered out of the action page's own record actions for a FOUND_STRAY.
  return { ...action, before: attachLostSubtype(pool) };
}

function buildResolutionActions(pool, component, cache) {
  return Object.fromEntries(
    Object.entries(POST_RESOLUTION_ACTIONS).map(([name, definition]) => [
      name,
      buildResolutionAction(pool, component, cache, definition),
    ]),
  );
}

/**
 * Administrator-only correction for a mistaken Post Resolution. It is offered
 * only for a completed outcome whose owner is not banned, requires an internal
 * reason, returns the Post to `ACTIVE` and records the corrected outcome in the
 * audit row. It deliberately leaves moderation fields, open Post Reports and
 * every terminated or approved interaction untouched: reopening never revives
 * closed requests or applications, and it never bypasses removal, moderation,
 * bans or the separate restoration/renewal paths.
 */
function buildReopenAction(pool, component, cache) {
  const action = buildPostAction(
    pool,
    component,
    {
      actionType: 'POST_REOPENED',
      icon: 'CornerUpLeft',
      requiresForm: true,
      reasonRequired: true,
      successMessage: 'Post reopened.',
      isVisible: (context) => {
        const record = context?.record;
        if (!record) return false;
        return (
          canAdminReopen(getRecordProperty(record, 'status')) && getRecordProperty(record, 'owner_is_banned') !== true
        );
      },
      validate: async (row, client) => {
        if (!canAdminReopen(row.status)) {
          return 'Only a completed post can be reopened.';
        }
        const { rows } = await client.query(`SELECT is_banned FROM users WHERE id = $1 FOR SHARE`, [row.creator_id]);
        if (!rows[0] || rows[0].is_banned) {
          return 'A post owned by a banned account cannot be reopened.';
        }
        return null;
      },
      mutate: async (client, row) => {
        const previousOutcome = row.status;
        await client.query(`UPDATE posts SET status = 'ACTIVE', updated_at = now() WHERE id = $1`, [row.id]);
        const content = buildNotificationContent('POST_REOPENED_BY_ADMIN', { postTitle: row.title });
        const { rows: notificationRows } = await client.query(
          `INSERT INTO notifications
             (recipient_id, type, title, body, title_arabic, body_arabic, related_post_id, is_read)
           VALUES ($1, 'POST_REOPENED_BY_ADMIN', $2, $3, $4, $5, $6, false)
           RETURNING id`,
          [row.creator_id, content.title, content.body, content.titleArabic, content.bodyArabic, row.id],
        );
        await enqueuePushDeliveries(client, {
          id: notificationRows[0].id,
          recipientId: row.creator_id,
          type: 'POST_REOPENED_BY_ADMIN',
        });
        await reopenPostCompletion(client, {
          postId: row.id,
          postTitle: row.title,
        });
        return { previousOutcome };
      },
    },
    cache,
  );

  // The action page loads the record through this action, so the owner ban
  // state must be attached here too; otherwise `reopenPost` would be filtered
  // out of the action page's own record actions for a banned owner.
  return { ...action, before: attachOwnerBanStatus(pool) };
}

export function buildPostActions(pool, component, cache) {
  return {
    ...buildResolutionActions(pool, component, cache),
    reopenPost: buildReopenAction(pool, component, cache),
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
        mutate: async (client, row, adminId) => {
          await client.query(
            `UPDATE posts
             SET moderation_status = 'CLEAN', moderation_reason = NULL, moderated_at = now(),
                 moderated_by_admin_id = $2, updated_at = now()
             WHERE id = $1`,
            [row.id, adminId],
          );
          const closedPostReportIds = await closeOpenPostReports(client, row.id, adminId);
          return { closedPostReportIds };
        },
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
        mutate: async (client, row, adminId, reason) => {
          await client.query(
            `UPDATE posts
             SET moderation_status = 'FLAGGED', moderation_reason = $2, moderated_at = now(),
                 moderated_by_admin_id = $3, updated_at = now()
             WHERE id = $1`,
            [row.id, reason, adminId],
          );
          const closedPostReportIds = await closeOpenPostReports(client, row.id, adminId);
          return { closedPostReportIds };
        },
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
          return canAdminRemove(status);
        },
        validate: (row) => (canAdminRemove(row.status) ? null : 'Only active posts can be removed.'),
        mutate: async (client, row, adminId, reason) => {
          await client.query(
            `UPDATE posts
             SET status = 'REMOVED', moderation_reason = $2, moderated_at = now(),
                 moderated_by_admin_id = $3, updated_at = now()
             WHERE id = $1`,
            [row.id, reason, adminId],
          );
          const content = buildNotificationContent('POST_REMOVED_BY_ADMIN', { reason });
          const { rows: notificationRows } = await client.query(
            `INSERT INTO notifications
               (recipient_id, type, title, body, title_arabic, body_arabic, related_post_id, is_read)
             VALUES ($1, 'POST_REMOVED_BY_ADMIN', $2, $3, $4, $5, $6, false)
             RETURNING id`,
            [row.creator_id, content.title, content.body, content.titleArabic, content.bodyArabic, row.id],
          );
          await enqueuePushDeliveries(client, {
            id: notificationRows[0].id,
            recipientId: row.creator_id,
            type: 'POST_REMOVED_BY_ADMIN',
          });
          const closedPostReportIds = await closeOpenPostReports(client, row.id, adminId);
          return { closedPostReportIds };
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
          return canAdminRestore(status);
        },
        validate: (row) => (canAdminRestore(row.status) ? null : 'Only removed posts can be restored.'),
        mutate: async (client, row, adminId) => {
          await client.query(
            `UPDATE posts
             SET status = 'ACTIVE', moderated_at = now(), moderated_by_admin_id = $2, updated_at = now()
             WHERE id = $1`,
            [row.id, adminId],
          );
          const closedPostReportIds = await closeOpenPostReports(client, row.id, adminId);
          return { closedPostReportIds };
        },
      },
      cache,
    ),
  };
}

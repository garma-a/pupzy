import { canAdminRemove } from '../../../../src/common/contracts/post-lifecycle.contract.ts';
import { isAnyAdmin } from '../rbac.js';
import { canHideComment, canRemoveComment } from './moderate-comment.actions.js';

/**
 * Acting on the reported content from a report page.
 *
 * The buttons next to "Review With No Action" are not copies of the target's
 * moderation actions. Each one only sends the moderator to the target's own
 * action form (the same code, validation, audit and report closing as on the
 * Post, Comment or User page) with `returnTo` set to this report, so after the
 * action they land back on the report and see it closed. A button's handler
 * changes nothing, so it is safe even if AdminJS calls it with a GET.
 *
 * Which buttons show depends on the target's current state (a Post already
 * removed or a User already banned has no button), loaded by `reportTargetState`
 * into `record.params.report_target_*` before the record's actions are listed.
 */
const TARGET_SQL = {
  post: `SELECT p.id AS target_id, p.status AS target_status, p.creator_id AS author_id, u.is_banned AS author_banned
         FROM post_reports r
         JOIN posts p ON p.id = r.post_id
         LEFT JOIN users u ON u.id = p.creator_id
         WHERE r.id = $1`,
  comment: `SELECT c.id AS target_id, c.status AS target_status, c.author_id AS author_id, u.is_banned AS author_banned
            FROM comment_reports r
            JOIN comments c ON c.id = r.comment_id
            LEFT JOIN users u ON u.id = c.author_id
            WHERE r.id = $1`,
  account: `SELECT r.reported_user_id AS target_id, NULL AS target_status, r.reported_user_id AS author_id,
                   u.is_banned AS author_banned
            FROM account_reports r
            LEFT JOIN users u ON u.id = r.reported_user_id
            WHERE r.id = $1`,
};

/** `before` hook for every record action of a report resource. */
export function reportTargetState(pool, kind) {
  return async function reportTargetStateBeforeHook(request, context) {
    const record = context?.record;
    if (!record?.params || !pool || typeof pool.query !== 'function') return request;
    const reportId = typeof record.id === 'function' ? record.id() : record.params.id;
    if (!reportId) return request;
    try {
      const { rows } = await pool.query(TARGET_SQL[kind], [reportId]);
      const row = rows[0];
      record.params.report_target_id = row?.target_id ?? null;
      record.params.report_target_status = row?.target_status ?? null;
      record.params.report_target_author_id = row?.author_id ?? null;
      record.params.report_target_author_banned = row?.author_banned === true;
    } catch {
      // Leave the state unset: the buttons are hidden and the target's own page still works.
    }
    return request;
  };
}

const param = (record, name) =>
  (typeof record?.get === 'function' ? record.get(name) : undefined) ?? record?.params?.[name];
const canBan = (record) =>
  Boolean(param(record, 'report_target_author_id')) && param(record, 'report_target_author_banned') !== true;

function redirectAction({ reportResourceId, icon, isVisible, target }) {
  return {
    actionType: 'record',
    icon,
    isAccessible: isAnyAdmin,
    isVisible: (context) => Boolean(context?.record) && isVisible(context.record),
    component: false,
    handler: async (_request, _response, context) => {
      const { record, currentAdmin, h } = context;
      const { resourceId, recordId, actionName } = target(record);
      const returnTo = h.recordActionUrl({ resourceId: reportResourceId, recordId: record.id(), actionName: 'show' });
      return {
        record: record.toJSON(currentAdmin),
        redirectUrl: h.recordActionUrl({
          resourceId,
          recordId,
          actionName,
          search: `?returnTo=${encodeURIComponent(returnTo)}`,
        }),
      };
    },
  };
}

const banAuthor = (reportResourceId) =>
  redirectAction({
    reportResourceId,
    icon: 'Slash',
    isVisible: canBan,
    target: (record) => ({
      resourceId: 'users',
      recordId: param(record, 'report_target_author_id'),
      actionName: 'banUser',
    }),
  });

export function buildPostReportTargetActions() {
  return {
    removePost: redirectAction({
      reportResourceId: 'post_reports',
      icon: 'Trash2',
      isVisible: (record) =>
        Boolean(param(record, 'report_target_id')) && canAdminRemove(param(record, 'report_target_status')),
      target: (record) => ({
        resourceId: 'posts',
        recordId: param(record, 'report_target_id'),
        actionName: 'removePost',
      }),
    }),
    banAuthor: banAuthor('post_reports'),
  };
}

export function buildCommentReportTargetActions() {
  const comment = (actionName) => (record) => ({
    resourceId: 'comments',
    recordId: param(record, 'report_target_id'),
    actionName,
  });
  return {
    hideComment: redirectAction({
      reportResourceId: 'comment_reports',
      icon: 'EyeOff',
      isVisible: (record) => canHideComment(param(record, 'report_target_status')),
      target: comment('hideComment'),
    }),
    removeComment: redirectAction({
      reportResourceId: 'comment_reports',
      icon: 'Trash',
      isVisible: (record) =>
        Boolean(param(record, 'report_target_id')) && canRemoveComment(param(record, 'report_target_status')),
      target: comment('removeComment'),
    }),
    banAuthor: banAuthor('comment_reports'),
  };
}

export function buildAccountReportTargetActions() {
  return {
    banUser: redirectAction({
      reportResourceId: 'account_reports',
      icon: 'Slash',
      isVisible: canBan,
      target: (record) => ({
        resourceId: 'users',
        recordId: param(record, 'report_target_author_id'),
        actionName: 'banUser',
      }),
    }),
  };
}

/** Adds the target-state `before` hook to a report's existing actions. */
export function withTargetState(actions, hook) {
  return Object.fromEntries(
    Object.entries(actions).map(([name, action]) => [
      name,
      { ...action, before: [action.before, hook].flat().filter(Boolean) },
    ]),
  );
}

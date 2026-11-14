import { postStatusLabel } from './post-review.js';
import { plainValue } from '../status-styles.js';
const VERBS = Object.freeze({
  POST_APPROVED: 'approved post',
  POST_FLAGGED: 'flagged post',
  POST_REMOVED: 'removed post',
  POST_RESTORED: 'restored post',
  POST_REOPENED: 'reopened post',
  POST_RESOLVED: 'completed post',
  USER_BANNED: 'banned account',
  USER_UNBANNED: 'unbanned account',
  USER_PROFILE_PHOTO_REMOVED: 'removed the profile photo of',
  COMMENT_HIDDEN: 'hid comment',
  COMMENT_REMOVED: 'removed comment',
  COMMENT_RESTORED: 'restored comment',
  COMMENT_IMAGES_HIDDEN: 'hid images on comment',
  POST_REPORT_REVIEWED_NO_ACTION: 'closed a report with no action on post',
  COMMENT_REPORT_REVIEWED_NO_ACTION: 'closed a report with no action on comment',
  ACCOUNT_REPORT_REVIEWED_NO_ACTION: 'closed a report with no action on account',
  ANNOUNCEMENT_SENT: 'sent announcement',
});
export function auditSentence({ actor, action, target, reason, metadata }) {
  const outcome =
    action === 'POST_RESOLVED' && metadata?.outcome ? ` as ${postStatusLabel(metadata.outcome).toLowerCase()}` : '';
  return `${actor || 'Removed administrator'} ${VERBS[action] ?? `recorded ${plainValue(action).toLowerCase()} on`} “${target}”${outcome}${reason ? ` — “${reason}”` : ''}`;
}

/** The actor is no longer a separate list column, so populate all actors in one batch. */
export async function attachAuditActors(pool, response) {
  const records = response.records ?? [];
  const ids = [...new Set(records.map((record) => record.params.admin_user_id).filter(Boolean))];
  if (!ids.length || !pool?.query) return response;
  const { rows } = await pool.query('SELECT id,full_name,email FROM admin_users WHERE id=ANY($1::uuid[])', [ids]);
  const actors = new Map(rows.map((row) => [row.id, row]));
  for (const record of records) {
    const id = record.params.admin_user_id,
      actor = actors.get(id);
    record.populated = {
      ...record.populated,
      admin_user_id: { id, resourceId: 'admin_users', missing: !actor, params: actor ?? {} },
    };
  }
  return response;
}

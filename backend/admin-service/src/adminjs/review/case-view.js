import {
  loadHistory,
  USER_NAME_SQL,
  postTypeLabel,
  postStatusLabel,
  moderationStatusLabel,
  moderationActionHistoryLabel,
  reportReasonLabel,
} from './post-review.js';
import { reportReviewStatus } from '../report-status.js';

const CASES = Object.freeze({
  post_reports: { table: 'post_reports', field: 'post_id', target: 'POST' },
  comment_reports: { table: 'comment_reports', field: 'comment_id', target: 'COMMENT' },
  account_reports: { table: 'account_reports', field: 'reported_user_id', target: 'USER' },
});
/** Show-page data only. SQL identifiers come exclusively from CASES, never requests. */
export async function loadReportCase(pool, resourceId, params) {
  const config = Object.hasOwn(CASES, resourceId) ? CASES[resourceId] : null;
  if (!config) throw new Error('Unknown case resource');
  const targetId = params[config.field];
  if (!targetId) return null;
  const [reportsResult, historyResult] = await Promise.all([
    pool.query(
      `SELECT r.id,r.reason,r.details,r.created_at,r.reviewed_at,r.review_outcome,r.reporter_id,
 ${USER_NAME_SQL} AS reporter_name,u.profile_picture_url AS reporter_picture,count(*) OVER()::int AS total
 FROM ${config.table} r LEFT JOIN users u ON u.id=r.reporter_id
 WHERE r.${config.field}=$1 AND r.id<>$2 ORDER BY (r.reviewed_at IS NOT NULL),r.created_at DESC,r.id DESC LIMIT 20`,
      [targetId, params.id],
    ),
    config.target === 'POST'
      ? loadHistory(pool, targetId)
      : pool.query(
          `SELECT a.id,a.action_type,a.reason,a.metadata,a.created_at,u.full_name AS admin_name,count(*) OVER()::int AS total
 FROM moderation_actions a LEFT JOIN admin_users u ON u.id=a.admin_user_id
 WHERE a.target_type=$1 AND a.target_id=$2 ORDER BY a.created_at DESC,a.id DESC LIMIT 12`,
          [config.target, targetId],
        ),
  ]);
  const history = Array.isArray(historyResult)
    ? historyResult.slice(0, 12)
    : historyResult.rows.map((r) => ({
        id: r.id,
        actionLabel: moderationActionHistoryLabel(r.action_type, r.metadata),
        reason: r.reason,
        adminName: r.admin_name ?? 'Removed administrator',
        createdAt: r.created_at,
      }));
  const reports = reportsResult.rows.map((r) => {
    const state = reportReviewStatus({ reviewedAt: r.reviewed_at, reviewOutcome: r.review_outcome });
    return {
      id: r.id,
      reasonLabel: reportReasonLabel(r.reason),
      details: r.details,
      createdAt: r.created_at,
      statusState: state.state,
      statusLabel: state.label,
      isOpen: state.isOpen,
      reporter: { id: r.reporter_id, name: r.reporter_name ?? 'Deleted account', pictureUrl: r.reporter_picture },
    };
  });
  let post = null,
    account = null,
    photos = [];
  if (config.target === 'POST') {
    const [p, m] = await Promise.all([
      pool.query(
        `SELECT p.id,p.title,p.description,p.post_type,p.status,p.moderation_status,p.created_at,p.creator_id,
 ${USER_NAME_SQL} AS owner_name,u.profile_picture_url AS owner_picture,c.name_english AS city
 FROM posts p LEFT JOIN users u ON u.id=p.creator_id LEFT JOIN cities c ON c.id=p.city_id WHERE p.id=$1`,
        [targetId],
      ),
      pool.query('SELECT id,public_url FROM post_media WHERE post_id=$1 ORDER BY display_order,created_at,id', [
        targetId,
      ]),
    ]);
    const r = p.rows[0];
    if (r)
      post = {
        id: r.id,
        title: r.title,
        text: r.description,
        typeLabel: postTypeLabel(r.post_type),
        status: r.status,
        statusLabel: postStatusLabel(r.status),
        moderationStatus: r.moderation_status,
        moderationLabel: moderationStatusLabel(r.moderation_status),
        createdAt: r.created_at,
        city: r.city,
        owner: { id: r.creator_id, name: r.owner_name ?? 'Deleted account', pictureUrl: r.owner_picture },
      };
    photos = m.rows.map((r) => ({ id: r.id, url: r.public_url, available: Boolean(r.public_url) }));
  } else if (config.target === 'USER') {
    const { rows } = await pool.query(
      `SELECT u.id,u.full_name,u.full_name_arabic,u.email,u.profile_picture_url,u.created_at,u.is_banned,u.post_count,
 (SELECT count(*)::int FROM account_reports r WHERE r.reported_user_id=u.id AND r.reviewed_at IS NULL) AS open_reports,
 (SELECT count(*)::int FROM moderation_actions a WHERE a.target_type='USER' AND a.target_id=u.id) AS past_actions
 FROM users u WHERE u.id=$1`,
      [targetId],
    );
    account = rows[0] ?? null;
  }
  return { post, account, photos, history, reports, otherReportsTotal: reportsResult.rows[0]?.total ?? 0 };
}

export function attachReportCase(resource, pool, components) {
  const name = resource.resource.tableName;
  if (!CASES[name] || !components.ReportCase) return resource;
  const show = resource.options.actions.show ?? {};
  const previous = show.after ? (Array.isArray(show.after) ? show.after : [show.after]) : [];
  const after = async (response) => {
    if (response.record?.params)
      response.record.params.report_case = JSON.stringify(await loadReportCase(pool, name, response.record.params));
    return response;
  };
  return {
    ...resource,
    options: {
      ...resource.options,
      actions: {
        ...resource.options.actions,
        show: { ...show, component: components.ReportCase, hideActionHeader: true, after: [...previous, after] },
      },
    },
  };
}

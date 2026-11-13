import { resolveCommentMediaUrl } from '../comment-media-url.js';
import { excerpt } from '../reference-title.js';
import { USER_NAME_SQL, reportReasonLabel } from '../review/post-review.js';

export const INBOX_PAGE_SIZE = 25;

/** What the Inbox lists. Each kind is one "case": a target with open work. */
export const INBOX_KINDS = Object.freeze({
  post_report: { label: 'Post report', resource: 'post_reports' },
  comment_report: { label: 'Comment report', resource: 'comment_reports' },
  account_report: { label: 'Account report', resource: 'account_reports' },
  flagged: { label: 'Flagged post', resource: 'posts' },
  pending: { label: 'Pending review', resource: 'posts' },
});

const KIND_NAMES = Object.keys(INBOX_KINDS);

/** Reads the filter, order and page from the request query; anything unknown falls back to the default. */
export function parseInboxQuery(query = {}) {
  const kind = KIND_NAMES.includes(query.kind) ? query.kind : 'all';
  const order = query.order === 'newest' ? 'newest' : 'oldest';
  const parsed = Number.parseInt(query.page, 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100_000) : 1;
  return { kind, order, page };
}

/**
 * One row per target. Open reports on the same Post, Comment or account are
 * grouped (`GROUP BY` the target) and the case opens the oldest one. A flagged
 * or pending Post is its own row.
 */
const CASE_SQL = {
  post_report: `
    SELECT 'post_report'::text AS kind, post_id AS target_id,
           (array_agg(id ORDER BY created_at, id))[1] AS case_id,
           count(*)::int AS report_count, min(created_at) AS since, max(created_at) AS latest
    FROM post_reports WHERE reviewed_at IS NULL GROUP BY post_id`,
  comment_report: `
    SELECT 'comment_report'::text, comment_id,
           (array_agg(id ORDER BY created_at, id))[1],
           count(*)::int, min(created_at), max(created_at)
    FROM comment_reports WHERE reviewed_at IS NULL GROUP BY comment_id`,
  account_report: `
    SELECT 'account_report'::text, reported_user_id,
           (array_agg(id ORDER BY created_at, id))[1],
           count(*)::int, min(created_at), max(created_at)
    FROM account_reports WHERE reviewed_at IS NULL GROUP BY reported_user_id`,
  flagged: `
    SELECT 'flagged'::text, id, id, 0, created_at, created_at
    FROM posts WHERE moderation_status = 'FLAGGED' AND status = 'ACTIVE'`,
  pending: `
    SELECT 'pending'::text, id, id, 0, created_at, created_at
    FROM posts WHERE moderation_status = 'PENDING_AUTO_REVIEW' AND status = 'ACTIVE'`,
};

const casesCte = (kind) =>
  `WITH cases(kind, target_id, case_id, report_count, since, latest) AS (${(kind === 'all' ? KIND_NAMES : [kind]).map((name) => CASE_SQL[name]).join('\n    UNION ALL')}\n    )`;

/** Only used when a link points past the last page. */
export const buildInboxCountSql = ({ kind }) => `${casesCte(kind)} SELECT count(*)::int AS total FROM cases`;

/** The page of cases: keys only, plus the total number of cases for the filter. */
export function buildInboxPageSql({ kind, order }) {
  const orderBy = order === 'newest' ? 'latest DESC' : 'since ASC';
  return `
    ${casesCte(kind)}
    SELECT kind, target_id, case_id, report_count, since, latest, count(*) OVER ()::int AS total
    FROM cases
    ORDER BY ${orderBy}, kind, target_id
    LIMIT ${INBOX_PAGE_SIZE} OFFSET $1`;
}

const PHOTO_SQL = `(SELECT m.public_url FROM post_media m WHERE m.post_id = p.id ORDER BY m.display_order, m.created_at LIMIT 1)`;
const COMMENT_IMAGE_SQL = `(SELECT m.storage_key FROM comment_media m WHERE m.comment_id = c.id ORDER BY m.display_order LIMIT 1)`;
const OPEN_POST_REPORTS_SQL = `(SELECT count(*)::int FROM post_reports x WHERE x.post_id = p.id AND x.reviewed_at IS NULL)`;

/** Details of every case on the page, one query per kind (never one per row). */
const DETAIL_SQL = {
  post_report: `
    SELECT r.id AS case_id, r.reason, r.reporter_id, ${USER_NAME_SQL} AS reporter_name, u.profile_picture_url AS reporter_picture,
           p.id AS target_id, p.title, ${PHOTO_SQL} AS photo
    FROM post_reports r
    LEFT JOIN users u ON u.id = r.reporter_id
    LEFT JOIN posts p ON p.id = r.post_id
    WHERE r.id = ANY($1::uuid[])`,
  comment_report: `
    SELECT r.id AS case_id, r.reason, r.reporter_id, ${USER_NAME_SQL} AS reporter_name, u.profile_picture_url AS reporter_picture,
           c.id AS target_id, c.text, ${COMMENT_IMAGE_SQL} AS photo_key,
           a.full_name AS author_name, a.profile_picture_url AS author_picture
    FROM comment_reports r
    LEFT JOIN users u ON u.id = r.reporter_id
    LEFT JOIN comments c ON c.id = r.comment_id
    LEFT JOIN users a ON a.id = c.author_id
    WHERE r.id = ANY($1::uuid[])`,
  account_report: `
    SELECT r.id AS case_id, r.reason, r.reporter_id, ${USER_NAME_SQL} AS reporter_name, u.profile_picture_url AS reporter_picture,
           t.id AS target_id,
           COALESCE(NULLIF(btrim(t.full_name), ''), NULLIF(btrim(t.full_name_arabic), ''), t.email) AS target_name,
           t.profile_picture_url AS target_picture
    FROM account_reports r
    LEFT JOIN users u ON u.id = r.reporter_id
    LEFT JOIN users t ON t.id = r.reported_user_id
    WHERE r.id = ANY($1::uuid[])`,
  post: `
    SELECT p.id AS target_id, p.title, p.moderation_reason, ${PHOTO_SQL} AS photo, ${OPEN_POST_REPORTS_SQL} AS open_reports
    FROM posts p
    WHERE p.id = ANY($1::uuid[])`,
};

const person = (id, name, pictureUrl) =>
  id ? { id, name: name ?? 'Deleted account', pictureUrl: pictureUrl ?? null } : null;

function toItem(row, detail, env) {
  const base = {
    key: `${row.kind}:${row.target_id}`,
    kind: row.kind,
    kindLabel: INBOX_KINDS[row.kind].label,
    targetId: row.target_id,
    reportCount: row.report_count,
    since: row.since,
    reporter: null,
    reason: null,
  };
  const target = { resource: INBOX_KINDS[row.kind].resource, id: row.case_id };

  if (row.kind === 'post_report') {
    return {
      ...base,
      target,
      title: detail?.title ?? 'Post not found',
      thumbnailUrl: detail?.photo ?? null,
      avatar: null,
      reasonLabel: reportReasonLabel(detail?.reason),
      reporter: person(detail?.reporter_id, detail?.reporter_name, detail?.reporter_picture),
    };
  }
  if (row.kind === 'comment_report') {
    const imageUrl = detail?.photo_key ? resolveCommentMediaUrl(detail.photo_key, env) : null;
    return {
      ...base,
      target,
      title: detail?.text ? excerpt(detail.text, 120) : 'Deleted comment',
      thumbnailUrl: imageUrl,
      avatar: imageUrl
        ? null
        : { name: detail?.author_name ?? 'Deleted account', pictureUrl: detail?.author_picture ?? null },
      reasonLabel: reportReasonLabel(detail?.reason),
      reporter: person(detail?.reporter_id, detail?.reporter_name, detail?.reporter_picture),
    };
  }
  if (row.kind === 'account_report') {
    return {
      ...base,
      target,
      title: detail?.target_name ?? 'Deleted account',
      thumbnailUrl: null,
      avatar: { name: detail?.target_name ?? 'Deleted account', pictureUrl: detail?.target_picture ?? null },
      reasonLabel: reportReasonLabel(detail?.reason),
      reporter: person(detail?.reporter_id, detail?.reporter_name, detail?.reporter_picture),
    };
  }
  return {
    ...base,
    target: { resource: 'posts', id: row.target_id },
    title: detail?.title ?? 'Post not found',
    thumbnailUrl: detail?.photo ?? null,
    avatar: null,
    reportCount: detail?.open_reports ?? 0,
    reasonLabel:
      detail?.moderation_reason ||
      (row.kind === 'flagged' ? 'Flagged by automatic review' : 'Waiting for automatic review'),
  };
}

const indexBy = (rows, field) => new Map(rows.map((row) => [row[field], row]));

/**
 * One page of the Moderation Inbox: 1 query for the page of cases, then at most
 * one query per kind present on the page for their details.
 */
export async function loadInbox(pool, query = {}, env = process.env) {
  const params = parseInboxQuery(query);
  const sql = buildInboxPageSql(params);
  let page = params.page;
  let { rows } = await pool.query(sql, [(page - 1) * INBOX_PAGE_SIZE]);

  if (rows.length === 0 && page > 1) {
    // A stale link to a page that no longer exists: show the last page instead.
    const { rows: countRows } = await pool.query(buildInboxCountSql(params));
    page = Math.max(1, Math.ceil((countRows[0]?.total ?? 0) / INBOX_PAGE_SIZE));
    ({ rows } = await pool.query(sql, [(page - 1) * INBOX_PAGE_SIZE]));
  }

  const total = rows[0]?.total ?? 0;
  const idsOf = (kind, field) => rows.filter((row) => row.kind === kind).map((row) => row[field]);
  const reportKinds = ['post_report', 'comment_report', 'account_report'];
  const postIds = rows.filter((row) => row.kind === 'flagged' || row.kind === 'pending').map((row) => row.target_id);

  const details = Object.fromEntries(
    await Promise.all([
      ...reportKinds.map(async (kind) => {
        const ids = idsOf(kind, 'case_id');
        if (ids.length === 0) return [kind, new Map()];
        const { rows: detailRows } = await pool.query(DETAIL_SQL[kind], [ids]);
        return [kind, indexBy(detailRows, 'case_id')];
      }),
      (async () => {
        if (postIds.length === 0) return ['post', new Map()];
        const { rows: detailRows } = await pool.query(DETAIL_SQL.post, [postIds]);
        return ['post', indexBy(detailRows, 'target_id')];
      })(),
    ]),
  );

  const items = rows.map((row) =>
    toItem(
      row,
      reportKinds.includes(row.kind) ? details[row.kind].get(row.case_id) : details.post.get(row.target_id),
      env,
    ),
  );

  return {
    items,
    kind: params.kind,
    order: params.order,
    page,
    pageSize: INBOX_PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE)),
  };
}

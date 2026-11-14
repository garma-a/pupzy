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
 * grouped (`GROUP BY` the target) and the case opens the oldest one. A Post that
 * is flagged or pending review AND has open reports is still ONE row: the
 * reports are joined to it. `post_state` is 'flagged', 'pending' or NULL.
 */
const OPEN_POST_REPORTS = `
  SELECT post_id, count(*)::int AS n, (array_agg(id ORDER BY created_at, id))[1] AS case_id,
         min(created_at) AS first_at, max(created_at) AS last_at
  FROM post_reports WHERE reviewed_at IS NULL GROUP BY post_id`;
const reviewPosts = (states) => `
  SELECT id, CASE moderation_status WHEN 'FLAGGED' THEN 'flagged' ELSE 'pending' END AS state,
         COALESCE(moderated_at, created_at) AS flag_at
  FROM posts WHERE status = 'ACTIVE' AND moderation_status IN (${states})`;
const BOTH_STATES = `'FLAGGED', 'PENDING_AUTO_REVIEW'`;
const POST_COLUMNS = `
  SELECT 'post'::text, COALESCE(r.post_id, p.id), r.case_id, COALESCE(r.n, 0),
         LEAST(r.first_at, p.flag_at), GREATEST(r.last_at, p.flag_at), p.state`;
const COLUMNS = '(kind, target_id, case_id, report_count, since, latest, post_state)';

const POST_SQL = {
  // Every open report, with the Post's review state when it has one.
  all: `${POST_COLUMNS} FROM (${OPEN_POST_REPORTS}) r FULL JOIN (${reviewPosts(BOTH_STATES)}) p ON p.id = r.post_id`,
  post_report: `${POST_COLUMNS} FROM (${OPEN_POST_REPORTS}) r LEFT JOIN (${reviewPosts(BOTH_STATES)}) p ON p.id = r.post_id`,
  // Flagged or pending Posts, with their open reports when they have any.
  flagged: postsWithReports(`'FLAGGED'`),
  pending: postsWithReports(`'PENDING_AUTO_REVIEW'`),
};

function postsWithReports(states) {
  return `
  SELECT 'post'::text, p.id, r.case_id, COALESCE(r.n, 0),
         LEAST(r.first_at, p.flag_at), GREATEST(r.last_at, p.flag_at), p.state
  FROM (${reviewPosts(states)}) p
  LEFT JOIN LATERAL (${OPEN_POST_REPORTS.replace('WHERE reviewed_at IS NULL', 'WHERE reviewed_at IS NULL AND post_id = p.id')}) r ON true`;
}

const CASE_SQL = {
  comment_report: `
    SELECT 'comment_report'::text, comment_id, (array_agg(id ORDER BY created_at, id))[1],
           count(*)::int, min(created_at), max(created_at), NULL::text
    FROM comment_reports WHERE reviewed_at IS NULL GROUP BY comment_id`,
  account_report: `
    SELECT 'account_report'::text, reported_user_id, (array_agg(id ORDER BY created_at, id))[1],
           count(*)::int, min(created_at), max(created_at), NULL::text
    FROM account_reports WHERE reviewed_at IS NULL GROUP BY reported_user_id`,
};

/** The SQL branches that make up a filter. Posts are one branch, however many filters they match. */
function branchesFor(kind) {
  switch (kind) {
    case 'all':
      return [POST_SQL.all, CASE_SQL.comment_report, CASE_SQL.account_report];
    case 'post_report':
    case 'flagged':
    case 'pending':
      return [POST_SQL[kind]];
    default:
      return [CASE_SQL[kind]];
  }
}

const casesCte = (kind) => `WITH cases${COLUMNS} AS (${branchesFor(kind).join('\n    UNION ALL')}\n    )`;

/** Only used when a link points past the last page. */
export const buildInboxCountSql = ({ kind }) => `${casesCte(kind)} SELECT count(*)::int AS total FROM cases`;

/** The page of cases: keys only, plus the total number of cases for the filter. */
export function buildInboxPageSql({ kind, order }) {
  const orderBy = order === 'newest' ? 'latest DESC' : 'since ASC';
  return `
    ${casesCte(kind)}
    SELECT kind, target_id, case_id, report_count, since, latest, post_state, count(*) OVER ()::int AS total
    FROM cases
    ORDER BY ${orderBy}, kind, target_id
    LIMIT ${INBOX_PAGE_SIZE} OFFSET $1`;
}

const PHOTO_SQL = `(SELECT m.public_url FROM post_media m WHERE m.post_id = p.id ORDER BY m.display_order, m.created_at LIMIT 1)`;
const COMMENT_IMAGE_SQL = `(SELECT m.storage_key FROM comment_media m WHERE m.comment_id = c.id ORDER BY m.display_order LIMIT 1)`;

/** Details of every case on the page, one query per kind (never one per row). */
const DETAIL_SQL = {
  post_report: `
    SELECT r.id AS case_id, r.reason, r.reporter_id, ${USER_NAME_SQL} AS reporter_name, u.profile_picture_url AS reporter_picture,
           r.post_id AS target_id
    FROM post_reports r
    LEFT JOIN users u ON u.id = r.reporter_id
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
    SELECT p.id AS target_id, p.title, p.moderation_reason, ${PHOTO_SQL} AS photo
    FROM posts p
    WHERE p.id = ANY($1::uuid[])`,
};

const person = (id, name, pictureUrl) =>
  id ? { id, name: name ?? 'Deleted account', pictureUrl: pictureUrl ?? null } : null;

const POST_KIND = { flagged: 'flagged', pending: 'pending' };

function toItem(row, detail, env) {
  const kind = row.kind === 'post' ? (POST_KIND[row.post_state] ?? 'post_report') : row.kind;
  const base = {
    key: `${row.kind}:${row.target_id}`,
    kind,
    kindLabel: INBOX_KINDS[kind].label,
    targetId: row.target_id,
    reportCount: row.report_count,
    since: row.since,
  };
  const reporter = person(detail?.reporter_id, detail?.reporter_name, detail?.reporter_picture);

  if (row.kind === 'post') {
    // A flagged or pending Post opens its review workspace, which lists the reports too.
    const inWorkspace = kind !== 'post_report';
    return {
      ...base,
      target: inWorkspace ? { resource: 'posts', id: row.target_id } : { resource: 'post_reports', id: row.case_id },
      title: detail?.post?.title ?? 'Post not found',
      thumbnailUrl: detail?.post?.photo ?? null,
      avatar: null,
      reasonLabel: row.case_id ? reportReasonLabel(detail?.reason) : detail?.post?.moderation_reason || null,
      reporter,
    };
  }
  const target = { resource: INBOX_KINDS[kind].resource, id: row.case_id };
  if (kind === 'comment_report') {
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
      reporter,
    };
  }
  return {
    ...base,
    target,
    title: detail?.target_name ?? 'Deleted account',
    thumbnailUrl: null,
    avatar: { name: detail?.target_name ?? 'Deleted account', pictureUrl: detail?.target_picture ?? null },
    reasonLabel: reportReasonLabel(detail?.reason),
    reporter,
  };
}

const indexBy = (rows, field) => new Map(rows.map((row) => [row[field], row]));

/**
 * One page of the Moderation Inbox: 1 query for the page of cases, then at most
 * four batched detail queries (Post reports, Comment reports, account reports, Posts).
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
  const postRows = rows.filter((row) => row.kind === 'post');
  const caseIds = (kind) => rows.filter((row) => row.kind === kind && row.case_id).map((row) => row.case_id);
  const fetchBy = async (sql, ids, field) => {
    if (ids.length === 0) return new Map();
    const { rows: detailRows } = await pool.query(sql, [ids]);
    return indexBy(detailRows, field);
  };
  const [reportDetails, commentDetails, accountDetails, postDetails] = await Promise.all([
    fetchBy(DETAIL_SQL.post_report, caseIds('post'), 'case_id'),
    fetchBy(DETAIL_SQL.comment_report, caseIds('comment_report'), 'case_id'),
    fetchBy(DETAIL_SQL.account_report, caseIds('account_report'), 'case_id'),
    fetchBy(
      DETAIL_SQL.post,
      postRows.map((row) => row.target_id),
      'target_id',
    ),
  ]);

  const items = rows.map((row) => {
    if (row.kind === 'comment_report') return toItem(row, commentDetails.get(row.case_id), env);
    if (row.kind === 'account_report') return toItem(row, accountDetails.get(row.case_id), env);
    return toItem(row, { ...reportDetails.get(row.case_id), post: postDetails.get(row.target_id) }, env);
  });

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

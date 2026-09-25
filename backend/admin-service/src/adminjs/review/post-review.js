import { isAnyAdmin } from '../rbac.js';

export const POST_REVIEW_WORKSPACE_PARAM = 'post_review_workspace';
export const POST_REVIEW_DISCUSSION_PARAM = 'post_review_discussion';
export const POST_REVIEW_DISCUSSION_ACTION = 'postReviewDiscussion';
export const POST_REVIEW_DISCUSSION_PAGE_SIZE = 10;
export const POST_REVIEW_REPORTS_LIMIT = 50;
export const POST_REVIEW_HISTORY_LIMIT = 50;

const POST_TYPE_LABELS = {
  RESCUE: 'Rescue',
  LOST: 'Lost & found',
  ADOPTION: 'Adoption',
  PRODUCT: 'Product',
  MATING: 'Mating',
};

const LOST_SUBTYPE_LABELS = {
  LOST_PET: 'Lost pet',
  FOUND_STRAY: 'Found stray',
};

const POST_STATUS_LABELS = {
  ACTIVE: 'Active',
  RESOLVED: 'Resolved',
  REUNITED: 'Reunited',
  ADOPTED: 'Adopted',
  SOLD: 'Sold',
  REMOVED: 'Removed',
  ANIMAL_DECEASED: 'Animal deceased',
};

const MODERATION_STATUS_LABELS = {
  PENDING_AUTO_REVIEW: 'Pending review',
  CLEAN: 'Clean',
  FLAGGED: 'Flagged',
};

const COMMENT_STATUS_LABELS = {
  ACTIVE: 'Active',
  IMAGE_HIDDEN: 'Image hidden',
  HIDDEN: 'Hidden',
  DELETED: 'Deleted',
  REMOVED: 'Removed',
};

const MODERATION_ACTION_LABELS = {
  POST_APPROVED: 'Post approved',
  POST_FLAGGED: 'Post flagged',
  POST_RESOLVED: 'Post resolution recorded',
  POST_REOPENED: 'Post reopened',
  POST_REMOVED: 'Post removed',
  POST_RESTORED: 'Post restored',
  USER_BANNED: 'User banned',
  USER_UNBANNED: 'User unbanned',
  COMMENT_RESTORED: 'Comment restored',
  COMMENT_REMOVED: 'Comment removed',
  POST_REPORT_REVIEWED_NO_ACTION: 'Post Report reviewed — no action',
  ACCOUNT_REPORT_REVIEWED_NO_ACTION: 'Pupzy Account Report reviewed — no action',
};

const REPORT_REASON_LABELS = {
  UNRELATED_TO_ANIMALS: 'Unrelated to animals',
  SPAM: 'Spam',
  INAPPROPRIATE_CONTENT: 'Inappropriate content',
  SCAM: 'Scam',
  SCAM_OR_FRAUD: 'Scam or fraud',
  DUPLICATE: 'Duplicate',
  HARASSMENT: 'Harassment',
  IMPERSONATION: 'Impersonation',
  INAPPROPRIATE_CONDUCT: 'Inappropriate conduct',
  SAFETY_CONCERN: 'Safety concern',
  OTHER: 'Other',
};

const REVIEW_OUTCOME_LABELS = {
  NO_ACTION: 'No action',
  ACTION_TAKEN: 'Action taken',
};

function labelFrom(labels, value, fallback = 'Unknown') {
  if (!value) return fallback;
  return (
    labels[value] ??
    value
      .replaceAll('_', ' ')
      .toLowerCase()
      .replace(/^./, (letter) => letter.toUpperCase())
  );
}

export const postTypeLabel = (value) => labelFrom(POST_TYPE_LABELS, value);
export const lostSubtypeLabel = (value) => labelFrom(LOST_SUBTYPE_LABELS, value);
export const postStatusLabel = (value) => labelFrom(POST_STATUS_LABELS, value);
export const moderationStatusLabel = (value) => labelFrom(MODERATION_STATUS_LABELS, value);
export const commentStatusLabel = (value) => labelFrom(COMMENT_STATUS_LABELS, value);
export const moderationActionLabel = (value) => labelFrom(MODERATION_ACTION_LABELS, value);

/**
 * Readable history label for one audit row. Administrator resolutions carry
 * their recorded outcome in metadata, so the history reads "Post marked
 * adopted" instead of a generic "Post resolution recorded". A reopening keeps
 * the corrected outcome visible as "Post reopened (was adopted)".
 */
export function moderationActionHistoryLabel(actionType, metadata) {
  if (actionType === 'POST_RESOLVED' && metadata?.outcome) {
    return `Post marked ${postStatusLabel(metadata.outcome).toLowerCase()}`;
  }
  if (actionType === 'POST_REOPENED') {
    return metadata?.previousOutcome
      ? `Post reopened (was ${postStatusLabel(metadata.previousOutcome).toLowerCase()})`
      : 'Post reopened';
  }
  return moderationActionLabel(actionType);
}
export const reportReasonLabel = (value) => labelFrom(REPORT_REASON_LABELS, value);
export const reviewOutcomeLabel = (value) => labelFrom(REVIEW_OUTCOME_LABELS, value);

/**
 * Normalizes a requested discussion page from a query value. Invalid, missing
 * or non-positive pages fall back to page 1. The real upper clamp happens once
 * the Comment total is known.
 */
export function normalizeDiscussionPage(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Derives the read-only public URL of Comment media from its immutable storage
 * key, matching the backend's delivery policy.
 */
export function resolveCommentMediaUrl(storageKey, env = process.env) {
  if (typeof storageKey !== 'string') return null;
  const cleanKey = storageKey.replace(/^\/+/, '');
  if (!cleanKey) return null;
  const base = (env?.COMMENT_MEDIA_CDN_BASE || env?.R2_PUBLIC_URL || 'https://cdn.pupzy.net').replace(/\/+$/, '');
  return `${base}/${cleanKey}`;
}

export function formatPostAge(createdAt, now = Date.now()) {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return 'Unknown age';
  const days = Math.floor((now - created) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day old';
  return `${days} days old`;
}

function toPhoto(row) {
  const url = typeof row.public_url === 'string' && row.public_url.trim() ? row.public_url : null;
  return {
    id: row.id,
    url,
    available: Boolean(url),
    displayOrder: row.display_order,
    width: row.width,
    height: row.height,
    contentType: row.file_content_type,
    fileSizeBytes: row.file_size_bytes,
    createdAt: row.created_at,
  };
}

function toAttachment(row, env) {
  const url = resolveCommentMediaUrl(row.storage_key, env);
  return {
    id: row.id,
    url,
    available: Boolean(url),
    width: row.width,
    height: row.height,
    contentType: row.file_content_type,
    createdAt: row.created_at,
  };
}

function groupBy(rows, keyFn) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}

/**
 * Loads one bounded page of top-level Comments for a Post with their Replies
 * and attached images. Every moderation state is included so staff keep the
 * existing retention visibility; each item carries a readable state label.
 */
export async function loadDiscussion(pool, postId, options = {}) {
  const pageSize =
    Number.isFinite(options.pageSize) && options.pageSize > 0 ? options.pageSize : POST_REVIEW_DISCUSSION_PAGE_SIZE;
  const env = options.env ?? process.env;

  const { rows: countRows } = await pool.query(
    `SELECT count(*)::int AS total FROM comments WHERE post_id = $1 AND parent_id IS NULL`,
    [postId],
  );
  const total = Number(countRows?.[0]?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(normalizeDiscussionPage(options.page), totalPages);
  const offset = (page - 1) * pageSize;

  const { rows: topLevelRows } = await pool.query(
    `SELECT c.id, c.parent_id, c.text, c.status, c.reply_count, c.boost_count, c.created_at,
            u.full_name AS author_name, u.email AS author_email
     FROM comments c
     LEFT JOIN users u ON u.id = c.author_id
     WHERE c.post_id = $1 AND c.parent_id IS NULL
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT $2 OFFSET $3`,
    [postId, pageSize, offset],
  );

  const parentIds = topLevelRows.map((row) => row.id);
  let replyRows = [];
  if (parentIds.length > 0) {
    const { rows } = await pool.query(
      `SELECT c.id, c.parent_id, c.text, c.status, c.reply_count, c.boost_count, c.created_at,
              u.full_name AS author_name, u.email AS author_email
       FROM comments c
       LEFT JOIN users u ON u.id = c.author_id
       WHERE c.parent_id = ANY($1::uuid[])
       ORDER BY c.created_at ASC, c.id ASC`,
      [parentIds],
    );
    replyRows = rows;
  }

  const commentIds = [...parentIds, ...replyRows.map((row) => row.id)];
  let mediaRows = [];
  if (commentIds.length > 0) {
    const { rows } = await pool.query(
      `SELECT id, comment_id, storage_key, width, height, file_content_type, display_order, created_at
       FROM comment_media
       WHERE comment_id = ANY($1::uuid[])
       ORDER BY display_order ASC`,
      [commentIds],
    );
    mediaRows = rows;
  }
  const mediaByComment = groupBy(mediaRows, (row) => row.comment_id);

  const toItem = (row) => ({
    id: row.id,
    parentId: row.parent_id,
    isReply: Boolean(row.parent_id),
    authorName: row.author_name ?? 'Deleted account',
    authorEmail: row.author_email ?? null,
    text: row.text,
    status: row.status,
    statusLabel: commentStatusLabel(row.status),
    replyCount: row.reply_count,
    boostCount: row.boost_count,
    createdAt: row.created_at,
    attachments: (mediaByComment.get(row.id) ?? []).map((media) => toAttachment(media, env)),
  });

  const repliesByParent = groupBy(replyRows, (row) => row.parent_id);

  return {
    page,
    pageSize,
    total,
    totalPages,
    itemCount: topLevelRows.length,
    items: topLevelRows.map((row) => ({
      ...toItem(row),
      replies: (repliesByParent.get(row.id) ?? []).map(toItem),
    })),
  };
}

/**
 * Loads the Post Reports for one Post, open first, plus every Comment Report
 * raised against a Comment in its discussion. Reviewed rows keep their review
 * outcome so open and reviewed items stay distinguishable.
 */
export async function loadReports(pool, postId) {
  const { rows: postReportRows } = await pool.query(
    `SELECT r.id, r.post_id, r.reporter_id, u.full_name AS reporter_name, r.reason, r.details,
            r.reviewed_at, r.reviewed_by_admin_id, r.review_outcome, r.created_at
     FROM post_reports r
     LEFT JOIN users u ON u.id = r.reporter_id
     WHERE r.post_id = $1
     ORDER BY (r.reviewed_at IS NOT NULL), r.created_at DESC
     LIMIT $2`,
    [postId, POST_REVIEW_REPORTS_LIMIT],
  );

  const { rows: commentReportRows } = await pool.query(
    `SELECT r.id, r.comment_id, c.text AS comment_text, c.status AS comment_status,
            r.reporter_id, u.full_name AS reporter_name, r.reason, r.details,
            r.reviewed_at, r.created_at
     FROM comment_reports r
     JOIN comments c ON c.id = r.comment_id
     LEFT JOIN users u ON u.id = r.reporter_id
     WHERE c.post_id = $1
     ORDER BY (r.reviewed_at IS NOT NULL), r.created_at DESC
     LIMIT $2`,
    [postId, POST_REVIEW_REPORTS_LIMIT],
  );

  const shape = (row) => ({
    id: row.id,
    reason: row.reason,
    reasonLabel: reportReasonLabel(row.reason),
    details: row.details ?? null,
    reporterId: row.reporter_id,
    reporterName: row.reporter_name ?? 'Deleted account',
    reviewedAt: row.reviewed_at,
    reviewOutcome: row.review_outcome ?? null,
    reviewOutcomeLabel: row.review_outcome ? reviewOutcomeLabel(row.review_outcome) : null,
    isOpen: !row.reviewed_at,
    statusLabel: row.reviewed_at ? 'Reviewed' : 'Open',
    createdAt: row.created_at,
  });

  return {
    postReports: postReportRows.map((row) => ({
      ...shape(row),
      postId: row.post_id,
    })),
    commentReports: commentReportRows.map((row) => ({
      ...shape(row),
      commentId: row.comment_id,
      commentText: row.comment_text ?? null,
      commentStatusLabel: row.comment_status ? commentStatusLabel(row.comment_status) : null,
    })),
    postReportsTruncated: postReportRows.length === POST_REVIEW_REPORTS_LIMIT,
    commentReportsTruncated: commentReportRows.length === POST_REVIEW_REPORTS_LIMIT,
  };
}

/**
 * Loads the readable audit history for one Post: administrator actions on the
 * Post itself plus actions on its Comments and Replies.
 */
export async function loadHistory(pool, postId) {
  const { rows } = await pool.query(
    `SELECT a.id, a.action_type, a.target_type, a.target_id, a.reason, a.metadata, a.created_at,
            adm.full_name AS admin_name, adm.email AS admin_email
     FROM moderation_actions a
     LEFT JOIN admin_users adm ON adm.id = a.admin_user_id
     WHERE (a.target_type = 'POST' AND a.target_id = $1)
        OR (a.target_type = 'COMMENT' AND a.target_id IN (SELECT id FROM comments WHERE post_id = $1))
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $2`,
    [postId, POST_REVIEW_HISTORY_LIMIT],
  );

  return rows.map((row) => ({
    id: row.id,
    actionType: row.action_type,
    actionLabel: moderationActionHistoryLabel(row.action_type, row.metadata),
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason ?? null,
    metadata: row.metadata ?? null,
    adminName: row.admin_name ?? 'Removed administrator',
    adminEmail: row.admin_email ?? null,
    createdAt: row.created_at,
  }));
}

/**
 * Builds one review-workspace payload for a Post: header context, original
 * photos, paginated Community Evidence, Reports and administrator history.
 * Never throws for display purposes; callers decide how to surface failures.
 */
export async function loadPostReview(pool, postId, options = {}) {
  const { rows: postRows } = await pool.query(
    `SELECT p.id, p.title, p.description, p.post_type, p.status, p.moderation_status, p.moderation_reason,
            p.urgency, p.area_name, p.created_at, p.creator_id, p.city_id,
            c.name_english AS city_name, c.name_arabic AS city_name_arabic, c.governorate AS city_governorate,
            u.full_name AS owner_name, u.email AS owner_email
     FROM posts p
     LEFT JOIN cities c ON c.id = p.city_id
     LEFT JOIN users u ON u.id = p.creator_id
     WHERE p.id = $1`,
    [postId],
  );
  const post = postRows[0];
  if (!post) {
    return { error: true, message: 'This Post no longer exists.' };
  }

  let subtype = null;
  if (post.post_type === 'LOST') {
    const { rows } = await pool.query(`SELECT report_type FROM lost_posts WHERE post_id = $1`, [postId]);
    subtype = rows[0]?.report_type ?? null;
  }

  const { rows: photoRows } = await pool.query(
    `SELECT id, public_url, display_order, width, height, file_content_type, file_size_bytes, created_at
     FROM post_media
     WHERE post_id = $1
     ORDER BY display_order ASC, created_at ASC`,
    [postId],
  );

  const discussion = await loadDiscussion(pool, postId, {
    page: options.discussionPage ?? 1,
    env: options.env,
  });
  const reports = await loadReports(pool, postId);
  const history = await loadHistory(pool, postId);

  return {
    error: false,
    generatedAt: new Date().toISOString(),
    post: {
      id: post.id,
      title: post.title,
      description: post.description,
      postType: post.post_type,
      typeLabel: postTypeLabel(post.post_type),
      subtype,
      subtypeLabel: post.post_type === 'LOST' ? lostSubtypeLabel(subtype) : null,
      status: post.status,
      statusLabel: postStatusLabel(post.status),
      moderationStatus: post.moderation_status,
      moderationStatusLabel: moderationStatusLabel(post.moderation_status),
      moderationReason: post.moderation_reason ?? null,
      urgency: post.urgency ?? null,
      cityId: post.city_id,
      cityName: post.city_name ?? null,
      governorate: post.city_governorate ?? null,
      areaName: post.area_name ?? null,
      createdAt: post.created_at,
      ageLabel: formatPostAge(post.created_at),
      owner: {
        id: post.creator_id,
        name: post.owner_name ?? 'Deleted account',
        email: post.owner_email ?? null,
      },
    },
    photos: photoRows.map(toPhoto),
    discussion,
    reports,
    history,
  };
}

/**
 * `show` before hook: attaches the LOST direction discriminator to the loaded
 * record so the type-specific resolution actions can offer only valid outcomes
 * (`LOST_PET` resolves as reunited; `FOUND_STRAY` as resolved or reunited).
 * The show handler serializes the record after this hook, so the value is
 * present when AdminJS computes the visible record actions. A lookup failure
 * leaves the discriminator unset and keeps the conservative REUNITED-only rule
 * instead of breaking the record page.
 */
export function attachLostSubtype(pool) {
  return async function attachLostSubtypeBeforeHook(request, context) {
    const record = context?.record;
    if (!record?.params || record.params.post_type !== 'LOST') return request;
    const recordId = typeof record.id === 'function' ? record.id() : record.params.id;
    if (!recordId || !pool || typeof pool.query !== 'function') return request;
    try {
      const { rows } = await pool.query(`SELECT report_type FROM lost_posts WHERE post_id = $1`, [recordId]);
      record.params.report_type = rows[0]?.report_type ?? null;
    } catch {
      // Leave the discriminator unset; the conservative default still applies.
    }
    return request;
  };
}

/**
 * `show`/action before hook: attaches whether the Post owner is banned so the
 * administrator reopening action is offered only for a Post whose owner can
 * still hold active content. A lookup failure leaves the flag unset and keeps
 * the action visible; the action's own transaction rejects a banned owner
 * anyway, so content is never reopened by a missing display-side lookup.
 */
export function attachOwnerBanStatus(pool) {
  return async function attachOwnerBanStatusBeforeHook(request, context) {
    const record = context?.record;
    if (!record?.params) return request;
    const recordId = typeof record.id === 'function' ? record.id() : record.params.id;
    if (!recordId || !pool || typeof pool.query !== 'function') return request;
    try {
      const { rows } = await pool.query(
        `SELECT u.is_banned FROM posts p JOIN users u ON u.id = p.creator_id WHERE p.id = $1`,
        [recordId],
      );
      record.params.owner_is_banned = rows[0]?.is_banned === true;
    } catch {
      // Leave the flag unset; the reopening transaction still rejects a banned owner.
    }
    return request;
  };
}

/**
 * `show` after hook: attaches the review workspace payload to the record so the
 * custom property component can render images, Community Evidence, Reports and
 * history without the page depending on technical media resources. A review
 * data failure must never break the Post record page.
 */
export function attachPostReviewData(pool) {
  return async function postReviewDataAfterHook(response) {
    if (!response?.record?.params || !pool || typeof pool.query !== 'function') return response;
    const recordId = typeof response.record.id === 'function' ? response.record.id() : response.record.params.id;
    if (!recordId) return response;
    try {
      const review = await loadPostReview(pool, recordId);
      response.record.params[POST_REVIEW_WORKSPACE_PARAM] = JSON.stringify(review);
    } catch {
      response.record.params[POST_REVIEW_WORKSPACE_PARAM] = JSON.stringify({
        error: true,
        message: 'The review workspace could not be loaded. The record fields below remain available.',
      });
    }
    return response;
  };
}

/**
 * Read-only API action used by the workspace to fetch another discussion page.
 * It is intentionally hidden from the action bar and returns the page payload
 * on the record params, mirroring the initial `show` payload.
 */
export function buildPostReviewActions(pool) {
  return {
    [POST_REVIEW_DISCUSSION_ACTION]: {
      actionType: 'record',
      icon: 'MessageSquare',
      isAccessible: isAnyAdmin,
      isVisible: false,
      component: false,
      handler: async (request, _response, context) => {
        const { record, currentAdmin } = context;
        const discussion = await loadDiscussion(pool, record.id(), {
          page: normalizeDiscussionPage(request?.query?.page),
        });
        const json = record.toJSON(currentAdmin);
        json.params[POST_REVIEW_DISCUSSION_PARAM] = JSON.stringify(discussion);
        return { record: json };
      },
    },
  };
}

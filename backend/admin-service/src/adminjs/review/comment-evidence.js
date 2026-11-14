import { resolveCommentMediaUrl } from '../comment-media-url.js';
import { excerpt } from '../reference-title.js';
import { reportReviewStatus } from '../report-status.js';
import { USER_NAME_SQL, commentStatusLabel, reportReasonLabel } from './post-review.js';

/** Statuses in which ordinary users cannot see the Comment's images. */
const IMAGES_HIDDEN_STATUSES = new Set(['IMAGE_HIDDEN', 'HIDDEN']);

const person = (id, name, pictureUrl) => ({
  id: id ?? null,
  name: name ?? 'Deleted account',
  pictureUrl: pictureUrl ?? null,
});

/**
 * Shapes one Comment, its images and its Comment Reports into the payload the
 * `CommentEvidence` component renders. Pure, so it is unit-tested directly.
 */
export function buildCommentEvidence({ comment, media = [], reports = [] }, env = process.env, currentReportId = null) {
  const hiddenFromUsers = IMAGES_HIDDEN_STATUSES.has(comment.status);
  return {
    id: comment.id,
    text: comment.text ?? '',
    status: comment.status,
    statusLabel: commentStatusLabel(comment.status),
    isReply: Boolean(comment.parent_id),
    imagesHidden: comment.status === 'IMAGE_HIDDEN',
    hidden: comment.status === 'HIDDEN',
    createdAt: comment.created_at,
    author: person(comment.author_id, comment.author_name, comment.author_picture),
    post: comment.post_id ? { id: comment.post_id, title: comment.post_title ?? null } : null,
    parent: comment.parent_id ? { id: comment.parent_id, excerpt: excerpt(comment.parent_text) } : null,
    media: media.map((row) => {
      const url = resolveCommentMediaUrl(row.storage_key, env);
      return {
        id: row.id,
        url,
        available: Boolean(url),
        width: row.width,
        height: row.height,
        contentType: row.file_content_type,
        hiddenFromUsers,
      };
    }),
    currentReportId,
    reports: reports.map((report) => {
      const status = reportReviewStatus({ reviewedAt: report.reviewed_at, reviewOutcome: report.review_outcome });
      return {
        id: report.id,
        reason: report.reason,
        reasonLabel: reportReasonLabel(report.reason),
        details: report.details ?? null,
        reporter: person(report.reporter_id, report.reporter_name, report.reporter_picture),
        createdAt: report.created_at,
        reviewedAt: report.reviewed_at ?? null,
        reviewedByName: report.reviewed_by_name ?? null,
        statusLabel: status.label,
        isOpen: status.isOpen,
      };
    }),
  };
}

/**
 * Loads the evidence for many Comments with three queries (Comments, images,
 * Reports) however many are asked for. Resolves to a Map keyed by Comment id.
 */
export async function loadCommentEvidence(pool, commentIds, env = process.env, currentReportIds = new Map()) {
  const ids = [...new Set(commentIds.filter(Boolean))];
  const evidence = new Map();
  if (ids.length === 0) return evidence;

  const [{ rows: comments }, { rows: media }, { rows: reports }] = await Promise.all([
    pool.query(
      `SELECT c.id, c.post_id, c.parent_id, c.text, c.status, c.author_id, c.created_at,
              ${USER_NAME_SQL} AS author_name, u.profile_picture_url AS author_picture,
              p.title AS post_title, pc.text AS parent_text
       FROM comments c
       LEFT JOIN users u ON u.id = c.author_id
       LEFT JOIN posts p ON p.id = c.post_id
       LEFT JOIN comments pc ON pc.id = c.parent_id
       WHERE c.id = ANY($1::uuid[])`,
      [ids],
    ),
    pool.query(
      `SELECT id, comment_id, storage_key, width, height, file_content_type, display_order
       FROM comment_media
       WHERE comment_id = ANY($1::uuid[])
       ORDER BY display_order ASC`,
      [ids],
    ),
    pool.query(
      `SELECT r.id, r.comment_id, r.reason, r.details, r.reviewed_at, r.review_outcome, r.created_at, r.reporter_id,
              a.full_name AS reviewed_by_name,
              ${USER_NAME_SQL} AS reporter_name, u.profile_picture_url AS reporter_picture
       FROM comment_reports r
       LEFT JOIN users u ON u.id = r.reporter_id
       LEFT JOIN admin_users a ON a.id = r.reviewed_by_admin_id
       WHERE r.comment_id = ANY($1::uuid[])
       ORDER BY (r.reviewed_at IS NOT NULL), r.created_at DESC`,
      [ids],
    ),
  ]);

  const group = (rows) => {
    const byComment = new Map();
    for (const row of rows) {
      if (!byComment.has(row.comment_id)) byComment.set(row.comment_id, []);
      byComment.get(row.comment_id).push(row);
    }
    return byComment;
  };
  const mediaByComment = group(media);
  const reportsByComment = group(reports);
  for (const comment of comments) {
    evidence.set(
      comment.id,
      buildCommentEvidence(
        { comment, media: mediaByComment.get(comment.id) ?? [], reports: reportsByComment.get(comment.id) ?? [] },
        env,
        currentReportIds.get(comment.id) ?? null,
      ),
    );
  }
  return evidence;
}

export const COMMENT_EVIDENCE_PARAM = 'comment_evidence';

/**
 * AdminJS `after` hook for the Comment and Comment Report show pages: stores
 * the evidence on `record.params.comment_evidence`. `commentIdOf` picks the
 * Comment id from the record's params.
 */
export function attachCommentEvidence(pool, { commentIdOf, reportIdOf = () => null }) {
  return async (response) => {
    const record = response?.record;
    if (!record?.params || !pool?.query) return response;
    const commentId = commentIdOf(record.params);
    if (!commentId) return response;
    const currentReportIds = new Map();
    const reportId = reportIdOf(record.params);
    if (reportId) currentReportIds.set(commentId, reportId);
    const evidence = await loadCommentEvidence(pool, [commentId], process.env, currentReportIds);
    const found = evidence.get(commentId);
    if (found) record.params[COMMENT_EVIDENCE_PARAM] = JSON.stringify(found);
    return response;
  };
}

/**
 * Plain-words review status of a Post, Comment or Pupzy Account Report,
 * derived from `reviewed_at` and `review_outcome`. Comment Reports have no
 * outcome column yet, so a reviewed one reads just "Closed".
 *
 * Shared by the AdminJS components and the Post review workspace loader so the
 * list, show page and workspace never disagree.
 */
export function reportReviewStatus({ reviewedAt, reviewOutcome } = {}) {
  if (!reviewedAt) return { state: 'OPEN', label: 'Open', isOpen: true };
  if (reviewOutcome === 'NO_ACTION') return { state: 'NO_ACTION', label: 'Closed: no action', isOpen: false };
  if (reviewOutcome === 'ACTION_TAKEN') return { state: 'ACTION_TAKEN', label: 'Closed: action taken', isOpen: false };
  return { state: 'CLOSED', label: 'Closed', isOpen: false };
}

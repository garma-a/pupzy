import { AppError } from '../common/errors/app.errors';

/**
 * Discussion publishing contract (Terms of Service 4.2(d) and 4.3).
 *
 * - New image Comments are allowed only beneath RESCUE Posts. Lost & Found
 *   (`LOST`, both directions) discussion is text-only, like every other type.
 * - Marketplace (`PRODUCT`) Posts have no discussion at all: no new Comments
 *   and no new Replies. Buyers contact the seller directly.
 *
 * Existing Comments are never purged to enforce these restrictions; they stay
 * readable and their authors can still delete them.
 */
export const IMAGE_COMMENT_ALLOWED_POST_TYPES = Object.freeze(['RESCUE'] as const);

export type ImageCommentPostType = (typeof IMAGE_COMMENT_ALLOWED_POST_TYPES)[number];

/** Stable GraphQL error code for image publication on a disallowed Post type. */
export const COMMENT_MEDIA_NOT_ALLOWED = 'COMMENT_MEDIA_NOT_ALLOWED';

/** Stable GraphQL error code for a Comment or Reply on a Post type without discussion. */
export const DISCUSSION_NOT_ALLOWED = 'DISCUSSION_NOT_ALLOWED';

/** True when a Post type may receive new image Comments. */
export function canPublishImageComment(postType: string | null | undefined): boolean {
  return postType === 'RESCUE';
}

/** True when a Post type may receive new Comments and Replies. */
export function canDiscuss(postType: string | null | undefined): boolean {
  return postType !== 'PRODUCT';
}

/**
 * Throws the stable, documented error when a Post type cannot receive image
 * Comments. Callers on the publish path use this before staged-media
 * finalization and again inside the committing transaction.
 */
export function assertImageCommentAllowed(postType: string): void {
  if (!canPublishImageComment(postType)) {
    throw new AppError('Images can only be attached to rescue comments', COMMENT_MEDIA_NOT_ALLOWED);
  }
}

/**
 * Throws the stable error when a Post type has no discussion. Checked before
 * quota and again inside the committing transaction, like the image rule.
 */
export function assertDiscussionAllowed(postType: string): void {
  if (!canDiscuss(postType)) {
    throw new AppError(
      'Marketplace listings do not take comments; contact the seller directly',
      DISCUSSION_NOT_ALLOWED,
    );
  }
}

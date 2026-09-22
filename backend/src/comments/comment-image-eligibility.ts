import { AppError } from '../common/errors/app.errors';

/**
 * Community Evidence publishing contract.
 *
 * New image Comments are allowed only beneath RESCUE and LOST Posts, including
 * both LOST directions (`LOST_PET` and `FOUND_STRAY`). Text Comments remain
 * available on every otherwise accessible Post type. Existing image Comments
 * are never purged to enforce the publishing restriction.
 */
export const IMAGE_COMMENT_ALLOWED_POST_TYPES = Object.freeze(['RESCUE', 'LOST'] as const);

export type ImageCommentPostType = (typeof IMAGE_COMMENT_ALLOWED_POST_TYPES)[number];

/** Stable GraphQL error code for image publication on a disallowed Post type. */
export const COMMENT_MEDIA_NOT_ALLOWED = 'COMMENT_MEDIA_NOT_ALLOWED';

/** True when a Post type may receive new image Comments. */
export function canPublishImageComment(postType: string | null | undefined): boolean {
  return postType === 'RESCUE' || postType === 'LOST';
}

/**
 * Throws the stable, documented error when a Post type cannot receive image
 * Comments. Callers on the publish path use this before staged-media
 * finalization and again inside the committing transaction.
 */
export function assertImageCommentAllowed(postType: string): void {
  if (!canPublishImageComment(postType)) {
    throw new AppError('Images can only be attached to rescue and lost/found comments', COMMENT_MEDIA_NOT_ALLOWED);
  }
}

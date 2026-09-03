import { ValidationError } from '../../common/errors/app.errors';
import { assertUuid } from '../../common/utils/validate-uuid';

export type CommentSortOrder = 'TOP' | 'NEWEST';

export interface CommentsQueryDto {
  postId: string;
  sort: CommentSortOrder;
  first: number;
  after?: string;
}

export interface CommentCursorPayload {
  createdAt: string;
  id: string;
}

/**
 * Encodes a comment's createdAt and id into an opaque base64 keyset cursor.
 */
export function encodeCommentCursor(comment: { createdAt: Date | string; id: string }): string {
  const createdAtStr = comment.createdAt instanceof Date ? comment.createdAt.toISOString() : comment.createdAt;
  const payload: CommentCursorPayload = {
    createdAt: createdAtStr,
    id: comment.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decodes an opaque base64 keyset cursor.
 * Throws ValidationError if malformed or invalid.
 */
export function decodeCommentCursor(cursor: string): CommentCursorPayload {
  try {
    const jsonStr = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    if (
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string' ||
      Number.isNaN(Date.parse(parsed.createdAt))
    ) {
      throw new Error('Invalid cursor fields');
    }

    return {
      createdAt: parsed.createdAt,
      id: parsed.id,
    };
  } catch {
    throw new ValidationError('Invalid pagination cursor');
  }
}

/**
 * Validates arguments for the `comments` query.
 */
export function validateCommentsQueryInput(rawArgs: {
  postId?: unknown;
  sort?: unknown;
  first?: unknown;
  after?: unknown;
}): CommentsQueryDto {
  if (typeof rawArgs.postId !== 'string') {
    throw new ValidationError('postId is required');
  }
  assertUuid(rawArgs.postId, 'postId');
  const postId = rawArgs.postId;

  // Validate sort
  let sort: CommentSortOrder = 'TOP';
  if (rawArgs.sort !== undefined && rawArgs.sort !== null) {
    if (rawArgs.sort === 'TOP' || rawArgs.sort === 'NEWEST') {
      sort = rawArgs.sort;
    } else {
      throw new ValidationError('Invalid sort value. Allowed values: TOP, NEWEST');
    }
  }

  // Validate first: default 20, reject > 50 or < 1
  let first = 20;
  if (rawArgs.first !== undefined && rawArgs.first !== null) {
    if (
      typeof rawArgs.first !== 'number' ||
      !Number.isInteger(rawArgs.first) ||
      rawArgs.first < 1 ||
      rawArgs.first > 50
    ) {
      throw new ValidationError('Page size must be an integer between 1 and 50');
    }
    first = rawArgs.first;
  }

  // Validate after cursor
  let after: string | undefined;
  if (rawArgs.after !== undefined && rawArgs.after !== null) {
    if (typeof rawArgs.after !== 'string' || rawArgs.after.trim().length === 0) {
      throw new ValidationError('after cursor must be a non-empty string');
    }
    // Verify cursor can be decoded
    decodeCommentCursor(rawArgs.after);
    after = rawArgs.after;
  }

  return {
    postId,
    sort,
    first,
    after,
  };
}

export interface RepliesQueryDto {
  commentId: string;
  first: number;
  after?: string;
}

/**
 * Validates arguments for the `replies` query.
 */
export function validateRepliesQueryInput(rawArgs: {
  commentId?: unknown;
  first?: unknown;
  after?: unknown;
}): RepliesQueryDto {
  if (typeof rawArgs.commentId !== 'string') {
    throw new ValidationError('commentId is required');
  }
  assertUuid(rawArgs.commentId, 'commentId');
  const commentId = rawArgs.commentId;

  // Validate first: default 20, reject > 50 or < 1
  let first = 20;
  if (rawArgs.first !== undefined && rawArgs.first !== null) {
    if (
      typeof rawArgs.first !== 'number' ||
      !Number.isInteger(rawArgs.first) ||
      rawArgs.first < 1 ||
      rawArgs.first > 50
    ) {
      throw new ValidationError('Page size must be an integer between 1 and 50');
    }
    first = rawArgs.first;
  }

  // Validate after cursor
  let after: string | undefined;
  if (rawArgs.after !== undefined && rawArgs.after !== null) {
    if (typeof rawArgs.after !== 'string' || rawArgs.after.trim().length === 0) {
      throw new ValidationError('after cursor must be a non-empty string');
    }
    decodeCommentCursor(rawArgs.after);
    after = rawArgs.after;
  }

  return {
    commentId,
    first,
    after,
  };
}

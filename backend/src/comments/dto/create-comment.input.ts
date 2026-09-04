import { ValidationError } from '../../common/errors/app.errors';
import { assertUuid } from '../../common/utils/validate-uuid';

export interface CreateCommentDto {
  clientRequestId: string;
  postId: string;
  text: string;
  mediaIds?: string[];
}

/**
 * Regex detecting unsafe ASCII control characters.
 * Allows \t (0x09), \n (0x0A), \r (0x0D).
 * Forbids 0x00..0x08, 0x0B, 0x0C, 0x0E..0x1F, 0x7F, and Unicode control 0x80..0x9F.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_CONTROL_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u0080-\u009F]/;

/**
 * Regex detecting HTML markup tags (e.g., <script>, <div>, <a href="...">, <br/>, etc.).
 */
const HTML_TAG_REGEX = /<[^>]+>/;

/**
 * Validates and sanitizes comment text.
 * - Trims leading/trailing whitespace
 * - Enforces 1 to 1,000 Unicode characters
 * - Rejects unsafe control characters
 * - Rejects raw HTML markup
 * - Returns sanitized plain text
 */
export function validateCommentText(rawText: unknown): string {
  if (typeof rawText !== 'string') {
    throw new ValidationError('Comment text is required');
  }

  const trimmed = rawText.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('Comment text cannot be empty');
  }

  // Count Unicode code points (properly handling emojis, surrogate pairs, etc.)
  const charCount = [...trimmed].length;
  if (charCount < 1 || charCount > 1000) {
    throw new ValidationError('Comment text must be between 1 and 1,000 characters');
  }

  if (UNSAFE_CONTROL_REGEX.test(trimmed)) {
    throw new ValidationError('Comment text contains forbidden control characters');
  }

  if (HTML_TAG_REGEX.test(trimmed)) {
    throw new ValidationError('Comment text cannot contain raw HTML');
  }

  return trimmed;
}

/**
 * Validates the raw GraphQL input for `createComment`.
 */
export function validateCreateCommentInput(rawInput: unknown): CreateCommentDto {
  if (!rawInput || typeof rawInput !== 'object') {
    throw new ValidationError('Invalid comment input');
  }

  const input = rawInput as Record<string, unknown>;

  // Validate clientRequestId
  if (typeof input.clientRequestId !== 'string' || input.clientRequestId.trim().length === 0) {
    throw new ValidationError('clientRequestId is required');
  }
  const clientRequestId = input.clientRequestId.trim();
  if (clientRequestId.length > 255) {
    throw new ValidationError('clientRequestId must not exceed 255 characters');
  }

  // Validate postId
  if (typeof input.postId !== 'string') {
    throw new ValidationError('postId is required');
  }
  assertUuid(input.postId, 'postId');
  const postId = input.postId;

  // Validate text
  const text = validateCommentText(input.text);

  // Validate mediaIds (at most 1 image supported in Ticket 06)
  let mediaIds: string[] | undefined;
  if (input.mediaIds !== undefined && input.mediaIds !== null) {
    if (!Array.isArray(input.mediaIds)) {
      throw new ValidationError('mediaIds must be an array');
    }
    if (input.mediaIds.length > 1) {
      throw new ValidationError('Maximum 1 image allowed per comment in this version');
    }
    const seen = new Set<string>();
    for (const id of input.mediaIds) {
      if (typeof id !== 'string') {
        throw new ValidationError('Each mediaId must be a string');
      }
      assertUuid(id, 'mediaId');
      if (seen.has(id)) {
        throw new ValidationError('Duplicate media IDs are not allowed');
      }
      seen.add(id);
    }
    mediaIds = input.mediaIds as string[];
  }

  return {
    clientRequestId,
    postId,
    text,
    mediaIds,
  };
}

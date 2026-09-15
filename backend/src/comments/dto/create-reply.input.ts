import { ValidationError } from '../../common/errors/app.errors';
import { assertUuid } from '../../common/utils/validate-uuid';

export interface CreateReplyDto {
  clientRequestId: string;
  commentId: string;
  text: string;
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
 * Validates and sanitizes reply text.
 * - Trims leading/trailing whitespace
 * - Enforces 1 to 500 Unicode characters
 * - Rejects unsafe control characters
 * - Rejects raw HTML markup
 * - Returns sanitized plain text
 */
export function validateReplyText(rawText: unknown): string {
  if (typeof rawText !== 'string') {
    throw new ValidationError('Reply text is required');
  }

  const trimmed = rawText.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('Reply text cannot be empty');
  }

  // Count Unicode code points (properly handling emojis, surrogate pairs, etc.)
  const charCount = [...trimmed].length;
  if (charCount < 1 || charCount > 500) {
    throw new ValidationError('Reply text must be between 1 and 500 characters');
  }

  if (UNSAFE_CONTROL_REGEX.test(trimmed)) {
    throw new ValidationError('Reply text contains forbidden control characters');
  }

  if (HTML_TAG_REGEX.test(trimmed)) {
    throw new ValidationError('Reply text cannot contain raw HTML');
  }

  return trimmed;
}

/**
 * Validates the raw GraphQL input for `createReply`.
 */
export function validateCreateReplyInput(rawInput: unknown): CreateReplyDto {
  if (!rawInput || typeof rawInput !== 'object') {
    throw new ValidationError('Invalid reply input');
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

  // Validate commentId
  if (typeof input.commentId !== 'string') {
    throw new ValidationError('commentId is required');
  }
  assertUuid(input.commentId, 'commentId');
  const commentId = input.commentId;

  // Validate text (1..500 chars)
  const text = validateReplyText(input.text);

  // Reject any attempt to provide media
  if ('mediaIds' in input && input.mediaIds !== undefined) {
    throw new ValidationError('Replies cannot contain media');
  }

  return {
    clientRequestId,
    commentId,
    text,
  };
}

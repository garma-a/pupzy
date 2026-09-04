import { AppError, ValidationError } from '../../common/errors/app.errors';

export interface RequestCommentImageUploadDto {
  contentType: string;
  fileSizeBytes: number;
}

/**
 * Validates the raw input for `requestCommentImageUploadUrl`.
 * - Requires contentType to be exactly 'image/webp' (AppError with COMMENT_MEDIA_INVALID_FORMAT)
 * - Requires fileSizeBytes to be an integer > 0 and <= 100,000 bytes (AppError with COMMENT_MEDIA_TOO_LARGE)
 */
export function validateRequestCommentImageUploadInput(rawInput: unknown): RequestCommentImageUploadDto {
  if (!rawInput || typeof rawInput !== 'object') {
    throw new ValidationError('Invalid requestCommentImageUpload input');
  }

  const input = rawInput as Record<string, unknown>;

  if (typeof input.contentType !== 'string') {
    throw new ValidationError('contentType is required');
  }

  if (input.contentType !== 'image/webp') {
    throw new AppError('Only static WebP images are allowed', 'COMMENT_MEDIA_INVALID_FORMAT');
  }

  if (typeof input.fileSizeBytes !== 'number' || !Number.isInteger(input.fileSizeBytes) || input.fileSizeBytes <= 0) {
    throw new ValidationError('fileSizeBytes must be a positive integer');
  }

  if (input.fileSizeBytes > 100_000) {
    throw new AppError('File size exceeds 100,000 bytes', 'COMMENT_MEDIA_TOO_LARGE');
  }

  return {
    contentType: input.contentType,
    fileSizeBytes: input.fileSizeBytes,
  };
}

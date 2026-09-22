import { AppError, ValidationError } from '../../common/errors/app.errors';

export interface RequestProfilePhotoUploadDto {
  contentType: string;
  fileSizeBytes: number;
}

/**
 * Validates the raw input for `requestProfilePhotoUploadUrl`.
 *
 * Profile photos reuse the established avatar image protections: static WebP
 * only, at most 100,000 bytes. Rejections happen before any ticket or
 * presigned URL is issued.
 */
export function validateRequestProfilePhotoUploadInput(rawInput: unknown): RequestProfilePhotoUploadDto {
  if (!rawInput || typeof rawInput !== 'object') {
    throw new ValidationError('Invalid requestProfilePhotoUploadUrl input');
  }

  const input = rawInput as Record<string, unknown>;

  if (typeof input.contentType !== 'string') {
    throw new ValidationError('contentType is required');
  }

  if (input.contentType !== 'image/webp') {
    throw new AppError('Only static WebP images are allowed', 'PROFILE_PHOTO_INVALID_FORMAT');
  }

  if (typeof input.fileSizeBytes !== 'number' || !Number.isInteger(input.fileSizeBytes) || input.fileSizeBytes <= 0) {
    throw new ValidationError('fileSizeBytes must be a positive integer');
  }

  if (input.fileSizeBytes > 100_000) {
    throw new AppError('File size exceeds 100,000 bytes', 'PROFILE_PHOTO_TOO_LARGE');
  }

  return {
    contentType: input.contentType,
    fileSizeBytes: input.fileSizeBytes,
  };
}

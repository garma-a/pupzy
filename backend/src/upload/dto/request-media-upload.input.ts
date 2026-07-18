import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';

/**
 * Allowed MIME types for media uploads.
 * Only modern image formats are accepted — video and other binary types
 * are intentionally excluded to keep R2 storage costs predictable.
 */
const ALLOWED_CONTENT_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;

/** 5 MB — maximum file size enforced at presign time and again by R2's ContentLength condition. */
const MAX_FILE_SIZE_BYTES = 5_242_880;

/**
 * Zod schema for the `requestMediaUploadUrl` mutation input.
 *
 * Validates business-level constraints that cannot be expressed in GraphQL SDL
 * (enum-like MIME type allowlist, numeric range for file size).
 */
const requestMediaUploadSchema = z.object({
  /**
   * MIME type of the file to upload.
   * Restricted to a known-safe set of image formats to prevent
   * arbitrary binary uploads to the R2 bucket.
   */
  contentType: z.enum(ALLOWED_CONTENT_TYPES),

  /**
   * Exact file size in bytes declared by the client.
   * Used as the ContentLength condition on the presigned URL so R2 rejects
   * uploads that exceed the declared size.
   * - Minimum 1 byte (reject empty uploads)
   * - Maximum 5 MB (5,242,880 bytes)
   */
  fileSizeBytes: z
    .number()
    .int('fileSizeBytes must be an integer')
    .min(1, 'fileSizeBytes must be at least 1')
    .max(MAX_FILE_SIZE_BYTES, `fileSizeBytes cannot exceed ${MAX_FILE_SIZE_BYTES} bytes (5MB)`),
});

/** TypeScript type inferred from the Zod schema — zero duplication. */
export type RequestMediaUploadInput = z.infer<typeof requestMediaUploadSchema>;

/**
 * Validates and parses the `requestMediaUploadUrl` mutation input.
 *
 * @throws {ValidationError} if any field fails validation, with a descriptive message.
 *
 * @example
 * const input = validateRequestMediaUploadInput(args.input);
 */
export function validateRequestMediaUploadInput(raw: unknown): RequestMediaUploadInput {
  const result = requestMediaUploadSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(message);
  }
  return result.data;
}

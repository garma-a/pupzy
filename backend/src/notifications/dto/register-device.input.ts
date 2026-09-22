import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';
import { DEVICE_PLATFORMS } from '../../database/schema';

/**
 * Provider tokens are opaque strings. The bounds reject empty and oversized
 * values without attempting to parse provider-specific token formats.
 */
export const deviceTokenSchema = z
  .string({ message: 'token must be a string' })
  .trim()
  .min(1, 'token must not be empty')
  .max(512, 'token cannot exceed 512 characters');

const registerDeviceSchema = z.object({
  token: deviceTokenSchema,
  platform: z.enum(DEVICE_PLATFORMS, { message: 'platform must be either "ANDROID" or "IOS"' }),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

/** Validates a `registerDevice` input; rejects unknown platforms and empty tokens. */
export function validateRegisterDeviceInput(raw: unknown): RegisterDeviceInput {
  const result = registerDeviceSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join('; ');
    throw new ValidationError(message);
  }
  return result.data;
}

/** Validates the `unregisterDevice` token argument. */
export function validateDeviceToken(raw: unknown): string {
  const result = deviceTokenSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join('; ');
    throw new ValidationError(message);
  }
  return result.data;
}

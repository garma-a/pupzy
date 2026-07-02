import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';

/**
 * Zod schema for the `completeProfile` mutation input.
 *
 * Validates business-level constraints that cannot be expressed in GraphQL SDL
 * (min/max lengths, phone number format, UUID format).
 */
const completeProfileSchema = z.object({
  /**
   * User's display name.
   * - Minimum 2 characters (avoids single-initial inputs)
   * - Maximum 120 characters (matches DB column length)
   */
  fullName: z
    .string()
    .min(2, 'Full name must be at least 2 characters')
    .max(120, 'Full name cannot exceed 120 characters')
    .trim(),

  /**
   * Phone number in E.164 format.
   * Examples: +201012345678, +12125551234
   */
  phoneNumber: z
    .string()
    .regex(
      /^\+[1-9]\d{1,14}$/,
      'Phone number must be in E.164 format (e.g. +201012345678)',
    ),

  /**
   * UUID of the user's city from the `cities` table.
   * Will be validated as a real city once the cities table is added.
   */
  cityId: z.string().uuid('cityId must be a valid UUID'),
});

/** TypeScript type inferred from the Zod schema — zero duplication. */
export type CompleteProfileInput = z.infer<typeof completeProfileSchema>;

/**
 * Validates and parses the `completeProfile` mutation input.
 *
 * @throws {ValidationError} if any field fails validation, with a descriptive message.
 *
 * @example
 * const input = validateCompleteProfileInput(args.input);
 */
export function validateCompleteProfileInput(
  raw: unknown,
): CompleteProfileInput {
  const result = completeProfileSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new ValidationError(message);
  }
  return result.data;
}

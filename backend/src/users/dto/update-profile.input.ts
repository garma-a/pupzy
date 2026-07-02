import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';

/**
 * Zod schema for the `updateProfile` mutation input.
 */
const updateProfileSchema = z.object({
  /**
   * User's display name.
   * - Minimum 2 characters
   * - Maximum 120 characters
   */
  fullName: z
    .string()
    .min(2, 'Full name must be at least 2 characters')
    .max(120, 'Full name cannot exceed 120 characters')
    .trim(),
});

/** TypeScript type inferred from the Zod schema */
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Validates and parses the `updateProfile` mutation input.
 *
 * @throws {ValidationError} if any field fails validation.
 */
export function validateUpdateProfileInput(raw: unknown): UpdateProfileInput {
  const result = updateProfileSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new ValidationError(message);
  }
  return result.data;
}

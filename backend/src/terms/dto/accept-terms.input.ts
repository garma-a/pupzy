import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';

/**
 * Zod schema for the `acceptTerms` mutation input.
 *
 * The version is required and bounded: it must match the currently published
 * version, and the bound keeps malformed client values out of the database.
 * `ageConfirmed` must be true: Pupzy is only for people aged 18 and over, and
 * accepting the Terms includes confirming that.
 */
const acceptTermsSchema = z.object({
  version: z.string().trim().min(1, 'version must not be empty').max(64, 'version cannot exceed 64 characters'),
  ageConfirmed: z.literal(true, { error: 'You must confirm you are 18 or older' }),
});

export type AcceptTermsInput = z.infer<typeof acceptTermsSchema>;

export function validateAcceptTermsInput(raw: unknown): AcceptTermsInput {
  const result = acceptTermsSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => issue.message).join('; '));
  }
  return result.data;
}

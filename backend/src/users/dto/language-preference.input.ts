import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';

/**
 * Zod schema for the explicit notification language preference.
 *
 * Only `ar` and `en` are accepted; the historic `ar` database default is not
 * an explicit choice and is represented as absent rather than as a value.
 */
export const languagePreferenceSchema = z.enum(['ar', 'en'], {
  message: 'languagePreference must be either "ar" or "en"',
});

export type LanguagePreference = z.infer<typeof languagePreferenceSchema>;

/**
 * Validates and parses a language preference supplied to the profile
 * operations. Rejects every unknown value.
 *
 * @throws {ValidationError} if the value is not exactly `ar` or `en`.
 */
export function validateLanguagePreferenceInput(raw: unknown): LanguagePreference {
  const result = languagePreferenceSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join('; ');
    throw new ValidationError(message);
  }
  return result.data;
}

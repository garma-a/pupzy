import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';

/**
 * Zod schema for the submitAdoptionApplication mutation input.
 * Validates the adoption questionnaire fields.
 */
const submitAdoptionApplicationSchema = z.object({
  targetPostId: z.string().uuid('targetPostId must be a valid UUID'),
  speciesPreference: z
    .enum(['DOG', 'CAT', 'BIRD', 'RABBIT', 'OTHER'])
    .nullish(),
  breedPreference: z.string().max(100).nullish(),
  agePreference: z.string().max(100).nullish(),
  genderPreference: z.enum(['MALE', 'FEMALE', 'UNKNOWN']).nullish(),
  livingSituation: z.enum(['APARTMENT', 'HOUSE_WITH_YARD', 'FARM', 'OTHER']),
  hasOutdoorAccess: z.boolean(),
  hasOtherPetsAtHome: z.boolean(),
  hasChildrenAtHome: z.boolean(),
  hoursAtHomePerDay: z.number().int().min(0).max(24).nullish(),
  previousPetExperience: z.string().max(2000).nullish(),
  whyAdopt: z
    .string()
    .min(20, 'Please write at least 20 characters explaining why you want to adopt')
    .max(5000),
  consentHomeVisit: z.boolean(),
  canProvideVetReference: z.boolean(),
});

export type SubmitAdoptionApplicationInput = z.infer<
  typeof submitAdoptionApplicationSchema
>;

export function validateSubmitAdoptionApplicationInput(
  raw: unknown,
): SubmitAdoptionApplicationInput {
  const result = submitAdoptionApplicationSchema.safeParse(raw);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new ValidationError(msg);
  }
  return result.data;
}

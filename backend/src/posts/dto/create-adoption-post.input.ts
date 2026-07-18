import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';
import { geoLocationSchema } from '../../users/dto/geo-location.input';
import { PERSONALITY_TAGS } from '../../database/schema';

/**
 * Zod schema for the `createAdoptionPost` mutation input.
 *
 * Validates business-level constraints that cannot be expressed in GraphQL SDL.
 *
 * The `.refine()` enforces the `ageValue` / `ageUnit` pairing constraint:
 * both must be provided together or both omitted. This mirrors the
 * `chk_adoption_age_pairing` CHECK constraint in PostgreSQL.
 *
 * ADOPTION posts intentionally omit the `urgency` field — the
 * `chk_posts_urgency_by_type` CHECK constraint requires urgency to be NULL
 * for ADOPTION rows.
 */
const createAdoptionPostSchema = z
  .object({
    /** Post title — minimum 3, maximum 200 characters. */
    title: z.string().min(3).max(200).trim(),

    /** Free-text description — minimum 10, maximum 5000 characters. */
    description: z.string().min(10).max(5000).trim(),

    /** Optional UUID of the user's city from the `cities` table. */
    cityId: z.string().uuid().optional(),

    /** GPS coordinates for the adoption location. */
    coordinates: geoLocationSchema,

    /** Human-readable name for the area (e.g. "Maadi, Cairo"). */
    areaName: z.string().max(200).trim().optional(),

    /** Name of the pet being put up for adoption. */
    petName: z.string().min(1, 'Pet name is required').max(100).trim(),

    /** Animal species. */
    species: z.enum(['DOG', 'CAT', 'BIRD', 'RABBIT', 'OTHER']),

    /** Breed of the animal, if known. */
    breed: z.string().max(100).trim().optional(),

    /**
     * Numeric age value — must be paired with `ageUnit`.
     * Enforced by `chk_adoption_age_pairing`.
     */
    ageValue: z.number().int().positive().optional(),

    /**
     * Unit for the age value — must be paired with `ageValue`.
     * Enforced by `chk_adoption_age_pairing`.
     */
    ageUnit: z.enum(['DAYS', 'WEEKS', 'MONTHS', 'YEARS']).optional(),

    /** Biological gender of the animal. */
    gender: z.enum(['MALE', 'FEMALE', 'UNKNOWN']),

    /** Whether the animal has been vaccinated. */
    vaccinated: z.boolean(),

    /** Whether the animal has been neutered/spayed. */
    neutered: z.boolean(),

    /** Free-text notes on the animal's health. */
    healthNotes: z.string().max(5000).trim().optional(),

    /**
     * Tags describing the pet's personality.
     * Validated against the `PERSONALITY_TAGS` constant from the schema.
     */
    personalityTags: z
      .array(z.enum(PERSONALITY_TAGS as unknown as [string, ...string[]]))
      .optional()
      .default([]),

    /** Living space requirement for potential adopters. */
    spaceRequirement: z
      .enum(['APARTMENT_OK', 'NEEDS_YARD', 'NEEDS_FARM_OR_LARGE_SPACE'])
      .optional(),

    /** Whether prior pet ownership experience is required. */
    priorPetExperienceRequired: z.boolean(),

    /** Free-text additional requirements for adopters. */
    additionalRequirements: z.string().max(5000).trim().optional(),

    /** Who currently has the animal (e.g. "foster home", "shelter"). */
    currentlyWith: z.string().max(200).trim().optional(),

    /** UUIDs of pre-uploaded media assets — maximum 4 images. */
    mediaIds: z.array(z.string().uuid()).max(4).optional(),
  })
  .refine((data) => (data.ageValue == null) === (data.ageUnit == null), {
    message: 'ageValue and ageUnit must both be provided or both be omitted',
    path: ['ageValue'],
  });

/** TypeScript type inferred from the Zod schema — zero duplication. */
export type CreateAdoptionPostInput = z.infer<typeof createAdoptionPostSchema>;

/**
 * Validates and parses the `createAdoptionPost` mutation input.
 *
 * @throws {ValidationError} if any field fails validation, with a descriptive message.
 *
 * @example
 * const input = validateCreateAdoptionPostInput(args.input);
 */
export function validateCreateAdoptionPostInput(raw: unknown): CreateAdoptionPostInput {
  const result = createAdoptionPostSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(message);
  }
  return result.data;
}

import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';
import { geoLocationSchema } from '../../users/dto/geo-location.input';

/**
 * Zod schema for the `createRescuePost` mutation input.
 *
 * Validates business-level constraints that cannot be expressed in GraphQL SDL.
 *
 * The `urgency` field is **required** for RESCUE posts — this mirrors the
 * `chk_posts_urgency_by_type` CHECK constraint in PostgreSQL, which mandates
 * that every RESCUE row has a non-null urgency value.
 */
const createRescuePostSchema = z.object({
  /** Post title — minimum 3, maximum 200 characters. */
  title: z
    .string()
    .min(3, 'Title must be at least 3 characters')
    .max(200, 'Title cannot exceed 200 characters')
    .trim(),

  /** Free-text description — minimum 10, maximum 5000 characters. */
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(5000, 'Description cannot exceed 5000 characters')
    .trim(),

  /** Optional UUID of the user's city from the `cities` table. */
  cityId: z.string().uuid('cityId must be a valid UUID').optional(),

  /** GPS coordinates for the rescue location. */
  coordinates: geoLocationSchema,

  /** Human-readable name for the area (e.g. "Maadi, Cairo"). */
  areaName: z
    .string()
    .max(200, 'Area name cannot exceed 200 characters')
    .trim()
    .optional(),

  /**
   * How urgent the rescue situation is.
   * Required for RESCUE posts per `chk_posts_urgency_by_type`.
   */
  urgency: z.enum(['CRITICAL', 'URGENT', 'MODERATE']),

  /** Animal species involved in the rescue. */
  species: z.enum(['DOG', 'CAT', 'BIRD', 'RABBIT', 'OTHER']),

  /**
   * Brief summary of the animal's current condition.
   * Minimum 5, maximum 500 characters.
   */
  conditionSummary: z
    .string()
    .min(5, 'Condition summary must be at least 5 characters')
    .max(500, 'Condition summary cannot exceed 500 characters')
    .trim(),

  /** The reporter's relationship to the rescue situation. */
  reporterRole: z.enum(['REPORTING', 'ON_SITE', 'CAN_TRANSPORT']),

  /** UUIDs of pre-uploaded media assets — maximum 4 images. */
  mediaIds: z
    .array(z.string().uuid('Each mediaId must be a valid UUID'))
    .max(4, 'Maximum 4 images allowed')
    .optional(),
});

/** TypeScript type inferred from the Zod schema — zero duplication. */
export type CreateRescuePostInput = z.infer<typeof createRescuePostSchema>;

/**
 * Validates and parses the `createRescuePost` mutation input.
 *
 * @throws {ValidationError} if any field fails validation, with a descriptive message.
 *
 * @example
 * const input = validateCreateRescuePostInput(args.input);
 */
export function validateCreateRescuePostInput(raw: unknown): CreateRescuePostInput {
  const result = createRescuePostSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(message);
  }
  return result.data;
}

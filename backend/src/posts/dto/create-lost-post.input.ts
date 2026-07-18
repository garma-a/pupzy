import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';
import { geoLocationSchema } from '../../users/dto/geo-location.input';

/**
 * Zod schema for the `createLostPost` mutation input.
 *
 * The `.superRefine()` enforces the LOST_PET vs FOUND_STRAY field-set integrity,
 * mirroring the `chk_lost_posts_report_fields` CHECK constraint in PostgreSQL.
 *
 * LOST_PET rules:
 *   - `dateLastSeen`: required
 *   - `currentCondition`, `isCurrentlySafeWithReporter`, `dateFound`: must be absent
 *
 * FOUND_STRAY rules:
 *   - `currentCondition`, `isCurrentlySafeWithReporter`, `dateFound`: required
 *   - `petName`, `dateLastSeen`: must be absent
 */
const createLostPostSchema = z
  .object({
    /** Post title — minimum 3, maximum 200 characters. */
    title: z
      .string()
      .min(3, 'Title must be at least 3 characters')
      .max(200)
      .trim(),

    /** Free-text description — minimum 10, maximum 5000 characters. */
    description: z
      .string()
      .min(10, 'Description must be at least 10 characters')
      .max(5000)
      .trim(),

    /** Optional UUID of the user's city from the `cities` table. */
    cityId: z.string().uuid().optional(),

    /** GPS coordinates for where the pet was lost or found. */
    coordinates: geoLocationSchema,

    /** Human-readable name for the area (e.g. "Maadi, Cairo"). */
    areaName: z.string().max(200).trim().optional(),

    /**
     * How urgent the situation is.
     * Required for LOST posts per `chk_posts_urgency_by_type`.
     */
    urgency: z.enum(['CRITICAL', 'URGENT', 'MODERATE']),

    /** Whether this is a report of a lost pet or a found stray. */
    reportType: z.enum(['LOST_PET', 'FOUND_STRAY']),

    /** Animal species. */
    species: z.enum(['DOG', 'CAT', 'BIRD', 'RABBIT', 'OTHER']),

    /** Breed of the animal, if known. */
    breed: z.string().max(100).trim().optional(),

    /** Physical description — color, markings, size, etc. */
    colorAndMarkings: z.string().max(300).trim().optional(),

    /** Whether the animal wears a collar or tag. */
    hasCollarWithIdentificationTag: z.boolean().optional(),

    /** Free-text description of how the animal was lost or found. */
    circumstances: z.string().max(5000).trim().optional(),

    // ── LOST_PET-only fields ──────────────────────────────────────────────

    /** Name of the pet — only valid for LOST_PET reports. */
    petName: z.string().max(100).trim().optional(),

    /** Date the pet was last seen (YYYY-MM-DD) — required for LOST_PET. */
    dateLastSeen: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateLastSeen must be in YYYY-MM-DD format')
      .optional(),

    // ── FOUND_STRAY-only fields ───────────────────────────────────────────

    /** Health condition of the found animal — required for FOUND_STRAY. */
    currentCondition: z.enum(['HEALTHY', 'INJURED', 'UNKNOWN']).optional(),

    /** Whether the reporter currently has the animal — required for FOUND_STRAY. */
    isCurrentlySafeWithReporter: z.boolean().optional(),

    /** Date the stray was found (YYYY-MM-DD) — required for FOUND_STRAY. */
    dateFound: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFound must be in YYYY-MM-DD format')
      .optional(),

    /** UUIDs of pre-uploaded media assets — maximum 4 images. */
    mediaIds: z.array(z.string().uuid()).max(4).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.reportType === 'LOST_PET') {
      // dateLastSeen is required for LOST_PET
      if (!data.dateLastSeen) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'dateLastSeen is required for LOST_PET reports',
          path: ['dateLastSeen'],
        });
      }

      // FOUND_STRAY-only fields must be absent
      if (data.currentCondition != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'currentCondition must not be set for LOST_PET',
          path: ['currentCondition'],
        });
      }
      if (data.isCurrentlySafeWithReporter != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'isCurrentlySafeWithReporter must not be set for LOST_PET',
          path: ['isCurrentlySafeWithReporter'],
        });
      }
      if (data.dateFound != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'dateFound must not be set for LOST_PET',
          path: ['dateFound'],
        });
      }
    } else {
      // FOUND_STRAY — required fields
      if (data.currentCondition == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'currentCondition is required for FOUND_STRAY',
          path: ['currentCondition'],
        });
      }
      if (data.isCurrentlySafeWithReporter == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'isCurrentlySafeWithReporter is required for FOUND_STRAY',
          path: ['isCurrentlySafeWithReporter'],
        });
      }
      if (data.dateFound == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'dateFound is required for FOUND_STRAY',
          path: ['dateFound'],
        });
      }

      // LOST_PET-only fields must be absent
      if (data.petName != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'petName must not be set for FOUND_STRAY',
          path: ['petName'],
        });
      }
      if (data.dateLastSeen != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'dateLastSeen must not be set for FOUND_STRAY',
          path: ['dateLastSeen'],
        });
      }
    }
  });

/** TypeScript type inferred from the Zod schema — zero duplication. */
export type CreateLostPostInput = z.infer<typeof createLostPostSchema>;

/**
 * Validates and parses the `createLostPost` mutation input.
 *
 * @throws {ValidationError} if any field fails validation, with a descriptive message.
 *
 * @example
 * const input = validateCreateLostPostInput(args.input);
 */
export function validateCreateLostPostInput(raw: unknown): CreateLostPostInput {
  const result = createLostPostSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(message);
  }
  return result.data;
}

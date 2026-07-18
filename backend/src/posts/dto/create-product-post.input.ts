import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';
import { geoLocationSchema } from '../../users/dto/geo-location.input';

/**
 * Zod schema for the `createProductPost` mutation input.
 *
 * The `.superRefine()` enforces the price / free-listing constraint:
 *   - `isFree = true`  → `priceAmount` must be null/undefined
 *   - `isFree = false` → `priceAmount` is required and must be > 0
 *
 * This mirrors the `chk_product_price_by_free` CHECK constraint in PostgreSQL.
 *
 * PRODUCT posts intentionally omit the `urgency` field — the
 * `chk_posts_urgency_by_type` CHECK constraint requires urgency to be NULL
 * for PRODUCT rows.
 */
const createProductPostSchema = z
  .object({
    /** Post title — minimum 3, maximum 200 characters. */
    title: z.string().min(3).max(200).trim(),

    /** Free-text description — minimum 10, maximum 5000 characters. */
    description: z.string().min(10).max(5000).trim(),

    /** Optional UUID of the user's city from the `cities` table. */
    cityId: z.string().uuid().optional(),

    /** GPS coordinates for the product listing location. */
    coordinates: geoLocationSchema,

    /** Human-readable name for the area (e.g. "Maadi, Cairo"). */
    areaName: z.string().max(200).trim().optional(),

    /** Product category. */
    category: z.enum([
      'CARE',
      'FOOD',
      'TRANSPORT',
      'ACCESSORIES',
      'GROOMING',
      'MEDICAL_SUPPLIES',
      'OTHER',
    ]),

    /** Physical condition of the product. */
    condition: z.enum(['NEW', 'LIKE_NEW', 'USED']),

    /**
     * Price in the smallest currency unit.
     * Must be > 0 when `isFree` is false; must be absent when `isFree` is true.
     * Enforced by `chk_product_price_by_free`.
     */
    priceAmount: z.number().positive('Price must be greater than 0').optional(),

    /** ISO 4217 3-letter currency code — defaults to 'EGP'. */
    priceCurrency: z
      .string()
      .length(3, 'Currency must be a 3-letter ISO code')
      .default('EGP'),

    /** Whether the product is being given away for free. */
    isFree: z.boolean(),

    /** Whether the seller is open to price negotiation. */
    openToOffers: z.boolean().optional().default(false),

    /** UUIDs of pre-uploaded media assets — maximum 4 images. */
    mediaIds: z.array(z.string().uuid()).max(4).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.isFree && data.priceAmount != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'priceAmount must not be set when isFree is true',
        path: ['priceAmount'],
      });
    }
    if (!data.isFree && data.priceAmount == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'priceAmount is required when isFree is false',
        path: ['priceAmount'],
      });
    }
  });

/** TypeScript type inferred from the Zod schema — zero duplication. */
export type CreateProductPostInput = z.infer<typeof createProductPostSchema>;

/**
 * Validates and parses the `createProductPost` mutation input.
 *
 * @throws {ValidationError} if any field fails validation, with a descriptive message.
 *
 * @example
 * const input = validateCreateProductPostInput(args.input);
 */
export function validateCreateProductPostInput(raw: unknown): CreateProductPostInput {
  const result = createProductPostSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(message);
  }
  return result.data;
}

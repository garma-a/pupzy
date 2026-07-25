import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';

// ─── Shared sub-schemas ─────────────────────────────────────────────────────

const viewerLocationSchema = z.object({
  latitude: z
    .number()
    .min(-90, 'latitude must be >= -90')
    .max(90, 'latitude must be <= 90'),
  longitude: z
    .number()
    .min(-180, 'longitude must be >= -180')
    .max(180, 'longitude must be <= 180'),
});

/**
 * Location filter schema.
 * - governorate: Required. Filters posts by Egyptian governorate.
 * - cityId: Optional. Narrows to a specific city within the governorate.
 * - viewerLocation: Optional. GPS for distance calc and radius filtering.
 * - radiusKm: Optional. Proximity radius in km. Default 25, range [1, 100].
 */
const locationFilterSchema = z.object({
  governorate: z.string().min(1, 'governorate is required').max(100),
  cityId: z.string().uuid('cityId must be a valid UUID').nullish(),
  viewerLocation: viewerLocationSchema.nullish(),
  radiusKm: z
    .number()
    .min(1, 'radiusKm minimum is 1')
    .max(100, 'radiusKm maximum is 100')
    .nullish(),
});

/**
 * Pagination schema.
 * - first: Page size. Default 20, range [1, 50].
 * - after: Opaque base64url cursor from previous page's endCursor.
 */
const paginationSchema = z.object({
  first: z.number().int().min(1).max(50).nullish(),
  after: z.string().nullish(),
});

// ─── Feed-specific schemas ──────────────────────────────────────────────────

const helpFeedSchema = locationFilterSchema.merge(paginationSchema);

const adoptFeedSchema = locationFilterSchema.merge(paginationSchema).extend({
  sort: z.enum(['HOT', 'NEWEST']).nullish(),
});

const PRODUCT_CATEGORIES = [
  'CARE',
  'FOOD',
  'TRANSPORT',
  'ACCESSORIES',
  'GROOMING',
  'MEDICAL_SUPPLIES',
  'OTHER',
] as const;

const marketFeedSchema = locationFilterSchema.merge(paginationSchema).extend({
  sort: z.enum(['HOT', 'NEWEST']).nullish(),
  category: z.enum(PRODUCT_CATEGORIES).nullish(),
});

const homeFeedSchema = locationFilterSchema.merge(paginationSchema);

// ─── Exported types ─────────────────────────────────────────────────────────

export type HelpFeedInput = z.infer<typeof helpFeedSchema>;
export type AdoptFeedInput = z.infer<typeof adoptFeedSchema>;
export type MarketFeedInput = z.infer<typeof marketFeedSchema>;
export type HomeFeedInput = z.infer<typeof homeFeedSchema>;

// ─── Validation helpers ─────────────────────────────────────────────────────

function formatZodErrors(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
}

export function validateHelpFeedInput(raw: unknown): HelpFeedInput {
  const result = helpFeedSchema.safeParse(raw);
  if (!result.success) throw new ValidationError(formatZodErrors(result.error));
  return result.data;
}

export function validateAdoptFeedInput(raw: unknown): AdoptFeedInput {
  const result = adoptFeedSchema.safeParse(raw);
  if (!result.success) throw new ValidationError(formatZodErrors(result.error));
  return result.data;
}

export function validateMarketFeedInput(raw: unknown): MarketFeedInput {
  const result = marketFeedSchema.safeParse(raw);
  if (!result.success) throw new ValidationError(formatZodErrors(result.error));
  return result.data;
}

export function validateHomeFeedInput(raw: unknown): HomeFeedInput {
  const result = homeFeedSchema.safeParse(raw);
  if (!result.success) throw new ValidationError(formatZodErrors(result.error));
  return result.data;
}

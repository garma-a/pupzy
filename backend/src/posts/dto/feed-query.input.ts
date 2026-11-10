import { z } from 'zod';
import { ValidationError } from '../../common/errors/app.errors';

// ─── Shared sub-schemas ─────────────────────────────────────────────────────

const viewerLocationSchema = z.object({
  latitude: z.number().min(-90, 'latitude must be >= -90').max(90, 'latitude must be <= 90'),
  longitude: z.number().min(-180, 'longitude must be >= -180').max(180, 'longitude must be <= 180'),
});

// Mating permits an entirely absent location; the other feeds additionally
// require an administrative area or viewer point below.
const feedLocationSchema = z.object({
  viewerLocation: viewerLocationSchema.nullish(),
  radiusKm: z.number().min(1, 'radiusKm minimum is 1').max(100, 'radiusKm maximum is 100').nullish(),
});

export type FeedLocationInput = z.infer<typeof feedLocationSchema>;

/**
 * Location filter schema.
 * - governorate: Optional. Fallback filter when a numeric radius has no resolvable center.
 * - cityId: Optional. Distance/radius center when no GPS; fallback City filter for a numeric radius.
 * - viewerLocation: Optional. GPS for distance calculation and numeric radius filtering.
 * - radiusKm: Null or omitted means nationwide, ignoring governorate/City scoping.
 *   A numeric radius retains proximity/fallback location filtering, range [1, 100].
 *   Distance is still returned whenever viewerLocation or a City center can be resolved.
 *
 * At least one of governorate, cityId, or viewerLocation must be provided.
 */
const locationFilterSchema = feedLocationSchema
  .extend({
    governorate: z.string().min(1).max(100).nullish(),
    cityId: z.string().uuid('cityId must be a valid UUID').nullish(),
  })
  .refine((data) => data.governorate || data.cityId || data.viewerLocation, {
    message: 'At least one of governorate, cityId, or viewerLocation must be provided',
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

/**
 * Optional server-side search schema.
 * - search: Free text matched against title, description, category, area and
 *   City names (English and Arabic) after shared normalization. Omitted,
 *   empty or whitespace-only text means no search; text shorter than two
 *   characters or longer than 100 is rejected. See
 *   `search-query.util.ts` for the full documented behavior.
 */
const feedSearchSchema = z.object({
  search: z.string().nullish(),
});

// ─── Feed-specific schemas ──────────────────────────────────────────────────

const helpFeedSchema = locationFilterSchema.and(paginationSchema).and(feedSearchSchema);

const adoptFeedSchema = locationFilterSchema
  .and(paginationSchema)
  .and(feedSearchSchema)
  .and(
    z.object({
      sort: z.enum(['HOT', 'NEWEST']).nullish(),
    }),
  );

const PRODUCT_CATEGORIES = [
  'CARE',
  'FOOD',
  'TRANSPORT',
  'ACCESSORIES',
  'GROOMING',
  'MEDICAL_SUPPLIES',
  'OTHER',
] as const;

const marketFeedSchema = locationFilterSchema
  .and(paginationSchema)
  .and(feedSearchSchema)
  .and(
    z.object({
      sort: z.enum(['HOT', 'NEWEST']).nullish(),
      category: z.enum(PRODUCT_CATEGORIES).nullish(),
    }),
  );

const homeFeedSchema = locationFilterSchema.and(paginationSchema).and(feedSearchSchema);

const mySavedPostsSchema = paginationSchema;

const POST_TYPES = ['RESCUE', 'LOST', 'ADOPTION', 'PRODUCT', 'MATING'] as const;

const myPostsSchema = paginationSchema.and(
  z.object({
    postType: z.enum(POST_TYPES),
  }),
);

// ─── Exported types ─────────────────────────────────────────────────────────

export type HelpFeedInput = z.infer<typeof helpFeedSchema>;
export type AdoptFeedInput = z.infer<typeof adoptFeedSchema>;
export type MarketFeedInput = z.infer<typeof marketFeedSchema>;
export type HomeFeedInput = z.infer<typeof homeFeedSchema>;
export type MySavedPostsInput = z.infer<typeof mySavedPostsSchema>;
export type MyPostsInput = z.infer<typeof myPostsSchema>;

// ─── Validation helpers ─────────────────────────────────────────────────────

function formatZodErrors(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

export function validateFeedLocationInput(raw: unknown): FeedLocationInput {
  const result = feedLocationSchema.safeParse(raw);
  if (!result.success) throw new ValidationError(formatZodErrors(result.error));
  return result.data;
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

export function validateMySavedPostsInput(raw: unknown): MySavedPostsInput {
  const result = mySavedPostsSchema.safeParse(raw);
  if (!result.success) throw new ValidationError(formatZodErrors(result.error));
  return result.data;
}

export function validateMyPostsInput(raw: unknown): MyPostsInput {
  const result = myPostsSchema.safeParse(raw);
  if (!result.success) throw new ValidationError(formatZodErrors(result.error));
  return result.data;
}

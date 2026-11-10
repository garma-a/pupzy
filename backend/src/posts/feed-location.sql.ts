import { eq, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { cities, posts } from '../database/schema';
import type * as schema from '../database/schema';

/**
 * Builds the city/governorate equality filter for feed queries. Returns
 * undefined when no administrative-boundary filter applies (radius-only
 * mode) — and() silently drops an undefined condition, so callers pass
 * this straight into and(...) with no manual null check.
 */
function buildLocationFilterCondition(
  governorate: string | null | undefined,
  cityId: string | null | undefined,
): SQL | undefined {
  if (cityId) return eq(posts.cityId, cityId);
  if (governorate) return eq(posts.governorate, governorate);
  return undefined;
}

/**
 * Null/omitted radius means nationwide, even when the client sends a City
 * or governorate. Center resolution remains separate so distance is still
 * available nationwide. Numeric radii keep the existing location fallback.
 */
export function buildFeedLocationCondition(
  radiusKm: number | null | undefined,
  centerPointAsEwkt: string | null,
  governorate: string | null | undefined,
  cityId: string | null | undefined,
): SQL | undefined {
  if (radiusKm == null) return undefined;
  return centerPointAsEwkt
    ? buildRadiusCondition(centerPointAsEwkt, radiusKm * 1000)
    : buildLocationFilterCondition(governorate, cityId);
}

/**
 * Resolves the center point for radius-based filtering, as EWKT text.
 *
 * Priority:
 * 1. viewerLocation (GPS) — user is physically there
 * 2. cityId center_point — user manually browsing another city
 * 3. null — no radius filtering possible
 */
export async function resolveRadiusCenter(
  db: NodePgDatabase<typeof schema>,
  viewerLocation: { latitude: number; longitude: number } | null | undefined,
  cityId: string | null | undefined,
): Promise<string | null> {
  if (viewerLocation) {
    return `SRID=4326;POINT(${viewerLocation.longitude} ${viewerLocation.latitude})`;
  }
  if (cityId) {
    const [row] = await db
      .select({ centerPointAsText: sql<string>`ST_AsEWKT(${cities.centerPoint})` })
      .from(cities)
      .where(eq(cities.id, cityId))
      .limit(1);
    return row?.centerPointAsText ?? null;
  }
  return null;
}

/**
 * Builds the PostGIS radius-filter condition for feed queries. Two
 * ST_DWithin calls: the raw-geometry one lets PostgreSQL use the GIST
 * index on posts.coordinates for fast pre-filtering, and the ::geography
 * one gives an accurate, Earth-curvature-aware distance cutoff in meters.
 * No Drizzle operator exists for PostGIS functions, so this is "the
 * manual way" — an sql fragment used as a plain condition inside and().
 */
function buildRadiusCondition(centerPointAsEwkt: string, radiusInMeters: number): SQL {
  const radiusInDegrees = radiusInMeters / 111320.0;
  return sql`
    ST_DWithin(${posts.coordinates}, ST_GeomFromEWKT(${centerPointAsEwkt}), ${radiusInDegrees})
    AND ST_DWithin(${posts.coordinates}::geography, ST_GeomFromEWKT(${centerPointAsEwkt})::geography, ${radiusInMeters})
  `;
}

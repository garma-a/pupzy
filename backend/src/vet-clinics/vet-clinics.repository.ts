import { Inject, Injectable, Logger } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql, eq } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../database/database.provider';
import { vetClinics, cities } from '../database/schema';
import type * as schema from '../database/schema';

/**
 * Shape of a proximity query result: a vet clinic's public fields plus its
 * computed distance from a reference point. Named ProximityResult rather
 * than QueryRow because every field here is already a real, correctly
 * typed value straight from the query builder — there is no separate raw
 * row shape anywhere upstream of this anymore.
 */
export interface VetClinicProximityResult {
  id: string;
  nameEnglish: string | null;
  nameArabic: string | null;
  phoneNumber: string | null;
  address: string | null;
  website: string | null;
  /** ST_Y(coordinates) — WGS-84 latitude */
  latitude: number;
  /** ST_X(coordinates) — WGS-84 longitude */
  longitude: number;
  /** ROUND(ST_Distance / 1000, 2) — geodesic kilometres */
  distanceKm: number;
}

@Injectable()
export class VetClinicsRepository {
  private readonly logger = new Logger(VetClinicsRepository.name);

  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * findNearest
   *
   * Returns the `limit` closest active vet clinics to a given GPS
   * coordinate.
   *
   * ## Query plan
   *
   * Step 1 — KNN sort with GIST:
   *   `ORDER BY coordinates <-> ST_SetSRID(ST_MakePoint($lng, $lat), 4326)`
   *   This uses `idx_vet_clinics_coordinates` (GIST) for O(log n) traversal.
   *   The planner stops traversing the index as soon as `LIMIT` rows pass
   *   the `is_active = true` filter — it does NOT full-scan the table.
   *
   * Step 2 — Accurate distance for the top-N rows only:
   *   `ST_Distance(coordinates::geography, point::geography)`
   *   Computes geodesic metres on the WGS-84 ellipsoid — accurate within
   *   centimetres at any distance. Called only on the LIMIT result rows,
   *   so cost is negligible.
   *
   * Step 3 — Coordinate extraction:
   *   `ST_Y(coordinates::geometry)` → latitude
   *   `ST_X(coordinates::geometry)` → longitude
   *
   * `.mapWith(Number)` on the three computed columns guarantees real JS
   * numbers at runtime — a raw sql fragment has no column-level type
   * decoder the way a real column does, so without this, values coming
   * back from PostgreSQL's ROUND()/ST_Y()/ST_X() (which the pg driver may
   * return as strings) would need manual Number() conversion downstream
   * instead of being handled once, here.
   *
   * EXPLAIN ANALYZE must show:
   *   "Index Scan using idx_vet_clinics_coordinates on vet_clinics"
   *
   * @param latitude   Post's WGS-84 latitude
   * @param longitude  Post's WGS-84 longitude
   * @param limit      Maximum rows to return (default 3)
   */
  async findNearest(latitude: number, longitude: number, limit = 3): Promise<VetClinicProximityResult[]> {
    this.logger.debug(`findNearest lat=${latitude} lng=${longitude} limit=${limit}`);

    const targetPoint = sql`ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)`;

    return this.db
      .select({
        id: vetClinics.id,
        nameEnglish: vetClinics.nameEnglish,
        nameArabic: vetClinics.nameArabic,
        phoneNumber: vetClinics.phoneNumber,
        address: vetClinics.address,
        website: vetClinics.website,
        latitude: sql<number>`ST_Y(${vetClinics.coordinates}::geometry)`.mapWith(Number),
        longitude: sql<number>`ST_X(${vetClinics.coordinates}::geometry)`.mapWith(Number),
        distanceKm: sql<number>`
          ROUND((ST_Distance(${vetClinics.coordinates}::geography, ${targetPoint}::geography) / 1000.0)::numeric, 2)
        `.mapWith(Number),
      })
      .from(vetClinics)
      .where(eq(vetClinics.isActive, true))
      .orderBy(sql`${vetClinics.coordinates} <-> ${targetPoint}`)
      .limit(limit);
  }

  /**
   * findNearestForCity
   *
   * Returns the `limit` closest active vet clinics to a city's
   * center_point. Used for ADOPTION posts where exact GPS coordinates are
   * private. The city center_point is public data.
   *
   * ## Why innerJoin(cities, eq(cities.id, cityId)) instead of a filter on vetClinics
   *
   * The join condition compares `cities.id` to the `cityId` parameter —
   * not to any column on `vetClinics` — so this attaches exactly one city
   * row (whichever one matches `cityId`) to every `vetClinics` row. That is
   * deliberately the same effect as the original raw
   * `CROSS JOIN LATERAL (SELECT center_point FROM cities WHERE id = … LIMIT 1)`:
   * it does NOT filter vet clinics by `city_id` at all — a clinic just
   * across a city boundary can still be the closest one, so vet clinics are
   * never restricted to "clinics whose city_id equals this city."
   *
   * All 3 nearest clinics to a given city are identical regardless of which
   * adoption post triggered the query — this is why the service caches by
   * `cityId` (not `postId`) for adoption posts.
   *
   * @param cityId  The post's city_id (UUID), used to resolve center_point
   * @param limit   Maximum rows to return (default 3)
   */
  async findNearestForCity(cityId: string, limit = 3): Promise<VetClinicProximityResult[]> {
    this.logger.debug(`findNearestForCity cityId=${cityId} limit=${limit}`);

    return this.db
      .select({
        id: vetClinics.id,
        nameEnglish: vetClinics.nameEnglish,
        nameArabic: vetClinics.nameArabic,
        phoneNumber: vetClinics.phoneNumber,
        address: vetClinics.address,
        website: vetClinics.website,
        latitude: sql<number>`ST_Y(${vetClinics.coordinates}::geometry)`.mapWith(Number),
        longitude: sql<number>`ST_X(${vetClinics.coordinates}::geometry)`.mapWith(Number),
        distanceKm: sql<number>`
          ROUND((ST_Distance(${vetClinics.coordinates}::geography, ST_SetSRID(${cities.centerPoint}, 4326)::geography) / 1000.0)::numeric, 2)
        `.mapWith(Number),
      })
      .from(vetClinics)
      .innerJoin(cities, eq(cities.id, cityId))
      .where(eq(vetClinics.isActive, true))
      .orderBy(sql`${vetClinics.coordinates} <-> ST_SetSRID(${cities.centerPoint}, 4326)`)
      .limit(limit);
  }
}

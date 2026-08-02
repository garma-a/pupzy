import { Inject, Injectable, Logger } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../database/database.provider';
import type * as schema from '../database/schema';

// ─── Raw DB row shape ─────────────────────────────────────────────────────────
/**
 * Shape of a row returned by the raw SQL proximity queries.
 *
 * All numeric columns (`latitude`, `longitude`, `distance_km`) are returned
 * as strings by the `pg` driver when produced by PostgreSQL functions
 * (ST_X, ST_Y, ROUND). The service layer casts them with `Number()`.
 *
 * snake_case keys here because `db.execute()` returns pg column names verbatim.
 *
 * The index signature `[key: string]: unknown` is required by the
 * `db.execute<T>()` generic constraint (`T extends Record<string, unknown>`).
 */
export interface VetClinicQueryRow {
  [key: string]: unknown;
  id:           string;
  name_english: string | null;
  name_arabic:  string | null;
  phone_number: string | null;
  address:      string | null;
  website:      string | null;
  /** ST_Y(coordinates)::text — WGS-84 latitude */
  latitude:     string;
  /** ST_X(coordinates)::text — WGS-84 longitude */
  longitude:    string;
  /** ROUND(ST_Distance / 1000, 2)::text — geodesic km */
  distance_km:  string;
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
   * Returns the `limit` closest active vet clinics to a given GPS coordinate.
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
   *   centimetres at any distance. Called only on LIMIT-3 result rows,
   *   so cost is negligible.
   *
   * Step 3 — Coordinate extraction:
   *   `ST_Y(coordinates::geometry)` → latitude
   *   `ST_X(coordinates::geometry)` → longitude
   *   Both return double precision; cast to ::text for pg driver compatibility.
   *
   * EXPLAIN ANALYZE must show:
   *   "Index Scan using idx_vet_clinics_coordinates on vet_clinics"
   *
   * @param latitude   Post's WGS-84 latitude
   * @param longitude  Post's WGS-84 longitude
   * @param limit      Maximum rows to return (default 3)
   */
  async findNearest(
    latitude: number,
    longitude: number,
    limit = 3,
  ): Promise<VetClinicQueryRow[]> {
    this.logger.debug(
      `findNearest lat=${latitude} lng=${longitude} limit=${limit}`,
    );

    const result = await this.db.execute<VetClinicQueryRow>(sql`
      SELECT
        vc.id,
        vc.name_english,
        vc.name_arabic,
        vc.phone_number,
        vc.address,
        vc.website,
        ST_Y(vc.coordinates::geometry)::text                                  AS latitude,
        ST_X(vc.coordinates::geometry)::text                                  AS longitude,
        ROUND(
          (ST_Distance(
            vc.coordinates::geography,
            ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
          ) / 1000.0)::numeric,
          2
        )::text                                                                AS distance_km
      FROM vet_clinics vc
      WHERE vc.is_active = true
      ORDER BY
        vc.coordinates <-> ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
      LIMIT ${limit}
    `);

    return result.rows;
  }

  /**
   * findNearestForCity
   *
   * Returns the `limit` closest active vet clinics to a city's center_point.
   *
   * Used for ADOPTION posts where the exact GPS coordinates are private.
   * The city center_point is public data — it is returned by the `cities` query.
   *
   * ## Query plan
   *
   * The `CROSS JOIN LATERAL` subquery resolves the city's center_point via a
   * single primary-key lookup (O(1)). The KNN sort then runs against that point,
   * using the same GIST index as `findNearest`.
   *
   * All 3 nearest clinics to a given city are identical regardless of which
   * adoption post triggered the query — this is why the service caches by
   * `cityId` (not `postId`) for adoption posts: a single DB query per city
   * per 24 hours covers all adoption posts in that city.
   *
   * @param cityId  The post's city_id (UUID), used to resolve center_point
   * @param limit   Maximum rows to return (default 3)
   */
  async findNearestForCity(
    cityId: string,
    limit = 3,
  ): Promise<VetClinicQueryRow[]> {
    this.logger.debug(
      `findNearestForCity cityId=${cityId} limit=${limit}`,
    );

    const result = await this.db.execute<VetClinicQueryRow>(sql`
      SELECT
        vc.id,
        vc.name_english,
        vc.name_arabic,
        vc.phone_number,
        vc.address,
        vc.website,
        ST_Y(vc.coordinates::geometry)::text                                  AS latitude,
        ST_X(vc.coordinates::geometry)::text                                  AS longitude,
        ROUND(
          (ST_Distance(
            vc.coordinates::geography,
            c.center_point::geography
          ) / 1000.0)::numeric,
          2
        )::text                                                                AS distance_km
      FROM vet_clinics vc
      CROSS JOIN LATERAL (
        SELECT center_point
        FROM   cities
        WHERE  id = ${cityId}
        LIMIT  1
      ) c
      WHERE vc.is_active = true
      ORDER BY vc.coordinates <-> c.center_point
      LIMIT ${limit}
    `);

    return result.rows;
  }
}

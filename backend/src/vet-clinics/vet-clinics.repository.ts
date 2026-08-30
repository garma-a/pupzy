import { Inject, Injectable, Logger } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql, eq } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../database/database.provider';
import { vetClinics, cities, cityCatalogRevisions } from '../database/schema';
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
  cityId: string | null;
  phoneNumber: string | null;
  address: string | null;
  addressEnglish: string | null;
  addressArabic: string | null;
  website: string | null;
  /** ST_Y(coordinates) — WGS-84 latitude */
  latitude: number;
  /** ST_X(coordinates) — WGS-84 longitude */
  longitude: number;
  /** ROUND(ST_Distance / 1000, 2) — geodesic kilometres */
  distanceKm: number;
}

export interface VetClinicCatalogRevisionReader {
  findNearest(latitude: number, longitude: number, limit?: number): Promise<VetClinicProximityResult[]>;
  findNearestForCity(cityId: string, limit?: number): Promise<VetClinicProximityResult[]>;
}

type VetClinicQueryExecutor = Pick<NodePgDatabase<typeof schema>, 'select'>;

@Injectable()
export class VetClinicsRepository {
  private readonly logger = new Logger(VetClinicsRepository.name);

  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Returns the revision committed with the current Vet Clinic / City catalog.
   *
   * Cached Vet Clinic payloads remain process-local; this small source-of-truth read
   * is the deployment-overlap fence that tells an already-running instance
   * when its local cache generation must no longer be served.
   */
  async getCatalogRevision(): Promise<number> {
    const [state] = await this.db
      .select({ revision: cityCatalogRevisions.revision })
      .from(cityCatalogRevisions)
      .where(eq(cityCatalogRevisions.id, 1))
      .limit(1);

    if (!state) {
      throw new Error('Catalog revision state is missing. Refusing to serve cached Vet Clinic data.');
    }

    return state.revision;
  }

  /**
   * Holds a shared PostgreSQL lock on the catalog revision while cached Vet Clinic
   * reads are evaluated. An administrative mutation takes the conflicting row lock
   * before changing clinic data, so this read completes before that mutation commits
   * or waits and observes its new revision.
   */
  async withCatalogRevision<T>(
    callback: (revision: number, reader: VetClinicCatalogRevisionReader) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const [state] = await tx
        .select({ revision: cityCatalogRevisions.revision })
        .from(cityCatalogRevisions)
        .where(eq(cityCatalogRevisions.id, 1))
        .for('share')
        .limit(1);

      if (!state) {
        throw new Error('Catalog revision state is missing. Refusing to serve cached Vet Clinic data.');
      }

      return callback(state.revision, {
        findNearest: (latitude: number, longitude: number, limit = 3) =>
          this.findNearestFrom(tx, latitude, longitude, limit),
        findNearestForCity: (cityId: string, limit = 3) => this.findNearestForCityFrom(tx, cityId, limit),
      });
    });
  }

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
   */
  async findNearest(latitude: number, longitude: number, limit = 3): Promise<VetClinicProximityResult[]> {
    return this.findNearestFrom(this.db, latitude, longitude, limit);
  }

  private async findNearestFrom(
    db: VetClinicQueryExecutor,
    latitude: number,
    longitude: number,
    limit = 3,
  ): Promise<VetClinicProximityResult[]> {
    this.logger.debug(`findNearest lat=${latitude} lng=${longitude} limit=${limit}`);

    const targetPoint = sql`ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)`;

    return db
      .select({
        id: vetClinics.id,
        nameEnglish: vetClinics.nameEnglish,
        nameArabic: vetClinics.nameArabic,
        cityId: vetClinics.cityId,
        phoneNumber: vetClinics.phoneNumber,
        address: vetClinics.address,
        addressEnglish: vetClinics.addressEnglish,
        addressArabic: vetClinics.addressArabic,
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
   */
  async findNearestForCity(cityId: string, limit = 3): Promise<VetClinicProximityResult[]> {
    return this.findNearestForCityFrom(this.db, cityId, limit);
  }

  private async findNearestForCityFrom(
    db: VetClinicQueryExecutor,
    cityId: string,
    limit = 3,
  ): Promise<VetClinicProximityResult[]> {
    this.logger.debug(`findNearestForCity cityId=${cityId} limit=${limit}`);

    return db
      .select({
        id: vetClinics.id,
        nameEnglish: vetClinics.nameEnglish,
        nameArabic: vetClinics.nameArabic,
        cityId: vetClinics.cityId,
        phoneNumber: vetClinics.phoneNumber,
        address: vetClinics.address,
        addressEnglish: vetClinics.addressEnglish,
        addressArabic: vetClinics.addressArabic,
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

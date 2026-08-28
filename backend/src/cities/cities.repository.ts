import { Inject, Injectable } from '@nestjs/common';
import { asc, inArray, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import { cities, cityCatalogRevisions, type City } from '../database/schema';
import type * as schema from '../database/schema';

export interface CatalogRevisionReader {
  findAll(): Promise<City[]>;
  findById(id: string): Promise<City | undefined>;
  findByIds(ids: readonly string[]): Promise<(City | null)[]>;
}

type CityQueryExecutor = Pick<NodePgDatabase<typeof schema>, 'select'>;

@Injectable()
export class CitiesRepository {
  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /** Returns all official cities ordered A-Z by English name. */
  async findAll(): Promise<City[]> {
    return this.findAllFrom(this.db);
  }

  private findAllFrom(db: CityQueryExecutor): Promise<City[]> {
    return db.select().from(cities).where(eq(cities.status, 'OFFICIAL')).orderBy(asc(cities.nameEnglish));
  }

  /**
   * Returns the revision committed with the current City catalog.
   *
   * Cached City payloads remain process-local; this small source-of-truth read
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
      throw new Error('City catalog revision state is missing. Refusing to serve cached City data.');
    }

    return state.revision;
  }

  /**
   * Holds a shared PostgreSQL lock on the catalog revision while a cached City
   * read is selected. A release takes the conflicting row lock before changing
   * City data, so this read completes before that release commits or waits and
   * observes its new revision.
   */
  async withCatalogRevision<T>(callback: (revision: number, reader: CatalogRevisionReader) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const [state] = await tx
        .select({ revision: cityCatalogRevisions.revision })
        .from(cityCatalogRevisions)
        .where(eq(cityCatalogRevisions.id, 1))
        .for('share')
        .limit(1);

      if (!state) {
        throw new Error('City catalog revision state is missing. Refusing to serve cached City data.');
      }

      return callback(state.revision, {
        findAll: () => this.findAllFrom(tx),
        findById: (id) => this.findByIdFrom(tx, id),
        findByIds: (ids) => this.findByIdsFrom(tx, ids),
      });
    });
  }

  /**
   * Returns a single city by ID, or undefined if not found.
   * Direct lookup by UUID remains accessible for all lifecycle states (OFFICIAL, LEGACY, RETIRED)
   * to preserve backward-compatible resolution for historical references.
   */
  async findById(id: string): Promise<City | undefined> {
    return this.findByIdFrom(this.db, id);
  }

  private async findByIdFrom(db: CityQueryExecutor, id: string): Promise<City | undefined> {
    const [city] = await db.select().from(cities).where(eq(cities.id, id)).limit(1);
    return city;
  }

  /**
   * Batch-loads cities by an array of IDs.
   * Resolves cities across all lifecycle states so historical entities continue to render.
   *
   * Returns results in the same order as the input IDs array,
   * with `null` for any ID that was not found — required by the DataLoader contract.
   */
  async findByIds(ids: readonly string[]): Promise<(City | null)[]> {
    return this.findByIdsFrom(this.db, ids);
  }

  private async findByIdsFrom(db: CityQueryExecutor, ids: readonly string[]): Promise<(City | null)[]> {
    if (ids.length === 0) return [];

    const rows = await db
      .select()
      .from(cities)
      .where(inArray(cities.id, ids as string[]));

    // Build a map for O(1) lookup so we preserve the input order
    const cityMap = new Map<string, City>(rows.map((c) => [c.id, c]));
    return ids.map((id) => cityMap.get(id) ?? null);
  }

  /**
   * Finds the nearest official city to the given GPS coordinates using PostGIS ST_Distance.
   * Used during profile completion and location updates.
   */
  async findNearest(latitude: number, longitude: number): Promise<City | undefined> {
    const point = `SRID=4326;POINT(${longitude} ${latitude})`;
    const [city] = await this.db
      .select()
      .from(cities)
      .where(eq(cities.status, 'OFFICIAL'))
      .orderBy(sql`ST_Distance(${cities.centerPoint}, ST_GeomFromEWKT(${point}))`)
      .limit(1);
    return city;
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { asc, inArray, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import { cities, type City } from '../database/schema';
import type * as schema from '../database/schema';

@Injectable()
export class CitiesRepository {
  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /** Returns all cities ordered A-Z by English name. */
  async findAll(): Promise<City[]> {
    return this.db.select().from(cities).orderBy(asc(cities.nameEn));
  }

  /**
   * Returns a single city by ID, or undefined if not found.
   * Used to validate that a cityId supplied by the client actually exists.
   */
  async findById(id: string): Promise<City | undefined> {
    const [city] = await this.db.select().from(cities).where(eq(cities.id, id)).limit(1);
    return city;
  }

  /**
   * Batch-loads cities by an array of IDs.
   * Used exclusively by the DataLoader to resolve N city IDs in one query.
   *
   * Returns results in the same order as the input IDs array,
   * with `null` for any ID that was not found — required by the DataLoader contract.
   */
  async findByIds(ids: readonly string[]): Promise<(City | null)[]> {
    if (ids.length === 0) return [];

    const rows = await this.db
      .select()
      .from(cities)
      .where(inArray(cities.id, ids as string[]));

    // Build a map for O(1) lookup so we preserve the input order
    const cityMap = new Map<string, City>(rows.map((c) => [c.id, c]));
    return ids.map((id) => cityMap.get(id) ?? null);
  }
}

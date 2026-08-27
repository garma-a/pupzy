import { sql, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  getOfficialCatalog,
  validateCatalog,
  mapCatalogRecordToInsertRow,
  type CityCatalogRecord,
  type CityCatalog,
} from './catalog';
import { cities } from '../database/schema/cities.schema';
import type * as schema from '../database/schema';

export interface SeedCitiesOptions {
  validateBeforeSeed?: boolean;
  batchSize?: number;
  catalog?: CityCatalogRecord[] | CityCatalog;
}

export interface SeedCitiesResult {
  totalSeeded: number;
  governorateCount: number;
}

export interface OfficialCityReference {
  id: string;
  governorate: string;
}

/**
 * Seeds the Egyptian City catalog into the database.
 *
 * Guarantees:
 * 1. Validates the complete dataset before performing any database writes.
 * 2. Runs inside a database transaction to ensure atomicity.
 * 3. Preserves lifecycle status of each catalog entry (e.g. RETIRED cities remain RETIRED).
 * 4. Idempotent: uses ON CONFLICT (source_code) DO UPDATE to update fields without duplicating rows
 *    or mutating existing UUID primary keys.
 * 5. Safe: does not delete, truncate, or overwrite historical (LEGACY / RETIRED) records.
 */
export async function seedOfficialCities(
  db: NodePgDatabase<typeof schema> | any,
  options: SeedCitiesOptions = {},
): Promise<SeedCitiesResult> {
  const rawCatalog = options.catalog ?? getOfficialCatalog();
  const catalogRecords = Array.isArray(rawCatalog) ? rawCatalog : rawCatalog.records;
  const catalogMetadata = Array.isArray(rawCatalog) ? undefined : rawCatalog.metadata;

  if (options.validateBeforeSeed !== false) {
    const validation = validateCatalog({
      records: catalogRecords,
      metadata: catalogMetadata,
    });
    if (!validation.isValid) {
      throw new Error(`City catalog validation failed before seeding: ${validation.errors.join('; ')}`);
    }
  }

  const batchSize = options.batchSize ?? 100;
  const officialRecords = catalogRecords.filter((c) => c.status === 'OFFICIAL' || !c.status);
  const governorates = new Set(officialRecords.map((c) => c.governorate));

  const runSeed = async (tx: any) => {
    for (let i = 0; i < catalogRecords.length; i += batchSize) {
      const chunk = catalogRecords.slice(i, i + batchSize);
      const batchValues = chunk.map((c) => mapCatalogRecordToInsertRow(c));

      await tx
        .insert(cities)
        .values(batchValues)
        .onConflictDoUpdate({
          target: cities.sourceCode,
          set: {
            nameEnglish: sql`excluded.name_english`,
            nameArabic: sql`excluded.name_arabic`,
            governorate: sql`excluded.governorate`,
            sourceNameEnglish: sql`excluded.source_name_english`,
            sourceNameArabic: sql`excluded.source_name_arabic`,
            status: sql`excluded.status`,
            centerPoint: sql`excluded.center_point`,
          },
        });
    }
  };

  if (typeof db.transaction === 'function') {
    await db.transaction(runSeed);
  } else {
    await runSeed(db);
  }

  return {
    totalSeeded: catalogRecords.length,
    governorateCount: governorates.size,
  };
}

async function queryOfficialCityReferences(db: any): Promise<OfficialCityReference[]> {
  return db
    .select({ id: cities.id, governorate: cities.governorate })
    .from(cities)
    .where(eq(cities.status, 'OFFICIAL'));
}

/**
 * Ensures official cities catalog is present in the database,
 * seeding the authoritative Egyptian Cities if none exist.
 * Used during fresh setup and disposable benchmark generation to reuse official Cities
 * without creating fake Cities.
 */
export async function ensureOfficialCities(
  db: NodePgDatabase<typeof schema> | any,
  catalog: CityCatalogRecord[] | CityCatalog = getOfficialCatalog(),
): Promise<OfficialCityReference[]> {
  const existing = await queryOfficialCityReferences(db);
  const catalogRecords = Array.isArray(catalog) ? catalog : catalog.records;
  const expectedOfficialCount = catalogRecords.filter((c) => c.status === 'OFFICIAL' || !c.status).length;

  if (existing && existing.length >= expectedOfficialCount) {
    return existing;
  }

  await seedOfficialCities(db, { catalog });

  return queryOfficialCityReferences(db);
}

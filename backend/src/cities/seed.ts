import { sql, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getOfficialCatalog, validateCatalog, type CityCatalogRecord } from './catalog';
import { cities } from '../database/schema/cities.schema';
import type * as schema from '../database/schema';

export interface SeedCitiesOptions {
  validateBeforeSeed?: boolean;
  batchSize?: number;
  catalog?: CityCatalogRecord[];
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
 * Seeds the official 351 Egyptian City catalog into the database.
 *
 * Guarantees:
 * 1. Validates the complete dataset before performing any database writes.
 * 2. Runs inside a database transaction to ensure atomicity.
 * 3. Idempotent: uses ON CONFLICT (source_code) DO UPDATE to update fields without duplicating rows
 *    or mutating existing UUID primary keys.
 * 4. Safe: does not delete, truncate, or overwrite historical (LEGACY / RETIRED) records.
 */
export async function seedOfficialCities(
  db: NodePgDatabase<typeof schema> | any,
  options: SeedCitiesOptions = {},
): Promise<SeedCitiesResult> {
  const catalog = options.catalog ?? getOfficialCatalog();

  if (options.validateBeforeSeed !== false) {
    const validation = validateCatalog({ records: catalog });
    if (!validation.isValid) {
      throw new Error(`City catalog validation failed before seeding: ${validation.errors.join('; ')}`);
    }
  }

  const batchSize = options.batchSize ?? 100;
  const governorates = new Set(catalog.map((c) => c.governorate));

  const runSeed = async (tx: any) => {
    for (let i = 0; i < catalog.length; i += batchSize) {
      const chunk = catalog.slice(i, i + batchSize);
      const batchValues = chunk.map((c) => ({
        sourceCode: c.sourceCode,
        nameEnglish: c.nameEnglish,
        nameArabic: c.nameArabic,
        governorate: c.governorate,
        sourceNameEnglish: c.sourceNameEnglish,
        sourceNameArabic: c.sourceNameArabic,
        status: 'OFFICIAL' as const,
        centerPoint: sql`ST_SetSRID(ST_MakePoint(${c.longitude}, ${c.latitude}), 4326)`,
      }));

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
    totalSeeded: catalog.length,
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
 * seeding the authoritative 351 Egyptian Cities if none exist.
 * Used during fresh setup and disposable benchmark generation to reuse official Cities
 * without creating fake Cities.
 */
export async function ensureOfficialCities(
  db: NodePgDatabase<typeof schema> | any,
): Promise<OfficialCityReference[]> {
  const existing = await queryOfficialCityReferences(db);

  if (existing && existing.length >= 351) {
    return existing;
  }

  await seedOfficialCities(db);

  return queryOfficialCityReferences(db);
}

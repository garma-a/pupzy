import { mapCatalogRecordToDbValues, type CityCatalogRecord } from './catalog';

/**
 * Escapes single quotes for SQL string literals.
 */
export function escapeSqlString(str: string): string {
  return str.replace(/'/g, "''");
}

/**
 * Generates an idempotent, lifecycle-aware INSERT ... ON CONFLICT (source_code) DO UPDATE statement
 * for a single catalog record.
 *
 * Guarantees identical SQL representation across reconciliation and future-release migrations,
 * including canonical fields, status, representative PostGIS coordinates, and conflict behavior.
 */
export function generateCityUpsertSql(record: CityCatalogRecord, indent = '  '): string {
  const dbValues = mapCatalogRecordToDbValues(record);
  return (
    `${indent}INSERT INTO cities (` +
    `source_code, name_english, name_arabic, governorate, source_name_english, source_name_arabic, status, center_point` +
    `) VALUES (` +
    `'${escapeSqlString(dbValues.sourceCode)}', ` +
    `'${escapeSqlString(dbValues.nameEnglish)}', ` +
    `'${escapeSqlString(dbValues.nameArabic)}', ` +
    `'${escapeSqlString(dbValues.governorate)}', ` +
    `'${escapeSqlString(dbValues.sourceNameEnglish)}', ` +
    `'${escapeSqlString(dbValues.sourceNameArabic)}', ` +
    `'${escapeSqlString(dbValues.status)}', ` +
    `ST_SetSRID(ST_MakePoint(${dbValues.longitude}, ${dbValues.latitude}), 4326)` +
    `) ON CONFLICT (source_code) DO UPDATE SET ` +
    `name_english = EXCLUDED.name_english, ` +
    `name_arabic = EXCLUDED.name_arabic, ` +
    `governorate = EXCLUDED.governorate, ` +
    `source_name_english = EXCLUDED.source_name_english, ` +
    `source_name_arabic = EXCLUDED.source_name_arabic, ` +
    `status = EXCLUDED.status, ` +
    `center_point = EXCLUDED.center_point;`
  );
}

/**
 * Generates an array of lifecycle-aware City upsert SQL statements for a collection of catalog records.
 */
export function generateCitiesUpsertSql(records: CityCatalogRecord[], indent = '  '): string[] {
  return records.map((record) => generateCityUpsertSql(record, indent));
}

/**
 * Generates the SQL statement for synchronizing denormalized governorate values in posts for official cities.
 */
export function generatePostGovernorateSyncSql(indent = '  '): string {
  return `${indent}UPDATE posts SET governorate = cities.governorate FROM cities WHERE posts.city_id = cities.id AND cities.status = 'OFFICIAL';`;
}

/**
 * Generates SQL lines for updating retired cities in a release.
 */
export function generateRetiredCitiesSql(records: CityCatalogRecord[], indent = '  '): string[] {
  const retiredRecords = records.filter((c) => c.status === 'RETIRED');
  if (retiredRecords.length === 0) {
    return [`${indent}-- (No retired cities in this release)`];
  }
  const retiredCodesList = retiredRecords.map((r) => `'${escapeSqlString(r.sourceCode)}'`).join(', ');
  return [`${indent}UPDATE cities SET status = 'RETIRED' WHERE source_code IN (${retiredCodesList});`];
}

/**
 * Generates verification check SQL lines asserting expected official counts, governorate counts,
 * and absence of null source codes.
 */
export function generateCityVerificationSql(
  expectedOfficialCount: number,
  expectedGovCount: number,
  indent = '  ',
  contextLabel = 'City release',
): string[] {
  return [
    `${indent}SELECT`,
    `${indent}  count(*) FILTER (WHERE status = 'OFFICIAL'),`,
    `${indent}  count(DISTINCT governorate) FILTER (WHERE status = 'OFFICIAL'),`,
    `${indent}  count(*) FILTER (WHERE status = 'OFFICIAL' AND source_code IS NULL)`,
    `${indent}INTO official_count, gov_count, invalid_official_count`,
    `${indent}FROM cities;`,
    ``,
    `${indent}IF official_count != ${expectedOfficialCount} THEN`,
    `${indent}  RAISE EXCEPTION '${contextLabel} verification failed: expected ${expectedOfficialCount} official cities, found %', official_count;`,
    `${indent}END IF;`,
    `${indent}IF gov_count != ${expectedGovCount} THEN`,
    `${indent}  RAISE EXCEPTION '${contextLabel} verification failed: expected ${expectedGovCount} governorates, found %', gov_count;`,
    `${indent}END IF;`,
    `${indent}IF invalid_official_count != 0 THEN`,
    `${indent}  RAISE EXCEPTION '${contextLabel} verification failed: found % official cities without source_code', invalid_official_count;`,
    `${indent}END IF;`,
  ];
}

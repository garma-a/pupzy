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
    `source_code, name_english, name_arabic, governorate, governorate_arabic, source_name_english, source_name_arabic, status, center_point, aliases, district_id` +
    `) VALUES (` +
    `'${escapeSqlString(dbValues.sourceCode)}', ` +
    `'${escapeSqlString(dbValues.nameEnglish)}', ` +
    `'${escapeSqlString(dbValues.nameArabic)}', ` +
    `'${escapeSqlString(dbValues.governorate)}', ` +
    `'${escapeSqlString(dbValues.governorateArabic)}', ` +
    `'${escapeSqlString(dbValues.sourceNameEnglish)}', ` +
    `'${escapeSqlString(dbValues.sourceNameArabic)}', ` +
    `'${escapeSqlString(dbValues.status)}', ` +
    `ST_SetSRID(ST_MakePoint(${dbValues.longitude}, ${dbValues.latitude}), 4326), ` +
    `ARRAY[${dbValues.aliases.map((a) => "'" + escapeSqlString(a) + "'").join(', ')}]::text[], ` +
    (dbValues.districtSourceCode
      ? `(SELECT id FROM cities WHERE source_code = '${escapeSqlString(dbValues.districtSourceCode)}')`
      : `NULL`) +
    `) ON CONFLICT (source_code) DO UPDATE SET ` +
    `name_english = EXCLUDED.name_english, ` +
    `name_arabic = EXCLUDED.name_arabic, ` +
    `governorate = EXCLUDED.governorate, ` +
    `governorate_arabic = EXCLUDED.governorate_arabic, ` +
    `source_name_english = EXCLUDED.source_name_english, ` +
    `source_name_arabic = EXCLUDED.source_name_arabic, ` +
    `status = EXCLUDED.status, ` +
    `center_point = EXCLUDED.center_point, aliases = EXCLUDED.aliases, district_id = EXCLUDED.district_id;`
  );
}

/**
 * Generates an array of lifecycle-aware City upsert SQL statements for a collection of catalog records.
 */
export function generateCitiesUpsertSql(records: CityCatalogRecord[], indent = '  '): string[] {
  return [...records]
    .sort((a, b) => Number(!!a.districtSourceCode) - Number(!!b.districtSourceCode))
    .map((record) => generateCityUpsertSql(record, indent));
}

/**
 * Generates the SQL statement for synchronizing denormalized governorate values in posts for official cities.
 */
export function generatePostGovernorateSyncSql(indent = '  '): string {
  return `${indent}UPDATE posts SET governorate = cities.governorate FROM cities WHERE posts.city_id = cities.id AND cities.status = 'OFFICIAL';`;
}

/** Backfills retained historical Cities using the same reviewed governorate labels. */
export function generateGovernorateArabicSyncSql(records: CityCatalogRecord[], indent = '  '): string {
  const labels = new Map(
    records.filter((row) => row.governorateArabic).map((row) => [row.governorate, row.governorateArabic!]),
  );
  if (!labels.size) return `${indent}-- No reviewed Arabic governorate labels supplied.`;
  const values = [...labels]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([english, arabic]) => `('${escapeSqlString(english)}', '${escapeSqlString(arabic)}')`)
    .join(', ');
  return `${indent}UPDATE cities AS city SET governorate_arabic = labels.arabic FROM (VALUES ${values}) AS labels(english, arabic) WHERE city.governorate = labels.english AND city.governorate_arabic IS DISTINCT FROM labels.arabic;`;
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
 * Generates SQL statements for transferring source identity (P-code) onto existing application UUIDs
 * for approved 1:1 City identity transfers.
 */
export function generateCityIdentityTransfersSql(
  identityTransfers: Array<{ retiredCitySourceCode: string; replacementCitySourceCode: string }>,
  indent = '  ',
): string[] {
  if (!identityTransfers || identityTransfers.length === 0) {
    return [`${indent}-- (No identity transfers in this release)`];
  }
  return identityTransfers.map(
    (identityTransfer) =>
      `${indent}UPDATE cities SET source_code = '${escapeSqlString(identityTransfer.replacementCitySourceCode.trim())}' WHERE source_code = '${escapeSqlString(identityTransfer.retiredCitySourceCode.trim())}';`,
  );
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

/**
 * Acquires the singleton City catalog fence before a reviewed release changes
 * City data. It is emitted inside the release's DO block, therefore a failed
 * migration cannot advance the revision or invalidate live caches.
 */
export function generateCityCatalogRevisionSql(indent = ''): string[] {
  return [
    `${indent}UPDATE city_catalog_revisions SET revision = revision + 1 WHERE id = 1;`,
    `${indent}IF NOT FOUND THEN`,
    `${indent}  RAISE EXCEPTION 'City catalog revision state is missing';`,
    `${indent}END IF;`,
  ];
}

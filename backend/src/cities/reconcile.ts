/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment */
import * as fs from 'fs';
import {
  getOfficialCatalog,
  validateCatalog,
  unpackCatalog,
  resolveDataPath,
  mapCatalogRecordToDbValues,
  type CityCatalogRecord,
  type CityCatalog,
} from './catalog';

export interface LegacyCityMapping {
  legacyGovernorate: string;
  legacyNameEnglish: string;
  legacyNameArabic?: string;
  targetSourceCode: string | null;
  notes?: string;
}

export interface LegacyMappingValidationResult {
  isValid: boolean;
  errors: string[];
  mappedCount: number;
  unmappedCount: number;
}

export interface ExistingCityRow {
  id: string;
  nameEnglish: string;
  nameArabic?: string | null;
  governorate: string;
  sourceCode?: string | null;
  status?: 'OFFICIAL' | 'LEGACY' | 'RETIRED';
}

export interface ReconcileOptions {
  catalog?: CityCatalogRecord[] | CityCatalog;
  mappings?: LegacyCityMapping[];
  validateBeforeReconcile?: boolean;
  clearCache?: () => Promise<void> | void;
  citiesService?: { clearCache: () => Promise<void> | void };
}

export interface ReconcileResult {
  matchedLegacyCount: number;
  unmatchedLegacyCount: number;
  insertedOfficialCount: number;
  totalOfficialCities: number;
  governorateCount: number;
}

/**
 * Loads the reviewed legacy city mapping table.
 * Runs completely offline.
 */
export function loadLegacyMappings(): LegacyCityMapping[] {
  const filePath = resolveDataPath('legacy-city-mappings.json');
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content) as LegacyCityMapping[];
}

/**
 * Validates a reviewed one-to-one legacy mapping table against the official City catalog.
 * Guarantees:
 * - No duplicate legacy entries (by normalized legacyGovernorate + legacyNameEnglish).
 * - No duplicate target sourceCodes (preventing ambiguous N:1 collapse unless explicitly intended).
 * - All non-null targetSourceCodes exist in the official catalog.
 */
export function validateLegacyMappings(
  mappings: LegacyCityMapping[],
  officialCatalog: CityCatalogRecord[],
): LegacyMappingValidationResult {
  const errors: string[] = [];
  const validSourceCodes = new Set(officialCatalog.map((c) => c.sourceCode));

  const seenLegacyKeys = new Set<string>();
  const seenTargetCodes = new Set<string>();

  let mappedCount = 0;
  let unmappedCount = 0;

  for (let i = 0; i < mappings.length; i++) {
    const item = mappings[i];
    const legacyKey = `${item.legacyGovernorate.trim().toLowerCase()}:${item.legacyNameEnglish.trim().toLowerCase()}`;

    if (seenLegacyKeys.has(legacyKey)) {
      errors.push(`Duplicate legacy entry at index ${i}: '${item.legacyNameEnglish}' in '${item.legacyGovernorate}'`);
    } else {
      seenLegacyKeys.add(legacyKey);
    }

    if (item.targetSourceCode !== null && item.targetSourceCode !== undefined) {
      const code = item.targetSourceCode.trim();
      if (!validSourceCodes.has(code)) {
        errors.push(`Unknown target sourceCode '${code}' at index ${i}`);
      } else if (seenTargetCodes.has(code)) {
        errors.push(`Duplicate target sourceCode '${code}' at index ${i}`);
      } else {
        seenTargetCodes.add(code);
      }
      mappedCount++;
    } else {
      unmappedCount++;
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    mappedCount,
    unmappedCount,
  };
}

/**
 * Reconciles an existing database's cities table against the official City catalog.
 *
 * Guarantees:
 * 1. Executes within a database transaction (all or nothing).
 * 2. Matched legacy cities retain their primary key UUIDs while gaining official source codes and canonical names.
 * 3. Unmatched legacy cities transition to 'LEGACY' status, preserving historical references without automatic nearest-neighbor remapping.
 * 4. Missing official cities are inserted to achieve complete official coverage across all governorates.
 * 5. Existing official cities receive reviewed canonical corrections (names, governorate, status, coordinates) rather than being skipped.
 * 6. Denormalized governorate values in posts are updated only for confidently identified official cities.
 * 7. Fails closed on duplicate legacy identities, zero-row or multi-row matches for reviewed non-null mappings, or verification mismatch.
 * 8. Cache invalidation is triggered post-commit.
 */
export async function reconcileCities(db: any, options: ReconcileOptions = {}): Promise<ReconcileResult> {
  const rawCatalog = options.catalog ?? getOfficialCatalog();
  const { records: catalogRecords, officialRecords } = unpackCatalog(rawCatalog);
  const mappings = options.mappings ?? loadLegacyMappings();

  if (options.validateBeforeReconcile !== false) {
    const catalogVal = validateCatalog(rawCatalog);
    if (!catalogVal.isValid) {
      throw new Error(`Catalog validation failed: ${catalogVal.errors.join('; ')}`);
    }

    const mappingVal = validateLegacyMappings(mappings, catalogRecords);
    if (!mappingVal.isValid) {
      throw new Error(`Legacy mapping validation failed: ${mappingVal.errors.join('; ')}`);
    }
  }

  const catalogByCode = new Map<string, CityCatalogRecord>(catalogRecords.map((c) => [c.sourceCode, c]));

  let matchedLegacyCount = 0;
  let unmatchedLegacyCount = 0;
  let insertedOfficialCount = 0;

  const expectedOfficialCount = officialRecords.length;
  const expectedGovCount = new Set(officialRecords.map((c) => c.governorate)).size;

  const runReconcile = async (tx: any) => {
    // 1. Fetch existing cities
    const existingRes = await tx.query(
      `SELECT id, name_english, name_arabic, governorate, source_code, status FROM cities`,
    );
    const existingRows: ExistingCityRow[] = existingRes.rows.map((r: any) => ({
      id: r.id,
      nameEnglish: r.name_english ?? r.nameEnglish ?? '',
      nameArabic: r.name_arabic ?? r.nameArabic ?? null,
      governorate: r.governorate ?? '',
      sourceCode: r.source_code ?? r.sourceCode ?? null,
      status: r.status ?? 'OFFICIAL',
    }));

    const legacyRows = existingRows.filter((r) => !r.sourceCode);
    const officialOrRetiredRows = existingRows.filter((r) => !!r.sourceCode);
    const claimedSourceCodes = new Set<string>();

    if (legacyRows.length > 0) {
      // Check for duplicate legacy identities in the database
      const seenLegacyKeys = new Set<string>();
      for (const row of legacyRows) {
        const key = `${row.governorate.trim().toLowerCase()}:${row.nameEnglish.trim().toLowerCase()}`;
        if (seenLegacyKeys.has(key)) {
          throw new Error(
            `City reconciliation aborted: duplicate legacy city identities found in database for '${row.nameEnglish}' in '${row.governorate}'`,
          );
        }
        seenLegacyKeys.add(key);
      }

      // Group legacy rows by key
      const legacyByKey = new Map<string, ExistingCityRow[]>();
      for (const row of legacyRows) {
        const key = `${row.governorate.trim().toLowerCase()}:${row.nameEnglish.trim().toLowerCase()}`;
        const list = legacyByKey.get(key) ?? [];
        list.push(row);
        legacyByKey.set(key, list);
      }

      const matchedLegacyRowIds = new Set<string>();

      // Apply non-null mappings
      for (const m of mappings) {
        if (m.targetSourceCode !== null && m.targetSourceCode !== undefined) {
          const key = `${m.legacyGovernorate.trim().toLowerCase()}:${m.legacyNameEnglish.trim().toLowerCase()}`;
          const matches = legacyByKey.get(key) ?? [];

          if (matches.length === 0) {
            throw new Error(
              `City reconciliation aborted: reviewed mapping for '${m.legacyNameEnglish}' in '${m.legacyGovernorate}' matched 0 legacy rows`,
            );
          }
          if (matches.length > 1) {
            throw new Error(
              `City reconciliation aborted: reviewed mapping for '${m.legacyNameEnglish}' in '${m.legacyGovernorate}' matched ${matches.length} legacy rows (expected 1)`,
            );
          }

          const row = matches[0];
          const official = catalogByCode.get(m.targetSourceCode.trim());
          if (!official) {
            throw new Error(`City reconciliation aborted: unknown target sourceCode '${m.targetSourceCode}'`);
          }

          const dbValues = mapCatalogRecordToDbValues(official);
          await tx.query(
            `UPDATE cities SET
              name_english = $1,
              name_arabic = $2,
              governorate = $3,
              source_code = $4,
              source_name_english = $5,
              source_name_arabic = $6,
              status = $7,
              center_point = ST_SetSRID(ST_MakePoint($8, $9), 4326)
             WHERE id = $10`,
            [
              dbValues.nameEnglish,
              dbValues.nameArabic,
              dbValues.governorate,
              dbValues.sourceCode,
              dbValues.sourceNameEnglish,
              dbValues.sourceNameArabic,
              dbValues.status,
              dbValues.longitude,
              dbValues.latitude,
              row.id,
            ],
          );

          if (dbValues.status === 'OFFICIAL') {
            await tx.query(`UPDATE posts SET governorate = $1 WHERE city_id = $2`, [dbValues.governorate, row.id]);
          }

          claimedSourceCodes.add(dbValues.sourceCode);
          matchedLegacyRowIds.add(row.id);
          matchedLegacyCount++;
        }
      }

      // Mark unmapped legacy records as LEGACY
      for (const row of legacyRows) {
        if (!matchedLegacyRowIds.has(row.id)) {
          await tx.query(`UPDATE cities SET status = $1 WHERE id = $2`, ['LEGACY', row.id]);
          unmatchedLegacyCount++;
        }
      }
    }

    // 2. Existing official or retired rows: apply canonical corrections rather than skipping
    for (const row of officialOrRetiredRows) {
      if (row.sourceCode && catalogByCode.has(row.sourceCode)) {
        const official = catalogByCode.get(row.sourceCode)!;
        const dbValues = mapCatalogRecordToDbValues(official);
        await tx.query(
          `UPDATE cities SET
            name_english = $1,
            name_arabic = $2,
            governorate = $3,
            source_name_english = $4,
            source_name_arabic = $5,
            status = $6,
            center_point = ST_SetSRID(ST_MakePoint($7, $8), 4326)
           WHERE id = $9`,
          [
            dbValues.nameEnglish,
            dbValues.nameArabic,
            dbValues.governorate,
            dbValues.sourceNameEnglish,
            dbValues.sourceNameArabic,
            dbValues.status,
            dbValues.longitude,
            dbValues.latitude,
            row.id,
          ],
        );

        if (dbValues.status === 'OFFICIAL') {
          await tx.query(`UPDATE posts SET governorate = $1 WHERE city_id = $2`, [dbValues.governorate, row.id]);
        }

        claimedSourceCodes.add(dbValues.sourceCode);
      }
    }

    // 3. Insert missing official cities
    const missingOfficial = catalogRecords.filter((c) => !claimedSourceCodes.has(c.sourceCode));
    for (const off of missingOfficial) {
      const dbValues = mapCatalogRecordToDbValues(off);
      await tx.query(
        `INSERT INTO cities (
          source_code,
          name_english,
          name_arabic,
          governorate,
          source_name_english,
          source_name_arabic,
          status,
          center_point
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($8, $9), 4326)
        )
        ON CONFLICT (source_code) DO UPDATE SET
          name_english = EXCLUDED.name_english,
          name_arabic = EXCLUDED.name_arabic,
          governorate = EXCLUDED.governorate,
          source_name_english = EXCLUDED.source_name_english,
          source_name_arabic = EXCLUDED.source_name_arabic,
          status = EXCLUDED.status,
          center_point = EXCLUDED.center_point`,
        [
          dbValues.sourceCode,
          dbValues.nameEnglish,
          dbValues.nameArabic,
          dbValues.governorate,
          dbValues.sourceNameEnglish,
          dbValues.sourceNameArabic,
          dbValues.status,
          dbValues.longitude,
          dbValues.latitude,
        ],
      );
      insertedOfficialCount++;
    }

    // 4. Post-verification inside transaction
    const verifyRes = await tx.query(
      `SELECT
        count(*) FILTER (WHERE status = 'OFFICIAL')::int as official_count,
        count(DISTINCT governorate) FILTER (WHERE status = 'OFFICIAL')::int as governorate_count,
        count(*) FILTER (WHERE status = 'OFFICIAL' AND source_code IS NULL)::int as invalid_official_count
       FROM cities`,
    );

    const stats = verifyRes.rows[0] ?? { official_count: 0, governorate_count: 0, invalid_official_count: 0 };
    const officialCount = Number(stats.official_count);
    const govCount = Number(stats.governorate_count);
    const invalidOfficialCount = Number(stats.invalid_official_count ?? 0);

    if (officialCount !== expectedOfficialCount) {
      throw new Error(
        `Reconciliation verification failed: expected ${expectedOfficialCount} official cities, found ${officialCount}`,
      );
    }
    if (govCount !== expectedGovCount) {
      throw new Error(
        `Reconciliation verification failed: expected ${expectedGovCount} governorates, found ${govCount}`,
      );
    }
    if (invalidOfficialCount !== 0) {
      throw new Error(
        `Reconciliation verification failed: found ${invalidOfficialCount} official cities without source_code`,
      );
    }
  };

  if (typeof db.transaction === 'function') {
    await db.transaction(runReconcile);
  } else {
    await runReconcile(db);
  }

  // Cache invalidation executes strictly post-commit
  if (options.citiesService?.clearCache) {
    await options.citiesService.clearCache();
  } else if (options.clearCache) {
    await options.clearCache();
  }

  return {
    matchedLegacyCount,
    unmatchedLegacyCount,
    insertedOfficialCount,
    totalOfficialCities: expectedOfficialCount,
    governorateCount: expectedGovCount,
  };
}

function escapeSqlString(str: string): string {
  return str.replace(/'/g, "''");
}

/**
 * Generates deterministic, fully offline Drizzle SQL migration statements for database reconciliation.
 */
export function generateReconcileMigrationSql(
  mappings: LegacyCityMapping[] = loadLegacyMappings(),
  catalog: CityCatalogRecord[] | CityCatalog = getOfficialCatalog(),
): string {
  const { records: catalogRecords, officialRecords } = unpackCatalog(catalog);

  // Validate before generating SQL
  const catalogVal = validateCatalog(catalog);
  if (!catalogVal.isValid) {
    throw new Error(`Catalog validation failed: ${catalogVal.errors.join('; ')}`);
  }
  const mappingVal = validateLegacyMappings(mappings, catalogRecords);
  if (!mappingVal.isValid) {
    throw new Error(`Legacy mapping validation failed: ${mappingVal.errors.join('; ')}`);
  }

  const catalogByCode = new Map<string, CityCatalogRecord>(catalogRecords.map((c) => [c.sourceCode, c]));

  const expectedOfficialCount = officialRecords.length;
  const expectedGovCount = new Set(officialRecords.map((c) => c.governorate)).size;

  const lines: string[] = [
    '--',
    '-- Migration: 0011_reconcile_city_catalog.sql',
    `-- Offline data migration reconciling legacy cities with the authoritative ${expectedOfficialCount}-city ADM2 catalog.`,
    '--',
    'DO $$',
    'DECLARE',
    '  legacy_count int;',
    '  matched_count int;',
    '  duplicate_count int;',
    '  official_count int;',
    '  gov_count int;',
    '  invalid_official_count int;',
    'BEGIN',
    '  -- 0. Check for legacy rows needing reconciliation',
    '  SELECT count(*) INTO legacy_count FROM cities WHERE source_code IS NULL;',
    '',
    '  IF legacy_count > 0 THEN',
    '    -- Check for duplicate legacy identities in the database before modifying data',
    '    SELECT count(*) INTO duplicate_count FROM (',
    '      SELECT lower(trim(governorate)), lower(trim(name_english))',
    '      FROM cities',
    '      WHERE source_code IS NULL',
    '      GROUP BY lower(trim(governorate)), lower(trim(name_english))',
    '      HAVING count(*) > 1',
    '    ) sub;',
    '',
    '    IF duplicate_count > 0 THEN',
    `      RAISE EXCEPTION 'City reconciliation aborted: duplicate legacy city identities found in database';`,
    '    END IF;',
    '',
    '    -- 1. Apply reviewed legacy mappings to preserve existing primary key UUIDs',
  ];

  for (const m of mappings) {
    if (m.targetSourceCode && catalogByCode.has(m.targetSourceCode)) {
      const off = catalogByCode.get(m.targetSourceCode)!;
      const dbValues = mapCatalogRecordToDbValues(off);
      lines.push(
        `    UPDATE cities SET ` +
          `source_code = '${escapeSqlString(dbValues.sourceCode)}', ` +
          `name_english = '${escapeSqlString(dbValues.nameEnglish)}', ` +
          `name_arabic = '${escapeSqlString(dbValues.nameArabic)}', ` +
          `governorate = '${escapeSqlString(dbValues.governorate)}', ` +
          `source_name_english = '${escapeSqlString(dbValues.sourceNameEnglish)}', ` +
          `source_name_arabic = '${escapeSqlString(dbValues.sourceNameArabic)}', ` +
          `status = '${escapeSqlString(dbValues.status)}', ` +
          `center_point = ST_SetSRID(ST_MakePoint(${dbValues.longitude}, ${dbValues.latitude}), 4326) ` +
          `WHERE lower(trim(governorate)) = lower('${escapeSqlString(m.legacyGovernorate.trim())}') ` +
          `AND lower(trim(name_english)) = lower('${escapeSqlString(m.legacyNameEnglish.trim())}') ` +
          `AND source_code IS NULL;`,
      );
      lines.push('    GET DIAGNOSTICS matched_count = ROW_COUNT;');
      lines.push('    IF matched_count = 0 THEN');
      lines.push(
        `      RAISE EXCEPTION 'City reconciliation aborted: reviewed mapping for % in % matched 0 legacy rows', '${escapeSqlString(m.legacyNameEnglish)}', '${escapeSqlString(m.legacyGovernorate)}';`,
      );
      lines.push('    ELSIF matched_count > 1 THEN');
      lines.push(
        `      RAISE EXCEPTION 'City reconciliation aborted: reviewed mapping for % in % matched % legacy rows (expected 1)', '${escapeSqlString(m.legacyNameEnglish)}', '${escapeSqlString(m.legacyGovernorate)}', matched_count;`,
      );
      lines.push('    END IF;');
    }
  }

  lines.push('');
  lines.push('    -- 2. Mark any unmapped legacy cities as LEGACY (preserving UUIDs and foreign keys)');
  lines.push(`    UPDATE cities SET status = 'LEGACY' WHERE source_code IS NULL;`);
  lines.push('  END IF;');
  lines.push('');
  lines.push('  -- 3. Update denormalized governorate values in posts for matched official cities');
  lines.push(
    `  UPDATE posts SET governorate = cities.governorate FROM cities WHERE posts.city_id = cities.id AND cities.status = 'OFFICIAL';`,
  );
  lines.push('');
  lines.push(`  -- 4. Insert missing official cities and apply canonical updates to existing official cities`);

  for (const off of catalogRecords) {
    const dbValues = mapCatalogRecordToDbValues(off);
    lines.push(
      `  INSERT INTO cities (` +
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
        `center_point = EXCLUDED.center_point;`,
    );
  }

  lines.push('');
  lines.push(
    `  -- 5. Verification checks: assert exactly ${expectedOfficialCount} official cities and ${expectedGovCount} governorates`,
  );
  lines.push('  SELECT');
  lines.push(`    count(*) FILTER (WHERE status = 'OFFICIAL'),`);
  lines.push(`    count(DISTINCT governorate) FILTER (WHERE status = 'OFFICIAL'),`);
  lines.push(`    count(*) FILTER (WHERE status = 'OFFICIAL' AND source_code IS NULL)`);
  lines.push('  INTO official_count, gov_count, invalid_official_count');
  lines.push('  FROM cities;');
  lines.push('');
  lines.push(`  IF official_count != ${expectedOfficialCount} THEN`);
  lines.push(
    `    RAISE EXCEPTION 'City reconciliation verification failed: expected ${expectedOfficialCount} official cities, found %', official_count;`,
  );
  lines.push('  END IF;');
  lines.push(`  IF gov_count != ${expectedGovCount} THEN`);
  lines.push(
    `    RAISE EXCEPTION 'City reconciliation verification failed: expected ${expectedGovCount} governorates, found %', gov_count;`,
  );
  lines.push('  END IF;');
  lines.push('  IF invalid_official_count != 0 THEN');
  lines.push(
    `    RAISE EXCEPTION 'City reconciliation verification failed: found % official cities without source_code', invalid_official_count;`,
  );
  lines.push('  END IF;');
  lines.push('END $$;');
  lines.push('');

  return lines.join('\n');
}

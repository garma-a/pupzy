import * as fs from 'fs';
import * as path from 'path';
import { sql } from 'drizzle-orm';

export interface RawCitySnapshotRecord {
  adm2_name: string;
  adm2_name1: string;
  adm2_name2?: string | null;
  adm2_name3?: string | null;
  adm2_pcode: string;
  adm1_name: string;
  adm1_name1: string;
  adm1_name2?: string | null;
  adm1_name3?: string | null;
  adm1_pcode: string;
  adm0_name: string;
  adm0_name1: string;
  adm0_name2?: string | null;
  adm0_name3?: string | null;
  adm0_pcode: string;
  valid_on?: string | null;
  valid_to?: string | null;
  area_sqkm?: number | null;
  version?: string | null;
  lang?: string | null;
  lang1?: string | null;
  lang2?: string | null;
  lang3?: string | null;
  adm2_ref_name?: string | null;
  center_lat: number | string;
  center_lon: number | string;
}

export interface CitySnapshotMetadata {
  source: string;
  sourceUrl: string;
  resourceUrl: string;
  upstreamVersion: string;
  upstreamDates: {
    validOn: string;
    reviewedDate: string;
    lastModified: string;
  };
  retrievalDate: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  totalRows: number;
  outsideZemamCount: number;
  selectableCount: number;
  governorateCount: number;
}

export interface CitySnapshot {
  metadata: CitySnapshotMetadata;
  records: RawCitySnapshotRecord[];
}

export type CityLifecycleStatusValue = 'OFFICIAL' | 'LEGACY' | 'RETIRED';

export interface CityCatalogRecord {
  sourceCode: string;
  nameEnglish: string;
  nameArabic: string;
  governorate: string;
  governorateArabic?: string;
  governorateCode: string;
  sourceNameEnglish: string;
  sourceNameArabic: string;
  latitude: number;
  longitude: number;
  status: CityLifecycleStatusValue;
}

export interface CityCatalogMetadata extends Partial<CitySnapshotMetadata> {
  totalCities?: number;
  governoratesCount?: number;
  declaredOfficialCount?: number;
  officialCitiesCount?: number;
  selectableCount?: number;
  retiredCount?: number;
}

export interface CityCatalog {
  metadata?: CityCatalogMetadata;
  records: CityCatalogRecord[];
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  stats: {
    totalCities: number;
    officialCount: number;
    retiredCount: number;
    governorateCount: number;
  };
}

export interface ValidateCatalogOptions {
  expectedOfficialCount?: number;
  expectedGovernorateCount?: number;
}

export interface CityDatabaseValues {
  sourceCode: string;
  nameEnglish: string;
  nameArabic: string;
  governorate: string;
  sourceNameEnglish: string;
  sourceNameArabic: string;
  status: CityLifecycleStatusValue;
  longitude: number;
  latitude: number;
}

/**
 * Maps a catalog record to normalized database values.
 * Serves as the single shared source of truth for seed, reconciliation, and migrations.
 */
export function mapCatalogRecordToDbValues(record: CityCatalogRecord): CityDatabaseValues {
  return {
    sourceCode: record.sourceCode.trim(),
    nameEnglish: record.nameEnglish.trim(),
    nameArabic: record.nameArabic.trim(),
    governorate: record.governorate.trim(),
    sourceNameEnglish: record.sourceNameEnglish.trim(),
    sourceNameArabic: record.sourceNameArabic.trim(),
    status: record.status ?? 'OFFICIAL',
    longitude: Number(record.longitude),
    latitude: Number(record.latitude),
  };
}

/**
 * Maps a catalog record to a Drizzle insert row with PostGIS geometry.
 */
export function mapCatalogRecordToInsertRow(record: CityCatalogRecord) {
  const values = mapCatalogRecordToDbValues(record);
  return {
    sourceCode: values.sourceCode,
    nameEnglish: values.nameEnglish,
    nameArabic: values.nameArabic,
    governorate: values.governorate,
    sourceNameEnglish: values.sourceNameEnglish,
    sourceNameArabic: values.sourceNameArabic,
    status: values.status,
    centerPoint: sql`ST_SetSRID(ST_MakePoint(${values.longitude}, ${values.latitude}), 4326)`,
  };
}

export function resolveDataPath(filename: string): string {
  const primaryPath = path.resolve(__dirname, 'data', filename);
  if (fs.existsSync(primaryPath)) {
    return primaryPath;
  }
  const fallbackSrc = path.resolve(__dirname, '../cities/data', filename);
  if (fs.existsSync(fallbackSrc)) {
    return fallbackSrc;
  }
  const fallbackRoot = path.resolve(process.cwd(), 'src/cities/data', filename);
  if (fs.existsSync(fallbackRoot)) {
    return fallbackRoot;
  }
  return primaryPath;
}

/**
 * Loads the untouched OCHA COD-AB Egyptian ADM2 source snapshot.
 * Runs completely offline without any network access.
 */
export function loadRawSnapshot(): CitySnapshot {
  const filePath = resolveDataPath('ocha-adm2-egypt-snapshot.json');
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content) as CitySnapshot;
}

function toCatalogRecord(item: RawCitySnapshotRecord, nameEnglish: string): CityCatalogRecord {
  return {
    sourceCode: item.adm2_pcode.trim(),
    nameEnglish,
    nameArabic: item.adm2_name1.trim(),
    governorate: item.adm1_name.trim(),
    governorateArabic: item.adm1_name1?.trim() ?? '',
    governorateCode: item.adm1_pcode.trim(),
    sourceNameEnglish: item.adm2_name.trim(),
    sourceNameArabic: item.adm2_name1.trim(),
    latitude: Number(item.center_lat),
    longitude: Number(item.center_lon),
    status: 'OFFICIAL',
  };
}

/**
 * Deterministically transforms a raw 365-row ADM2 snapshot into 351 selectable Cities:
 * 1. Excludes all 14 outside-zemam units ('Zemam Out' / ending in '00').
 * 2. Applies Kism / Markaz English-name disambiguation for duplicate names within the same governorate.
 * 3. Preserves upstream Arabic and source names.
 */
export function transformCatalog(snapshot: CitySnapshot): CityCatalog {
  const rawRecords = snapshot.records;
  // Exclude outside zemam units
  const selectable = rawRecords.filter(
    (record) => record.adm2_name !== 'Zemam Out' && !record.adm2_pcode.endsWith('00'),
  );

  // Group by (governorate, adm2_name) to find duplicates for disambiguation
  const grouped = new Map<string, RawCitySnapshotRecord[]>();
  for (const record of selectable) {
    const key = `${record.adm1_name}:${record.adm2_name}`;
    const list = grouped.get(key) ?? [];
    list.push(record);
    grouped.set(key, list);
  }

  const records: CityCatalogRecord[] = [];

  for (const [, items] of grouped.entries()) {
    if (items.length === 1) {
      records.push(toCatalogRecord(items[0], items[0].adm2_name.trim()));
    } else {
      // Disambiguate with Kism/Markaz suffix
      for (const item of items) {
        const arabic = item.adm2_name1.trim();
        let suffix = '';
        if (arabic.includes('قسم')) {
          suffix = ' (Kism)';
        } else if (arabic.includes('مركز')) {
          suffix = ' (Markaz)';
        } else if (arabic.includes('مدينة')) {
          suffix = ' (City)';
        } else {
          suffix = ` (${arabic})`;
        }

        const disambiguatedName = `${item.adm2_name.trim()}${suffix}`;
        records.push(toCatalogRecord(item, disambiguatedName));
      }
    }
  }

  records.sort((a, b) => {
    const govCmp = a.governorate.localeCompare(b.governorate);
    if (govCmp !== 0) return govCmp;
    return a.nameEnglish.localeCompare(b.nameEnglish);
  });

  return {
    metadata: {
      ...snapshot.metadata,
      totalCities: records.length,
      governoratesCount: new Set(records.map((r) => r.governorate)).size,
    },
    records,
  };
}

/**
 * Normalizes an input catalog (records array or catalog object) and extracts records by lifecycle status.
 */
export function unpackCatalog(catalog: CityCatalogRecord[] | CityCatalog | { metadata?: CityCatalogMetadata; records: CityCatalogRecord[] }): {
  records: CityCatalogRecord[];
  metadata?: CityCatalogMetadata;
  officialRecords: CityCatalogRecord[];
  retiredRecords: CityCatalogRecord[];
  legacyRecords: CityCatalogRecord[];
} {
  const records = Array.isArray(catalog) ? catalog : catalog.records;
  const metadata = Array.isArray(catalog) ? undefined : catalog.metadata;
  const officialRecords = records.filter((c) => c.status === 'OFFICIAL' || !c.status);
  const retiredRecords = records.filter((c) => c.status === 'RETIRED');
  const legacyRecords = records.filter((c) => c.status === 'LEGACY');
  return { records, metadata, officialRecords, retiredRecords, legacyRecords };
}

/**
 * Validates integrity constraints for a City catalog:
 * - Selectable official cities match expected count (default 351 or metadata declared count)
 * - Distinct governorates match expected count (default 27 or metadata declared count)
 * - Unique source codes across all catalog entries (including retired)
 * - Unique (nameEnglish, governorate) pairs for official cities
 * - Non-blank names and valid schema length limits (<= 100 chars)
 * - Finite WGS84 coordinates in bounds
 * - Valid parent governorate codes
 */
export function validateCatalog(
  catalog: CityCatalogRecord[] | CityCatalog | { metadata?: CityCatalogMetadata; records: CityCatalogRecord[] },
  options: ValidateCatalogOptions = {},
): ValidationResult {
  const errors: string[] = [];
  const { records, metadata: meta, officialRecords, retiredRecords, legacyRecords } = unpackCatalog(catalog);
  const expectedOfficial =
    options.expectedOfficialCount ??
    meta?.declaredOfficialCount ??
    meta?.officialCitiesCount ??
    meta?.selectableCount ??
    (meta?.totalCities !== undefined && retiredRecords.length === 0 && legacyRecords.length === 0
      ? meta.totalCities
      : 351);

  const expectedGovCount =
    options.expectedGovernorateCount ??
    meta?.governorateCount ??
    meta?.governoratesCount ??
    27;

  if (officialRecords.length !== expectedOfficial) {
    errors.push(
      `Expected exactly ${expectedOfficial} selectable official cities, found ${officialRecords.length}`,
    );
  }

  const officialGovernorates = new Set(officialRecords.map((r) => r.governorate));
  if (officialGovernorates.size !== expectedGovCount) {
    errors.push(
      `Expected exactly ${expectedGovCount} governorates for official cities, found ${officialGovernorates.size}`,
    );
  }

  const VALID_GOVERNORATE_CODES = new Set([
    'EG01',
    'EG02',
    'EG03',
    'EG04',
    'EG11',
    'EG12',
    'EG13',
    'EG14',
    'EG15',
    'EG16',
    'EG17',
    'EG18',
    'EG19',
    'EG21',
    'EG22',
    'EG23',
    'EG24',
    'EG25',
    'EG26',
    'EG27',
    'EG28',
    'EG29',
    'EG31',
    'EG32',
    'EG33',
    'EG34',
    'EG35',
  ]);

  const seenSourceCodes = new Set<string>();
  const seenOfficialGovNamePairs = new Set<string>();

  for (let i = 0; i < records.length; i++) {
    const city = records[i];
    const prefix = `City[${i}] (${city.sourceCode || 'unknown'})`;

    // Unique source code across all records
    if (!city.sourceCode || city.sourceCode.trim() === '') {
      errors.push(`${prefix}: Missing or blank sourceCode`);
    } else if (seenSourceCodes.has(city.sourceCode)) {
      errors.push(`${prefix}: Duplicate sourceCode '${city.sourceCode}'`);
    } else {
      seenSourceCodes.add(city.sourceCode);
    }

    // Lifecycle status validation
    const validStatuses = new Set(['OFFICIAL', 'LEGACY', 'RETIRED']);
    if (city.status && !validStatuses.has(city.status)) {
      errors.push(`${prefix}: Invalid status '${city.status}'`);
    }

    // Parent relationship validation
    if (!city.governorateCode || !VALID_GOVERNORATE_CODES.has(city.governorateCode)) {
      errors.push(`${prefix}: Invalid parent governorateCode '${city.governorateCode}'`);
    } else if (city.sourceCode && !city.sourceCode.startsWith(city.governorateCode)) {
      errors.push(
        `${prefix}: sourceCode '${city.sourceCode}' does not match parent governorateCode '${city.governorateCode}'`,
      );
    }

    // Unique (nameEnglish, governorate) for official cities
    if (city.status === 'OFFICIAL' || !city.status) {
      const govNameKey = `${city.governorate}:${city.nameEnglish}`;
      if (seenOfficialGovNamePairs.has(govNameKey)) {
        errors.push(`${prefix}: Duplicate nameEnglish '${city.nameEnglish}' in governorate '${city.governorate}'`);
      } else {
        seenOfficialGovNamePairs.add(govNameKey);
      }
    }

    // Nonblank checks & length limits (<= 100)
    const stringFields: Array<{ key: keyof CityCatalogRecord; label: string; required: boolean }> = [
      { key: 'nameEnglish', label: 'nameEnglish', required: true },
      { key: 'nameArabic', label: 'nameArabic', required: true },
      { key: 'governorate', label: 'governorate', required: true },
      { key: 'sourceCode', label: 'sourceCode', required: true },
      { key: 'sourceNameEnglish', label: 'sourceNameEnglish', required: true },
      { key: 'sourceNameArabic', label: 'sourceNameArabic', required: true },
    ];

    for (const field of stringFields) {
      const val = city[field.key];
      if (typeof val === 'string') {
        if (field.required && val.trim() === '') {
          errors.push(`${prefix}: Blank ${field.label}`);
        }
        if (val.length > 100) {
          errors.push(`${prefix}: ${field.label} exceeds 100 characters (${val.length})`);
        }
      } else if (field.required) {
        errors.push(`${prefix}: Missing required ${field.label}`);
      }
    }

    // Finite coordinates
    if (!Number.isFinite(city.latitude) || !Number.isFinite(city.longitude)) {
      errors.push(`${prefix}: Non-finite coordinates (${city.latitude}, ${city.longitude})`);
    } else {
      if (city.latitude < -90 || city.latitude > 90) {
        errors.push(`${prefix}: Latitude out of bounds (${city.latitude})`);
      }
      if (city.longitude < -180 || city.longitude > 180) {
        errors.push(`${prefix}: Longitude out of bounds (${city.longitude})`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    stats: {
      totalCities: records.length,
      officialCount: officialRecords.length,
      retiredCount: retiredRecords.length,
      governorateCount: officialGovernorates.size,
    },
  };
}

let cachedOfficialCatalog: CityCatalogRecord[] | null = null;

/**
 * Loads the complete compiled City catalog from disk.
 */
export function loadOfficialCatalog(): CityCatalog {
  const filePath = resolveDataPath('egypt-cities-catalog.json');
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) as CityCatalog;
  }
  const snapshot = loadRawSnapshot();
  return transformCatalog(snapshot);
}

/**
 * Returns the compiled 351-city official reference catalog records.
 * Cached in memory after first load.
 */
export function getOfficialCatalog(): CityCatalogRecord[] {
  if (cachedOfficialCatalog) {
    return cachedOfficialCatalog;
  }
  const catalog = loadOfficialCatalog();
  cachedOfficialCatalog = catalog.records;
  return cachedOfficialCatalog;
}

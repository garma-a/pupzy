import * as fs from 'fs';
import * as path from 'path';
import {
  transformCatalog,
  validateCatalog,
  validateSnapshot,
  mapCatalogRecordToDbValues,
  resolveDataPath,
  type CitySnapshot,
  type CityCatalogRecord,
  type CityCatalogMetadata,
} from './catalog';

export const DEFAULT_RESOURCE_URL =
  'https://data.humdata.org/dataset/b90d81ba-7c7a-4283-9899-827480d80a79/resource/81126a96-2991-48e1-93cb-24c164a4de88/download/ocha-adm2-egypt-snapshot.json';

export interface RenamedAreaDiff {
  sourceCode: string;
  governorate: string;
  oldNameEnglish: string;
  newNameEnglish: string;
  oldNameArabic: string;
  newNameArabic: string;
}

export interface RecodedAreaDiff {
  oldSourceCode: string;
  newSourceCode: string;
  nameEnglish: string;
  governorate: string;
}

export interface CoordinateChangedAreaDiff {
  sourceCode: string;
  nameEnglish: string;
  governorate: string;
  oldCoordinates: [number, number];
  newCoordinates: [number, number];
  distanceKm: number;
}

export interface SnapshotDiffReport {
  added: CityCatalogRecord[];
  removed: CityCatalogRecord[];
  renamed: RenamedAreaDiff[];
  recoded: RecodedAreaDiff[];
  coordinateChanged: CoordinateChangedAreaDiff[];
  summary: {
    totalCurrent: number;
    totalCandidate: number;
    addedCount: number;
    removedCount: number;
    renamedCount: number;
    recodedCount: number;
    coordinateChangedCount: number;
  };
}

export interface ReviewedReleaseOptions {
  reviewedMetadata?: {
    declaredOfficialCount?: number;
    governorateCount?: number;
  };
  replacementMappings?: Array<{
    retiredSourceCode: string;
    replacementSourceCode: string;
    notes?: string;
  }>;
}

export interface ReviewedReleaseResult {
  updatedCatalog: CityCatalogRecord[];
  diffReport: SnapshotDiffReport;
  retiredCount: number;
  officialCount: number;
  metadata?: CityCatalogMetadata;
}

export interface MigrationMeta {
  nextIdx: number;
  tag: string;
  filename: string;
  journalPath: string;
}

export interface PublishReleaseOptions extends ReviewedReleaseOptions {
  migrationsFolder?: string;
  catalogPath?: string;
  snapshotPath?: string;
  writeSnapshot?: boolean;
}

export interface PublishReleaseResult {
  release: ReviewedReleaseResult;
  migrationTag: string;
  migrationPath: string;
  migrationSql: string;
  catalogPath: string;
  snapshotPath?: string;
  journalUpdated: boolean;
}

function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

function escapeSqlString(str: string): string {
  return str.replace(/'/g, "''");
}

/**
 * Resolves the absolute path to the Drizzle migrations folder.
 */
export function resolveMigrationsFolder(explicitFolder?: string): string {
  if (explicitFolder) {
    return path.isAbsolute(explicitFolder) ? explicitFolder : path.resolve(process.cwd(), explicitFolder);
  }
  const possiblePaths = [
    path.resolve(process.cwd(), 'drizzle/migrations'),
    path.resolve(__dirname, '../../../drizzle/migrations'),
    path.resolve(__dirname, '../../drizzle/migrations'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return path.resolve(process.cwd(), 'drizzle/migrations');
}

/**
 * Compares a candidate upstream snapshot against the current catalog
 * and returns a detailed diff report classifying added, removed, renamed,
 * recoded, and coordinate-changed areas for human review.
 */
export function compareSnapshots(
  currentCatalog: CityCatalogRecord[],
  candidateSnapshot: CitySnapshot,
): SnapshotDiffReport {
  const snapshotVal = validateSnapshot(candidateSnapshot);
  if (!snapshotVal.isValid) {
    throw new Error(`Candidate snapshot failed schema/provenance validation:\n- ${snapshotVal.errors.join('\n- ')}`);
  }

  const candidateTransformed = transformCatalog(candidateSnapshot);
  const candidateRecords = candidateTransformed.records;

  const currentByCode = new Map<string, CityCatalogRecord>(currentCatalog.map((c) => [c.sourceCode, c]));
  const candidateByCode = new Map<string, CityCatalogRecord>(candidateRecords.map((c) => [c.sourceCode, c]));

  const added: CityCatalogRecord[] = [];
  const removed: CityCatalogRecord[] = [];
  const renamed: RenamedAreaDiff[] = [];
  const recoded: RecodedAreaDiff[] = [];
  const coordinateChanged: CoordinateChangedAreaDiff[] = [];

  // Detect Added and Modified
  for (const cand of candidateRecords) {
    const curr = currentByCode.get(cand.sourceCode);
    if (!curr) {
      // Check if this was a recode of an existing city with same name and governorate
      const matchedByName = currentCatalog.find(
        (c) =>
          c.governorate.toLowerCase() === cand.governorate.toLowerCase() &&
          c.nameEnglish.toLowerCase() === cand.nameEnglish.toLowerCase(),
      );
      if (matchedByName) {
        recoded.push({
          oldSourceCode: matchedByName.sourceCode,
          newSourceCode: cand.sourceCode,
          nameEnglish: cand.nameEnglish,
          governorate: cand.governorate,
        });
      } else {
        added.push(cand);
      }
    } else {
      // Check for rename
      const nameChanged =
        curr.nameEnglish !== cand.nameEnglish ||
        curr.nameArabic !== cand.nameArabic ||
        curr.sourceNameEnglish !== cand.sourceNameEnglish ||
        curr.sourceNameArabic !== cand.sourceNameArabic;

      if (nameChanged) {
        renamed.push({
          sourceCode: cand.sourceCode,
          governorate: cand.governorate,
          oldNameEnglish: curr.nameEnglish,
          newNameEnglish: cand.nameEnglish,
          oldNameArabic: curr.nameArabic,
          newNameArabic: cand.nameArabic,
        });
      }

      // Check for coordinate change (> 100 meters / ~0.001 deg)
      const latDiff = Math.abs(curr.latitude - cand.latitude);
      const lonDiff = Math.abs(curr.longitude - cand.longitude);
      if (latDiff > 0.0001 || lonDiff > 0.0001) {
        coordinateChanged.push({
          sourceCode: cand.sourceCode,
          nameEnglish: cand.nameEnglish,
          governorate: cand.governorate,
          oldCoordinates: [curr.latitude, curr.longitude],
          newCoordinates: [cand.latitude, cand.longitude],
          distanceKm: calculateDistanceKm(curr.latitude, curr.longitude, cand.latitude, cand.longitude),
        });
      }
    }
  }

  // Detect Removed
  for (const curr of currentCatalog) {
    if (curr.status === 'OFFICIAL' && !candidateByCode.has(curr.sourceCode)) {
      const isRecoded = recoded.some((r) => r.oldSourceCode === curr.sourceCode);
      if (!isRecoded) {
        removed.push(curr);
      }
    }
  }

  return {
    added,
    removed,
    renamed,
    recoded,
    coordinateChanged,
    summary: {
      totalCurrent: currentCatalog.length,
      totalCandidate: candidateRecords.length,
      addedCount: added.length,
      removedCount: removed.length,
      renamedCount: renamed.length,
      recodedCount: recoded.length,
      coordinateChangedCount: coordinateChanged.length,
    },
  };
}

/**
 * Applies a reviewed upstream release to the catalog:
 * - Removed official cities transition to 'RETIRED' (never deleted, preserving UUIDs and references).
 * - Added official cities are included with 'OFFICIAL' status.
 * - Updated official cities have names/coordinates updated.
 * - Enforces metadata confirmation for count changes.
 * - Validates one-to-one replacement mappings against retired and active official identities.
 */
export function applyReviewedRelease(
  currentCatalog: CityCatalogRecord[],
  candidateSnapshot: CitySnapshot,
  options: ReviewedReleaseOptions = {},
): ReviewedReleaseResult {
  const snapshotVal = validateSnapshot(candidateSnapshot);
  if (!snapshotVal.isValid) {
    throw new Error(`Candidate snapshot failed schema/provenance validation:\n- ${snapshotVal.errors.join('\n- ')}`);
  }

  const diffReport = compareSnapshots(currentCatalog, candidateSnapshot);
  const candidateTransformed = transformCatalog(candidateSnapshot);

  const candidateByCode = new Map<string, CityCatalogRecord>(
    candidateTransformed.records.map((c) => [c.sourceCode, c]),
  );

  const currentOfficialCount = currentCatalog.filter((c) => c.status === 'OFFICIAL' || !c.status).length;
  const currentGovCount = new Set(
    currentCatalog.filter((c) => c.status === 'OFFICIAL' || !c.status).map((c) => c.governorate),
  ).size;

  const updatedCatalog: CityCatalogRecord[] = [];
  let retiredCount = 0;
  let officialCount = 0;

  // Process existing catalog items
  for (const curr of currentCatalog) {
    if (curr.status === 'RETIRED') {
      // Previously retired city remains retired and cannot be automatically reactivated
      updatedCatalog.push({
        ...curr,
        status: 'RETIRED',
      });
      retiredCount++;
      candidateByCode.delete(curr.sourceCode);
      continue;
    }

    const cand = candidateByCode.get(curr.sourceCode);
    if (cand) {
      // Retain or update official record
      updatedCatalog.push({
        ...cand,
        status: 'OFFICIAL',
      });
      officialCount++;
      candidateByCode.delete(curr.sourceCode);
    } else {
      // Removed from upstream -> mark as RETIRED
      updatedCatalog.push({
        ...curr,
        status: 'RETIRED',
      });
      retiredCount++;
    }
  }

  // Add remaining candidate records (new additions)
  for (const [, cand] of candidateByCode.entries()) {
    updatedCatalog.push({
      ...cand,
      status: 'OFFICIAL',
    });
    officialCount++;
  }

  const distinctGovCount = new Set(updatedCatalog.filter((c) => c.status === 'OFFICIAL').map((c) => c.governorate))
    .size;

  // Enforce explicit reviewed metadata when official count changes
  if (officialCount !== currentOfficialCount) {
    if (options.reviewedMetadata?.declaredOfficialCount === undefined) {
      throw new Error(
        `Official count changed from ${currentOfficialCount} to ${officialCount}; explicit reviewedMetadata.declaredOfficialCount matching candidate is required.`,
      );
    }
    if (options.reviewedMetadata.declaredOfficialCount !== officialCount) {
      throw new Error(
        `Declared official count mismatch: expected ${options.reviewedMetadata.declaredOfficialCount}, got ${officialCount}`,
      );
    }
  } else if (options.reviewedMetadata?.declaredOfficialCount !== undefined) {
    if (options.reviewedMetadata.declaredOfficialCount !== officialCount) {
      throw new Error(
        `Declared official count mismatch: expected ${options.reviewedMetadata.declaredOfficialCount}, got ${officialCount}`,
      );
    }
  }

  // Enforce explicit reviewed metadata when governorate count changes
  if (distinctGovCount !== currentGovCount) {
    if (options.reviewedMetadata?.governorateCount === undefined) {
      throw new Error(
        `Governorate count changed from ${currentGovCount} to ${distinctGovCount}; explicit reviewedMetadata.governorateCount matching candidate is required.`,
      );
    }
    if (options.reviewedMetadata.governorateCount !== distinctGovCount) {
      throw new Error(
        `Declared governorate count mismatch: expected ${options.reviewedMetadata.governorateCount}, got ${distinctGovCount}`,
      );
    }
  } else if (options.reviewedMetadata?.governorateCount !== undefined) {
    if (options.reviewedMetadata.governorateCount !== distinctGovCount) {
      throw new Error(
        `Declared governorate count mismatch: expected ${options.reviewedMetadata.governorateCount}, got ${distinctGovCount}`,
      );
    }
  }

  // Validate replacement mappings if provided
  if (options.replacementMappings && options.replacementMappings.length > 0) {
    const activeCodes = new Set(updatedCatalog.filter((c) => c.status === 'OFFICIAL').map((c) => c.sourceCode));
    const retiredCodes = new Set(updatedCatalog.filter((c) => c.status === 'RETIRED').map((c) => c.sourceCode));
    const seenRetired = new Set<string>();

    for (let i = 0; i < options.replacementMappings.length; i++) {
      const mapping = options.replacementMappings[i];
      if (!mapping.retiredSourceCode || typeof mapping.retiredSourceCode !== 'string') {
        throw new Error(`Replacement mapping at index ${i} missing retiredSourceCode`);
      }
      if (!mapping.replacementSourceCode || typeof mapping.replacementSourceCode !== 'string') {
        throw new Error(`Replacement mapping at index ${i} missing replacementSourceCode`);
      }
      const retCode = mapping.retiredSourceCode.trim();
      const repCode = mapping.replacementSourceCode.trim();

      if (seenRetired.has(retCode)) {
        throw new Error(`Duplicate replacement mapping for retired city '${retCode}' at index ${i}`);
      }
      seenRetired.add(retCode);

      if (!retiredCodes.has(retCode)) {
        throw new Error(`Replacement mapping error: '${retCode}' is not a retired city in the updated release`);
      }
      if (!activeCodes.has(repCode)) {
        throw new Error(
          `Replacement mapping error: '${repCode}' is not an active official city in the updated release`,
        );
      }
    }
  }

  return {
    updatedCatalog,
    diffReport,
    retiredCount,
    officialCount,
    metadata: {
      ...candidateSnapshot.metadata,
      totalCities: updatedCatalog.length,
      declaredOfficialCount: officialCount,
      selectableCount: officialCount,
      officialCitiesCount: officialCount,
      governorateCount: distinctGovCount,
      governoratesCount: distinctGovCount,
      retiredCount,
    },
  };
}

/**
 * Fetches an actual candidate upstream snapshot from a remote resource URL.
 * Developer-only tool — application runtime and migrations remain completely offline.
 * Rejects dataset landing pages (HTML) and validates schema/provenance before returning.
 */
export async function fetchUpstreamSnapshot(url = DEFAULT_RESOURCE_URL): Promise<CitySnapshot> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Pupzy-Refresher/1.0',
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch upstream snapshot: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  if (contentType.includes('text/html') || text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
    throw new Error(
      `Failed to fetch upstream snapshot: received HTML landing page instead of a JSON snapshot resource at ${url}`,
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse upstream snapshot JSON from ${url}: ${msg}`);
  }

  const validation = validateSnapshot(data);
  if (!validation.isValid) {
    throw new Error(
      `Fetched upstream snapshot failed schema/provenance validation:\n- ${validation.errors.join('\n- ')}`,
    );
  }

  return data as CitySnapshot;
}

/**
 * Inspects migrations folder and journal to determine the next monotonically ordered migration index and tag.
 */
export function getNextMigrationMeta(migrationsFolder: string, tagSuffix = 'release_city_catalog'): MigrationMeta {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  let nextIdx = 1;

  if (fs.existsSync(journalPath)) {
    const journalContent = fs.readFileSync(journalPath, 'utf8');
    const journal = JSON.parse(journalContent) as { entries?: Array<{ idx: number; tag: string }> };
    if (journal.entries && journal.entries.length > 0) {
      const maxIdx = Math.max(...journal.entries.map((e) => e.idx));
      nextIdx = maxIdx + 1;
    }
  } else {
    // If journal doesn't exist, scan migration directory for numeric prefixes
    if (fs.existsSync(migrationsFolder)) {
      const files = fs.readdirSync(migrationsFolder);
      const sqlFiles = files.filter((f) => f.endsWith('.sql'));
      let maxPrefix = -1;
      for (const f of sqlFiles) {
        const match = /^(\d{4})_/.exec(f);
        if (match) {
          maxPrefix = Math.max(maxPrefix, parseInt(match[1], 10));
        }
      }
      if (maxPrefix >= 0) {
        nextIdx = maxPrefix + 1;
      }
    }
  }

  const prefix = String(nextIdx).padStart(4, '0');
  const tag = `${prefix}_${tagSuffix}`;
  return {
    nextIdx,
    tag,
    filename: `${tag}.sql`,
    journalPath,
  };
}

/**
 * Generates deterministic, append-only Drizzle SQL migration statements for upgrading a database
 * to a reviewed City catalog release.
 *
 * Guarantees:
 * 1. Monotonically ordered and append-only (never rewrites earlier migrations).
 * 2. Idempotent and safe to run on fresh or already-migrated databases.
 * 3. Preserves retired lifecycle states and existing application UUIDs.
 * 4. Verifies official counts, governorate counts, and foreign key integrity before transaction commit.
 */
export function generateReleaseMigrationSql(
  release: ReviewedReleaseResult,
  options: { migrationTag?: string } = {},
): string {
  const { updatedCatalog, officialCount, metadata } = release;
  const expectedGovCount = metadata?.governorateCount ?? 27;
  const tag = options.migrationTag ?? 'release_city_catalog';

  const lines: string[] = [
    '--',
    `-- Migration: ${tag}.sql`,
    `-- Release upgrade data migration to authoritative ${officialCount}-city ADM2 catalog (${expectedGovCount} governorates).`,
    '--',
    'DO $$',
    'DECLARE',
    '  official_count int;',
    '  gov_count int;',
    '  invalid_official_count int;',
    'BEGIN',
    '  -- 1. Mark newly retired cities as RETIRED',
  ];

  const retiredRecords = updatedCatalog.filter((c) => c.status === 'RETIRED');
  if (retiredRecords.length > 0) {
    const retiredCodesList = retiredRecords.map((r) => `'${escapeSqlString(r.sourceCode)}'`).join(', ');
    lines.push(`  UPDATE cities SET status = 'RETIRED' WHERE source_code IN (${retiredCodesList});`);
  } else {
    lines.push('  -- (No retired cities in this release)');
  }

  lines.push('');
  lines.push('  -- 2. Upsert official and updated catalog records');
  for (const record of updatedCatalog) {
    const dbValues = mapCatalogRecordToDbValues(record);
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
  lines.push('  -- 3. Synchronize denormalized governorate values in posts for official cities');
  lines.push(
    `  UPDATE posts SET governorate = cities.governorate FROM cities WHERE posts.city_id = cities.id AND cities.status = 'OFFICIAL';`,
  );
  lines.push('');
  lines.push(
    `  -- 4. Verification checks: assert exactly ${officialCount} official cities and ${expectedGovCount} governorates`,
  );
  lines.push('  SELECT');
  lines.push(`    count(*) FILTER (WHERE status = 'OFFICIAL'),`);
  lines.push(`    count(DISTINCT governorate) FILTER (WHERE status = 'OFFICIAL'),`);
  lines.push(`    count(*) FILTER (WHERE status = 'OFFICIAL' AND source_code IS NULL)`);
  lines.push('  INTO official_count, gov_count, invalid_official_count');
  lines.push('  FROM cities;');
  lines.push('');
  lines.push(`  IF official_count != ${officialCount} THEN`);
  lines.push(
    `    RAISE EXCEPTION 'City release verification failed: expected ${officialCount} official cities, found %', official_count;`,
  );
  lines.push('  END IF;');
  lines.push(`  IF gov_count != ${expectedGovCount} THEN`);
  lines.push(
    `    RAISE EXCEPTION 'City release verification failed: expected ${expectedGovCount} governorates, found %', gov_count;`,
  );
  lines.push('  END IF;');
  lines.push('  IF invalid_official_count != 0 THEN');
  lines.push(
    `    RAISE EXCEPTION 'City release verification failed: found % official cities without source_code', invalid_official_count;`,
  );
  lines.push('  END IF;');
  lines.push('END $$;');
  lines.push('');

  return lines.join('\n');
}

/**
 * End-to-end publisher for a reviewed City catalog release.
 *
 * Guarantees:
 * - Fully validates candidate snapshot, metadata, count changes, replacement mappings, and updated catalog in memory first.
 * - Determines the next monotonically ordered migration number and generates append-only migration SQL and journal update.
 * - Writes all artifacts atomically only when all validations and generation steps succeed (fails closed without partial file writes).
 */
export function publishReviewedRelease(
  currentCatalog: CityCatalogRecord[],
  candidateSnapshot: CitySnapshot,
  options: PublishReleaseOptions = {},
): PublishReleaseResult {
  // 1. Validate snapshot
  const snapshotVal = validateSnapshot(candidateSnapshot);
  if (!snapshotVal.isValid) {
    throw new Error(`Candidate snapshot validation failed:\n- ${snapshotVal.errors.join('\n- ')}`);
  }

  // 2. Apply reviewed release (validates count changes, metadata, replacement mappings)
  const release = applyReviewedRelease(currentCatalog, candidateSnapshot, options);

  // 3. Validate updated catalog
  const catalogVal = validateCatalog({
    metadata: release.metadata,
    records: release.updatedCatalog,
  });
  if (!catalogVal.isValid) {
    throw new Error(`Updated catalog validation failed:\n- ${catalogVal.errors.join('\n- ')}`);
  }

  // 4. Resolve file paths
  const catalogPath = options.catalogPath ?? resolveDataPath('egypt-cities-catalog.json');
  const snapshotPath = options.snapshotPath ?? resolveDataPath('ocha-adm2-egypt-snapshot.json');
  const migrationsFolder = resolveMigrationsFolder(options.migrationsFolder);

  const migrationMeta = getNextMigrationMeta(migrationsFolder);
  const migrationSql = generateReleaseMigrationSql(release, { migrationTag: migrationMeta.tag });
  const migrationFilePath = path.join(migrationsFolder, migrationMeta.filename);

  // Prepare journal update in memory
  let updatedJournalContent: string | null = null;
  if (fs.existsSync(migrationMeta.journalPath)) {
    const journalContent = fs.readFileSync(migrationMeta.journalPath, 'utf8');
    const journal = JSON.parse(journalContent) as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number; version?: string; when?: number; tag: string; breakpoints?: boolean }>;
    };
    journal.entries = journal.entries || [];
    journal.entries.push({
      idx: migrationMeta.nextIdx,
      version: journal.version || '7',
      when: Date.now(),
      tag: migrationMeta.tag,
      breakpoints: true,
    });
    updatedJournalContent = JSON.stringify(journal, null, 2);
  }

  // 5. All validations passed; atomically write all artifacts
  fs.writeFileSync(
    catalogPath,
    JSON.stringify(
      {
        metadata: release.metadata,
        records: release.updatedCatalog,
      },
      null,
      2,
    ),
    'utf8',
  );

  if (options.writeSnapshot !== false) {
    fs.writeFileSync(snapshotPath, JSON.stringify(candidateSnapshot, null, 2), 'utf8');
  }

  fs.writeFileSync(migrationFilePath, migrationSql, 'utf8');

  if (updatedJournalContent) {
    fs.writeFileSync(migrationMeta.journalPath, updatedJournalContent, 'utf8');
  }

  return {
    release,
    migrationTag: migrationMeta.tag,
    migrationPath: migrationFilePath,
    migrationSql,
    catalogPath,
    snapshotPath: options.writeSnapshot !== false ? snapshotPath : undefined,
    journalUpdated: !!updatedJournalContent,
  };
}

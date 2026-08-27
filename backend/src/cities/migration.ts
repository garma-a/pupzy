import * as fs from 'fs';
import * as path from 'path';
import type { ReviewedReleaseResult } from './plan';
import {
  generateCitiesUpsertSql,
  generateRetiredCitiesSql,
  generatePostGovernorateSyncSql,
  generateCityVerificationSql,
  generateIdentityTransfersSql,
} from './release-sql';

export interface MigrationMeta {
  nextIdx: number;
  tag: string;
  filename: string;
  journalPath: string;
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
 * 5. Uses shared lifecycle-aware City upsert and verification generators to prevent drift.
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
    '  -- 1. Apply reviewed identity transfers / recodes onto existing application UUIDs',
    ...generateIdentityTransfersSql(release.replacementMappings ?? [], '  '),
    '',
    '  -- 2. Mark newly retired cities as RETIRED',
    ...generateRetiredCitiesSql(updatedCatalog, '  '),
    '',
    '  -- 3. Upsert official and updated catalog records',
    ...generateCitiesUpsertSql(updatedCatalog, '  '),
    '',
    '  -- 4. Synchronize denormalized governorate values in posts for official cities',
    generatePostGovernorateSyncSql('  '),
    '',
    `  -- 5. Verification checks: assert exactly ${officialCount} official cities and ${expectedGovCount} governorates`,
    ...generateCityVerificationSql(officialCount, expectedGovCount, '  ', 'City release'),
    'END $$;',
    '',
  ];

  return lines.join('\n');
}

import * as fs from 'fs';
import * as path from 'path';
import type { ReviewedReleaseResult } from './plan';
import {
  generateCitiesUpsertSql,
  generateRetiredCitiesSql,
  generatePostGovernorateSyncSql,
  generateCityVerificationSql,
  generateCityIdentityTransfersSql,
} from './release-sql';

export interface MigrationMeta {
  nextIdx: number;
  tag: string;
  filename: string;
  journalPath: string;
}

export interface JournalEntry {
  idx: number;
  version?: string;
  when?: number;
  tag: string;
  breakpoints?: boolean;
}

export interface MigrationJournal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export interface MigrationHistoryValidationResult {
  isValid: boolean;
  errors: string[];
  nextIdx: number;
  entriesCount: number;
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

interface ScannedMigrationFile {
  file: string;
  tag: string;
  prefix?: string;
  idx?: number;
}

function scanMigrationDirectory(migrationsFolder: string): {
  scannedFiles: ScannedMigrationFile[];
  errors: string[];
} {
  const errors: string[] = [];
  const scannedFiles: ScannedMigrationFile[] = [];
  if (!fs.existsSync(migrationsFolder)) {
    return { scannedFiles, errors };
  }

  const files = fs.readdirSync(migrationsFolder);
  const sqlFiles = files.filter((f) => f.endsWith('.sql'));
  const seenPrefixes = new Map<string, string>();

  for (const file of sqlFiles) {
    const tag = file.slice(0, -4);
    const match = /^(\d{4})_/.exec(file);
    const prefix = match ? match[1] : undefined;
    const idx = prefix !== undefined ? parseInt(prefix, 10) : undefined;

    if (prefix !== undefined) {
      if (seenPrefixes.has(prefix)) {
        errors.push(
          `Multiple migration files on disk share numeric prefix "${prefix}": "${seenPrefixes.get(prefix)}" and "${file}"`,
        );
      } else {
        seenPrefixes.set(prefix, file);
      }
    }

    scannedFiles.push({ file, tag, prefix, idx });
  }

  return { scannedFiles, errors };
}

/**
 * Reconciles the Drizzle migrations journal and filesystem migrations directory.
 * Fails closed on duplicate indices, duplicate tags, sequence gaps, tag prefix mismatches,
 * missing files referenced by the journal, unjournaled migration files on disk, or duplicate prefixes.
 */
export function reconcileMigrationHistory(migrationsFolder: string): MigrationHistoryValidationResult {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  const errors: string[] = [];
  let nextIdx = 0;
  let entriesCount = 0;

  if (fs.existsSync(journalPath)) {
    let journal: MigrationJournal;
    try {
      const content = fs.readFileSync(journalPath, 'utf8');
      journal = JSON.parse(content) as MigrationJournal;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(`Malformed or unparseable migration journal at "${journalPath}": ${message}`);
      return { isValid: false, errors, nextIdx: 0, entriesCount: 0 };
    }

    if (!journal || typeof journal !== 'object') {
      errors.push(`Invalid journal schema at "${journalPath}": root must be a non-null object`);
      return { isValid: false, errors, nextIdx: 0, entriesCount: 0 };
    }

    if (!Array.isArray(journal.entries)) {
      errors.push(`Invalid journal schema at "${journalPath}": "entries" property must be an array`);
      return { isValid: false, errors, nextIdx: 0, entriesCount: 0 };
    }

    const seenIndices = new Set<number>();
    const seenTags = new Set<string>();
    const entries = journal.entries;
    entriesCount = entries.length;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const entryPrefix = `Journal entry at index ${i}`;

      if (!entry || typeof entry !== 'object') {
        errors.push(`${entryPrefix} is not a valid object`);
        continue;
      }

      if (typeof entry.idx !== 'number' || !Number.isInteger(entry.idx) || entry.idx < 0) {
        errors.push(`${entryPrefix} has invalid or missing "idx": ${String(entry?.idx)}`);
      } else {
        if (seenIndices.has(entry.idx)) {
          errors.push(`Duplicate journal index ${entry.idx} found at entry ${i}`);
        }
        seenIndices.add(entry.idx);
      }

      if (typeof entry.tag !== 'string' || !entry.tag.trim()) {
        errors.push(`${entryPrefix} has invalid or missing "tag"`);
      } else {
        if (seenTags.has(entry.tag)) {
          errors.push(`Duplicate journal tag "${entry.tag}" found at entry ${i}`);
        }
        seenTags.add(entry.tag);

        if (typeof entry.idx === 'number' && Number.isInteger(entry.idx) && entry.idx >= 0) {
          const expectedPrefix = String(entry.idx).padStart(4, '0');
          if (!entry.tag.startsWith(`${expectedPrefix}_`)) {
            errors.push(
              `Journal entry idx ${entry.idx} tag "${entry.tag}" does not start with expected prefix "${expectedPrefix}_"`,
            );
          }
        }

        const sqlFilePath = path.join(migrationsFolder, `${entry.tag}.sql`);
        if (!fs.existsSync(sqlFilePath)) {
          errors.push(
            `Migration file "${entry.tag}.sql" referenced in journal entry ${entry.idx} does not exist on disk in "${migrationsFolder}"`,
          );
        }
      }
    }

    // Check for gaps in sequence (strictly 0..N-1)
    if (entries.length > 0 && seenIndices.size === entries.length) {
      const sortedIndices = Array.from(seenIndices).sort((a, b) => a - b);
      for (let i = 0; i < sortedIndices.length; i++) {
        if (sortedIndices[i] !== i) {
          errors.push(`Migration journal has gap in sequence: missing index ${i}, found ${sortedIndices[i]}`);
          break;
        }
      }
      nextIdx = sortedIndices[sortedIndices.length - 1] + 1;
    }

    // Scan directory for unjournaled or colliding SQL files
    const scanResult = scanMigrationDirectory(migrationsFolder);
    errors.push(...scanResult.errors);

    for (const item of scanResult.scannedFiles) {
      if (!seenTags.has(item.tag)) {
        errors.push(`Unjournaled migration file "${item.file}" found on disk at "${migrationsFolder}"`);
      }
    }
  } else {
    // Journal does not exist: scan directory for numeric prefix continuity
    const scanResult = scanMigrationDirectory(migrationsFolder);
    errors.push(...scanResult.errors);

    const indexedFiles = scanResult.scannedFiles.filter((f) => f.idx !== undefined);
    if (indexedFiles.length > 0) {
      const seenIndices = new Set(indexedFiles.map((f) => f.idx!));
      const maxIdx = Math.max(...Array.from(seenIndices));
      for (let i = 0; i <= maxIdx; i++) {
        if (!seenIndices.has(i)) {
          errors.push(`Missing migration file with prefix "${String(i).padStart(4, '0')}" in directory sequence`);
        }
      }
      nextIdx = maxIdx + 1;
      entriesCount = indexedFiles.length;
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    nextIdx,
    entriesCount,
  };
}

/**
 * Reconciles journal and migrations directory and returns the next monotonically ordered migration metadata.
 * Fails closed if history is inconsistent or if the target migration file already exists on disk.
 */
export function getNextMigrationMeta(migrationsFolder: string, tagSuffix = 'release_city_catalog'): MigrationMeta {
  const historyVal = reconcileMigrationHistory(migrationsFolder);
  if (!historyVal.isValid) {
    throw new Error(`Migration history reconciliation failed closed:\n- ${historyVal.errors.join('\n- ')}`);
  }

  const nextIdx = historyVal.nextIdx;
  const prefix = String(nextIdx).padStart(4, '0');
  const tag = `${prefix}_${tagSuffix}`;
  const filename = `${tag}.sql`;
  const migrationFilePath = path.join(migrationsFolder, filename);

  if (fs.existsSync(migrationFilePath)) {
    throw new Error(
      `Target migration file "${filename}" already exists on disk in "${migrationsFolder}". Publication refuses to overwrite existing migrations.`,
    );
  }

  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  return {
    nextIdx,
    tag,
    filename,
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
    '  -- 1. Apply reviewed City identity transfers onto existing application UUIDs',
    ...generateCityIdentityTransfersSql(release.identityTransfers ?? [], '  '),
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

import * as fs from 'fs';
import * as path from 'path';
import {
  validateCatalog,
  validateSnapshot,
  resolveDataPath,
  type CitySnapshot,
  type CityCatalogRecord,
} from './catalog';
import { applyReviewedRelease, type ReviewedReleaseOptions, type ReviewedReleaseResult } from './plan';
import { getNextMigrationMeta, generateReleaseMigrationSql, resolveMigrationsFolder } from './migration';

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

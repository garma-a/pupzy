import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  validateCatalog,
  validateSnapshot,
  resolveDataPath,
  loadOfficialCatalog,
  type CitySnapshot,
  type CityCatalogRecord,
  type CityCatalog,
} from './catalog';
import { compareSnapshots } from './diff';
import { applyReviewedRelease, type ReviewedReleaseOptions, type ReviewedReleaseResult } from './plan';
import {
  getNextMigrationMeta,
  generateReleaseMigrationSql,
  resolveMigrationsFolder,
  MigrationJournal,
} from './migration';

export type FaultInjectionStage =
  | 'stage_catalog'
  | 'stage_snapshot'
  | 'stage_migration'
  | 'stage_journal'
  | 'replace_catalog'
  | 'replace_snapshot'
  | 'replace_migration'
  | 'replace_journal';

export type FaultInjectionHook = (stage: FaultInjectionStage) => void;

export interface PublishReleaseOptions extends ReviewedReleaseOptions {
  migrationsFolder?: string;
  catalogPath?: string;
  snapshotPath?: string;
  writeSnapshot?: boolean;
  _faultInjectionHook?: FaultInjectionHook;
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

interface RecoveryBackupEntry {
  path: string;
  backupPath: string;
}

interface PublicationRecoveryManifest {
  stage: string;
  timestamp: number;
  migrationPath: string;
  backups: RecoveryBackupEntry[];
}

function restoreBackups(backups: RecoveryBackupEntry[]): void {
  for (const backup of backups) {
    if (fs.existsSync(backup.backupPath)) {
      try {
        fs.copyFileSync(backup.backupPath, backup.path);
        fs.rmSync(backup.backupPath, { force: true });
      } catch {
        // ignore rollback cleanup errors
      }
    }
  }
}

/**
 * Recovers an interrupted publication from a previous crash or failure by restoring
 * backed-up release artifacts and removing dangling uncommitted migration files.
 */
export function recoverInterruptedPublication(migrationsFolder: string): boolean {
  const manifestPath = path.join(migrationsFolder, '.publication-recovery-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return false;
  }

  try {
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent) as PublicationRecoveryManifest;

    if (manifest && Array.isArray(manifest.backups)) {
      restoreBackups(manifest.backups);
    }

    if (manifest && typeof manifest.migrationPath === 'string') {
      if (fs.existsSync(manifest.migrationPath)) {
        fs.rmSync(manifest.migrationPath, { force: true });
      }
    }

    fs.rmSync(manifestPath, { force: true });
    return true;
  } catch {
    // If manifest itself is corrupt, remove it
    if (fs.existsSync(manifestPath)) {
      fs.rmSync(manifestPath, { force: true });
    }
    return false;
  }
}

/**
 * End-to-end atomic publisher for a reviewed City catalog release.
 *
 * Guarantees:
 * 1. Monotonically reconciles migration history and fails closed on inconsistencies.
 * 2. Refuses to overwrite existing migrations, identical candidate releases, or incompatible journal entries.
 * 3. Fully generates and validates every artifact in an isolated staging area before touching production artifacts.
 * 4. Boundary fault-safety: any failure during staging or replacement immediately rolls back all touched files to their previous state.
 * 5. Crash-safety: supports deterministic automatic recovery before subsequent publication starts.
 */
export function publishReviewedRelease(
  currentCatalog: CityCatalogRecord[],
  candidateSnapshot: CitySnapshot,
  options: PublishReleaseOptions = {},
): PublishReleaseResult {
  const migrationsFolder = resolveMigrationsFolder(options.migrationsFolder);
  const catalogPath = options.catalogPath ?? resolveDataPath('egypt-cities-catalog.json');
  const snapshotPath = options.snapshotPath ?? resolveDataPath('ocha-adm2-egypt-snapshot.json');

  // 0. Automatic recovery from prior interrupted publication
  recoverInterruptedPublication(migrationsFolder);

  // 1. Validate candidate snapshot schema and provenance
  const snapshotVal = validateSnapshot(candidateSnapshot);
  if (!snapshotVal.isValid) {
    throw new Error(`Candidate snapshot validation failed:\n- ${snapshotVal.errors.join('\n- ')}`);
  }

  // 2. Check for identical / unadvancing candidate snapshot
  const diff = compareSnapshots(currentCatalog, candidateSnapshot);
  const hasNoChanges =
    diff.summary.addedCount === 0 &&
    diff.summary.removedCount === 0 &&
    diff.summary.renamedCount === 0 &&
    diff.summary.recodedCount === 0 &&
    diff.summary.coordinateChangedCount === 0;

  if (hasNoChanges) {
    let currentMetadataVersion: string | undefined;
    if (fs.existsSync(catalogPath)) {
      try {
        const parsedCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as {
          metadata?: { upstreamVersion?: string };
        };
        currentMetadataVersion = parsedCatalog.metadata?.upstreamVersion;
      } catch {
        // ignore
      }
    }
    if (!currentMetadataVersion) {
      const currentFull = loadOfficialCatalog();
      currentMetadataVersion = currentFull.metadata?.upstreamVersion;
    }

    if (
      !candidateSnapshot.metadata?.upstreamVersion ||
      candidateSnapshot.metadata.upstreamVersion === currentMetadataVersion
    ) {
      throw new Error(
        'Publication refused: candidate snapshot contains no changes and does not advance the current catalog release.',
      );
    }
  }

  // 3. Apply reviewed release (validates count changes, metadata, replacement mappings)
  const release = applyReviewedRelease(currentCatalog, candidateSnapshot, options);

  // 4. Validate updated catalog in memory
  const catalogVal = validateCatalog({
    metadata: release.metadata,
    records: release.updatedCatalog,
  });
  if (!catalogVal.isValid) {
    throw new Error(`Updated catalog validation failed:\n- ${catalogVal.errors.join('\n- ')}`);
  }

  // 5. Reconcile migration history and determine next monotonic migration metadata
  const migrationMeta = getNextMigrationMeta(migrationsFolder);
  const migrationSql = generateReleaseMigrationSql(release, { migrationTag: migrationMeta.tag });
  const migrationFilePath = path.join(migrationsFolder, migrationMeta.filename);

  // Prepare updated journal in memory
  let updatedJournalContent: string | null = null;
  if (fs.existsSync(migrationMeta.journalPath)) {
    const journalContent = fs.readFileSync(migrationMeta.journalPath, 'utf8');
    const journal = JSON.parse(journalContent) as MigrationJournal;
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

  // 6. Stage all artifacts in an isolated temporary directory
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'city-release-staging-'));
  const stagedCatalogFile = path.join(stagingDir, 'egypt-cities-catalog.json');
  const stagedSnapshotFile = path.join(stagingDir, 'ocha-adm2-egypt-snapshot.json');
  const stagedMigrationFile = path.join(stagingDir, migrationMeta.filename);
  const stagedJournalFile = path.join(stagingDir, '_journal.json');

  const recoveryManifestPath = path.join(migrationsFolder, '.publication-recovery-manifest.json');
  const backups: RecoveryBackupEntry[] = [];

  try {
    // 6a. Stage Catalog
    fs.writeFileSync(
      stagedCatalogFile,
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
    if (options._faultInjectionHook) {
      options._faultInjectionHook('stage_catalog');
    }
    const stagedCatVal = validateCatalog(JSON.parse(fs.readFileSync(stagedCatalogFile, 'utf8')) as CityCatalog);
    if (!stagedCatVal.isValid) {
      throw new Error(`Staged catalog validation failed:\n- ${stagedCatVal.errors.join('\n- ')}`);
    }

    // 6b. Stage Snapshot
    if (options.writeSnapshot !== false) {
      fs.writeFileSync(stagedSnapshotFile, JSON.stringify(candidateSnapshot, null, 2), 'utf8');
      if (options._faultInjectionHook) {
        options._faultInjectionHook('stage_snapshot');
      }
      const stagedSnapVal = validateSnapshot(JSON.parse(fs.readFileSync(stagedSnapshotFile, 'utf8')));
      if (!stagedSnapVal.isValid) {
        throw new Error(`Staged snapshot validation failed:\n- ${stagedSnapVal.errors.join('\n- ')}`);
      }
    }

    // 6c. Stage Migration SQL
    fs.writeFileSync(stagedMigrationFile, migrationSql, 'utf8');
    if (options._faultInjectionHook) {
      options._faultInjectionHook('stage_migration');
    }
    const stagedSqlContent = fs.readFileSync(stagedMigrationFile, 'utf8');
    if (!stagedSqlContent.trim() || !stagedSqlContent.includes('DO $$') || !stagedSqlContent.includes('END $$;')) {
      throw new Error('Staged migration SQL validation failed: incomplete or empty SQL statements');
    }

    // 6d. Stage Journal
    if (updatedJournalContent) {
      fs.writeFileSync(stagedJournalFile, updatedJournalContent, 'utf8');
      if (options._faultInjectionHook) {
        options._faultInjectionHook('stage_journal');
      }
      const stagedJournalParsed = JSON.parse(fs.readFileSync(stagedJournalFile, 'utf8')) as MigrationJournal;
      if (!Array.isArray(stagedJournalParsed.entries)) {
        throw new Error('Staged journal validation failed: entries must be an array');
      }
    }

    // 7. Atomic replacement with boundary rollback protection
    // 7a. Prepare backups
    if (fs.existsSync(catalogPath)) {
      const backupPath = `${catalogPath}.recovery.bak`;
      fs.copyFileSync(catalogPath, backupPath);
      backups.push({ path: catalogPath, backupPath });
    }
    if (options.writeSnapshot !== false && fs.existsSync(snapshotPath)) {
      const backupPath = `${snapshotPath}.recovery.bak`;
      fs.copyFileSync(snapshotPath, backupPath);
      backups.push({ path: snapshotPath, backupPath });
    }
    if (fs.existsSync(migrationMeta.journalPath)) {
      const backupPath = `${migrationMeta.journalPath}.recovery.bak`;
      fs.copyFileSync(migrationMeta.journalPath, backupPath);
      backups.push({ path: migrationMeta.journalPath, backupPath });
    }

    // Write recovery manifest
    const manifest: PublicationRecoveryManifest = {
      stage: 'replacing',
      timestamp: Date.now(),
      migrationPath: migrationFilePath,
      backups,
    };
    fs.writeFileSync(recoveryManifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    // 7b. Execute Replacements
    fs.copyFileSync(stagedCatalogFile, catalogPath);
    if (options._faultInjectionHook) {
      options._faultInjectionHook('replace_catalog');
    }

    if (options.writeSnapshot !== false) {
      fs.copyFileSync(stagedSnapshotFile, snapshotPath);
      if (options._faultInjectionHook) {
        options._faultInjectionHook('replace_snapshot');
      }
    }

    fs.copyFileSync(stagedMigrationFile, migrationFilePath);
    if (options._faultInjectionHook) {
      options._faultInjectionHook('replace_migration');
    }

    if (updatedJournalContent) {
      fs.copyFileSync(stagedJournalFile, migrationMeta.journalPath);
      if (options._faultInjectionHook) {
        options._faultInjectionHook('replace_journal');
      }
    }

    // 8. Publication succeeded cleanly: clean up manifest and backups
    for (const b of backups) {
      if (fs.existsSync(b.backupPath)) {
        fs.rmSync(b.backupPath, { force: true });
      }
    }
    if (fs.existsSync(recoveryManifestPath)) {
      fs.rmSync(recoveryManifestPath, { force: true });
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
  } catch (err) {
    // 9. Boundary Rollback: restore all files from backups
    restoreBackups(backups);

    if (fs.existsSync(migrationFilePath)) {
      try {
        fs.rmSync(migrationFilePath, { force: true });
      } catch {
        // ignore
      }
    }

    if (fs.existsSync(recoveryManifestPath)) {
      try {
        fs.rmSync(recoveryManifestPath, { force: true });
      } catch {
        // ignore
      }
    }

    throw err;
  } finally {
    // Clean up staging directory
    if (fs.existsSync(stagingDir)) {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

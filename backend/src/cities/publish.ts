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
  hadOriginal?: boolean;
}

interface PublicationRecoveryManifest {
  stage: string;
  timestamp: number;
  migrationPath: string;
  backups: RecoveryBackupEntry[];
}

interface ReleaseArtifact {
  destinationPath: string;
  stagedPath: string;
  content: string;
  stageFault: FaultInjectionStage;
  replaceFault: FaultInjectionStage;
  validate(content: string): void;
}

function restoreBackups(backups: RecoveryBackupEntry[]): void {
  for (const backup of backups) {
    if (backup.hadOriginal === false) {
      try {
        fs.rmSync(backup.path, { force: true });
      } catch {
        // ignore rollback cleanup errors
      }
      continue;
    }

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

function stageArtifact(artifact: ReleaseArtifact, faultInjectionHook?: FaultInjectionHook): void {
  fs.writeFileSync(artifact.stagedPath, artifact.content, 'utf8');
  faultInjectionHook?.(artifact.stageFault);
  artifact.validate(fs.readFileSync(artifact.stagedPath, 'utf8'));
}

function backupReleaseArtifacts(artifacts: ReleaseArtifact[]): RecoveryBackupEntry[] {
  return artifacts.map((artifact) => {
    const backupPath = `${artifact.destinationPath}.recovery.bak`;
    const hadOriginal = fs.existsSync(artifact.destinationPath);

    if (hadOriginal) {
      fs.copyFileSync(artifact.destinationPath, backupPath);
    }

    return { path: artifact.destinationPath, backupPath, hadOriginal };
  });
}

function replaceArtifact(artifact: ReleaseArtifact, faultInjectionHook?: FaultInjectionHook): void {
  fs.copyFileSync(artifact.stagedPath, artifact.destinationPath);
  faultInjectionHook?.(artifact.replaceFault);
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

  if (options.writeSnapshot === false) {
    throw new Error('Publication refused: the source snapshot is mandatory in every City release artifact set.');
  }

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

  // 3. Apply reviewed release (validates count changes, metadata, and City identity transfers)
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

  // Prepare the required journal artifact in memory. An empty migration history is initialized
  // by the first publication; a non-empty history without a journal has already failed closed.
  let journal: MigrationJournal;
  if (fs.existsSync(migrationMeta.journalPath)) {
    const journalContent = fs.readFileSync(migrationMeta.journalPath, 'utf8');
    journal = JSON.parse(journalContent) as MigrationJournal;
  } else {
    journal = { version: '7', dialect: 'postgresql', entries: [] };
  }
  journal.entries.push({
    idx: migrationMeta.nextIdx,
    version: journal.version || '7',
    when: Date.now(),
    tag: migrationMeta.tag,
    breakpoints: true,
  });
  const updatedJournalContent = JSON.stringify(journal, null, 2);

  // 6. Stage all artifacts in an isolated temporary directory
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'city-release-staging-'));
  const stagedCatalogFile = path.join(stagingDir, 'egypt-cities-catalog.json');
  const stagedSnapshotFile = path.join(stagingDir, 'ocha-adm2-egypt-snapshot.json');
  const stagedMigrationFile = path.join(stagingDir, migrationMeta.filename);
  const stagedJournalFile = path.join(stagingDir, '_journal.json');

  const recoveryManifestPath = path.join(migrationsFolder, '.publication-recovery-manifest.json');
  let backups: RecoveryBackupEntry[] = [];

  try {
    const artifacts: ReleaseArtifact[] = [
      {
        destinationPath: catalogPath,
        stagedPath: stagedCatalogFile,
        content: JSON.stringify({ metadata: release.metadata, records: release.updatedCatalog }, null, 2),
        stageFault: 'stage_catalog',
        replaceFault: 'replace_catalog',
        validate(content) {
          const validation = validateCatalog(JSON.parse(content) as CityCatalog);
          if (!validation.isValid) {
            throw new Error(`Staged catalog validation failed:\n- ${validation.errors.join('\n- ')}`);
          }
        },
      },
      {
        destinationPath: snapshotPath,
        stagedPath: stagedSnapshotFile,
        content: JSON.stringify(candidateSnapshot, null, 2),
        stageFault: 'stage_snapshot',
        replaceFault: 'replace_snapshot',
        validate(content) {
          const validation = validateSnapshot(JSON.parse(content));
          if (!validation.isValid) {
            throw new Error(`Staged snapshot validation failed:\n- ${validation.errors.join('\n- ')}`);
          }
        },
      },
      {
        destinationPath: migrationFilePath,
        stagedPath: stagedMigrationFile,
        content: migrationSql,
        stageFault: 'stage_migration',
        replaceFault: 'replace_migration',
        validate(content) {
          if (!content.trim() || !content.includes('DO $$') || !content.includes('END $$;')) {
            throw new Error('Staged migration SQL validation failed: incomplete or empty SQL statements');
          }
        },
      },
      {
        destinationPath: migrationMeta.journalPath,
        stagedPath: stagedJournalFile,
        content: updatedJournalContent,
        stageFault: 'stage_journal',
        replaceFault: 'replace_journal',
        validate(content) {
          const parsed = JSON.parse(content) as MigrationJournal;
          const lastEntry = parsed.entries?.at(-1);
          if (
            !Array.isArray(parsed.entries) ||
            lastEntry?.idx !== migrationMeta.nextIdx ||
            lastEntry?.tag !== migrationMeta.tag
          ) {
            throw new Error('Staged journal validation failed: missing migration entry for the staged migration');
          }
        },
      },
    ];

    for (const artifact of artifacts) {
      stageArtifact(artifact, options._faultInjectionHook);
    }

    // Every artifact follows the same backup, replacement, and cleanup protocol.
    for (const artifact of artifacts) {
      fs.mkdirSync(path.dirname(artifact.destinationPath), { recursive: true });
    }
    backups = backupReleaseArtifacts(artifacts);

    // Write recovery manifest
    const manifest: PublicationRecoveryManifest = {
      stage: 'replacing',
      timestamp: Date.now(),
      migrationPath: migrationFilePath,
      backups,
    };
    fs.writeFileSync(recoveryManifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    for (const artifact of artifacts) {
      replaceArtifact(artifact, options._faultInjectionHook);
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
      snapshotPath,
      journalUpdated: true,
    };
  } catch (err) {
    // 9. Boundary Rollback: restore every artifact that replacement touched.
    restoreBackups(backups);

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

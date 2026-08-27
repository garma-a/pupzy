import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
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
  | 'replace_journal'
  | 'sync_catalog'
  | 'sync_snapshot'
  | 'sync_migration'
  | 'sync_journal'
  | 'sync_recovery_manifest'
  | 'cleanup_backup_catalog'
  | 'cleanup_backup_snapshot'
  | 'cleanup_backup_migration'
  | 'cleanup_backup_journal';

export type FaultInjectionHook = (stage: FaultInjectionStage) => void;

/**
 * Test-only signal that models abrupt process termination. The publisher intentionally
 * leaves the durable recovery state in place instead of executing its normal rollback.
 */
export class SimulatedProcessInterruption extends Error {}

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

type ReleaseArtifactKind = 'catalog' | 'snapshot' | 'migration' | 'journal';

interface RecoveryArtifact {
  kind: ReleaseArtifactKind;
  path: string;
  backupPath: string;
  hadOriginal: boolean;
  originalDigest?: string;
  publishedDigest: string;
}

interface PublicationRecoveryManifest {
  version: 1;
  state: 'replacing' | 'published' | 'restored';
  timestamp: number;
  artifacts: RecoveryArtifact[];
}

interface ReleaseArtifact {
  kind: ReleaseArtifactKind;
  destinationPath: string;
  stagedPath: string;
  content: string;
  stageFault: FaultInjectionStage;
  syncFault: FaultInjectionStage;
  replaceFault: FaultInjectionStage;
  validate(content: string): void;
}

function contentDigest(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function syncFile(filePath: string): void {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function syncDirectory(directoryPath: string): void {
  const descriptor = fs.openSync(directoryPath, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeDurably(filePath: string, content: string | Buffer): void {
  const descriptor = fs.openSync(filePath, 'w');
  try {
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function replaceAtomically(destinationPath: string, stagedPath: string): void {
  fs.renameSync(stagedPath, destinationPath);
  syncFile(destinationPath);
  syncDirectory(path.dirname(destinationPath));
}

function removeDurably(filePath: string): void {
  fs.rmSync(filePath, { force: true });
  syncDirectory(path.dirname(filePath));
}

function ensureArtifactDirectories(artifacts: ReleaseArtifact[]): void {
  for (const artifact of artifacts) {
    fs.mkdirSync(path.dirname(artifact.destinationPath), { recursive: true });
  }
}

function stageArtifact(artifact: ReleaseArtifact, faultInjectionHook?: FaultInjectionHook): void {
  writeDurably(artifact.stagedPath, artifact.content);
  faultInjectionHook?.(artifact.stageFault);
  artifact.validate(fs.readFileSync(artifact.stagedPath, 'utf8'));
}

function backupReleaseArtifacts(artifacts: ReleaseArtifact[]): RecoveryArtifact[] {
  return artifacts.map((artifact) => {
    const backupPath = `${artifact.destinationPath}.recovery.bak`;
    const hadOriginal = fs.existsSync(artifact.destinationPath);
    const originalContent = hadOriginal ? fs.readFileSync(artifact.destinationPath) : undefined;

    if (originalContent) {
      writeDurably(backupPath, originalContent);
      syncDirectory(path.dirname(backupPath));
    }

    return {
      kind: artifact.kind,
      path: artifact.destinationPath,
      backupPath,
      hadOriginal,
      originalDigest: originalContent ? contentDigest(originalContent) : undefined,
      publishedDigest: contentDigest(artifact.content),
    };
  });
}

function replaceArtifact(artifact: ReleaseArtifact, faultInjectionHook?: FaultInjectionHook): void {
  fs.renameSync(artifact.stagedPath, artifact.destinationPath);
  faultInjectionHook?.(artifact.syncFault);
  syncFile(artifact.destinationPath);
  syncDirectory(path.dirname(artifact.destinationPath));
  faultInjectionHook?.(artifact.replaceFault);
}

function recoveryManifestPath(migrationsFolder: string): string {
  return path.join(migrationsFolder, '.publication-recovery-manifest.json');
}

function writeRecoveryManifest(
  manifestPath: string,
  manifest: PublicationRecoveryManifest,
  faultInjectionHook?: FaultInjectionHook,
): void {
  const stagedPath = `${manifestPath}.${randomUUID()}.tmp`;
  try {
    writeDurably(stagedPath, JSON.stringify(manifest, null, 2));
    faultInjectionHook?.('sync_recovery_manifest');
    replaceAtomically(manifestPath, stagedPath);
  } finally {
    if (fs.existsSync(stagedPath)) {
      fs.rmSync(stagedPath, { force: true });
    }
  }
}

function parseRecoveryManifest(manifestPath: string): PublicationRecoveryManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Publication recovery manifest is corrupt at "${manifestPath}": ${detail}`);
  }

  const manifest = parsed as Partial<PublicationRecoveryManifest>;
  const validState = manifest.state === 'replacing' || manifest.state === 'published' || manifest.state === 'restored';
  if (manifest.version !== 1 || !validState || !Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 4) {
    throw new Error(`Publication recovery manifest is corrupt at "${manifestPath}": invalid schema`);
  }

  const kinds = new Set<ReleaseArtifactKind>();
  const paths = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (
      !artifact ||
      !['catalog', 'snapshot', 'migration', 'journal'].includes(artifact.kind) ||
      kinds.has(artifact.kind) ||
      typeof artifact.path !== 'string' ||
      !path.isAbsolute(artifact.path) ||
      paths.has(artifact.path) ||
      artifact.backupPath !== `${artifact.path}.recovery.bak` ||
      typeof artifact.hadOriginal !== 'boolean' ||
      typeof artifact.publishedDigest !== 'string' ||
      (artifact.hadOriginal && typeof artifact.originalDigest !== 'string')
    ) {
      throw new Error(`Publication recovery manifest is corrupt at "${manifestPath}": invalid artifact entry`);
    }
    kinds.add(artifact.kind);
    paths.add(artifact.path);
  }

  return manifest as PublicationRecoveryManifest;
}

function validateRecoveredArtifact(artifact: RecoveryArtifact): void {
  if (!fs.existsSync(artifact.path)) {
    throw new Error(`Recovered ${artifact.kind} artifact is missing at "${artifact.path}"`);
  }
  const content = fs.readFileSync(artifact.path, 'utf8');
  if (artifact.kind === 'catalog') {
    const validation = validateCatalog(JSON.parse(content) as CityCatalog);
    if (!validation.isValid) throw new Error(`Recovered catalog validation failed: ${validation.errors.join('; ')}`);
  } else if (artifact.kind === 'snapshot') {
    const validation = validateSnapshot(JSON.parse(content));
    if (!validation.isValid) throw new Error(`Recovered snapshot validation failed: ${validation.errors.join('; ')}`);
  } else if (artifact.kind === 'journal') {
    JSON.parse(content);
  } else if (!content.trim()) {
    throw new Error('Recovered migration validation failed: migration is empty');
  }
}

function verifyArtifactSet(
  artifacts: RecoveryArtifact[],
  migrationsFolder: string,
  expectedDigest: 'originalDigest' | 'publishedDigest',
): void {
  for (const artifact of artifacts) {
    const digest = artifact[expectedDigest];
    if (!digest) {
      if (fs.existsSync(artifact.path)) {
        throw new Error(`Recovered ${artifact.kind} artifact should be absent but remains at "${artifact.path}"`);
      }
      // Retrying recovery after a failed directory fsync must durably confirm the deletion.
      syncDirectory(path.dirname(artifact.path));
      continue;
    }
    if (!fs.existsSync(artifact.path) || contentDigest(fs.readFileSync(artifact.path)) !== digest) {
      throw new Error(`Recovered ${artifact.kind} artifact does not match its durable ${expectedDigest}`);
    }
    validateRecoveredArtifact(artifact);
  }

  try {
    // getNextMigrationMeta also proves the journal and migration directory are a reconciled pair.
    getNextMigrationMeta(migrationsFolder);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Recovered release artifact set is inconsistent: ${detail}`);
  }
}

function restoreArtifact(artifact: RecoveryArtifact): void {
  if (!artifact.hadOriginal) {
    if (fs.existsSync(artifact.path)) removeDurably(artifact.path);
    return;
  }

  if (!fs.existsSync(artifact.backupPath)) {
    throw new Error(`Required recovery backup is missing at "${artifact.backupPath}"`);
  }
  const backup = fs.readFileSync(artifact.backupPath);
  if (contentDigest(backup) !== artifact.originalDigest) {
    throw new Error(`Recovery backup checksum does not match at "${artifact.backupPath}"`);
  }

  const restoreStagedPath = `${artifact.path}.${randomUUID()}.restore`;
  try {
    writeDurably(restoreStagedPath, backup);
    replaceAtomically(artifact.path, restoreStagedPath);
  } finally {
    if (fs.existsSync(restoreStagedPath)) fs.rmSync(restoreStagedPath, { force: true });
  }
}

function cleanupRecoveryEvidence(
  manifestPath: string,
  artifacts: RecoveryArtifact[],
  faultInjectionHook?: FaultInjectionHook,
): void {
  const cleanupFaults: Record<ReleaseArtifactKind, FaultInjectionStage> = {
    catalog: 'cleanup_backup_catalog',
    snapshot: 'cleanup_backup_snapshot',
    migration: 'cleanup_backup_migration',
    journal: 'cleanup_backup_journal',
  };
  for (const artifact of artifacts) {
    faultInjectionHook?.(cleanupFaults[artifact.kind]);
    if (fs.existsSync(artifact.backupPath)) removeDurably(artifact.backupPath);
  }
  removeDurably(manifestPath);
}

/**
 * Recovers an interrupted publication from a previous crash or failure by restoring
 * backed-up release artifacts and removing dangling uncommitted migration files.
 */
export function recoverInterruptedPublication(migrationsFolder: string): boolean {
  const manifestPath = recoveryManifestPath(migrationsFolder);
  if (!fs.existsSync(manifestPath)) {
    return false;
  }

  const manifest = parseRecoveryManifest(manifestPath);
  try {
    if (manifest.state === 'replacing') {
      for (const artifact of manifest.artifacts) restoreArtifact(artifact);
      verifyArtifactSet(manifest.artifacts, migrationsFolder, 'originalDigest');
      manifest.state = 'restored';
      writeRecoveryManifest(manifestPath, manifest);
    } else if (manifest.state === 'published') {
      verifyArtifactSet(manifest.artifacts, migrationsFolder, 'publishedDigest');
    } else {
      verifyArtifactSet(manifest.artifacts, migrationsFolder, 'originalDigest');
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Publication restoration failed; recovery evidence was preserved: ${detail}`);
  }

  cleanupRecoveryEvidence(manifestPath, manifest.artifacts);
  return true;
}

/**
 * End-to-end atomic publisher for a reviewed City catalog release.
 *
 * Guarantees:
 * 1. Monotonically reconciles migration history and fails closed on inconsistencies.
 * 2. Refuses to overwrite existing migrations, identical candidate releases, or incompatible journal entries.
 * 3. Fully generates, syncs, and validates every artifact beside its destination before any live artifact changes.
 * 4. Boundary fault-safety: normal failures restore the previous artifact set; process interruption leaves durable recovery evidence.
 * 5. Crash-safety: deterministically verifies and completes recovery before subsequent publication starts.
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

  // Staging occurs beside each destination so the final rename is atomic on that filesystem.
  const publicationId = randomUUID();
  const stagedPathFor = (destinationPath: string) => `${destinationPath}.publication-${publicationId}.staged`;
  const manifestPath = recoveryManifestPath(migrationsFolder);
  let manifest: PublicationRecoveryManifest | undefined;
  let artifacts: ReleaseArtifact[] = [];

  try {
    artifacts = [
      {
        kind: 'catalog',
        destinationPath: catalogPath,
        stagedPath: stagedPathFor(catalogPath),
        content: JSON.stringify({ metadata: release.metadata, records: release.updatedCatalog }, null, 2),
        stageFault: 'stage_catalog',
        syncFault: 'sync_catalog',
        replaceFault: 'replace_catalog',
        validate(content) {
          const validation = validateCatalog(JSON.parse(content) as CityCatalog);
          if (!validation.isValid) {
            throw new Error(`Staged catalog validation failed:\n- ${validation.errors.join('\n- ')}`);
          }
        },
      },
      {
        kind: 'snapshot',
        destinationPath: snapshotPath,
        stagedPath: stagedPathFor(snapshotPath),
        content: JSON.stringify(candidateSnapshot, null, 2),
        stageFault: 'stage_snapshot',
        syncFault: 'sync_snapshot',
        replaceFault: 'replace_snapshot',
        validate(content) {
          const validation = validateSnapshot(JSON.parse(content));
          if (!validation.isValid) {
            throw new Error(`Staged snapshot validation failed:\n- ${validation.errors.join('\n- ')}`);
          }
        },
      },
      {
        kind: 'migration',
        destinationPath: migrationFilePath,
        stagedPath: stagedPathFor(migrationFilePath),
        content: migrationSql,
        stageFault: 'stage_migration',
        syncFault: 'sync_migration',
        replaceFault: 'replace_migration',
        validate(content) {
          if (!content.trim() || !content.includes('DO $$') || !content.includes('END $$;')) {
            throw new Error('Staged migration SQL validation failed: incomplete or empty SQL statements');
          }
        },
      },
      {
        kind: 'journal',
        destinationPath: migrationMeta.journalPath,
        stagedPath: stagedPathFor(migrationMeta.journalPath),
        content: updatedJournalContent,
        stageFault: 'stage_journal',
        syncFault: 'sync_journal',
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

    ensureArtifactDirectories(artifacts);
    for (const artifact of artifacts) stageArtifact(artifact, options._faultInjectionHook);

    // The complete, synced backup set is recorded and synced before any live artifact changes.
    manifest = {
      version: 1,
      state: 'replacing',
      timestamp: Date.now(),
      artifacts: backupReleaseArtifacts(artifacts),
    };
    writeRecoveryManifest(manifestPath, manifest, options._faultInjectionHook);

    for (const artifact of artifacts) replaceArtifact(artifact, options._faultInjectionHook);

    // The new release is only committed after every artifact has been verified and synced.
    verifyArtifactSet(manifest.artifacts, migrationsFolder, 'publishedDigest');
    for (const artifact of manifest.artifacts) {
      syncFile(artifact.path);
      syncDirectory(path.dirname(artifact.path));
    }
    manifest.state = 'published';
    writeRecoveryManifest(manifestPath, manifest, options._faultInjectionHook);
    cleanupRecoveryEvidence(manifestPath, manifest.artifacts, options._faultInjectionHook);

    return {
      release,
      migrationTag: migrationMeta.tag,
      migrationPath: migrationFilePath,
      migrationSql,
      catalogPath,
      snapshotPath,
      journalUpdated: true,
    };
  } catch (error) {
    if (error instanceof SimulatedProcessInterruption) {
      throw error;
    }

    // Before the durable published marker, a normal error restores the previous complete release.
    // A recovery error is deliberately surfaced without deleting the manifest or backups.
    if (manifest?.state === 'replacing') {
      if (fs.existsSync(manifestPath)) {
        recoverInterruptedPublication(migrationsFolder);
      } else {
        // Manifest establishment failed before any live artifact changed, so no recovery state
        // is needed. Remove only the unused, durable backups created for this aborted attempt.
        for (const artifact of manifest.artifacts) {
          if (fs.existsSync(artifact.backupPath)) removeDurably(artifact.backupPath);
        }
      }
    }

    throw error;
  } finally {
    for (const artifact of artifacts) {
      if (fs.existsSync(artifact.stagedPath)) {
        fs.rmSync(artifact.stagedPath, { force: true });
      }
    }
  }
}

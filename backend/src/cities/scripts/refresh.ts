import * as fs from 'fs';
import * as path from 'path';
import {
  compareSnapshots,
  publishReviewedRelease,
  fetchUpstreamSnapshot,
  type SnapshotDiffReport,
  type ReviewedReleaseOptions,
} from '../refresh';
import { getOfficialCatalog, loadRawSnapshot, type CitySnapshot } from '../catalog';

function printDiffReport(diff: SnapshotDiffReport): void {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('            UPSTREAM CITY CATALOG DIFF REPORT                  ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Current catalog total:   ${diff.summary.totalCurrent}`);
  console.log(`Candidate snapshot total: ${diff.summary.totalCandidate}`);
  console.log('───────────────────────────────────────────────────────────────');
  console.log(`  Added Cities:             ${diff.summary.addedCount}`);
  console.log(`  Removed Cities:           ${diff.summary.removedCount}`);
  console.log(`  Renamed Cities:           ${diff.summary.renamedCount}`);
  console.log(`  Recoded Cities:           ${diff.summary.recodedCount}`);
  console.log(`  Coordinate changes:       ${diff.summary.coordinateChangedCount}`);
  console.log('───────────────────────────────────────────────────────────────\n');

  if (diff.added.length > 0) {
    console.log('➕ Added Cities:');
    for (const a of diff.added) {
      console.log(`  [${a.sourceCode}] ${a.governorate}: ${a.nameEnglish} (${a.nameArabic})`);
    }
    console.log('');
  }

  if (diff.removed.length > 0) {
    console.log('➖ Removed Cities (will become RETIRED):');
    for (const r of diff.removed) {
      console.log(`  [${r.sourceCode}] ${r.governorate}: ${r.nameEnglish} (${r.nameArabic})`);
    }
    console.log('');
  }

  if (diff.renamed.length > 0) {
    console.log('✏️  Renamed Cities:');
    for (const rn of diff.renamed) {
      console.log(
        `  [${rn.sourceCode}] ${rn.governorate}: "${rn.oldNameEnglish}" -> "${rn.newNameEnglish}" | "${rn.oldNameArabic}" -> "${rn.newNameArabic}"`,
      );
    }
    console.log('');
  }

  if (diff.recoded.length > 0) {
    console.log('🔄 Recoded Cities:');
    for (const rc of diff.recoded) {
      console.log(`  ${rc.governorate}: ${rc.nameEnglish} code changed: ${rc.oldSourceCode} -> ${rc.newSourceCode}`);
    }
    console.log('');
  }

  if (diff.coordinateChanged.length > 0) {
    console.log('📍 Coordinate Changes:');
    for (const cc of diff.coordinateChanged) {
      console.log(`  [${cc.sourceCode}] ${cc.governorate}: ${cc.nameEnglish} shifted by ~${cc.distanceKm} km`);
    }
    console.log('');
  }
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const candidateIndex = args.indexOf('--candidate');
  const fetchIndex = args.indexOf('--fetch');
  const officialCountIndex = args.indexOf('--official-count');
  const govCountIndex = args.indexOf('--gov-count');
  const identityTransfersIndex = args.indexOf('--identity-transfers');
  const legacyLifecycleDecisionsIndex = args.indexOf('--legacy-lifecycle-decisions');
  const applyFlag = args.includes('--apply');

  const currentCatalog = getOfficialCatalog();
  let candidateSnapshot: CitySnapshot;
  if (candidateIndex !== -1 && args[candidateIndex + 1]) {
    const candidatePath = path.resolve(process.cwd(), args[candidateIndex + 1]);
    console.log(`Loading candidate snapshot from: ${candidatePath}`);
    candidateSnapshot = JSON.parse(fs.readFileSync(candidatePath, 'utf8')) as CitySnapshot;
  } else if (fetchIndex !== -1) {
    const fetchUrl = args[fetchIndex + 1] && !args[fetchIndex + 1].startsWith('--') ? args[fetchIndex + 1] : undefined;
    console.log(`Fetching candidate upstream snapshot from OCHA HDX resource (${fetchUrl || 'default'})...`);
    candidateSnapshot = await fetchUpstreamSnapshot(fetchUrl);
  } else {
    console.log('No candidate specified; comparing raw local snapshot with compiled catalog...');
    candidateSnapshot = loadRawSnapshot();
  }

  const diff = compareSnapshots(currentCatalog, candidateSnapshot);
  printDiffReport(diff);

  if (applyFlag) {
    console.log('Applying reviewed release and generating append-only migration...');

    const options: ReviewedReleaseOptions = {};

    if (officialCountIndex !== -1 && args[officialCountIndex + 1]) {
      options.reviewedMetadata = options.reviewedMetadata || {};
      options.reviewedMetadata.declaredOfficialCount = parseInt(args[officialCountIndex + 1], 10);
    }
    if (govCountIndex !== -1 && args[govCountIndex + 1]) {
      options.reviewedMetadata = options.reviewedMetadata || {};
      options.reviewedMetadata.governorateCount = parseInt(args[govCountIndex + 1], 10);
    }

    if (identityTransfersIndex !== -1 && args[identityTransfersIndex + 1]) {
      const identityTransfersPath = path.resolve(process.cwd(), args[identityTransfersIndex + 1]);
      const identityTransfersContent = fs.readFileSync(identityTransfersPath, 'utf8');
      options.identityTransfers = JSON.parse(identityTransfersContent) as ReviewedReleaseOptions['identityTransfers'];
    }
    if (legacyLifecycleDecisionsIndex !== -1 && args[legacyLifecycleDecisionsIndex + 1]) {
      const legacyLifecycleDecisionsPath = path.resolve(process.cwd(), args[legacyLifecycleDecisionsIndex + 1]);
      const legacyLifecycleDecisionsContent = fs.readFileSync(legacyLifecycleDecisionsPath, 'utf8');
      options.legacyLifecycleDecisions = JSON.parse(
        legacyLifecycleDecisionsContent,
      ) as ReviewedReleaseOptions['legacyLifecycleDecisions'];
    }

    const result = publishReviewedRelease(currentCatalog, candidateSnapshot, options);

    console.log(`✓ Updated catalog written to: ${result.catalogPath}`);
    console.log(`✓ Updated raw snapshot written to: ${result.snapshotPath}`);
    console.log(`✓ Monotonically ordered migration written to: ${result.migrationPath} (${result.migrationTag})`);
    if (result.journalUpdated) {
      console.log('✓ Drizzle migrations journal updated.');
    }
    console.log(
      `✓ Release summary: ${result.release.officialCount} official Cities, ${result.release.legacyCount} legacy Cities, ${result.release.retiredCount} retired Cities.`,
    );
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Refresh command failed:', err);
      process.exit(1);
    });
}

import * as fs from 'fs';
import * as path from 'path';
import {
  compareSnapshots,
  applyReviewedRelease,
  fetchUpstreamSnapshot,
  type SnapshotDiffReport,
} from '../refresh';
import { getOfficialCatalog, loadRawSnapshot, type CitySnapshot } from '../catalog';
import { generateReconcileMigrationSql, loadLegacyMappings } from '../reconcile';

function printDiffReport(diff: SnapshotDiffReport): void {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('            UPSTREAM CITY CATALOG DIFF REPORT                  ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Current catalog total:   ${diff.summary.totalCurrent}`);
  console.log(`Candidate snapshot total: ${diff.summary.totalCandidate}`);
  console.log('───────────────────────────────────────────────────────────────');
  console.log(`  Added areas:              ${diff.summary.addedCount}`);
  console.log(`  Removed areas:            ${diff.summary.removedCount}`);
  console.log(`  Renamed areas:            ${diff.summary.renamedCount}`);
  console.log(`  Recoded areas:            ${diff.summary.recodedCount}`);
  console.log(`  Coordinate changes:       ${diff.summary.coordinateChangedCount}`);
  console.log('───────────────────────────────────────────────────────────────\n');

  if (diff.added.length > 0) {
    console.log('➕ Added Areas:');
    for (const a of diff.added) {
      console.log(`  [${a.sourceCode}] ${a.governorate}: ${a.nameEnglish} (${a.nameArabic})`);
    }
    console.log('');
  }

  if (diff.removed.length > 0) {
    console.log('➖ Removed Areas (will become RETIRED):');
    for (const r of diff.removed) {
      console.log(`  [${r.sourceCode}] ${r.governorate}: ${r.nameEnglish} (${r.nameArabic})`);
    }
    console.log('');
  }

  if (diff.renamed.length > 0) {
    console.log('✏️  Renamed Areas:');
    for (const rn of diff.renamed) {
      console.log(
        `  [${rn.sourceCode}] ${rn.governorate}: "${rn.oldNameEnglish}" -> "${rn.newNameEnglish}" | "${rn.oldNameArabic}" -> "${rn.newNameArabic}"`,
      );
    }
    console.log('');
  }

  if (diff.recoded.length > 0) {
    console.log('🔄 Recoded Areas:');
    for (const rc of diff.recoded) {
      console.log(`  ${rc.governorate}: ${rc.nameEnglish} code changed: ${rc.oldSourceCode} -> ${rc.newSourceCode}`);
    }
    console.log('');
  }

  if (diff.coordinateChanged.length > 0) {
    console.log('📍 Coordinate Changes:');
    for (const cc of diff.coordinateChanged) {
      console.log(
        `  [${cc.sourceCode}] ${cc.governorate}: ${cc.nameEnglish} shifted by ~${cc.distanceKm} km`,
      );
    }
    console.log('');
  }
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const candidateIndex = args.indexOf('--candidate');
  const fetchFlag = args.includes('--fetch');
  const applyFlag = args.includes('--apply');

  const currentCatalog = getOfficialCatalog();
  let candidateSnapshot: CitySnapshot;

  if (candidateIndex !== -1 && args[candidateIndex + 1]) {
    const candidatePath = path.resolve(process.cwd(), args[candidateIndex + 1]);
    console.log(`Loading candidate snapshot from: ${candidatePath}`);
    candidateSnapshot = JSON.parse(fs.readFileSync(candidatePath, 'utf8')) as CitySnapshot;
  } else if (fetchFlag) {
    console.log('Fetching candidate upstream snapshot from OCHA HDX...');
    candidateSnapshot = await fetchUpstreamSnapshot();
  } else {
    console.log('No candidate specified; comparing raw local snapshot with compiled catalog...');
    candidateSnapshot = loadRawSnapshot();
  }

  const diff = compareSnapshots(currentCatalog, candidateSnapshot);
  printDiffReport(diff);

  if (applyFlag) {
    console.log('Applying reviewed release and regenerating artifacts...');
    const release = applyReviewedRelease(currentCatalog, candidateSnapshot);

    const catalogPath = path.resolve(__dirname, '../data/egypt-cities-catalog.json');
    fs.writeFileSync(
      catalogPath,
      JSON.stringify({ records: release.updatedCatalog }, null, 2),
      'utf8',
    );
    console.log(`✓ Updated catalog written to ${catalogPath}`);

    const mappings = loadLegacyMappings();
    const migrationSql = generateReconcileMigrationSql(mappings, release.updatedCatalog);
    const migrationPath = path.resolve(__dirname, '../../../drizzle/migrations/0011_reconcile_city_catalog.sql');
    fs.writeFileSync(migrationPath, migrationSql, 'utf8');
    console.log(`✓ Updated reconciliation migration written to ${migrationPath}`);
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

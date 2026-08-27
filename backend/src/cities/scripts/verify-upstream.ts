import { fetchUpstreamSnapshot, DEFAULT_RESOURCE_URL, DEFAULT_DATASET_URL } from '../fetch';
import { getOfficialCatalog } from '../catalog';
import { compareSnapshots } from '../diff';

/**
 * Maintainer tool to verify that the upstream OCHA COD-AB Egypt live resource
 * remains reachable, downloadable, and usable without modifying any repository artifacts.
 */
export async function verifyUpstreamResource(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('       OCHA COD-AB EGYPT UPSTREAM RESOURCE LIVE VERIFICATION    ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Dataset Landing Page: ${DEFAULT_DATASET_URL}`);
  console.log(`Default Resource URL: ${DEFAULT_RESOURCE_URL}`);
  console.log('Fetching and validating live upstream artifact (read-only)...');

  const startTime = Date.now();
  const candidateSnapshot = await fetchUpstreamSnapshot(DEFAULT_RESOURCE_URL);
  const elapsedMs = Date.now() - startTime;

  console.log(`\n✓ Live upstream artifact fetched and validated in ${elapsedMs} ms!`);
  console.log('───────────────────────────────────────────────────────────────');
  console.log(`Source:              ${candidateSnapshot.metadata.source}`);
  console.log(`Upstream Version:    ${candidateSnapshot.metadata.upstreamVersion}`);
  console.log(`Valid On:            ${candidateSnapshot.metadata.upstreamDates.validOn}`);
  console.log(`Reviewed Date:       ${candidateSnapshot.metadata.upstreamDates.reviewedDate}`);
  console.log(`Last Modified:       ${candidateSnapshot.metadata.upstreamDates.lastModified}`);
  console.log(`Retrieval Date:      ${candidateSnapshot.metadata.retrievalDate}`);
  console.log(`License:             ${candidateSnapshot.metadata.license}`);
  console.log(`License URL:         ${candidateSnapshot.metadata.licenseUrl}`);
  console.log(`Attribution:         ${candidateSnapshot.metadata.attribution}`);
  console.log('───────────────────────────────────────────────────────────────');
  console.log(`Total Upstream Rows: ${candidateSnapshot.metadata.totalRows}`);
  console.log(`Outside Zemam Count: ${candidateSnapshot.metadata.outsideZemamCount}`);
  console.log(`Selectable Cities:   ${candidateSnapshot.metadata.selectableCount}`);
  console.log(`Governorates:        ${candidateSnapshot.metadata.governorateCount}`);
  console.log('───────────────────────────────────────────────────────────────');

  const currentCatalog = getOfficialCatalog();
  const diff = compareSnapshots(currentCatalog, candidateSnapshot);

  console.log('\nComparison with current catalog:');
  console.log(`  Added:              ${diff.summary.addedCount}`);
  console.log(`  Removed:            ${diff.summary.removedCount}`);
  console.log(`  Renamed:            ${diff.summary.renamedCount}`);
  console.log(`  Recoded:            ${diff.summary.recodedCount}`);
  console.log(`  Coordinate changes: ${diff.summary.coordinateChangedCount}`);
  console.log('───────────────────────────────────────────────────────────────');
  console.log('✅ Upstream resource is healthy and ready for review/release.');
}

if (require.main === module) {
  verifyUpstreamResource()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ Upstream resource verification failed:', err);
      process.exit(1);
    });
}

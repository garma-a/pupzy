/** Disposable SQL benchmark only. This writes no release artifact or migration journal. */
import * as fs from 'fs';
import * as path from 'path';
import { loadOfficialCatalog, transformCatalog, type CitySnapshot } from '../catalog';
import { applyReviewedRelease } from '../plan';
import { generateReleaseMigrationSql } from '../migration';
const folder = path.resolve(process.cwd(), 'output/neighbourhood-cities');
const snapshot = JSON.parse(fs.readFileSync(path.join(folder, 'candidate-snapshot.json'), 'utf8')) as CitySnapshot;
const candidate = transformCatalog(snapshot);
const release = applyReviewedRelease(loadOfficialCatalog().records, snapshot, {
  reviewedMetadata: { declaredOfficialCount: candidate.records.length, governorateCount: 27 },
});
fs.writeFileSync(
  path.join(folder, 'candidate-benchmark.sql'),
  '-- BENCHMARK ONLY: publication gates have not passed. Do not use as a release.\n' +
    generateReleaseMigrationSql(release, { migrationTag: '0066_release_city_catalog' }),
);
console.log(`${release.officialCount} rows; disposable benchmark SQL only. Publisher gates still apply.`);

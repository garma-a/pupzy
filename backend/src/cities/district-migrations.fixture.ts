/** Historical ADR0002 scenarios stop before the Neighbourhood catalog release. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateReleaseMigrationSql, type MigrationJournal } from './migration';
import { readCityData } from './data-files';
import { loadRawSnapshot, type CityCatalog } from './catalog';
import { compareSnapshots } from './diff';

export function districtMigrationsFixture(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pupzy-district-migrations-'));
  fs.cpSync(path.resolve(__dirname, '../../drizzle/migrations'), directory, { recursive: true });
  for (const file of fs.readdirSync(directory)) {
    if (/^\d{4}_.*\.sql$/.test(file) && Number(file.slice(0, 4)) > 65) fs.unlinkSync(path.join(directory, file));
  }
  const journalPath = path.join(directory, 'meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as MigrationJournal;
  journal.entries = journal.entries.filter((entry) => Number(entry.tag.slice(0, 4)) <= 65);
  // Preserve the historical district display cleanup and its revision bump.
  // The actual Neighbourhood0066 is exercised by neighbourhoods.integration.spec.
  const seed = readCityData<CityCatalog>('neighbourhoods/district-seed.json.gz');
  const tag = '0066_release_city_catalog';
  fs.writeFileSync(
    path.join(directory, tag + '.sql'),
    generateReleaseMigrationSql(
      {
        updatedCatalog: seed.records,
        diffReport: compareSnapshots([], loadRawSnapshot()),
        retiredCount: 0,
        officialCount: seed.records.length,
        legacyCount: 0,
        metadata: seed.metadata,
        identityTransfers: [],
        legacyLifecycleDecisions: [],
      },
      { migrationTag: tag },
    ),
  );
  const last = journal.entries[journal.entries.length - 1];
  if (!last || typeof last.when !== 'number') throw new Error('Historical fixture requires a dated migration tail');
  journal.entries.push({ idx: last.idx + 1, version: last.version, when: last.when + 1000, tag, breakpoints: true });
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  return directory;
}

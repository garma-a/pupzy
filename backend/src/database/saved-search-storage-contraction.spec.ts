import * as fs from 'fs';
import * as path from 'path';

/**
 * Ticket 19: contract the retired saved-search storage.
 *
 * Ticket 18 removed every saved-search runtime surface but deliberately left
 * the `saved_searches` table and its transitional references for deployment
 * overlap. This contraction is authorized by spec Implementation Decision 22
 * and must:
 *   - keep every historical migration byte-for-byte intact;
 *   - drop the table through exactly one new forward migration;
 *   - leave no Drizzle export, runtime reference, admin registration or test
 *     fixture that still reads the dropped storage.
 */
describe('Saved-search storage contraction (ticket 19)', () => {
  const BACKEND_ROOT = path.resolve(__dirname, '../..');
  const MIGRATIONS_DIR = path.join(BACKEND_ROOT, 'drizzle/migrations');
  const CONTRACTION_TAG = '0053_drop_saved_searches';
  const SCHEMA_MODULE = path.join(BACKEND_ROOT, 'src/database/schema/saved-searches.schema.ts');

  // Storage identifiers only: the retained `SYSTEM_ANNOUNCEMENT` notification
  // enum/templates may still describe the retired feature in prose.
  const STORAGE_IDENTIFIER = /saved_searches|savedSearches|\bSavedSearch\b/;

  interface JournalEntry {
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }

  interface JournalData {
    version: string;
    dialect: string;
    entries: JournalEntry[];
  }

  function collectFiles(dir: string, isCandidate: (name: string) => boolean, files: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') collectFiles(fullPath, isCandidate, files);
      } else if (isCandidate(entry.name)) {
        files.push(fullPath);
      }
    }
    return files;
  }

  function journal(): JournalData {
    return JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as JournalData;
  }

  it('preserves the historical migrations that create and evolve saved_searches', () => {
    const create = fs.readFileSync(path.join(MIGRATIONS_DIR, '0000_familiar_shiver_man.sql'), 'utf8');
    expect(create).toContain('CREATE TABLE "saved_searches"');
    expect(create).toContain('idx_saved_searches_match');

    const speciesRecast = fs.readFileSync(path.join(MIGRATIONS_DIR, '0003_nosy_korg.sql'), 'utf8');
    expect(speciesRecast).toContain('ALTER TABLE "saved_searches" ALTER COLUMN "species" SET DATA TYPE text;');
    expect(speciesRecast).toContain(
      'ALTER TABLE "saved_searches" ALTER COLUMN "species" SET DATA TYPE "public"."species_type"',
    );
  });

  it('drops saved-search storage through exactly one forward migration', () => {
    const migrationFiles = fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql'));
    const droppingMigrations = migrationFiles.filter((file) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      return /drop\s+table\s+(if\s+exists\s+)?"saved_searches"/i.test(sql);
    });

    expect(droppingMigrations).toEqual([`${CONTRACTION_TAG}.sql`]);
  });

  it('registers the contraction migration once, after every earlier migration', () => {
    const { entries } = journal();
    const tags = entries.map((entry) => entry.tag);

    expect(tags.filter((tag) => tag === CONTRACTION_TAG)).toHaveLength(1);

    // The contraction was introduced after the historical migrations that
    // existed when it shipped; later unrelated migrations may follow it.
    const contractionIndex = entries.findIndex((entry) => entry.tag === CONTRACTION_TAG);
    expect(entries[contractionIndex - 1]?.tag).toBe('0052_add_normalized_feed_search');
    expect(entries[contractionIndex].idx).toBe(contractionIndex);
    expect(entries.every((entry, index) => entry.idx === index)).toBe(true);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('removes the Drizzle table module and its schema barrel export', () => {
    expect(fs.existsSync(SCHEMA_MODULE)).toBe(false);

    const barrel = fs.readFileSync(path.join(BACKEND_ROOT, 'src/database/schema/index.ts'), 'utf8');
    expect(barrel).not.toMatch(/saved-searches/);
  });

  it('leaves no storage reference in backend runtime, backend test helpers, admin runtime or admin test fixtures', () => {
    const backendRuntime = collectFiles(path.join(BACKEND_ROOT, 'src'), (name) => !name.endsWith('.spec.ts'));
    const backendTestHelpers = collectFiles(
      path.join(BACKEND_ROOT, 'test'),
      (name) => !name.endsWith('.spec.ts') && !name.includes('e2e-spec'),
    );
    const adminRuntime = collectFiles(
      path.join(BACKEND_ROOT, 'admin-service/src'),
      (name) => !name.endsWith('.test.js'),
    );
    const adminTestFixtures = collectFiles(path.join(BACKEND_ROOT, 'admin-service/test'), () => true);

    const offenders = [...backendRuntime, ...backendTestHelpers, ...adminRuntime, ...adminTestFixtures].filter((file) =>
      STORAGE_IDENTIFIER.test(fs.readFileSync(file, 'utf8')),
    );

    expect(offenders.map((file) => path.relative(BACKEND_ROOT, file))).toEqual([]);
  });
});

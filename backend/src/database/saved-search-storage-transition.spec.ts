import * as fs from 'fs';
import * as path from 'path';
import { getTableName } from 'drizzle-orm';
import { savedSearches } from './schema';

/**
 * Ticket 18 retires saved-search runtime surfaces but deliberately leaves the
 * `saved_searches` table in place for deployment overlap. Ticket 19 owns the
 * destructive forward migration. These guards keep historical migrations
 * untouched and stop the storage contraction from landing with this slice.
 */
describe('Saved-search storage transition (ticket 18, contracted by ticket 19)', () => {
  const migrationsDir = path.resolve(__dirname, '../../drizzle/migrations');
  const migrationFiles = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql'));

  it('preserves the historical migrations that create and evolve saved_searches', () => {
    const create = fs.readFileSync(path.join(migrationsDir, '0000_familiar_shiver_man.sql'), 'utf8');
    expect(create).toContain('CREATE TABLE "saved_searches"');
    expect(create).toContain('idx_saved_searches_match');

    const speciesRecast = fs.readFileSync(path.join(migrationsDir, '0003_nosy_korg.sql'), 'utf8');
    expect(speciesRecast).toContain('"saved_searches"');
  });

  it('has not contracted saved-search storage during the runtime retirement', () => {
    const droppingMigrations = migrationFiles.filter((file) => {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      return /drop\s+table\s+(if\s+exists\s+)?"saved_searches"/i.test(sql);
    });
    expect(droppingMigrations).toEqual([]);

    const columnDrops = migrationFiles.filter((file) => {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      return /alter\s+table\s+"saved_searches"[\s\S]*?drop\s+column/i.test(sql);
    });
    expect(columnDrops).toEqual([]);
  });

  it('keeps the temporary Drizzle export available for transitional Account Deletion cleanup', () => {
    expect(savedSearches).toBeDefined();
    expect(getTableName(savedSearches)).toBe('saved_searches');
  });
});

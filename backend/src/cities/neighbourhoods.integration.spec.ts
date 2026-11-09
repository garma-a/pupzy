import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as schema from '../database/schema';
import { runMigrations } from '../database/migrate';
import { CitiesRepository } from './cities.repository';
import { generateCityUpsertSql } from './release-sql';
import { getOfficialCatalog } from './catalog';
import type { GpsChecks } from './coverage';

describe('Neighbourhood schema upgrade on disposable PostGIS', () => {
  jest.setTimeout(90000);
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let temp: string;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4-alpine')
      .withDatabase('neighbourhood_upgrade_test')
      .withUsername('test')
      .withPassword('test')
      .start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'neighbourhood-main-schema-'));
    const folder = path.resolve(process.cwd(), 'drizzle/migrations');
    fs.cpSync(folder, temp, { recursive: true });
    const journalFile = path.join(temp, 'meta/_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8')) as { entries: Array<{ idx: number }> };
    journal.entries = journal.entries.filter((e) => e.idx <= 64);
    fs.writeFileSync(journalFile, JSON.stringify(journal));
    await runMigrations({ pool, migrationsFolder: temp });
    await pool.query(
      `INSERT INTO users (firebase_user_id, email, home_city_id) SELECT 'neighbourhood-test', 'neighbourhood@example.invalid', id FROM cities WHERE source_code = 'EG0202'`,
    );
    await pool.query(
      `INSERT INTO posts (creator_id, post_type, title, description, city_id, urgency, coordinates) SELECT users.id, 'RESCUE', 'Test', 'Test', cities.id, 'URGENT', cities.center_point FROM users CROSS JOIN cities WHERE users.firebase_user_id = 'neighbourhood-test' AND cities.source_code = 'EG0202'`,
    );
    await pool.query(`CREATE TABLE test_city_identities AS SELECT id, source_code FROM cities`);
    await runMigrations({ pool });
  });
  afterAll(async () => {
    await pool?.end();
    await container?.stop();
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  });
  it('keeps district UUIDs and user/post references through upgrade and rerun', async () => {
    for (const file of ['0065_add_city_neighbourhood_fields.sql', '0066_release_city_catalog.sql'])
      await pool.query(fs.readFileSync(path.resolve('drizzle/migrations', file), 'utf8'));
    const changed = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM test_city_identities old LEFT JOIN cities USING (source_code) WHERE cities.id IS DISTINCT FROM old.id`,
    );
    expect(changed.rows[0].count).toBe(0);
    const refs = await pool.query<{ preserved: boolean }>(
      `SELECT users.home_city_id = posts.city_id AS preserved FROM users JOIN posts ON posts.creator_id = users.id WHERE users.firebase_user_id = 'neighbourhood-test'`,
    );
    expect(refs.rows[0].preserved).toBe(true);
  });
  it('selects official neighbourhoods by GPS and rejects a nested district', async () => {
    const district = getOfficialCatalog().find((r) => r.sourceCode === 'EG0202')!;
    const child = {
      ...district,
      sourceCode: 'PUPZY:integration-quarter',
      nameEnglish: 'Integration Quarter',
      nameArabic: 'حي الاختبار',
      longitude: district.longitude + 0.001,
      districtSourceCode: district.sourceCode,
    };
    await pool.query(generateCityUpsertSql(child));
    const repository = new CitiesRepository(drizzle(pool, { schema }));
    const found = await repository.findNearest(child.latitude, child.longitude);
    expect(found?.sourceCode).toBe(child.sourceCode);
    await expect(
      pool.query(`UPDATE cities SET district_id = $1 WHERE source_code = 'EG0202'`, [found!.id]),
    ).rejects.toThrow();
    await pool.query(`DELETE FROM cities WHERE source_code = 'PUPZY:integration-quarter'`);
  });
  it('GPS data review gate: requires reviewed fixtures and 30 repository spot checks per area', async () => {
    const fixture = JSON.parse(
      fs.readFileSync(path.resolve('src/cities/data/neighbourhoods/gps-checks.json'), 'utf8'),
    ) as GpsChecks;
    const repository = new CitiesRepository(drizzle(pool, { schema }));
    expect(fixture.metadata.reviewed).toBe(true);
    for (const checks of Object.values(fixture.areas)) {
      expect(checks.length).toBeGreaterThanOrEqual(30);
      for (const check of checks) {
        const city = await repository.findNearest(check.latitude, check.longitude);
        expect(check.acceptableSourceCodes).toContain(city?.sourceCode);
      }
    }
  });
});

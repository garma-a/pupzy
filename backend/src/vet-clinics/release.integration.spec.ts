import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '../database/migrate';
import { Clinic, readData } from './catalog';
import { legacy, legacyCityCodes } from './migration';

interface Journal {
  entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
}
const migrationRoot = path.resolve(__dirname, '../../drizzle/migrations');
const fullJournal = JSON.parse(fs.readFileSync(path.join(migrationRoot, 'meta/_journal.json'), 'utf8')) as Journal;
const data = readData<Clinic[]>('egypt-vet-clinics.json');
const releaseSql = fs.readFileSync(path.join(migrationRoot, '0068_release_egypt_vet_clinics.sql'), 'utf8');

describe('Vet Clinic release via production Drizzle migrator (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  const temporary: string[] = [];
  function fixture(last: number, probe = false) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pupzy-vet-migrations-'));
    temporary.push(dir);
    fs.mkdirSync(path.join(dir, 'meta'));
    const entries = fullJournal.entries.filter((e) => e.idx <= last);
    entries.forEach((e) => fs.copyFileSync(path.join(migrationRoot, e.tag + '.sql'), path.join(dir, e.tag + '.sql')));
    if (probe) {
      // This is deliberately the NEXT pending migration in the same migrate()
      // invocation. An ADD VALUE implementation fails here with SQLSTATE 55P04.
      const entry = {
        idx: 71,
        version: '7',
        when: entries.at(-1)!.when + 1,
        tag: '0071_probe_web_enum',
        breakpoints: true,
      };
      entries.push(entry);
      fs.writeFileSync(
        path.join(dir, entry.tag + '.sql'),
        `INSERT INTO vet_clinics (name_english, source, source_key, coordinates, is_active) VALUES ('Enum probe', 'WEB_RESEARCH', 'WEB:enum-probe', ST_SetSRID(ST_MakePoint(31.2804034,29.9731857),4326), false);`,
      );
    }
    fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify({ ...fullJournal, entries }));
    return dir;
  }
  const migrateTo = (dir: string) =>
    runMigrations({
      pool,
      migrationsFolder: dir,
      customSqlPath: path.join(migrationRoot, '../custom.sql'),
      logger: { log: () => {}, error: () => {} },
    });
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4-alpine')
      .withDatabase('pupzy_vets_test')
      .withUsername('test')
      .withPassword('test')
      .start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
    await container?.stop();
    temporary.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  });
  beforeEach(async () => {
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  });
  it('migrates an empty database, consumes WEB_RESEARCH in the same batch, resolves Cities, and reruns without changing rows/revision', async () => {
    const dir = fixture(70, true);
    await migrateTo(dir);
    const rows = await pool.query(
      `SELECT v.source_key, c.source_code AS city, ST_X(v.coordinates) AS longitude, ST_Y(v.coordinates) AS latitude, v.phone_number, v.is_active, v.is_24_hours, v.facebook_url, v.location_precision FROM vet_clinics v JOIN cities c ON c.id=v.city_id ORDER BY source_key COLLATE "C"`,
    );
    expect(rows.rows).toEqual(
      [...data]
        .sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0))
        .map((c) => ({
          source_key: c.sourceKey,
          city: c.cityId,
          longitude: c.longitude,
          latitude: c.latitude,
          phone_number: c.phone,
          is_active: c.active,
          is_24_hours: c.is24Hours,
          facebook_url: c.facebookUrl,
          location_precision: c.locationPrecision,
        })),
    );
    const snapshot = await pool.query('SELECT to_jsonb(v) AS row FROM vet_clinics v ORDER BY id');
    const rev = await pool.query('SELECT revision FROM city_catalog_revisions WHERE id=1');
    await migrateTo(dir);
    await pool.query(releaseSql);
    expect((await pool.query('SELECT to_jsonb(v) AS row FROM vet_clinics v ORDER BY id')).rows).toEqual(snapshot.rows);
    expect((await pool.query('SELECT revision FROM city_catalog_revisions WHERE id=1')).rows).toEqual(rev.rows);
  }, 120_000);
  it('updates pristine seed rows, disables pristine exclusions, preserves administrator edits byte for byte and inserts missing clinics', async () => {
    await migrateTo(fixture(66));
    const edits = [
      'name_english',
      'name_arabic',
      'phone_number',
      'address',
      'address_english',
      'address_arabic',
      'coordinates',
      'city_id',
      'website',
      'source',
      'is_active',
      'location_provenance',
      'location_captured_at',
      'updated_at',
    ];
    // Keep two rows pristine; exercise a different administrator-owned field on
    // each of the remaining rows, including rejected and included source rows.
    const protectedRows: Array<{ id: string; row: unknown }> = [];
    let editIndex = 0;
    for (const [i, c] of legacy.entries()) {
      const ar = !!c.address && /[\u0600-\u06ff]/.test(c.address);
      const result = await pool.query<{ id: string }>(
        `INSERT INTO vet_clinics (name_english,name_arabic,area_name,city_id,coordinates,phone_number,address,address_english,address_arabic,website,source,osm_id,osm_type,location_provenance,is_active) VALUES ($1,$2,$3,(SELECT id FROM cities WHERE source_code=$4),ST_SetSRID(ST_MakePoint($5,$6),4326),$7,$8,$9,$10,$11,'OSM',$12,$13,'OSM',true) RETURNING id`,
        [
          c.name_english,
          c.name_arabic,
          c.city_hint ?? c.governorate_hint,
          legacyCityCodes[i],
          c.longitude,
          c.latitude,
          c.phone_number,
          c.address,
          ar ? null : c.address,
          ar ? c.address : null,
          c.website,
          c.osm_id,
          c.osm_type,
        ],
      );
      const id = result.rows[0].id;
      if (i !== 0 && i !== 5) {
        const field = edits[editIndex++];
        const sqlValue =
          field === 'coordinates'
            ? 'ST_Translate(coordinates,0.001,0)'
            : field === 'city_id'
              ? 'NULL'
              : field === 'source'
                ? "'MANUAL'"
                : field === 'is_active'
                  ? 'false'
                  : ['updated_at', 'location_captured_at'].includes(field)
                    ? "now()+interval '1 minute'"
                    : field === 'phone_number'
                      ? "'+201012345678'"
                      : field === 'website'
                        ? "'https://admin.example/'"
                        : "'Administrator edit'";
        await pool.query(`UPDATE vet_clinics SET ${field}=${sqlValue} WHERE id=$1`, [id]);
        protectedRows.push({
          id,
          row: (
            await pool.query<{ row: unknown }>(
              `SELECT to_jsonb(v) - 'source_key' - 'is_24_hours' - 'facebook_url' - 'location_precision' AS row FROM vet_clinics v WHERE id=$1`,
              [id],
            )
          ).rows[0].row,
        });
      }
    }
    await migrateTo(fixture(70, true));
    for (const item of protectedRows)
      expect(
        (
          await pool.query<{ row: unknown }>(
            `SELECT to_jsonb(v) - 'source_key' - 'is_24_hours' - 'facebook_url' - 'location_precision' AS row FROM vet_clinics v WHERE id=$1`,
            [item.id],
          )
        ).rows[0].row,
      ).toEqual(item.row);
    expect((await pool.query('SELECT phone_number, is_active FROM vet_clinics WHERE osm_id=5617442828')).rows).toEqual([
      { phone_number: '+201013779994', is_active: true },
    ]);
    // ACE is an unresolved exclusion; the approved modern clinic gets E.164 and keeps its UUID.
    expect((await pool.query('SELECT is_active FROM vet_clinics WHERE osm_id=2185265914')).rows).toEqual([
      { is_active: false },
    ]);
    expect(
      (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM vet_clinics WHERE osm_id=6691724991')).rows[0].n,
    ).toBe(1);
  }, 120_000);
  it('checks unique keys, Egyptian phone and http(s) constraints on subsequent writes', async () => {
    await migrateTo(fixture(70));
    expect(
      (
        await pool.query<{ location_precision: string }>(
          "SELECT DISTINCT location_precision FROM vet_clinics WHERE source_key LIKE 'WEB:%'",
        )
      ).rows.every((r) => ['exact', 'street', 'area'].includes(r.location_precision)),
    ).toBe(true);
    const base = `INSERT INTO vet_clinics (source_key,coordinates,phone_number,website,facebook_url) VALUES ($1,ST_SetSRID(ST_MakePoint(31.2804034,29.9731857),4326),$2,$3,$4)`;
    await expect(
      pool.query(
        "INSERT INTO vet_clinics(coordinates, location_precision) VALUES(ST_SetSRID(ST_MakePoint(31,30),4326), 'invented')",
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await pool.query(base, ['WEB:valid', '+20223456789', 'https://clinic.example/', 'http://facebook.com/clinic']);
    await expect(pool.query(base, ['WEB:valid', null, null, null])).rejects.toMatchObject({ code: '23505' });
    for (const phone of ['01012345678', '+201312345678', 'junk', '+202123'])
      await expect(pool.query(base, ['WEB:bad-phone', phone, null, null])).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(base, ['WEB:bad-site', null, 'javascript:alert(1)', null])).rejects.toMatchObject({
      code: '23514',
    });
    await expect(pool.query(base, ['WEB:bad-host', null, 'https://?invalid-host', null])).rejects.toMatchObject({
      code: '23514',
    });
    await expect(pool.query(base, ['WEB:bad-fb', null, null, 'ftp://example.com'])).rejects.toMatchObject({
      code: '23514',
    });
  }, 120_000);
});

import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { runMigrations } from '../database/migrate';
import { getOfficialCatalog, type CitySnapshot } from './catalog';
import { applyReviewedRelease, generateReleaseMigrationSql, publishReviewedRelease } from './refresh';
import { CitiesRepository } from './cities.repository';
import { CitiesService } from './cities.service';
import type { Cache } from 'cache-manager';

describe('Reviewed Append-Only Release Workflow Integration (Disposable PostgreSQL)', () => {
  jest.setTimeout(90_000);
  let container: StartedPostgreSqlContainer;
  let connectionString: string;
  let pool: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4-alpine')
      .withDatabase('pupzy_release_integration_test')
      .withUsername('test')
      .withPassword('test')
      .start();

    connectionString = container.getConnectionUri();
    pool = new Pool({ connectionString });
  }, 90_000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
  });

  const setupDatabasePrerequisites = async () => {
    await pool.query('CREATE EXTENSION IF NOT EXISTS postgis;');
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    await pool.query(`
      CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
        SELECT (
          lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') ||
          '7' || substr(encode(gen_random_bytes(2), 'hex'), 2, 3) ||
          '8' || substr(encode(gen_random_bytes(2), 'hex'), 2, 3) ||
          encode(gen_random_bytes(6), 'hex')
        )::uuid;
      $$ LANGUAGE sql VOLATILE;
    `);
  };

  const cleanDatabase = async () => {
    await pool.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'spatial_ref_sys') LOOP
          EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;

        FOR r IN (
          SELECT typname
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public'
            AND t.typtype = 'e'
        ) LOOP
          EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
        END LOOP;

        FOR r IN (
          SELECT viewname
          FROM pg_views
          WHERE schemaname = 'public'
            AND viewname NOT LIKE 'geometry_%'
            AND viewname NOT LIKE 'geography_%'
            AND viewname != 'spatial_ref_sys'
        ) LOOP
          EXECUTE 'DROP VIEW IF EXISTS public.' || quote_ident(r.viewname) || ' CASCADE';
        END LOOP;
      END $$;
      DROP SCHEMA IF EXISTS drizzle CASCADE;
    `);
    await setupDatabasePrerequisites();
  };

  const createFutureReleaseMigration = () => {
    const baseCatalog = getOfficialCatalog();
    expect(baseCatalog.length).toBe(351);

    // Create candidate where:
    // - 2 Cairo cities (EG0101, EG0102) are removed upstream -> become RETIRED
    // - 1 new Cairo city (EG0198) is added upstream -> becomes OFFICIAL
    // - 1 existing city (EG0104 Maadi) is updated with new canonical coordinates/name
    const rawRecords = baseCatalog
      .filter((c) => c.sourceCode !== 'EG0101' && c.sourceCode !== 'EG0102')
      .map((c) => {
        if (c.sourceCode === 'EG0104') {
          return {
            adm2_name: 'Maadi Updated',
            adm2_name1: 'المعادي المحدثة',
            adm2_pcode: c.sourceCode,
            adm1_name: c.governorate,
            adm1_name1: c.governorateArabic || '',
            adm1_pcode: c.governorateCode,
            adm0_name: 'Egypt',
            adm0_name1: 'مصر',
            adm0_pcode: 'EG',
            center_lat: 29.9601,
            center_lon: 31.2601,
          };
        }
        return {
          adm2_name: c.sourceNameEnglish,
          adm2_name1: c.sourceNameArabic,
          adm2_pcode: c.sourceCode,
          adm1_name: c.governorate,
          adm1_name1: c.governorateArabic || '',
          adm1_pcode: c.governorateCode,
          adm0_name: 'Egypt',
          adm0_name1: 'مصر',
          adm0_pcode: 'EG',
          center_lat: c.latitude,
          center_lon: c.longitude,
        };
      });

    // Add new candidate city
    rawRecords.push({
      adm2_name: 'New Administrative Capital Sector 1',
      adm2_name1: 'العاصمة الإدارية الجديدة قطاع 1',
      adm2_pcode: 'EG0198',
      adm1_name: 'Cairo',
      adm1_name1: 'القاهرة',
      adm1_pcode: 'EG01',
      adm0_name: 'Egypt',
      adm0_name1: 'مصر',
      adm0_pcode: 'EG',
      center_lat: 30.015,
      center_lon: 31.75,
    });

    const candidateSnapshot: CitySnapshot = {
      metadata: {
        source: 'OCHA COD-AB Egypt 2026.2',
        sourceUrl: 'https://data.humdata.org/dataset/cod-ab-egy',
        resourceUrl:
          'https://data.humdata.org/dataset/b90d81ba-7c7a-4283-9899-827480d80a79/resource/81126a96-2991-48e1-93cb-24c164a4de88/download/ocha-adm2-egypt-snapshot.json',
        upstreamVersion: '2026.2.0',
        upstreamDates: {
          validOn: '2026-06-01',
          reviewedDate: '2026-06-15',
          lastModified: '2026-06-20',
        },
        retrievalDate: '2026-08-27',
        license: 'CC-BY-IGO',
        licenseUrl: 'https://creativecommons.org/licenses/by/3.0/igo/',
        attribution: 'UN OCHA Egypt Office',
        totalRows: rawRecords.length,
        outsideZemamCount: 0,
        selectableCount: rawRecords.length,
        governorateCount: 27,
      },
      records: rawRecords,
    };

    const release = applyReviewedRelease(baseCatalog, candidateSnapshot, {
      reviewedMetadata: {
        declaredOfficialCount: 350,
        governorateCount: 27,
      },
      replacementMappings: [
        {
          retiredSourceCode: 'EG0101',
          replacementSourceCode: 'EG0198',
          notes: 'Recoded EG0101 to EG0198',
        },
      ],
    });

    const migrationSql = generateReleaseMigrationSql(release, { migrationTag: '0012_release_city_catalog' });
    return { release, migrationSql };
  };

  it('proves fresh database migration applies both baseline and new release migrations monotonically', async () => {
    await cleanDatabase();

    // 1. Run baseline migrations up to 0011
    await runMigrations({
      pool,
      migrationsFolder: path.resolve(__dirname, '../../drizzle/migrations'),
      customSqlPath: path.resolve(__dirname, '../../drizzle/custom.sql'),
    });

    // 2. Generate and apply 0012 release migration
    const { migrationSql } = createFutureReleaseMigration();
    await pool.query(migrationSql);

    // 3. Verify counts in the fresh database
    const statsRes = await pool.query<{
      official_count: string;
      retired_count: string;
      gov_count: string;
      total_count: string;
    }>(`
      SELECT
        count(*) FILTER (WHERE status = 'OFFICIAL') as official_count,
        count(*) FILTER (WHERE status = 'RETIRED') as retired_count,
        count(DISTINCT governorate) FILTER (WHERE status = 'OFFICIAL') as gov_count,
        count(*) as total_count
      FROM cities
    `);

    expect(Number(statsRes.rows[0].official_count)).toBe(350);
    expect(Number(statsRes.rows[0].retired_count)).toBe(1);
    expect(Number(statsRes.rows[0].gov_count)).toBe(27);
    expect(Number(statsRes.rows[0].total_count)).toBe(351);

    // Verify recoded/added city exists with status OFFICIAL
    const addedCity = await pool.query<{ source_code: string; status: string; name_english: string }>(
      `SELECT source_code, status, name_english FROM cities WHERE source_code = 'EG0198'`,
    );
    expect(addedCity.rows).toHaveLength(1);
    expect(addedCity.rows[0].status).toBe('OFFICIAL');
    expect(addedCity.rows[0].name_english).toContain('New Administrative Capital');

    // Verify retired city without mapping exists with status RETIRED
    const retiredCities = await pool.query<{ source_code: string; status: string }>(
      `SELECT source_code, status FROM cities WHERE source_code = 'EG0102'`,
    );
    expect(retiredCities.rows).toHaveLength(1);
    expect(retiredCities.rows[0].status).toBe('RETIRED');

    // Verify transferred source code no longer exists as a separate row
    const oldTransferredCity = await pool.query<{ source_code: string }>(
      `SELECT source_code FROM cities WHERE source_code = 'EG0101'`,
    );
    expect(oldTransferredCity.rows).toHaveLength(0);
  });

  it('proves populated database upgrades seamlessly to the new release transferring recoded identity and preserving UUIDs and foreign keys', async () => {
    await cleanDatabase();

    // 1. Run baseline migrations up to 0011
    await runMigrations({
      pool,
      migrationsFolder: path.resolve(__dirname, '../../drizzle/migrations'),
      customSqlPath: path.resolve(__dirname, '../../drizzle/custom.sql'),
    });

    // 2. Fetch IDs of cities that will be recoded, retired without mapping, and updated
    const recodedCityRes = await pool.query<{ id: string; source_code: string }>(
      `SELECT id, source_code FROM cities WHERE source_code = 'EG0101'`,
    );
    const recodedCityId = recodedCityRes.rows[0].id;

    const retiringCityRes = await pool.query<{ id: string; source_code: string }>(
      `SELECT id, source_code FROM cities WHERE source_code = 'EG0102'`,
    );
    const retiringCityId = retiringCityRes.rows[0].id;

    const maadiCityRes = await pool.query<{ id: string; source_code: string }>(
      `SELECT id, source_code FROM cities WHERE source_code = 'EG0104'`,
    );
    const maadiCityId = maadiCityRes.rows[0].id;

    // 3. Create users, posts, saved searches, and vet clinics referencing these cities before release migration
    const userRes = await pool.query<{ id: string }>(`
      INSERT INTO users (firebase_user_id, email, full_name, home_city_id)
      VALUES ('fb-user-rel-1', 'release-user@example.com', 'Release User', '${recodedCityId}')
      RETURNING id
    `);
    const userId = userRes.rows[0].id;

    // Post referencing city to be recoded (EG0101 -> EG0198)
    const postRecodedRes = await pool.query<{ id: string }>(
      `INSERT INTO posts (
        creator_id, post_type, title, description, status, moderation_status, city_id, coordinates, urgency, governorate
      ) VALUES (
        $1, 'RESCUE', 'Dog in Recoded District', 'Needs help', 'ACTIVE', 'CLEAN', $2, ST_SetSRID(ST_MakePoint(31.2, 30.0), 4326), 'URGENT', 'Cairo'
      ) RETURNING id`,
      [userId, recodedCityId],
    );
    const postRecodedId = postRecodedRes.rows[0].id;

    // Post referencing city to be retired without mapping (EG0102)
    const postRetiringRes = await pool.query<{ id: string }>(
      `INSERT INTO posts (
        creator_id, post_type, title, description, status, moderation_status, city_id, coordinates, urgency, governorate
      ) VALUES (
        $1, 'RESCUE', 'Cat in Retiring District', 'Needs help', 'ACTIVE', 'CLEAN', $2, ST_SetSRID(ST_MakePoint(31.2, 30.0), 4326), 'URGENT', 'Cairo'
      ) RETURNING id`,
      [userId, retiringCityId],
    );
    const postRetiringId = postRetiringRes.rows[0].id;

    // Post referencing active city to be updated (EG0104 Maadi)
    const postMaadiRes = await pool.query<{ id: string }>(
      `INSERT INTO posts (
        creator_id, post_type, title, description, status, moderation_status, city_id, coordinates, urgency, governorate
      ) VALUES (
        $1, 'ADOPTION', 'Puppy in Maadi', 'Good boy', 'ACTIVE', 'CLEAN', $2, ST_SetSRID(ST_MakePoint(31.2, 30.0), 4326), NULL, 'Cairo'
      ) RETURNING id`,
      [userId, maadiCityId],
    );
    const postMaadiId = postMaadiRes.rows[0].id;

    // Saved search referencing recoded city
    const savedSearchRes = await pool.query<{ id: string }>(
      `INSERT INTO saved_searches (user_id, post_type, city_id, label)
       VALUES ($1, 'ADOPTION', $2, 'Alert in Recoded City')
       RETURNING id`,
      [userId, recodedCityId],
    );
    const savedSearchId = savedSearchRes.rows[0].id;

    // Vet clinics referencing recoded and retiring cities
    const clinicRecodedRes = await pool.query<{ id: string }>(
      `INSERT INTO vet_clinics (name_english, city_id, coordinates, phone_number)
       VALUES ('Recoded District Vet', $1, ST_SetSRID(ST_MakePoint(31.25, 30.01), 4326), '01000000001')
       RETURNING id`,
      [recodedCityId],
    );
    const clinicRecodedId = clinicRecodedRes.rows[0].id;

    const clinicRetiringRes = await pool.query<{ id: string }>(
      `INSERT INTO vet_clinics (name_english, city_id, coordinates, phone_number)
       VALUES ('Old Retiring District Vet', $1, ST_SetSRID(ST_MakePoint(31.25, 30.01), 4326), '01000000002')
       RETURNING id`,
      [retiringCityId],
    );
    const clinicRetiringId = clinicRetiringRes.rows[0].id;

    // 4. Set up CitiesService with mock cache
    const db = drizzle(pool, { schema });
    const repo = new CitiesRepository(db);
    const cacheStore = new Map<string, unknown>();
    const mockCache: jest.Mocked<Partial<Cache>> = {
      get: jest
        .fn()
        .mockImplementation((k: string) =>
          Promise.resolve(cacheStore.get(k) as schema.City | schema.City[] | undefined),
        ),
      set: jest.fn().mockImplementation((k: string, v: unknown) => {
        cacheStore.set(k, v);
        return Promise.resolve();
      }),
      del: jest.fn().mockImplementation((k: string) => {
        cacheStore.delete(k);
        return Promise.resolve();
      }),
    };

    const service = new CitiesService(repo, mockCache as Cache);

    // Prime cache before migration
    const preList = await service.findAll();
    expect(preList.length).toBe(351);

    // 5. Apply future release migration (0012)
    const { migrationSql } = createFutureReleaseMigration();
    await pool.query(migrationSql);
    await service.clearCache();

    // 6. Verify service returns updated 350-city official list
    const postList = await service.findAll();
    expect(postList.length).toBe(350);

    // 7. Verify recoded city (EG0101 -> EG0198) preserved UUID and was updated to new official definition
    const recodedCityAfter = await pool.query<{
      id: string;
      status: string;
      source_code: string;
      name_english: string;
    }>(`SELECT id, status, source_code, name_english FROM cities WHERE id = $1`, [recodedCityId]);
    expect(recodedCityAfter.rows[0].id).toBe(recodedCityId);
    expect(recodedCityAfter.rows[0].source_code).toBe('EG0198');
    expect(recodedCityAfter.rows[0].name_english).toBe('New Administrative Capital Sector 1');
    expect(recodedCityAfter.rows[0].status).toBe('OFFICIAL');

    // User referencing recoded city remains valid with same UUID
    const userAfter = await pool.query<{ home_city_id: string }>(`SELECT home_city_id FROM users WHERE id = $1`, [
      userId,
    ]);
    expect(userAfter.rows[0].home_city_id).toBe(recodedCityId);

    // Post referencing recoded city remains valid with same UUID
    const postRecodedAfter = await pool.query<{ city_id: string; governorate: string }>(
      `SELECT city_id, governorate FROM posts WHERE id = $1`,
      [postRecodedId],
    );
    expect(postRecodedAfter.rows[0].city_id).toBe(recodedCityId);
    expect(postRecodedAfter.rows[0].governorate).toBe('Cairo');

    // Saved search referencing recoded city remains valid with same UUID
    const savedSearchAfter = await pool.query<{ city_id: string }>(`SELECT city_id FROM saved_searches WHERE id = $1`, [
      savedSearchId,
    ]);
    expect(savedSearchAfter.rows[0].city_id).toBe(recodedCityId);

    // Vet clinic referencing recoded city remains valid with same UUID
    const clinicRecodedAfter = await pool.query<{ city_id: string }>(`SELECT city_id FROM vet_clinics WHERE id = $1`, [
      clinicRecodedId,
    ]);
    expect(clinicRecodedAfter.rows[0].city_id).toBe(recodedCityId);

    // Direct lookup for recoded city returns new official details via service
    const recodedLookup = await service.findById(recodedCityId);
    expect(recodedLookup?.id).toBe(recodedCityId);
    expect(recodedLookup?.sourceCode).toBe('EG0198');
    expect(recodedLookup?.status).toBe('OFFICIAL');
    expect(recodedLookup?.nameEnglish).toBe('New Administrative Capital Sector 1');

    // 8. Verify retiring city without mapping (EG0102) transitioned to RETIRED and retained UUID
    const retiringCityAfter = await pool.query<{ id: string; status: string; source_code: string }>(
      `SELECT id, status, source_code FROM cities WHERE id = $1`,
      [retiringCityId],
    );
    expect(retiringCityAfter.rows[0].id).toBe(retiringCityId);
    expect(retiringCityAfter.rows[0].source_code).toBe('EG0102');
    expect(retiringCityAfter.rows[0].status).toBe('RETIRED');

    // Post referencing retired city remains valid
    const postRetiringAfter = await pool.query<{ city_id: string }>(`SELECT city_id FROM posts WHERE id = $1`, [
      postRetiringId,
    ]);
    expect(postRetiringAfter.rows[0].city_id).toBe(retiringCityId);

    // Vet clinic referencing retired city remains valid
    const clinicRetiringAfter = await pool.query<{ city_id: string }>(`SELECT city_id FROM vet_clinics WHERE id = $1`, [
      clinicRetiringId,
    ]);
    expect(clinicRetiringAfter.rows[0].city_id).toBe(retiringCityId);

    // Direct lookup for retired city still resolves via service
    const retiredLookup = await service.findById(retiringCityId);
    expect(retiredLookup?.id).toBe(retiringCityId);
    expect(retiredLookup?.status).toBe('RETIRED');

    // 9. Active Maadi city received canonical updates while retaining UUID
    const maadiAfter = await pool.query<{ id: string; name_english: string; status: string }>(
      `SELECT id, name_english, status FROM cities WHERE id = $1`,
      [maadiCityId],
    );
    expect(maadiAfter.rows[0].id).toBe(maadiCityId);
    expect(maadiAfter.rows[0].name_english).toBe('Maadi Updated');
    expect(maadiAfter.rows[0].status).toBe('OFFICIAL');

    const postMaadiAfter = await pool.query<{ city_id: string; governorate: string }>(
      `SELECT city_id, governorate FROM posts WHERE id = $1`,
      [postMaadiId],
    );
    expect(postMaadiAfter.rows[0].city_id).toBe(maadiCityId);
    expect(postMaadiAfter.rows[0].governorate).toBe('Cairo');
  });

  it('proves re-running the release migration on an already-upgraded database is idempotent', async () => {
    await cleanDatabase();
    await runMigrations({
      pool,
      migrationsFolder: path.resolve(__dirname, '../../drizzle/migrations'),
      customSqlPath: path.resolve(__dirname, '../../drizzle/custom.sql'),
    });

    const { migrationSql } = createFutureReleaseMigration();
    await pool.query(migrationSql);

    const snapshotBefore = await pool.query<{ id: string; source_code: string; name_english: string; status: string }>(
      `SELECT id, source_code, name_english, status FROM cities ORDER BY source_code LIMIT 20`,
    );

    // Re-run migration 0012
    await expect(pool.query(migrationSql)).resolves.not.toThrow();

    const snapshotAfter = await pool.query<{ id: string; source_code: string; name_english: string; status: string }>(
      `SELECT id, source_code, name_english, status FROM cities ORDER BY source_code LIMIT 20`,
    );

    expect(snapshotAfter.rows).toEqual(snapshotBefore.rows);
  });

  it('reproduces production deployment sequence: failed release rollback safety, deployment overlap, and cold-cache new container coherence', async () => {
    await cleanDatabase();

    // 1. Initial production baseline migration
    await runMigrations({
      pool,
      migrationsFolder: path.resolve(__dirname, '../../drizzle/migrations'),
      customSqlPath: path.resolve(__dirname, '../../drizzle/custom.sql'),
    });

    const db = drizzle(pool, { schema });
    const repo = new CitiesRepository(db);

    // Instance 1: Existing running container
    const cacheStore1 = new Map<string, unknown>();
    const mockCache1: jest.Mocked<Partial<Cache>> = {
      get: jest
        .fn()
        .mockImplementation((k: string) =>
          Promise.resolve(cacheStore1.get(k) as schema.City | schema.City[] | undefined),
        ),
      set: jest.fn().mockImplementation((k: string, v: unknown) => {
        cacheStore1.set(k, v);
        return Promise.resolve();
      }),
      del: jest.fn().mockImplementation((k: string) => {
        cacheStore1.delete(k);
        return Promise.resolve();
      }),
    };
    const runningInstance = new CitiesService(repo, mockCache1 as Cache);

    // Get city IDs from DB before migration
    const eg0101Res = await pool.query<{ id: string }>(`SELECT id FROM cities WHERE source_code = 'EG0101'`);
    const eg0101Id = eg0101Res.rows[0].id;

    const eg0102Res = await pool.query<{ id: string }>(`SELECT id FROM cities WHERE source_code = 'EG0102'`);
    const eg0102Id = eg0102Res.rows[0].id;

    const maadiRes = await pool.query<{ id: string }>(`SELECT id FROM cities WHERE source_code = 'EG0104'`);
    const maadiId = maadiRes.rows[0].id;

    // Instance 1 primes its cache
    const initialList = await runningInstance.findAll();
    expect(initialList.length).toBe(351);

    const initial0101 = await runningInstance.findById(eg0101Id);
    expect(initial0101?.status).toBe('OFFICIAL');

    const initial0102 = await runningInstance.findById(eg0102Id);
    expect(initial0102?.status).toBe('OFFICIAL');

    const initialMaadi = await runningInstance.findById(maadiId);
    expect(initialMaadi?.nameEnglish).toBe('Maadi');

    // 2. Failed release simulation (e.g. invalid migration that raises exception before commit)
    const failedReleaseSql = `
      DO $$
      BEGIN
        UPDATE cities SET status = 'RETIRED' WHERE source_code = 'EG0102';
        RAISE EXCEPTION 'Simulated verification mismatch during preDeployCommand';
      END $$;
    `;

    await expect(pool.query(failedReleaseSql)).rejects.toThrow(
      'Simulated verification mismatch during preDeployCommand',
    );

    // Instance 1 cache remains completely safe and valid
    expect(runningInstance.getCacheGeneration()).toBe(0);
    const postFailList = await runningInstance.findAll();
    expect(postFailList.length).toBe(351);

    const postFail0101 = await runningInstance.findById(eg0101Id);
    expect(postFail0101?.status).toBe('OFFICIAL');

    // 3. Successful preDeployCommand execution
    const { migrationSql } = createFutureReleaseMigration();
    await pool.query(migrationSql);

    // 4. Railway boots Instance 2 (new container with cold cache) during deployment overlap
    const cacheStore2 = new Map<string, unknown>();
    const mockCache2: jest.Mocked<Partial<Cache>> = {
      get: jest
        .fn()
        .mockImplementation((k: string) =>
          Promise.resolve(cacheStore2.get(k) as schema.City | schema.City[] | undefined),
        ),
      set: jest.fn().mockImplementation((k: string, v: unknown) => {
        cacheStore2.set(k, v);
        return Promise.resolve();
      }),
      del: jest.fn().mockImplementation((k: string) => {
        cacheStore2.delete(k);
        return Promise.resolve();
      }),
    };
    const newContainerInstance = new CitiesService(repo, mockCache2 as Cache);

    // Instance 2 serves fresh requests across all lifecycles:
    // Official list returns 350 cities (post-release)
    const newOfficialList = await newContainerInstance.findAll();
    expect(newOfficialList.length).toBe(350);

    // Recoded city returns OFFICIAL with new identity and preserved UUID
    const recodedLookup = await newContainerInstance.findById(eg0101Id);
    expect(recodedLookup?.status).toBe('OFFICIAL');
    expect(recodedLookup?.sourceCode).toBe('EG0198');
    expect(recodedLookup?.nameEnglish).toContain('New Administrative Capital');

    // Retired city returns RETIRED
    const retiredLookup = await newContainerInstance.findById(eg0102Id);
    expect(retiredLookup?.status).toBe('RETIRED');

    // Updated city returns new canonical name
    const updatedMaadi = await newContainerInstance.findById(maadiId);
    expect(updatedMaadi?.nameEnglish).toBe('Maadi Updated');
    expect(updatedMaadi?.status).toBe('OFFICIAL');

    // Instance 1 invalidates in O(1) time if clearCache is invoked
    await runningInstance.clearCache();
    expect(runningInstance.getCacheGeneration()).toBe(1);
    const instance1RefreshedList = await runningInstance.findAll();
    expect(instance1RefreshedList.length).toBe(350);
  });

  it('fails closed when attempting to generate releases with invalid many-to-one mappings or unmapped detected recodes', () => {
    const baseCatalog = getOfficialCatalog();

    // 1. Unmapped detected recode (EG0101 name & governorate matched with new P-code EG0198)
    const recodedRaw = baseCatalog
      .filter((c) => c.sourceCode !== 'EG0101')
      .map((c) => ({
        adm2_name: c.sourceNameEnglish,
        adm2_name1: c.sourceNameArabic,
        adm2_pcode: c.sourceCode,
        adm1_name: c.governorate,
        adm1_name1: c.governorateArabic || '',
        adm1_pcode: c.governorateCode,
        adm0_name: 'Egypt',
        adm0_name1: 'مصر',
        adm0_pcode: 'EG',
        center_lat: c.latitude,
        center_lon: c.longitude,
      }));

    recodedRaw.push({
      adm2_name: 'Al Tibbin',
      adm2_name1: 'قسم التبين',
      adm2_pcode: 'EG0198', // new P-code for Al Tibbin
      adm1_name: 'Cairo',
      adm1_name1: 'القاهرة',
      adm1_pcode: 'EG01',
      adm0_name: 'Egypt',
      adm0_name1: 'مصر',
      adm0_pcode: 'EG',
      center_lat: 29.78,
      center_lon: 31.33,
    });

    const recodeSnapshot: CitySnapshot = {
      metadata: {
        source: 'OCHA COD-AB Egypt 2026.2',
        sourceUrl: 'https://data.humdata.org/dataset/cod-ab-egy',
        resourceUrl:
          'https://data.humdata.org/dataset/b90d81ba-7c7a-4283-9899-827480d80a79/resource/81126a96-2991-48e1-93cb-24c164a4de88/download/ocha-adm2-egypt-snapshot.json',
        upstreamVersion: '2026.2.0',
        upstreamDates: {
          validOn: '2026-06-01',
          reviewedDate: '2026-06-15',
          lastModified: '2026-06-20',
        },
        retrievalDate: '2026-08-27',
        license: 'CC-BY-IGO',
        licenseUrl: 'https://creativecommons.org/licenses/by/3.0/igo/',
        attribution: 'UN OCHA Egypt Office',
        totalRows: recodedRaw.length,
        outsideZemamCount: 0,
        selectableCount: recodedRaw.length,
        governorateCount: 27,
      },
      records: recodedRaw,
    };

    // Fails closed on unmapped detected recode
    expect(() =>
      applyReviewedRelease(baseCatalog, recodeSnapshot, {
        reviewedMetadata: { declaredOfficialCount: 351, governorateCount: 27 },
      }),
    ).toThrow(/Unreviewed recode detected for 'Al Tibbin'/);

    // 2. Many-to-one mapping (two retired cities mapped to the same replacement target)
    expect(() =>
      applyReviewedRelease(baseCatalog, recodeSnapshot, {
        reviewedMetadata: { declaredOfficialCount: 351, governorateCount: 27 },
        replacementMappings: [
          { retiredSourceCode: 'EG0101', replacementSourceCode: 'EG0198' },
          { retiredSourceCode: 'EG0102', replacementSourceCode: 'EG0198' },
        ],
      }),
    ).toThrow(/Duplicate replacement mapping for replacement city 'EG0198'/);
  });

  describe('End-to-End Published Release Migration with Drizzle Runner', () => {
    const copyBaselineMigrationsToTemp = (tempMigrationsDir: string) => {
      const srcMigrationsDir = path.resolve(__dirname, '../../drizzle/migrations');
      const tempMetaDir = path.join(tempMigrationsDir, 'meta');
      fs.mkdirSync(tempMetaDir, { recursive: true });

      const files = fs.readdirSync(srcMigrationsDir);
      for (const file of files) {
        const fullSrc = path.join(srcMigrationsDir, file);
        if (fs.statSync(fullSrc).isFile() && file.endsWith('.sql')) {
          fs.copyFileSync(fullSrc, path.join(tempMigrationsDir, file));
        }
      }

      fs.copyFileSync(path.join(srcMigrationsDir, 'meta', '_journal.json'), path.join(tempMetaDir, '_journal.json'));
    };

    it('proves published release via publishReviewedRelease executes end-to-end through Drizzle runMigrations on fresh database', async () => {
      await cleanDatabase();

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-fresh-e2e-'));
      const tempMigrationsDir = path.join(tempDir, 'migrations');
      copyBaselineMigrationsToTemp(tempMigrationsDir);

      const baseCatalog = getOfficialCatalog();
      const rawRecords = baseCatalog
        .filter((c) => c.sourceCode !== 'EG0101' && c.sourceCode !== 'EG0102')
        .map((c) => ({
          adm2_name: c.sourceNameEnglish,
          adm2_name1: c.sourceNameArabic,
          adm2_pcode: c.sourceCode,
          adm1_name: c.governorate,
          adm1_name1: c.governorateArabic || '',
          adm1_pcode: c.governorateCode,
          adm0_name: 'Egypt',
          adm0_name1: 'مصر',
          adm0_pcode: 'EG',
          center_lat: c.latitude,
          center_lon: c.longitude,
        }));

      rawRecords.push({
        adm2_name: 'New Administrative Capital Sector 1',
        adm2_name1: 'العاصمة الإدارية الجديدة قطاع 1',
        adm2_pcode: 'EG0198',
        adm1_name: 'Cairo',
        adm1_name1: 'القاهرة',
        adm1_pcode: 'EG01',
        adm0_name: 'Egypt',
        adm0_name1: 'مصر',
        adm0_pcode: 'EG',
        center_lat: 30.015,
        center_lon: 31.75,
      });

      const candidateSnapshot: CitySnapshot = {
        metadata: {
          source: 'OCHA COD-AB Egypt 2026.2',
          sourceUrl: 'https://data.humdata.org/dataset/cod-ab-egy',
          resourceUrl:
            'https://data.humdata.org/dataset/b90d81ba-7c7a-4283-9899-827480d80a79/resource/81126a96-2991-48e1-93cb-24c164a4de88/download/ocha-adm2-egypt-snapshot.json',
          upstreamVersion: '2026.2.0',
          upstreamDates: {
            validOn: '2026-06-01',
            reviewedDate: '2026-06-15',
            lastModified: '2026-06-20',
          },
          retrievalDate: '2026-08-27',
          license: 'CC-BY-IGO',
          licenseUrl: 'https://creativecommons.org/licenses/by/3.0/igo/',
          attribution: 'UN OCHA Egypt Office',
          totalRows: rawRecords.length,
          outsideZemamCount: 0,
          selectableCount: rawRecords.length,
          governorateCount: 27,
        },
        records: rawRecords,
      };

      const pubResult = publishReviewedRelease(baseCatalog, candidateSnapshot, {
        migrationsFolder: tempMigrationsDir,
        catalogPath: path.join(tempDir, 'catalog.json'),
        snapshotPath: path.join(tempDir, 'snapshot.json'),
        reviewedMetadata: {
          declaredOfficialCount: 350,
          governorateCount: 27,
        },
        replacementMappings: [
          {
            retiredSourceCode: 'EG0101',
            replacementSourceCode: 'EG0198',
            notes: 'Recoded EG0101 to EG0198',
          },
        ],
      });

      expect(pubResult.migrationTag).toBe('0012_release_city_catalog');
      expect(fs.existsSync(pubResult.migrationPath)).toBe(true);

      // Run Drizzle migration runner with published migration
      await runMigrations({
        pool,
        migrationsFolder: tempMigrationsDir,
        customSqlPath: path.resolve(__dirname, '../../drizzle/custom.sql'),
      });

      const statsRes = await pool.query<{
        official_count: string;
        retired_count: string;
        gov_count: string;
      }>(`
        SELECT
          count(*) FILTER (WHERE status = 'OFFICIAL') as official_count,
          count(*) FILTER (WHERE status = 'RETIRED') as retired_count,
          count(DISTINCT governorate) FILTER (WHERE status = 'OFFICIAL') as gov_count
        FROM cities
      `);

      expect(Number(statsRes.rows[0].official_count)).toBe(350);
      expect(Number(statsRes.rows[0].retired_count)).toBe(1);
      expect(Number(statsRes.rows[0].gov_count)).toBe(27);

      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('proves published release via publishReviewedRelease executes end-to-end through Drizzle runMigrations on populated database with preserved UUIDs', async () => {
      await cleanDatabase();

      // 1. Apply baseline migrations up to 0011
      await runMigrations({
        pool,
        migrationsFolder: path.resolve(__dirname, '../../drizzle/migrations'),
        customSqlPath: path.resolve(__dirname, '../../drizzle/custom.sql'),
      });

      // 2. Insert records referencing cities
      const eg0101Res = await pool.query<{ id: string }>(`SELECT id FROM cities WHERE source_code = 'EG0101'`);
      const eg0101Id = eg0101Res.rows[0].id;

      const userRes = await pool.query<{ id: string }>(`
        INSERT INTO users (firebase_user_id, email, full_name, home_city_id)
        VALUES ('fb-user-e2e-pub', 'e2e-pub@example.com', 'E2E Pub User', '${eg0101Id}')
        RETURNING id
      `);
      const userId = userRes.rows[0].id;

      const postRes = await pool.query<{ id: string }>(`
        INSERT INTO posts (
          creator_id, post_type, title, description, status, moderation_status, city_id, coordinates, urgency, governorate
        ) VALUES (
          '${userId}', 'RESCUE', 'E2E Dog', 'Help', 'ACTIVE', 'CLEAN', '${eg0101Id}', ST_SetSRID(ST_MakePoint(31.2, 30.0), 4326), 'URGENT', 'Cairo'
        ) RETURNING id
      `);
      const postId = postRes.rows[0].id;

      // 3. Stage and publish 0012
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-pop-e2e-'));
      const tempMigrationsDir = path.join(tempDir, 'migrations');
      copyBaselineMigrationsToTemp(tempMigrationsDir);

      const baseCatalog = getOfficialCatalog();
      const rawRecords = baseCatalog
        .filter((c) => c.sourceCode !== 'EG0101' && c.sourceCode !== 'EG0102')
        .map((c) => ({
          adm2_name: c.sourceNameEnglish,
          adm2_name1: c.sourceNameArabic,
          adm2_pcode: c.sourceCode,
          adm1_name: c.governorate,
          adm1_name1: c.governorateArabic || '',
          adm1_pcode: c.governorateCode,
          adm0_name: 'Egypt',
          adm0_name1: 'مصر',
          adm0_pcode: 'EG',
          center_lat: c.latitude,
          center_lon: c.longitude,
        }));

      rawRecords.push({
        adm2_name: 'New Administrative Capital Sector 1',
        adm2_name1: 'العاصمة الإدارية الجديدة قطاع 1',
        adm2_pcode: 'EG0198',
        adm1_name: 'Cairo',
        adm1_name1: 'القاهرة',
        adm1_pcode: 'EG01',
        adm0_name: 'Egypt',
        adm0_name1: 'مصر',
        adm0_pcode: 'EG',
        center_lat: 30.015,
        center_lon: 31.75,
      });

      const candidateSnapshot: CitySnapshot = {
        metadata: {
          source: 'OCHA COD-AB Egypt 2026.2',
          sourceUrl: 'https://data.humdata.org/dataset/cod-ab-egy',
          resourceUrl:
            'https://data.humdata.org/dataset/b90d81ba-7c7a-4283-9899-827480d80a79/resource/81126a96-2991-48e1-93cb-24c164a4de88/download/ocha-adm2-egypt-snapshot.json',
          upstreamVersion: '2026.2.0',
          upstreamDates: {
            validOn: '2026-06-01',
            reviewedDate: '2026-06-15',
            lastModified: '2026-06-20',
          },
          retrievalDate: '2026-08-27',
          license: 'CC-BY-IGO',
          licenseUrl: 'https://creativecommons.org/licenses/by/3.0/igo/',
          attribution: 'UN OCHA Egypt Office',
          totalRows: rawRecords.length,
          outsideZemamCount: 0,
          selectableCount: rawRecords.length,
          governorateCount: 27,
        },
        records: rawRecords,
      };

      publishReviewedRelease(baseCatalog, candidateSnapshot, {
        migrationsFolder: tempMigrationsDir,
        catalogPath: path.join(tempDir, 'catalog.json'),
        snapshotPath: path.join(tempDir, 'snapshot.json'),
        reviewedMetadata: {
          declaredOfficialCount: 350,
          governorateCount: 27,
        },
        replacementMappings: [
          {
            retiredSourceCode: 'EG0101',
            replacementSourceCode: 'EG0198',
            notes: 'Recoded EG0101 to EG0198',
          },
        ],
      });

      // 4. Run migration upgrade with Drizzle runner
      await runMigrations({
        pool,
        migrationsFolder: tempMigrationsDir,
        customSqlPath: path.resolve(__dirname, '../../drizzle/custom.sql'),
      });

      // 5. Verify recoded city preserved UUID and user/post references are intact
      const cityAfter = await pool.query<{ id: string; source_code: string; name_english: string; status: string }>(
        `SELECT id, source_code, name_english, status FROM cities WHERE id = $1`,
        [eg0101Id],
      );
      expect(cityAfter.rows[0].id).toBe(eg0101Id);
      expect(cityAfter.rows[0].source_code).toBe('EG0198');
      expect(cityAfter.rows[0].status).toBe('OFFICIAL');
      expect(cityAfter.rows[0].name_english).toContain('New Administrative Capital');

      const userAfter = await pool.query<{ home_city_id: string }>(`SELECT home_city_id FROM users WHERE id = $1`, [
        userId,
      ]);
      expect(userAfter.rows[0].home_city_id).toBe(eg0101Id);

      const postAfter = await pool.query<{ city_id: string }>(`SELECT city_id FROM posts WHERE id = $1`, [postId]);
      expect(postAfter.rows[0].city_id).toBe(eg0101Id);

      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});

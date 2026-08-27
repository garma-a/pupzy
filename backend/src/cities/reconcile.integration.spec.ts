import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import * as path from 'path';
import * as fs from 'fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { runMigrations } from '../database/migrate';
import { loadLegacyMappings } from './reconcile';
import { CitiesRepository } from './cities.repository';
import { CitiesService } from './cities.service';
import type { Cache } from 'cache-manager';

describe('Reconciliation Migration Integration (Disposable PostgreSQL)', () => {
  jest.setTimeout(60_000);
  let container: StartedPostgreSqlContainer;
  let connectionString: string;
  let pool: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4-alpine')
      .withDatabase('pupzy_reconcile_integration_test')
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

  const runSqlFile = async (filePath: string) => {
    const sql = fs.readFileSync(filePath, 'utf8');
    await pool.query(sql);
  };

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

  const applyMigrationsUpTo0010 = async () => {
    await cleanDatabase();
    const migrationsDir = path.resolve(__dirname, '../../drizzle/migrations');
    const migrationFiles = [
      '0000_familiar_shiver_man.sql',
      '0001_windy_moondragon.sql',
      '0002_lame_anita_blake.sql',
      '0003_nosy_korg.sql',
      '0004_curly_silhouette.sql',
      '0005_easy_the_hand.sql',
      '0006_add_mating_post_type.sql',
      '0007_create_mating_posts.sql',
      '0008_brave_lester.sql',
      '0009_version_custom_ddl.sql',
      '0010_peaceful_wind_dancer.sql',
    ];

    for (const file of migrationFiles) {
      const filePath = path.join(migrationsDir, file);
      const sqlContent = fs.readFileSync(filePath, 'utf8');
      const statements = sqlContent.split('--> statement-breakpoint');
      for (const stmt of statements) {
        const trimmed = stmt.trim();
        if (trimmed) {
          await pool.query(trimmed);
        }
      }
    }

    const customSqlPath = path.resolve(__dirname, '../../drizzle/custom.sql');
    await runSqlFile(customSqlPath);
  };

  it('proves clean-database migration creates authoritative 351 official cities across 27 governorates', async () => {
    await cleanDatabase();

    // Run full migrations from scratch on a clean database
    await expect(
      runMigrations({
        pool,
        migrationsFolder: path.resolve(__dirname, '../../drizzle/migrations'),
        customSqlPath: path.resolve(__dirname, '../../drizzle/custom.sql'),
      }),
    ).resolves.not.toThrow();

    // Verify official count and governorate count
    const statsRes = await pool.query<{ official_count: string; gov_count: string; legacy_count: string }>(`
      SELECT
        count(*) FILTER (WHERE status = 'OFFICIAL') as official_count,
        count(DISTINCT governorate) FILTER (WHERE status = 'OFFICIAL') as gov_count,
        count(*) FILTER (WHERE status = 'LEGACY') as legacy_count
      FROM cities
    `);

    expect(Number(statsRes.rows[0].official_count)).toBe(351);
    expect(Number(statsRes.rows[0].gov_count)).toBe(27);
    expect(Number(statsRes.rows[0].legacy_count)).toBe(0);
  });

  it('proves populated-database reconciliation preserves UUIDs, links relations, syncs governorates, and leaves unresolved cities as non-selectable LEGACY', async () => {
    await applyMigrationsUpTo0010();

    const mappings = loadLegacyMappings();
    expect(mappings.length).toBe(109);

    // Insert all 109 legacy cities with legacy status and null source_code
    const legacyCityIds = new Map<string, string>();
    for (const m of mappings) {
      const key = `${m.legacyGovernorate}:${m.legacyNameEnglish}`;
      const res = await pool.query<{ id: string }>(
        `INSERT INTO cities (
          name_english,
          name_arabic,
          governorate,
          source_code,
          status,
          center_point
        ) VALUES (
          $1, $2, $3, NULL, 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)
        ) RETURNING id`,
        [m.legacyNameEnglish, m.legacyNameArabic ?? m.legacyNameEnglish, m.legacyGovernorate],
      );
      legacyCityIds.set(key, res.rows[0].id);
    }

    const maadiId = legacyCityIds.get('Cairo:Maadi')!;
    const unmappedObsoleteId = legacyCityIds.get('Cairo:Cairo')!; // Unmapped legacy city

    expect(maadiId).toBeDefined();
    expect(unmappedObsoleteId).toBeDefined();

    // Create user referencing legacy Maadi
    const userRes = await pool.query<{ id: string }>(`
      INSERT INTO users (firebase_user_id, email, full_name)
      VALUES ('fb-user-legacy-1', 'legacy-user@example.com', 'Legacy User')
      RETURNING id
    `);
    const userId = userRes.rows[0].id;

    // Create post referencing mapped Maadi with old governorate spelling
    const postMaadiRes = await pool.query<{ id: string }>(
      `INSERT INTO posts (
        creator_id, post_type, title, description, status, moderation_status, city_id, coordinates, urgency, governorate
      ) VALUES (
        $1, 'RESCUE', 'Dog in Maadi', 'Needs home', 'ACTIVE', 'CLEAN', $2, ST_SetSRID(ST_MakePoint(31.2, 30.0), 4326), 'URGENT', 'Old Cairo Governorate'
      ) RETURNING id`,
      [userId, maadiId],
    );
    const postMaadiId = postMaadiRes.rows[0].id;

    // Create post referencing unmapped legacy city
    const postUnmappedRes = await pool.query<{ id: string }>(
      `INSERT INTO posts (
        creator_id, post_type, title, description, status, moderation_status, city_id, coordinates, urgency, governorate
      ) VALUES (
        $1, 'RESCUE', 'Dog in Unmapped', 'Needs home', 'ACTIVE', 'CLEAN', $2, ST_SetSRID(ST_MakePoint(31.2, 30.0), 4326), 'URGENT', 'Old Governorate'
      ) RETURNING id`,
      [userId, unmappedObsoleteId],
    );
    const postUnmappedId = postUnmappedRes.rows[0].id;

    // Create vet clinic referencing legacy Maadi
    const clinicRes = await pool.query<{ id: string }>(
      `INSERT INTO vet_clinics (name_english, city_id, coordinates, phone_number)
       VALUES ('Maadi Vet', $1, ST_SetSRID(ST_MakePoint(31.25, 30.01), 4326), '01000000000')
       RETURNING id`,
      [maadiId],
    );
    const clinicId = clinicRes.rows[0].id;

    // Create saved search referencing legacy Maadi
    const searchRes = await pool.query<{ id: string }>(
      `INSERT INTO saved_searches (user_id, label, city_id, post_type)
       VALUES ($1, 'My Maadi Search', $2, 'ADOPTION')
       RETURNING id`,
      [userId, maadiId],
    );
    const searchId = searchRes.rows[0].id;

    // Apply migration 0011
    const migration0011Path = path.resolve(__dirname, '../../drizzle/migrations/0011_reconcile_city_catalog.sql');
    await runSqlFile(migration0011Path);

    // Verify 74 mapped legacy cities gained official source code and canonical attributes while keeping UUIDs
    const maadiAfter = await pool.query<{
      id: string;
      name_english: string;
      source_code: string;
      status: string;
      governorate: string;
    }>(`SELECT id, name_english, source_code, status, governorate FROM cities WHERE id = $1`, [maadiId]);
    expect(maadiAfter.rows[0].id).toBe(maadiId);
    expect(maadiAfter.rows[0].source_code).toBe('EG0104');
    expect(maadiAfter.rows[0].status).toBe('OFFICIAL');
    expect(maadiAfter.rows[0].governorate).toBe('Cairo');

    // Verify 35 unmapped legacy cities transitioned to status = 'LEGACY' while keeping UUIDs
    const unmappedAfter = await pool.query<{ id: string; status: string; source_code: string | null }>(
      `SELECT id, status, source_code FROM cities WHERE id = $1`,
      [unmappedObsoleteId],
    );
    expect(unmappedAfter.rows[0].id).toBe(unmappedObsoleteId);
    expect(unmappedAfter.rows[0].status).toBe('LEGACY');
    expect(unmappedAfter.rows[0].source_code).toBeNull();

    // Verify denormalized governorate in posts was synchronized for mapped official city
    const postMaadiAfter = await pool.query<{ governorate: string; city_id: string }>(
      `SELECT governorate, city_id FROM posts WHERE id = $1`,
      [postMaadiId],
    );
    expect(postMaadiAfter.rows[0].city_id).toBe(maadiId);
    expect(postMaadiAfter.rows[0].governorate).toBe('Cairo');

    // Verify historical reference for unmapped legacy post remains intact
    const postUnmappedAfter = await pool.query<{ city_id: string }>(`SELECT city_id FROM posts WHERE id = $1`, [
      postUnmappedId,
    ]);
    expect(postUnmappedAfter.rows[0].city_id).toBe(unmappedObsoleteId);

    // Verify vet clinic and saved search relations remain intact
    const clinicAfter = await pool.query<{ city_id: string }>(`SELECT city_id FROM vet_clinics WHERE id = $1`, [
      clinicId,
    ]);
    expect(clinicAfter.rows[0].city_id).toBe(maadiId);

    const searchAfter = await pool.query<{ city_id: string }>(`SELECT city_id FROM saved_searches WHERE id = $1`, [
      searchId,
    ]);
    expect(searchAfter.rows[0].city_id).toBe(maadiId);

    // Verify total counts: exactly 351 official across 27 governorates + 35 legacy
    const totalStats = await pool.query<{ official_count: string; gov_count: string; legacy_count: string }>(`
      SELECT
        count(*) FILTER (WHERE status = 'OFFICIAL') as official_count,
        count(DISTINCT governorate) FILTER (WHERE status = 'OFFICIAL') as gov_count,
        count(*) FILTER (WHERE status = 'LEGACY') as legacy_count
      FROM cities
    `);
    expect(Number(totalStats.rows[0].official_count)).toBe(351);
    expect(Number(totalStats.rows[0].gov_count)).toBe(27);
    expect(Number(totalStats.rows[0].legacy_count)).toBe(35);
  });

  it('proves fail-closed nonzero failure behavior when legacy database has duplicate identities', async () => {
    await applyMigrationsUpTo0010();

    const mappings = loadLegacyMappings();
    // Insert legacy cities
    for (const m of mappings) {
      await pool.query(
        `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
         VALUES ($1, $2, $3, 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2, 30.0), 4326))`,
        [m.legacyNameEnglish, m.legacyNameArabic ?? m.legacyNameEnglish, m.legacyGovernorate],
      );
    }

    // Insert a duplicate case-insensitive legacy identity in Cairo: 'maadi'
    await pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('maadi', 'المعادي مكرر', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2, 30.0), 4326))`,
    );

    const migration0011Path = path.resolve(__dirname, '../../drizzle/migrations/0011_reconcile_city_catalog.sql');
    await expect(runSqlFile(migration0011Path)).rejects.toThrow(/duplicate legacy city identities found in database/);

    // Verify transaction rolled back: no official source codes were applied
    const countWithSourceCode = await pool.query<{ count: string }>(
      `SELECT count(*) FROM cities WHERE source_code IS NOT NULL`,
    );
    expect(Number(countWithSourceCode.rows[0].count)).toBe(0);
  });

  it('proves fail-closed nonzero failure behavior when a reviewed mapping matches 0 legacy rows in populated database', async () => {
    await applyMigrationsUpTo0010();

    const mappings = loadLegacyMappings();
    // Insert all legacy cities EXCEPT 'Aswan'
    for (const m of mappings) {
      if (m.legacyNameEnglish === 'Aswan' && m.legacyGovernorate === 'Aswan') {
        continue; // Intentionally omit mapped city
      }
      await pool.query(
        `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
         VALUES ($1, $2, $3, 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2, 30.0), 4326))`,
        [m.legacyNameEnglish, m.legacyNameArabic ?? m.legacyNameEnglish, m.legacyGovernorate],
      );
    }

    const migration0011Path = path.resolve(__dirname, '../../drizzle/migrations/0011_reconcile_city_catalog.sql');
    await expect(runSqlFile(migration0011Path)).rejects.toThrow(
      /reviewed mapping for Aswan in Aswan matched 0 legacy rows/,
    );

    // Verify transaction rolled back
    const countWithSourceCode = await pool.query<{ count: string }>(
      `SELECT count(*) FROM cities WHERE source_code IS NOT NULL`,
    );
    expect(Number(countWithSourceCode.rows[0].count)).toBe(0);
  });

  it('proves re-running migration on an already-reconciled database succeeds idempotently without error or UUID mutation', async () => {
    await cleanDatabase();
    await runMigrations({
      pool,
      migrationsFolder: path.resolve(__dirname, '../../drizzle/migrations'),
      customSqlPath: path.resolve(__dirname, '../../drizzle/custom.sql'),
    });

    const beforeRes = await pool.query<{ id: string; source_code: string; name_english: string }>(
      `SELECT id, source_code, name_english FROM cities ORDER BY source_code LIMIT 10`,
    );
    const beforeCities = beforeRes.rows;

    // Re-run migration 0011
    const migration0011Path = path.resolve(__dirname, '../../drizzle/migrations/0011_reconcile_city_catalog.sql');
    await expect(runSqlFile(migration0011Path)).resolves.not.toThrow();

    // Verify UUIDs and identities remain strictly identical
    const afterRes = await pool.query<{ id: string; source_code: string; name_english: string }>(
      `SELECT id, source_code, name_english FROM cities ORDER BY source_code LIMIT 10`,
    );
    expect(afterRes.rows).toEqual(beforeCities);

    // Verify total official count remains exactly 351 across 27 governorates
    const statsRes = await pool.query<{ official_count: string; gov_count: string }>(`
      SELECT
        count(*) FILTER (WHERE status = 'OFFICIAL') as official_count,
        count(DISTINCT governorate) FILTER (WHERE status = 'OFFICIAL') as gov_count
      FROM cities
    `);
    expect(Number(statsRes.rows[0].official_count)).toBe(351);
    expect(Number(statsRes.rows[0].gov_count)).toBe(27);
  });

  it('proves existing official cities receive canonical corrections rather than being skipped', async () => {
    await applyMigrationsUpTo0010();

    // Insert an official city with outdated/incorrect canonical name and governorate
    const oldOfficialRes = await pool.query<{ id: string }>(`
      INSERT INTO cities (source_code, name_english, name_arabic, governorate, status, center_point)
      VALUES ('EG0104', 'Old Incorrect Maadi Name', 'اسم قديم', 'Old Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2, 30.0), 4326))
      RETURNING id
    `);
    const oldOfficialId = oldOfficialRes.rows[0].id;

    // Run migration 0011
    const migration0011Path = path.resolve(__dirname, '../../drizzle/migrations/0011_reconcile_city_catalog.sql');
    await runSqlFile(migration0011Path);

    // Verify the existing official city received canonical name, arabic name, governorate, and coordinates
    const updatedRes = await pool.query<{
      id: string;
      name_english: string;
      name_arabic: string;
      governorate: string;
      source_code: string;
    }>(`SELECT id, name_english, name_arabic, governorate, source_code FROM cities WHERE id = $1`, [oldOfficialId]);
    expect(updatedRes.rows[0].id).toBe(oldOfficialId);
    expect(updatedRes.rows[0].name_english).toBe('Maadi');
    expect(updatedRes.rows[0].name_arabic).toBe('قسم المعادي');
    expect(updatedRes.rows[0].governorate).toBe('Cairo');
  });

  it('proves end-to-end cache coherence across migration and application restart with PostgreSQL', async () => {
    await applyMigrationsUpTo0010();

    const mappings = loadLegacyMappings();
    const legacyCityIds = new Map<string, string>();
    for (const m of mappings) {
      const key = `${m.legacyGovernorate}:${m.legacyNameEnglish}`;
      const res = await pool.query<{ id: string }>(
        `INSERT INTO cities (
          name_english,
          name_arabic,
          governorate,
          source_code,
          status,
          center_point
        ) VALUES (
          $1, $2, $3, NULL, 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)
        ) RETURNING id`,
        [m.legacyNameEnglish, m.legacyNameArabic ?? m.legacyNameEnglish, m.legacyGovernorate],
      );
      legacyCityIds.set(key, res.rows[0].id);
    }

    const maadiId = legacyCityIds.get('Cairo:Maadi')!;
    const unmappedLegacyId = legacyCityIds.get('Cairo:Cairo')!;

    // Set up Drizzle repository and CitiesService with cache
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

    // 1. Prime cache before migration
    const preMigrationList = await service.findAll();
    expect(preMigrationList.length).toBe(109);

    const preMaadiLookup = await service.findById(maadiId);
    expect(preMaadiLookup?.nameEnglish).toBe('Maadi');
    expect(preMaadiLookup?.sourceCode).toBeNull();

    const preUnmappedLookup = await service.findById(unmappedLegacyId);
    expect(preUnmappedLookup?.status).toBe('OFFICIAL');

    // 2. Execute migration 0011 (as preDeployCommand would)
    const migration0011Path = path.resolve(__dirname, '../../drizzle/migrations/0011_reconcile_city_catalog.sql');
    await runSqlFile(migration0011Path);

    // 3. Invalidate cache on running service
    await service.clearCache();

    // 4. Assert service returns freshly reconciled catalog and per-ID data
    const postMigrationList = await service.findAll();
    expect(postMigrationList.length).toBe(351);

    const postMaadiLookup = await service.findById(maadiId);
    expect(postMaadiLookup?.id).toBe(maadiId);
    expect(postMaadiLookup?.sourceCode).toBe('EG0104');
    expect(postMaadiLookup?.status).toBe('OFFICIAL');

    const postUnmappedLookup = await service.findById(unmappedLegacyId);
    expect(postUnmappedLookup?.id).toBe(unmappedLegacyId);
    expect(postUnmappedLookup?.status).toBe('LEGACY');
    expect(postUnmappedLookup?.sourceCode).toBeNull();

    // 5. Simulate application restart (new service instance with fresh cache)
    const restartStore = new Map<string, unknown>();
    const restartCache: jest.Mocked<Partial<Cache>> = {
      get: jest
        .fn()
        .mockImplementation((k: string) =>
          Promise.resolve(restartStore.get(k) as schema.City | schema.City[] | undefined),
        ),
      set: jest.fn().mockImplementation((k: string, v: unknown) => {
        restartStore.set(k, v);
        return Promise.resolve();
      }),
      del: jest.fn().mockImplementation((k: string) => {
        restartStore.delete(k);
        return Promise.resolve();
      }),
    };
    const restartedService = new CitiesService(repo, restartCache as Cache);

    const restartedList = await restartedService.findAll();
    expect(restartedList.length).toBe(351);

    const restartedMaadi = await restartedService.findById(maadiId);
    expect(restartedMaadi?.sourceCode).toBe('EG0104');
    expect(restartedMaadi?.status).toBe('OFFICIAL');

    const restartedUnmapped = await restartedService.findById(unmappedLegacyId);
    expect(restartedUnmapped?.status).toBe('LEGACY');
  });
});

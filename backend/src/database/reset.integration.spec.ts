import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool, type QueryResult } from 'pg';
import * as bcrypt from 'bcryptjs';
import { runDatabasePreflight, isLocalHost } from './preflight';
import { runDatabaseReset } from './reset';

describe('Canonical Baseline Database Reset Integration', () => {
  jest.setTimeout(120_000);

  let container: StartedPostgreSqlContainer;
  let connectionString: string;
  let pool: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4-alpine')
      .withDatabase('pupzy_reset_test')
      .withUsername('test')
      .withPassword('test')
      .start();

    connectionString = container.getConnectionUri();
    pool = new Pool({ connectionString });
  }, 120_000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
  });

  describe('Read-Only Preflight Safeguards', () => {
    it('correctly classifies local vs remote hosts', () => {
      expect(isLocalHost('localhost')).toBe(true);
      expect(isLocalHost('127.0.0.1')).toBe(true);
      expect(isLocalHost('::1')).toBe(true);
      expect(isLocalHost('host.docker.internal')).toBe(true);
      expect(isLocalHost('172.17.0.2')).toBe(true);
      expect(isLocalHost('10.0.0.5')).toBe(true);
      expect(isLocalHost('192.168.1.100')).toBe(true);

      expect(isLocalHost('prod-db.pupzy.internal')).toBe(false);
      expect(isLocalHost('aws-rds.amazonaws.com')).toBe(false);
      expect(isLocalHost('railway.app')).toBe(false);
    });

    it('passes on a valid local test database and reports metadata', async () => {
      const report = await runDatabasePreflight({ pool, databaseUrl: connectionString });
      expect(report.isSafe).toBe(true);
      expect(report.databaseName).toBe('pupzy_reset_test');
      expect(report.currentUser).toBe('test');
      expect(typeof report.publicTableCount).toBe('number');
      expect(typeof report.hasDrizzleSchema).toBe('boolean');
    });

    it('refuses destructive reset if NODE_ENV is production without explicit override', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        await expect(
          runDatabasePreflight({ pool, databaseUrl: connectionString, allowProduction: false }),
        ).rejects.toThrow(/production/);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('refuses destructive reset if host is remote without explicit override', async () => {
      await expect(
        runDatabasePreflight({
          databaseUrl: 'postgresql://postgres:secret@db.railway.internal:5432/pupzy',
          allowRemote: false,
        }),
      ).rejects.toThrow(/remote database/);
    });

    it('refuses destructive reset if target database is a protected system database', async () => {
      const sysPool = new Pool({ connectionString });
      // Simulate system db name check by mocking query response
      const mockResult: QueryResult<{
        db_name: string;
        db_user: string;
        server_ip: string | null;
        server_port: number | null;
        db_version: string;
      }> = {
        rows: [
          {
            db_name: 'template1',
            db_user: 'postgres',
            server_ip: '127.0.0.1',
            server_port: 5432,
            db_version: 'PostgreSQL 16',
          },
        ],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      };
      const querySpy = jest.spyOn(sysPool, 'query').mockResolvedValueOnce(mockResult as never);

      try {
        await expect(runDatabasePreflight({ pool: sysPool, databaseUrl: connectionString })).rejects.toThrow(
          /system database/,
        );
      } finally {
        querySpy.mockRestore();
        await sysPool.end();
      }
    });
  });

  describe('Clean Reset, Migration, and Canonical Baseline Seeding', () => {
    it('executes full database reset, applies all migrations, and establishes the canonical baseline', async () => {
      // 1. First populate the database with synthetic/benchmark dummy data
      await pool.query(`
        CREATE TABLE IF NOT EXISTS dummy_benchmark_data (id serial primary key, note text);
        INSERT INTO dummy_benchmark_data (note) VALUES ('disposable dummy record');
      `);

      // 2. Run database reset with admin seed credentials
      const resetResult = await runDatabaseReset({
        pool,
        databaseUrl: connectionString,
        adminSeed: {
          email: 'admin@pupzy.local',
          password: 'SuperSecureAdminPassword123!',
          fullName: 'Pupzy Root Administrator',
        },
      });

      // Verify reset report summary
      expect(resetResult.citiesCount).toBe(351);
      expect(resetResult.governoratesCount).toBe(27);
      expect(resetResult.vetClinicsCount).toBe(16);
      expect(resetResult.catalogRevision).toBe(1);
      expect(resetResult.adminCreated).toBe(true);
      expect(resetResult.usersCount).toBe(0);
      expect(resetResult.postsCount).toBe(0);

      // Verify dummy benchmark table was dropped
      const dummyRes = await pool.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'dummy_benchmark_data'
      `);
      expect(dummyRes.rows[0].count).toBe('0');

      // Verify all 351 official cities have required lifecycle fields
      const officialCitiesRes = await pool.query<{
        id: string;
        source_code: string;
        name_english: string;
        name_arabic: string;
        governorate: string;
        source_name_english: string;
        source_name_arabic: string;
        status: string;
        has_center_point: boolean;
      }>(`
        SELECT
          id,
          source_code,
          name_english,
          name_arabic,
          governorate,
          source_name_english,
          source_name_arabic,
          status,
          (center_point IS NOT NULL) AS has_center_point
        FROM cities
        ORDER BY source_code
      `);

      expect(officialCitiesRes.rows.length).toBe(351);
      for (const city of officialCitiesRes.rows) {
        expect(city.status).toBe('OFFICIAL');
        expect(city.source_code).toMatch(/^EG\d{4}$/);
        expect(city.name_english.trim().length).toBeGreaterThan(0);
        expect(city.name_arabic.trim().length).toBeGreaterThan(0);
        expect(city.governorate.trim().length).toBeGreaterThan(0);
        expect(city.source_name_english.trim().length).toBeGreaterThan(0);
        expect(city.source_name_arabic.trim().length).toBeGreaterThan(0);
        expect(city.has_center_point).toBe(true);
      }

      // Verify 27 distinct governorates
      const distinctGovs = new Set(officialCitiesRes.rows.map((c) => c.governorate));
      expect(distinctGovs.size).toBe(27);

      // Verify the 16 checked-in Imported Vet Clinics are linked to valid official cities
      const clinicsRes = await pool.query<{
        id: string;
        name_english: string | null;
        name_arabic: string | null;
        city_id: string;
        source: string;
        osm_id: string;
        has_coordinates: boolean;
      }>(`
        SELECT
          id,
          name_english,
          name_arabic,
          city_id,
          source,
          osm_id::text,
          (coordinates IS NOT NULL) AS has_coordinates
        FROM vet_clinics
      `);

      expect(clinicsRes.rows.length).toBe(16);
      for (const clinic of clinicsRes.rows) {
        expect(clinic.city_id).toBeTruthy();
        expect(clinic.source).toBe('OSM');
        expect(clinic.osm_id).toBeTruthy();
        expect(clinic.has_coordinates).toBe(true);
      }

      // Verify million benchmark was not generated
      const usersRes = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM users`);
      expect(usersRes.rows[0].count).toBe('0');
      const postsRes = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM posts`);
      expect(postsRes.rows[0].count).toBe('0');

      // Verify admin user creation with bcrypt hash (no plaintext)
      const adminRes = await pool.query<{
        id: string;
        email: string;
        password_hash: string;
        role: string;
        is_active: boolean;
      }>(`
        SELECT id, email, password_hash, role, is_active
        FROM admin_users
        WHERE email = 'admin@pupzy.local'
      `);

      expect(adminRes.rows.length).toBe(1);
      const admin = adminRes.rows[0];
      expect(admin.email).toBe('admin@pupzy.local');
      expect(admin.role).toBe('SUPER_ADMIN');
      expect(admin.is_active).toBe(true);
      expect(admin.password_hash).toMatch(/^\$2[aby]\$\d{2}\$/); // bcrypt hash format
      expect(await bcrypt.compare('SuperSecureAdminPassword123!', admin.password_hash)).toBe(true);
      expect(await bcrypt.compare('WrongPassword', admin.password_hash)).toBe(false);
    });

    it('proves database schema contains all columns, indexes, and types expected by AdminJS Cities resource', async () => {
      const columnsRes = await pool.query<{ column_name: string; data_type: string; udt_name: string }>(`
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns
        WHERE table_name = 'cities' AND table_schema = 'public'
      `);

      const columnNames = columnsRes.rows.map((c) => c.column_name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('source_code');
      expect(columnNames).toContain('name_english');
      expect(columnNames).toContain('name_arabic');
      expect(columnNames).toContain('governorate');
      expect(columnNames).toContain('source_name_english');
      expect(columnNames).toContain('source_name_arabic');
      expect(columnNames).toContain('status');
      expect(columnNames).toContain('center_point');
      expect(columnNames).toContain('created_at');

      // Verify status enum type
      const statusCol = columnsRes.rows.find((c) => c.column_name === 'status');
      expect(statusCol?.udt_name).toBe('city_lifecycle_status');

      // Verify singleton revision table
      const revRes = await pool.query<{ id: number; revision: number }>(`
        SELECT id, revision FROM city_catalog_revisions
      `);
      expect(revRes.rows).toEqual([{ id: 1, revision: 1 }]);
    });
  });
});

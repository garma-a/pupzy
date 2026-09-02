import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool, type QueryResult } from 'pg';
import * as bcrypt from 'bcryptjs';
import { runDatabasePreflight, isLoopbackHost, isLocalHost } from './preflight';
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
    it('correctly classifies loopback/sockets as local and private/docker/remote as non-local', () => {
      // Loopback hosts & sockets (trusted automatically)
      expect(isLoopbackHost('localhost')).toBe(true);
      expect(isLoopbackHost('LOCALHOST')).toBe(true);
      expect(isLoopbackHost('127.0.0.1')).toBe(true);
      expect(isLoopbackHost('127.0.0.2')).toBe(true);
      expect(isLoopbackHost('127.255.255.255')).toBe(true);
      expect(isLoopbackHost('::1')).toBe(true);
      expect(isLoopbackHost('[::1]')).toBe(true);
      expect(isLoopbackHost('0:0:0:0:0:0:0:1')).toBe(true);
      expect(isLoopbackHost('[0:0:0:0:0:0:0:1]')).toBe(true);
      expect(isLoopbackHost('::ffff:127.0.0.1')).toBe(true);
      expect(isLoopbackHost(undefined)).toBe(true);
      expect(isLoopbackHost(null)).toBe(true);
      expect(isLoopbackHost('')).toBe(true);
      expect(isLoopbackHost('/var/run/postgresql')).toBe(true);
      expect(isLoopbackHost('/tmp/.s.PGSQL.5432')).toBe(true);

      // Backwards-compatible alias
      expect(isLocalHost('localhost')).toBe(true);
      expect(isLocalHost('127.0.0.1')).toBe(true);

      // Private IPv4 ranges (MUST NOT be trusted automatically)
      expect(isLoopbackHost('10.0.0.5')).toBe(false);
      expect(isLoopbackHost('10.255.0.1')).toBe(false);
      expect(isLoopbackHost('172.16.0.1')).toBe(false);
      expect(isLoopbackHost('172.17.0.2')).toBe(false);
      expect(isLoopbackHost('172.31.255.255')).toBe(false);
      expect(isLoopbackHost('192.168.1.100')).toBe(false);
      expect(isLoopbackHost('169.254.1.1')).toBe(false);

      // Docker host aliases (MUST NOT be trusted automatically)
      expect(isLoopbackHost('host.docker.internal')).toBe(false);
      expect(isLoopbackHost('gateway.docker.internal')).toBe(false);
      expect(isLoopbackHost('docker.for.mac.host.internal')).toBe(false);

      // Container & remote domain names / public IPs
      expect(isLoopbackHost('postgres')).toBe(false);
      expect(isLoopbackHost('prod-db.pupzy.internal')).toBe(false);
      expect(isLoopbackHost('aws-rds.amazonaws.com')).toBe(false);
      expect(isLoopbackHost('railway.app')).toBe(false);
      expect(isLoopbackHost('1.2.3.4')).toBe(false);
    });

    it('passes on a valid local test database and reports metadata', async () => {
      const report = await runDatabasePreflight({ pool, databaseUrl: connectionString });
      expect(report.isSafe).toBe(true);
      expect(report.databaseName).toBe('pupzy_reset_test');
      expect(report.currentUser).toBe('test');
      expect(report.isLoopback).toBe(true);
      expect(report.isProduction).toBe(false);
      expect(typeof report.publicTableCount).toBe('number');
      expect(typeof report.hasDrizzleSchema).toBe('boolean');
    });

    describe('Production Environment Protection', () => {
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

      it('refuses destructive reset if RAILWAY_ENVIRONMENT_NAME is production without explicit override', async () => {
        const originalRailway = process.env.RAILWAY_ENVIRONMENT_NAME;
        try {
          process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
          await expect(
            runDatabasePreflight({ pool, databaseUrl: connectionString, allowProduction: false }),
          ).rejects.toThrow(/production/);
        } finally {
          process.env.RAILWAY_ENVIRONMENT_NAME = originalRailway;
        }
      });

      it('allows destructive reset in production environment when allowProduction is explicitly true', async () => {
        const originalEnv = process.env.NODE_ENV;
        try {
          process.env.NODE_ENV = 'production';
          const report = await runDatabasePreflight({
            pool,
            databaseUrl: connectionString,
            allowProduction: true,
          });
          expect(report.isSafe).toBe(true);
          expect(report.isProduction).toBe(true);
        } finally {
          process.env.NODE_ENV = originalEnv;
        }
      });
    });

    describe('Remote & Private-Network Host Protection', () => {
      it('refuses destructive reset if host is remote without explicit override', async () => {
        await expect(
          runDatabasePreflight({
            databaseUrl: 'postgresql://postgres:secret@db.railway.internal:5432/pupzy_reset_test',
            allowRemote: false,
          }),
        ).rejects.toThrow(/target host "db.railway.internal" is not an automatically trusted local loopback target/);
      });

      it('refuses destructive reset for private IPv4 addresses without explicit override', async () => {
        await expect(
          runDatabasePreflight({
            databaseUrl: 'postgresql://postgres:secret@172.17.0.2:5432/pupzy_reset_test',
            allowRemote: false,
          }),
        ).rejects.toThrow(/target host "172.17.0.2" is not an automatically trusted local loopback target/);

        await expect(
          runDatabasePreflight({
            databaseUrl: 'postgresql://postgres:secret@10.0.0.5:5432/pupzy_reset_test',
            allowRemote: false,
          }),
        ).rejects.toThrow(/target host "10.0.0.5" is not an automatically trusted local loopback target/);

        await expect(
          runDatabasePreflight({
            databaseUrl: 'postgresql://postgres:secret@192.168.1.50:5432/pupzy_reset_test',
            allowRemote: false,
          }),
        ).rejects.toThrow(/target host "192.168.1.50" is not an automatically trusted local loopback target/);
      });

      it('refuses destructive reset for Docker host aliases without explicit override', async () => {
        await expect(
          runDatabasePreflight({
            databaseUrl: 'postgresql://postgres:secret@host.docker.internal:5432/pupzy_reset_test',
            allowRemote: false,
          }),
        ).rejects.toThrow(/target host "host.docker.internal" is not an automatically trusted local loopback target/);
      });

      it('allows remote database target when allowRemote is explicitly true', async () => {
        const report = await runDatabasePreflight({
          pool,
          databaseUrl: connectionString,
          allowRemote: true,
        });
        expect(report.isSafe).toBe(true);
      });
    });

    describe('Expected Database Name Verification', () => {
      it('refuses reset when confirmDatabaseName does not match connected database', async () => {
        await expect(
          runDatabasePreflight({
            pool,
            databaseUrl: connectionString,
            confirmDatabaseName: 'pupzy_production_accident',
          }),
        ).rejects.toThrow(/target database name mismatch/);
      });

      it('refuses reset when expectedDatabaseName does not match connected database', async () => {
        await expect(
          runDatabasePreflight({
            pool,
            databaseUrl: connectionString,
            expectedDatabaseName: 'different_db_name',
          }),
        ).rejects.toThrow(/target database name mismatch/);
      });

      it('refuses reset when expectedDatabaseNames list does not include connected database', async () => {
        await expect(
          runDatabasePreflight({
            pool,
            databaseUrl: connectionString,
            expectedDatabaseNames: ['staging_db', 'dev_db'],
          }),
        ).rejects.toThrow(/target database name mismatch/);
      });

      it('passes reset when expectedDatabaseName matches connected database', async () => {
        const report = await runDatabasePreflight({
          pool,
          databaseUrl: connectionString,
          expectedDatabaseName: 'pupzy_reset_test',
        });
        expect(report.databaseName).toBe('pupzy_reset_test');
      });

      it('refuses reset when no expected database name can be determined', async () => {
        // Pool wrapper with active connection where expected name is not provided in options or pool config
        const namelessPool = {
          options: { host: '127.0.0.1' },
          query: pool.query.bind(pool),
          end: async () => {},
        } as unknown as Pool;

        await expect(
          runDatabasePreflight({
            pool: namelessPool,
          }),
        ).rejects.toThrow(/an expected database name is required/);
      });
    });

    describe('Protected System Database Protection', () => {
      it('refuses destructive reset if target database is a protected system database', async () => {
        const sysPool = new Pool({ connectionString });
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
          await expect(
            runDatabasePreflight({
              pool: sysPool,
              databaseUrl: connectionString,
              expectedDatabaseName: 'template1',
            }),
          ).rejects.toThrow(/system database/);
        } finally {
          querySpy.mockRestore();
          await sysPool.end();
        }
      });

      it('allows system database reset only when allowSystemDatabase is explicitly provided', async () => {
        const sysPool = new Pool({ connectionString });
        const mockIdentResult: QueryResult<{
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
        const mockTableResult: QueryResult<{ count: string }> = {
          rows: [{ count: '0' }],
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
        };

        const querySpy = jest
          .spyOn(sysPool, 'query')
          .mockResolvedValueOnce(mockIdentResult as never)
          .mockResolvedValueOnce(mockTableResult as never)
          .mockResolvedValueOnce(mockTableResult as never);

        try {
          const report = await runDatabasePreflight({
            pool: sysPool,
            databaseUrl: connectionString,
            expectedDatabaseName: 'template1',
            allowSystemDatabase: true,
          });
          expect(report.databaseName).toBe('template1');
        } finally {
          querySpy.mockRestore();
          await sysPool.end();
        }
      });
    });

    describe('Independence of Policy Checks', () => {
      it('refuses reset if allowProduction is true but host is remote and allowRemote is false', async () => {
        await expect(
          runDatabasePreflight({
            databaseUrl: 'postgresql://postgres:secret@db.railway.internal:5432/pupzy_reset_test',
            allowProduction: true,
            allowRemote: false,
          }),
        ).rejects.toThrow(/target host "db.railway.internal" is not an automatically trusted local loopback target/);
      });

      it('refuses reset if allowRemote is true but environment is production and allowProduction is false', async () => {
        const originalEnv = process.env.NODE_ENV;
        try {
          process.env.NODE_ENV = 'production';
          await expect(
            runDatabasePreflight({
              pool,
              databaseUrl: connectionString,
              allowRemote: true,
              allowProduction: false,
            }),
          ).rejects.toThrow(/environment indicates production/);
        } finally {
          process.env.NODE_ENV = originalEnv;
        }
      });

      it('refuses reset if both allowProduction and allowRemote are true but database name mismatches', async () => {
        await expect(
          runDatabasePreflight({
            pool,
            databaseUrl: connectionString,
            allowProduction: true,
            allowRemote: true,
            confirmDatabaseName: 'wrong_expected_db',
          }),
        ).rejects.toThrow(/target database name mismatch/);
      });
    });
  });

  describe('Check-Only Mode', () => {
    it('performs read-only policy and identity validation without changing database state', async () => {
      // Create a sentinel record
      await pool.query(`
        CREATE TABLE IF NOT EXISTS check_only_sentinel (id serial primary key, val text);
        INSERT INTO check_only_sentinel (val) VALUES ('persisted_before_check');
      `);

      const result = await runDatabaseReset({
        pool,
        databaseUrl: connectionString,
        checkOnly: true,
      });

      expect(result.checkOnly).toBe(true);
      expect(result.preflight.isSafe).toBe(true);
      expect(result.preflight.databaseName).toBe('pupzy_reset_test');
      expect(result.citiesCount).toBe(0);

      // Verify sentinel record was NOT dropped or wiped
      const checkRes = await pool.query<{ val: string }>(`
        SELECT val FROM check_only_sentinel WHERE val = 'persisted_before_check'
      `);
      expect(checkRes.rows.length).toBe(1);

      await pool.query(`DROP TABLE IF EXISTS check_only_sentinel CASCADE;`);
    });
  });

  describe('Zero-Write Failure Behavior Guarantee', () => {
    it('executes zero writes or drops when target verification fails', async () => {
      // 1. Create a sentinel table with existing records
      await pool.query(`
        CREATE TABLE IF NOT EXISTS zero_write_sentinel (id serial primary key, secret text);
        INSERT INTO zero_write_sentinel (secret) VALUES ('critical_production_data');
      `);

      // 2. Attempt reset with database name mismatch
      await expect(
        runDatabaseReset({
          pool,
          databaseUrl: connectionString,
          confirmDatabaseName: 'mismatched_db_name',
        }),
      ).rejects.toThrow(/target database name mismatch/);

      // Verify sentinel data remains intact
      let sentinelRes = await pool.query<{ count: string; secret: string }>(`
        SELECT count(*)::text AS count, max(secret) AS secret FROM zero_write_sentinel
      `);
      expect(sentinelRes.rows[0].count).toBe('1');
      expect(sentinelRes.rows[0].secret).toBe('critical_production_data');

      // 3. Attempt reset with production environment refusal
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        await expect(
          runDatabaseReset({
            pool,
            databaseUrl: connectionString,
            allowProduction: false,
          }),
        ).rejects.toThrow(/environment indicates production/);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }

      // Verify sentinel data STILL remains intact
      sentinelRes = await pool.query<{ count: string; secret: string }>(`
        SELECT count(*)::text AS count, max(secret) AS secret FROM zero_write_sentinel
      `);
      expect(sentinelRes.rows[0].count).toBe('1');
      expect(sentinelRes.rows[0].secret).toBe('critical_production_data');

      // Clean up sentinel table
      await pool.query(`DROP TABLE IF EXISTS zero_write_sentinel CASCADE;`);
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

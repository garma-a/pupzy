import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { runMigrations } from './migrate';

describe('Database Migration Runner Integration', () => {
  jest.setTimeout(120_000);

  let container: StartedPostgreSqlContainer;
  let connectionString: string;
  let pool: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4-alpine')
      .withDatabase('pupzy_migration_test')
      .withUsername('test')
      .withPassword('test')
      .start();

    connectionString = container.getConnectionUri();
    pool = new Pool({ connectionString });
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
  });

  it('proves clean-database migration successfully creates all schema and custom objects', async () => {
    // Run migrations on clean database
    await expect(
      runMigrations({
        pool,
        migrationsFolder: path.resolve(__dirname, '../../drizzle/migrations'),
        customSqlPath: path.resolve(__dirname, '../../drizzle/custom.sql'),
      }),
    ).resolves.not.toThrow();

    // Verify key tables exist
    const tablesRes = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    const tableNames = tablesRes.rows.map((r) => r.table_name);

    expect(tableNames).toContain('users');
    expect(tableNames).toContain('posts');
    expect(tableNames).toContain('admin_users');
    expect(tableNames).toContain('moderation_actions');
    expect(tableNames).toContain('cities');
    expect(tableNames).toContain('rescue_posts');
    expect(tableNames).toContain('lost_posts');
    expect(tableNames).toContain('adoption_posts');
    expect(tableNames).toContain('product_posts');
    expect(tableNames).toContain('mating_posts');
    expect(tableNames).toContain('notifications');
    expect(tableNames).toContain('vet_clinic_location_audits');

    // Verify vet_clinic_location_audits attribution columns are all NOT NULL
    const auditColsRes = await pool.query<{ column_name: string; is_nullable: string }>(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'vet_clinic_location_audits'
    `);
    const colNullMap = Object.fromEntries(auditColsRes.rows.map((r) => [r.column_name, r.is_nullable]));
    expect(colNullMap['vet_clinic_id']).toBe('NO');
    expect(colNullMap['admin_user_id']).toBe('NO');
    expect(colNullMap['selected_city_id']).toBe('NO');
    expect(colNullMap['nearest_city_id']).toBe('NO');

    // Verify foreign keys use RESTRICT ('r') for on delete
    const fkRes = await pool.query<{ conname: string; confdeltype: string }>(`
      SELECT conname, confdeltype::text AS confdeltype
      FROM pg_constraint
      WHERE conrelid = 'vet_clinic_location_audits'::regclass AND contype = 'f'
    `);
    expect(fkRes.rows.length).toBe(4);
    for (const fk of fkRes.rows) {
      expect(fk.confdeltype).toBe('r'); // 'r' = RESTRICT
    }

    // Verify append-only trigger exists
    const triggerRes = await pool.query<{ tgname: string }>(`
      SELECT tgname
      FROM pg_trigger
      WHERE tgrelid = 'vet_clinic_location_audits'::regclass AND tgname = 'trg_audit_append_only'
    `);
    expect(triggerRes.rowCount).toBe(1);

    // Verify city_lifecycle_status operators and functions exist from migration 0017
    const operatorRes = await pool.query<{ oprname: string }>(`
      SELECT oprname
      FROM pg_operator
      WHERE oprleft = 'city_lifecycle_status'::regtype
        AND oprright = 'text'::regtype
    `);
    const operatorNames = operatorRes.rows.map((r) => r.oprname);
    expect(operatorNames).toContain('~~*');
    expect(operatorNames).toContain('~~');

    const functionRes = await pool.query<{ proname: string }>(`
      SELECT proname
      FROM pg_proc
      WHERE proname IN ('city_lifecycle_status_ilike', 'city_lifecycle_status_like')
    `);
    const functionNames = functionRes.rows.map((r) => r.proname);
    expect(functionNames).toContain('city_lifecycle_status_ilike');
    expect(functionNames).toContain('city_lifecycle_status_like');
  });

  it('proves city lifecycle status filtering via ~~* and ~~ operators functions properly', async () => {
    // Insert cities with different lifecycle statuses
    const officialRes = await pool.query<{ id: string }>(`
      INSERT INTO cities (name_english, name_arabic, governorate, center_point, status)
      VALUES ('Alexandria', 'الإسكندرية', 'Alexandria', ST_SetSRID(ST_MakePoint(29.9187, 31.2001), 4326), 'OFFICIAL')
      RETURNING id
    `);
    const officialId = officialRes.rows[0].id;

    const legacyRes = await pool.query<{ id: string }>(`
      INSERT INTO cities (name_english, name_arabic, governorate, center_point, status)
      VALUES ('Legacy City', 'مدينة قديمة', 'Giza', ST_SetSRID(ST_MakePoint(31.2, 30.0), 4326), 'LEGACY')
      RETURNING id
    `);
    const legacyId = legacyRes.rows[0].id;

    const retiredRes = await pool.query<{ id: string }>(`
      INSERT INTO cities (name_english, name_arabic, governorate, center_point, status)
      VALUES ('Retired District', 'حي ملغى', 'Cairo', ST_SetSRID(ST_MakePoint(31.3, 30.1), 4326), 'RETIRED')
      RETURNING id
    `);
    const retiredId = retiredRes.rows[0].id;

    // Test case-insensitive ~~* operator filtering (used by AdminJS list filter)
    const ilikeOfficial = await pool.query<{ id: string }>(`
      SELECT id FROM cities WHERE status ~~* '%official%'
    `);
    const ilikeOfficialIds = ilikeOfficial.rows.map((r) => r.id);
    expect(ilikeOfficialIds).toContain(officialId);
    expect(ilikeOfficialIds).not.toContain(legacyId);
    expect(ilikeOfficialIds).not.toContain(retiredId);

    const ilikeLegacy = await pool.query<{ id: string }>(`
      SELECT id FROM cities WHERE status ~~* '%legacy%'
    `);
    expect(ilikeLegacy.rows.map((r) => r.id)).toEqual([legacyId]);

    const ilikeRetired = await pool.query<{ id: string }>(`
      SELECT id FROM cities WHERE status ~~* '%retired%'
    `);
    expect(ilikeRetired.rows.map((r) => r.id)).toEqual([retiredId]);

    // Test case-sensitive ~~ operator filtering
    const likeExact = await pool.query<{ id: string }>(`
      SELECT id FROM cities WHERE status ~~ 'OFFICIAL'
    `);
    expect(likeExact.rows.map((r) => r.id)).toContain(officialId);

    const likeWrongCase = await pool.query<{ id: string }>(`
      SELECT id FROM cities WHERE status ~~ 'official'
    `);
    expect(likeWrongCase.rowCount).toBe(0);
  });

  it('proves repeatable custom SQL is applied and triggers/constraints are active', async () => {
    // 1. Verify foreign key from custom.sql
    const fkRes = await pool.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE constraint_name = 'fk_users_banned_by_admin'
    `);
    expect(fkRes.rowCount).toBeGreaterThan(0);

    // 2. Insert prerequisite rows to test triggers and constraints
    const cityRes = await pool.query<{ id: string }>(`
      INSERT INTO cities (name_english, name_arabic, governorate, center_point)
      VALUES ('Cairo', 'القاهرة', 'Cairo', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326))
      RETURNING id
    `);
    const cityId = cityRes.rows[0].id;

    const userRes = await pool.query<{ id: string; post_count: number; rescue_post_count: number }>(`
      INSERT INTO users (firebase_user_id, email, full_name)
      VALUES ('test-fb-1', 'user1@example.com', 'User One')
      RETURNING id, post_count, rescue_post_count
    `);
    const userId = userRes.rows[0].id;
    expect(userRes.rows[0].post_count).toBe(0);

    // 3. Test check constraint from custom.sql:
    // RESCUE post without urgency tier should violate posts_urgency_matches_post_type_constraint
    await expect(
      pool.query(
        `INSERT INTO posts (creator_id, post_type, title, description, status, moderation_status, city_id, coordinates, urgency)
         VALUES ($1, 'RESCUE', 'Rescue dog', 'Needs help', 'ACTIVE', 'CLEAN', $2, ST_SetSRID(ST_MakePoint(31.2, 30.0), 4326), NULL)`,
        [userId, cityId],
      ),
    ).rejects.toThrow();

    // Valid RESCUE post with urgency should succeed and trigger sync_user_post_counts
    await pool.query(
      `INSERT INTO posts (creator_id, post_type, title, description, status, moderation_status, city_id, coordinates, urgency)
       VALUES ($1, 'RESCUE', 'Rescue dog', 'Needs help', 'ACTIVE', 'CLEAN', $2, ST_SetSRID(ST_MakePoint(31.2, 30.0), 4326), 'CRITICAL')`,
      [userId, cityId],
    );

    const userAfterPost = await pool.query<{ post_count: number; rescue_post_count: number }>(
      `SELECT post_count, rescue_post_count FROM users WHERE id = $1`,
      [userId],
    );
    expect(userAfterPost.rows[0].post_count).toBe(1);
    expect(userAfterPost.rows[0].rescue_post_count).toBe(1);
  });

  it('revokes admin sessions on security changes and enforces canonical email uniqueness', async () => {
    const admin = await pool.query<{ id: string }>(`
      INSERT INTO admin_users (email, password_hash, full_name, role)
      VALUES ('security@example.com', 'hash-one', 'Security Admin', 'SUPER_ADMIN')
      RETURNING id
    `);
    const adminId = admin.rows[0].id;

    await expect(
      pool.query(
        `INSERT INTO admin_users (email, password_hash, full_name)
         VALUES ('SECURITY@example.com', 'hash-two', 'Duplicate Admin')`,
      ),
    ).rejects.toThrow();

    for (const update of [`password_hash = 'hash-changed'`, `role = 'ADMIN'`, `is_active = FALSE`]) {
      await pool.query(
        `INSERT INTO admin_sessions (sid, sess, expire)
         VALUES ($1, $2::json, now() + interval '1 hour')`,
        [`session-${update}`, JSON.stringify({ adminUser: { id: adminId } })],
      );
      await pool.query(`UPDATE admin_users SET ${update} WHERE id = $1`, [adminId]);
      const sessions = await pool.query(`SELECT sid FROM admin_sessions WHERE sess -> 'adminUser' ->> 'id' = $1`, [
        adminId,
      ]);
      expect(sessions.rowCount).toBe(0);
    }
  });

  it('proves re-running the migration operation against an already-migrated database succeeds without error or schema corruption', async () => {
    // Re-run the full migration operation
    await expect(
      runMigrations({
        pool,
        migrationsFolder: path.resolve(__dirname, '../../drizzle/migrations'),
        customSqlPath: path.resolve(__dirname, '../../drizzle/custom.sql'),
      }),
    ).resolves.not.toThrow();

    // Verify existing data remains intact
    const usersCount = await pool.query<{ count: string }>(`SELECT count(*) FROM users`);
    expect(parseInt(usersCount.rows[0].count, 10)).toBeGreaterThan(0);

    const postsCount = await pool.query<{ count: string }>(`SELECT count(*) FROM posts`);
    expect(parseInt(postsCount.rows[0].count, 10)).toBeGreaterThan(0);

    // Verify operators still function seamlessly after rerun
    const postRerunIlike = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM cities WHERE status ~~* '%official%'
    `);
    expect(parseInt(postRerunIlike.rows[0].count, 10)).toBeGreaterThan(0);

    const postRerunLike = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM cities WHERE status ~~ 'OFFICIAL'
    `);
    expect(parseInt(postRerunLike.rows[0].count, 10)).toBeGreaterThan(0);
  });

  it('proves nonzero failure behavior when migration or custom SQL fails', async () => {
    // Nonexistent migrations folder fails
    await expect(
      runMigrations({
        pool,
        migrationsFolder: path.resolve(__dirname, 'nonexistent-migrations-dir'),
      }),
    ).rejects.toThrow();

    await expect(
      runMigrations({
        pool,
        migrationsFolder: path.resolve(__dirname, '../../drizzle/migrations'),
        customSqlPath: path.resolve(__dirname, 'missing-custom.sql'),
      }),
    ).rejects.toThrow(/Custom SQL file not found/);

    // Broken custom SQL file fails
    const tempCustomSql = path.resolve(__dirname, 'temp_broken.sql');
    fs.writeFileSync(tempCustomSql, 'THIS IS INVALID SQL STATEMENT;');
    try {
      await expect(
        runMigrations({
          pool,
          migrationsFolder: path.resolve(__dirname, '../../drizzle/migrations'),
          customSqlPath: tempCustomSql,
        }),
      ).rejects.toThrow();
    } finally {
      if (fs.existsSync(tempCustomSql)) {
        fs.unlinkSync(tempCustomSql);
      }
    }
  });

  it('proves upgrade from the immediately preceding nullable-audit schema (0000..0018) preserves existing attributed audits and establishes candidate schema', async () => {
    // 1. Create a dedicated database for testing baseline upgrade
    await pool.query('CREATE DATABASE pupzy_baseline_upgrade_test;');
    const upgradeConnStr = connectionString.replace('/pupzy_migration_test', '/pupzy_baseline_upgrade_test');
    const upgradePool = new Pool({ connectionString: upgradeConnStr });

    const tempBaselineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drizzle-main-baseline-'));
    const tempMetaDir = path.join(tempBaselineDir, 'meta');
    fs.mkdirSync(tempMetaDir, { recursive: true });

    try {
      // Create extensions & uuidv7
      await upgradePool.query('CREATE EXTENSION IF NOT EXISTS postgis;');
      await upgradePool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
      await upgradePool.query(`
        CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
          SELECT (
            lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') ||
            '7' || substr(encode(gen_random_bytes(2), 'hex'), 2, 3) ||
            '8' || substr(encode(gen_random_bytes(2), 'hex'), 2, 3) ||
            encode(gen_random_bytes(6), 'hex')
          )::uuid;
        $$ LANGUAGE sql VOLATILE;
      `);

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

      // Reproduce the schema immediately before 0019, where the administrator
      // attribution column was nullable and foreign keys used SET NULL.
      const fullJournalPath = path.resolve(__dirname, '../../drizzle/migrations/meta/_journal.json');
      const journalData = JSON.parse(fs.readFileSync(fullJournalPath, 'utf8')) as JournalData;
      const baselineEntries = journalData.entries.filter((entry: JournalEntry) => entry.idx <= 18);
      fs.writeFileSync(
        path.join(tempMetaDir, '_journal.json'),
        JSON.stringify({ ...journalData, entries: baselineEntries }, null, 2),
      );

      // Copy migration files 0000 through 0018 into temp folder
      for (const entry of baselineEntries) {
        const sqlFileName = `${entry.tag}.sql`;
        const srcPath = path.resolve(__dirname, '../../drizzle/migrations', sqlFileName);
        fs.copyFileSync(srcPath, path.join(tempBaselineDir, sqlFileName));
      }

      // Apply the immediately preceding migrations (0000..0018)
      const upgradeDb = drizzle(upgradePool);
      await migrate(upgradeDb, { migrationsFolder: tempBaselineDir });

      // Retrieve baseline city seeded by 0011
      const cityRes = await upgradePool.query<{ id: string }>(`
        SELECT id FROM cities WHERE name_english = 'Maadi' LIMIT 1;
      `);
      const cityId = cityRes.rows[0].id;

      const userRes = await upgradePool.query<{ id: string }>(`
        INSERT INTO users (firebase_user_id, email, full_name)
        VALUES ('fb-user-upgrade-1', 'upgrade-user@example.com', 'Upgrade User')
        RETURNING id;
      `);
      const userId = userRes.rows[0].id;

      const clinicRes = await upgradePool.query<{ id: string }>(
        `INSERT INTO vet_clinics (name_english, name_arabic, city_id, coordinates, source, osm_id)
         VALUES ('Maadi Pets', 'حيوانات المعادي', $1, ST_SetSRID(ST_MakePoint(31.25, 29.96), 4326), 'OSM', 12345)
         RETURNING id;`,
        [cityId],
      );
      const clinicId = clinicRes.rows[0].id;

      const adminRes = await upgradePool.query<{ id: string }>(`
        INSERT INTO admin_users (email, password_hash, full_name, role)
        VALUES ('upgrade-admin@pupzy.local', 'hash', 'Upgrade Admin', 'SUPER_ADMIN')
        RETURNING id;
      `);
      const adminId = adminRes.rows[0].id;

      const auditRes = await upgradePool.query<{ id: string }>(
        `INSERT INTO vet_clinic_location_audits
          (id, vet_clinic_id, admin_user_id, selected_city_id, nearest_city_id, reason, coordinates)
        VALUES
          (uuidv7(), $1, $2, $3, $3, 'Audited location coordinates',
           ST_SetSRID(ST_MakePoint(31.2569, 29.9602), 4326))
        RETURNING id;`,
        [clinicId, adminId, cityId],
      );
      const auditId = auditRes.rows[0].id;

      // 2. Now run candidate migration 0019 + custom.sql on the existing database.
      await runMigrations({
        pool: upgradePool,
        migrationsFolder: path.resolve(__dirname, '../../drizzle/migrations'),
        customSqlPath: path.resolve(__dirname, '../../drizzle/custom.sql'),
      });

      // 3. Verify data preservation
      const postUpgradeCity = await upgradePool.query<{ id: string; name_english: string }>(
        `SELECT id, name_english FROM cities WHERE id = $1`,
        [cityId],
      );
      expect(postUpgradeCity.rows[0].name_english).toBe('Maadi');

      const postUpgradeUser = await upgradePool.query<{ id: string; email: string }>(
        `SELECT id, email FROM users WHERE id = $1`,
        [userId],
      );
      expect(postUpgradeUser.rows[0].email).toBe('upgrade-user@example.com');

      const postUpgradeClinic = await upgradePool.query<{ id: string; name_english: string; source: string }>(
        `SELECT id, name_english, source FROM vet_clinics WHERE id = $1`,
        [clinicId],
      );
      expect(postUpgradeClinic.rows[0].name_english).toBe('Maadi Pets');
      expect(postUpgradeClinic.rows[0].source).toBe('OSM');

      // 4. Verify the pre-existing audit attribution is preserved.
      const preservedAudit = await upgradePool.query<{
        vet_clinic_id: string;
        admin_user_id: string;
        selected_city_id: string;
        nearest_city_id: string;
      }>(
        `SELECT vet_clinic_id, admin_user_id, selected_city_id, nearest_city_id
         FROM vet_clinic_location_audits WHERE id = $1`,
        [auditId],
      );
      expect(preservedAudit.rows).toEqual([
        {
          vet_clinic_id: clinicId,
          admin_user_id: adminId,
          selected_city_id: cityId,
          nearest_city_id: cityId,
        },
      ]);

      // Verify upgraded vet_clinic_location_audits schema properties:
      // 4a. Attribution columns NOT NULL
      const upgradedCols = await upgradePool.query<{ column_name: string; is_nullable: string }>(`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'vet_clinic_location_audits'
      `);
      const upgradedNullMap = Object.fromEntries(upgradedCols.rows.map((r) => [r.column_name, r.is_nullable]));
      expect(upgradedNullMap['vet_clinic_id']).toBe('NO');
      expect(upgradedNullMap['admin_user_id']).toBe('NO');
      expect(upgradedNullMap['selected_city_id']).toBe('NO');
      expect(upgradedNullMap['nearest_city_id']).toBe('NO');

      // 4b. Foreign keys are ON DELETE RESTRICT
      const upgradedFks = await upgradePool.query<{ conname: string; confdeltype: string }>(`
        SELECT conname, confdeltype::text AS confdeltype
        FROM pg_constraint
        WHERE conrelid = 'vet_clinic_location_audits'::regclass AND contype = 'f'
      `);
      expect(upgradedFks.rows.length).toBe(4);
      for (const fk of upgradedFks.rows) {
        expect(fk.confdeltype).toBe('r');
      }

      // 4c. Deletion of referenced clinic, admin, or city is rejected
      await expect(upgradePool.query(`DELETE FROM vet_clinics WHERE id = $1`, [clinicId])).rejects.toThrow();
      await expect(upgradePool.query(`DELETE FROM admin_users WHERE id = $1`, [adminId])).rejects.toThrow();
      await expect(upgradePool.query(`DELETE FROM cities WHERE id = $1`, [cityId])).rejects.toThrow();

      // 4d. Direct UPDATE and DELETE on committed audit are rejected by append-only trigger
      await expect(
        upgradePool.query(`UPDATE vet_clinic_location_audits SET reason = 'tampered' WHERE vet_clinic_id = $1`, [
          clinicId,
        ]),
      ).rejects.toThrow(/append-only/i);

      await expect(
        upgradePool.query(`DELETE FROM vet_clinic_location_audits WHERE vet_clinic_id = $1`, [clinicId]),
      ).rejects.toThrow(/append-only/i);

      // Table: address_search_cache
      await upgradePool.query(`
        INSERT INTO address_search_cache (id, normalized_query, results)
        VALUES (uuidv7(), 'maadi clinic query', '[{"displayName":"Maadi"}]'::jsonb);
      `);
      const cacheCount = await upgradePool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM address_search_cache WHERE normalized_query = 'maadi clinic query'`,
      );
      expect(parseInt(cacheCount.rows[0].count, 10)).toBe(1);

      // 5. Verify repeat application on upgraded database succeeds
      await expect(
        runMigrations({
          pool: upgradePool,
          migrationsFolder: path.resolve(__dirname, '../../drizzle/migrations'),
          customSqlPath: path.resolve(__dirname, '../../drizzle/custom.sql'),
        }),
      ).resolves.not.toThrow();
    } finally {
      await upgradePool.end();
      fs.rmSync(tempBaselineDir, { recursive: true, force: true });
      await pool.query('DROP DATABASE IF EXISTS pupzy_baseline_upgrade_test;');
    }
  });
});

import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import * as path from 'path';
import * as fs from 'fs';
import { runMigrations } from './migrate';

describe('Database Migration Runner Integration', () => {
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
});

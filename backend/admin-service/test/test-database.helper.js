import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

const { Pool } = pg;
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(here, '../../drizzle/migrations');
const customSqlPath = path.resolve(here, '../../drizzle/custom.sql');

export class TestDatabaseHelper {
  async start() {
    this.container = await new PostgreSqlContainer('postgis/postgis:16-3.4-alpine')
      .withDatabase('pupzy_admin_test')
      .withUsername('test')
      .withPassword('test')
      .start();
    this.connectionString = this.container.getConnectionUri();
    this.pool = new Pool({ connectionString: this.connectionString, max: 8 });

    await this.pool.query('CREATE EXTENSION IF NOT EXISTS postgis');
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await this.pool.query(`
      CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
        SELECT (
          lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') ||
          '7' || substr(encode(gen_random_bytes(2), 'hex'), 2, 3) ||
          '8' || substr(encode(gen_random_bytes(2), 'hex'), 2, 3) ||
          encode(gen_random_bytes(6), 'hex')
        )::uuid;
      $$ LANGUAGE sql VOLATILE;
    `);

    const journal = JSON.parse(await fs.readFile(path.join(migrationsDirectory, 'meta/_journal.json'), 'utf8'));
    for (const entry of journal.entries) {
      const sql = await fs.readFile(path.join(migrationsDirectory, `${entry.tag}.sql`), 'utf8');
      await this.pool.query(sql);
    }
    await this.pool.query(await fs.readFile(customSqlPath, 'utf8'));
    return this.connectionString;
  }

  async clean() {
    await this.pool.query(`
      TRUNCATE TABLE
        post_media, rescue_posts, lost_posts, adoption_posts, product_posts, mating_posts,
        post_upvotes, post_saves, contact_requests, adoption_applications, post_reports,
        notifications, saved_searches, moderation_actions, posts, admin_users, users,
        cities, vet_clinics, vet_clinic_location_audits, address_search_cache
      CASCADE
    `);
  }

  async stop() {
    await this.pool?.end();
    await this.container?.stop();
  }
}

export async function seedPrincipals(pool) {
  const admin = await pool.query(
    `INSERT INTO admin_users (email, password_hash, full_name, role)
     VALUES ('admin@example.com', '$2a$12$placeholder', 'Test Admin', 'SUPER_ADMIN')
     RETURNING id`,
  );
  const city = await pool.query(
    `INSERT INTO cities (name_english, name_arabic, governorate, center_point)
     VALUES ('Cairo', 'القاهرة', 'Cairo', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326))
     RETURNING id`,
  );
  const user = await pool.query(
    `INSERT INTO users (firebase_user_id, email, full_name)
     VALUES ('firebase-test-user', 'user@example.com', 'Test User')
     RETURNING id`,
  );
  return {
    adminId: admin.rows[0].id,
    cityId: city.rows[0].id,
    userId: user.rows[0].id,
  };
}

export async function insertPost(pool, values) {
  const result = await pool.query(
    `INSERT INTO posts
       (creator_id, post_type, title, description, status, moderation_status, city_id,
        coordinates, report_count, created_at)
     VALUES ($1, 'ADOPTION', $2, 'Description', $3, $4, $5,
       ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326), $6, COALESCE($7, now()))
     RETURNING id`,
    [
      values.userId,
      values.title ?? 'Post',
      values.status ?? 'ACTIVE',
      values.moderationStatus ?? 'PENDING_AUTO_REVIEW',
      values.cityId,
      values.reportCount ?? 0,
      values.createdAt ?? null,
    ],
  );
  return result.rows[0].id;
}

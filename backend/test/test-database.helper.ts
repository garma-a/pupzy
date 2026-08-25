import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../src/database/schema';
import * as fs from 'fs';
import * as path from 'path';

export class TestDatabaseHelper {
  private container!: StartedPostgreSqlContainer;
  public pool!: Pool;
  public db!: NodePgDatabase<typeof schema>;

  async start(): Promise<string> {
    this.container = await new PostgreSqlContainer('postgis/postgis:16-3.4-alpine')
      .withDatabase('pupzy_test')
      .withUsername('test')
      .withPassword('test')
      .start();

    const connectionString = this.container.getConnectionUri();
    this.pool = new Pool({ connectionString });
    this.db = drizzle(this.pool, { schema });

    // Enable postgis, pgcrypto, and uuidv7 before running migrations
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS postgis;');
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
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

    // Run migrations
    await migrate(this.db, { migrationsFolder: path.join(__dirname, '../drizzle/migrations') });

    // Run custom.sql
    const customSqlPath = path.join(__dirname, '../drizzle/custom.sql');
    if (fs.existsSync(customSqlPath)) {
      const customSql = fs.readFileSync(customSqlPath, 'utf8');
      await this.pool.query(customSql);
    }

    return connectionString;
  }

  async clean(): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(`
      TRUNCATE TABLE
        post_media,
        rescue_posts,
        lost_posts,
        adoption_posts,
        product_posts,
        mating_posts,
        post_upvotes,
        post_saves,
        contact_requests,
        adoption_applications,
        post_reports,
        notifications,
        saved_searches,
        moderation_actions,
        posts,
        admin_users,
        users,
        cities,
        vet_clinics
      CASCADE;
    `);
  }

  async stop(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
    if (this.container) {
      await this.container.stop();
    }
  }
}

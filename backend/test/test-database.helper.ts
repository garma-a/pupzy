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
      DECLARE
        v_time timestamp with time zone:= clock_timestamp();
        v_secs bigint := floor(extract(epoch from v_time));
        v_usec bigint := extract(microsecond from v_time);
        v_msec bigint := (v_secs * 1000) + floor(v_usec / 1000);
        v_rand bytea := gen_random_bytes(10);
      BEGIN
        RETURN encode(
          set_byte(
            set_byte(
              overlay(
                v_rand
                placing substring(int8send(v_msec) from 3 for 6)
                from 1 for 6
              ),
              6, (b'0111' || substring(get_byte(v_rand, 0)::bit(8) from 5 for 4))::bit(8)::int
            ),
            8, (b'10' || substring(get_byte(v_rand, 2)::bit(8) from 3 for 6))::bit(8)::int
          ),
          'hex'
        )::uuid;
      END;
      $$ LANGUAGE plpgsql;
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
        posts,
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

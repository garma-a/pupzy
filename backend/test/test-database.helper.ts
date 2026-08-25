import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { runMigrations } from '../src/database/migrate';
import * as schema from '../src/database/schema';
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

    await runMigrations({
      pool: this.pool,
      migrationsFolder: path.join(__dirname, '../drizzle/migrations'),
      customSqlPath: path.join(__dirname, '../drizzle/custom.sql'),
    });

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

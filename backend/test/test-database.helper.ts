import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { runMigrations } from '../src/database/migrate';
import * as schema from '../src/database/schema';
import * as path from 'path';

/**
 * Opt-in escape hatch for machines without Docker: point TEST_DATABASE_URL at a
 * dedicated PostGIS database and the helper uses it instead of a container.
 * The name must end in `_test` because `start()` wipes the schema and
 * `clean()` truncates every table — this must never reach a dev or prod DB.
 */
function externalTestDatabaseUrl(): string | null {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return null;
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`TEST_DATABASE_URL must name a database ending in "_test" (got "${name}").`);
  }
  return url;
}

export class TestDatabaseHelper {
  private container?: StartedPostgreSqlContainer;
  public pool!: Pool;
  public db!: NodePgDatabase<typeof schema>;

  async start(): Promise<string> {
    const externalUrl = externalTestDatabaseUrl();
    if (!externalUrl) {
      this.container = await new PostgreSqlContainer('postgis/postgis:16-3.4-alpine')
        .withDatabase('pupzy_test')
        .withUsername('test')
        .withPassword('test')
        .start();
    }

    const connectionString = externalUrl ?? this.container!.getConnectionUri();
    this.pool = new Pool({ connectionString });
    this.db = drizzle(this.pool, { schema });

    if (externalUrl) {
      // Reproduce the empty database a fresh container would provide.
      await this.pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }

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
        discussion_notification_events,
        push_deliveries,
        device_registrations,
        moderation_actions,
        media_finalizations,
        posts,
        admin_users,
        blocks,
        account_reports,
        users,
        cities,
        vet_clinics,
        vet_clinic_location_audits,
        address_search_cache,
        account_deletions,
        staged_uploads,
        post_pins,
        comment_boosts,
        comment_idempotency,
        comment_media,
        media_deletion_work,
        comment_reports,
        comments,
        blocked_media_hashes
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

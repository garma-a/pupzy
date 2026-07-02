import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DATABASE_TOKEN = 'DATABASE';

/**
 * Drizzle ORM database provider for Pupzy backend.
 *
 * ## Connection pooling
 * Uses a `node-postgres` connection pool for efficient connection reuse.
 * Pool settings are configurable via environment variables for different
 * deployment environments.
 *
 * | Env variable             | Default | Description                               |
 * |--------------------------|---------|-------------------------------------------|
 * | DB_POOL_MAX              | 20      | Max simultaneous connections              |
 * | DB_IDLE_TIMEOUT_MS       | 30000   | Release idle connections after N ms       |
 * | DB_CONNECTION_TIMEOUT_MS | 2000    | Fail if a connection takes longer than Nms|
 *
 * ## Graceful shutdown
 * The provider implements NestJS's `onApplicationShutdown` hook via a wrapper
 * that calls `pool.end()` when the app stops. This ensures all in-flight queries
 * complete and connections are cleanly released before the process exits.
 *
 * ## Schema
 * The pool is passed to Drizzle with the full schema object, which enables
 * Drizzle's type-safe relational query builder (`db.query.*`).
 */
export const databaseProvider = {
  provide: DATABASE_TOKEN,
  useFactory: (
    databaseUrl: string,
    poolMax: number,
    idleTimeoutMs: number,
    connectionTimeoutMs: number,
  ) => {
    const pool = new Pool({
      connectionString: databaseUrl,
      max: poolMax,
      idleTimeoutMillis: idleTimeoutMs,
      connectionTimeoutMillis: connectionTimeoutMs,
    });

    // Log pool errors to avoid unhandled promise rejection crashes
    pool.on('error', (err) => {
      console.error('[Database] Unexpected pool error:', err.message);
    });

    const db = drizzle(pool, { schema });

    /**
     * Attach the pool to the db instance so DatabaseModule can
     * call pool.end() during graceful shutdown.
     * This is a lightweight pattern that avoids an extra provider.
     */
    (db as unknown as { _pool: Pool })._pool = pool;

    return db;
  },
  inject: [
    'DATABASE_URL',
    'DB_POOL_MAX',
    'DB_IDLE_TIMEOUT_MS',
    'DB_CONNECTION_TIMEOUT_MS',
  ],
};

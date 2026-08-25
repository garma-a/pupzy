import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

export interface MigrationOptions {
  databaseUrl?: string;
  migrationsFolder?: string;
  customSqlPath?: string;
  pool?: Pool;
  logger?: {
    log: (msg: string) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
}

function resolveDrizzlePath(defaultSubpath: string, explicitPath?: string): string {
  if (explicitPath) {
    return path.isAbsolute(explicitPath) ? explicitPath : path.resolve(process.cwd(), explicitPath);
  }
  const cwdPath = path.resolve(process.cwd(), defaultSubpath);
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }
  const fallbacks = [
    path.resolve(__dirname, '../../', defaultSubpath),
    path.resolve(__dirname, '../', defaultSubpath),
    path.resolve(__dirname, '../../../', defaultSubpath),
  ];
  for (const fallback of fallbacks) {
    if (fs.existsSync(fallback)) {
      return fallback;
    }
  }
  return cwdPath;
}

export async function runMigrations(options: MigrationOptions = {}): Promise<void> {
  const logger = options.logger ?? console;
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;

  if (!databaseUrl && !options.pool) {
    throw new Error('[Migration] DATABASE_URL is not set and no pg Pool was provided.');
  }

  const migrationsFolder = resolveDrizzlePath('drizzle/migrations', options.migrationsFolder);
  const customSqlPath = resolveDrizzlePath('drizzle/custom.sql', options.customSqlPath);

  if (!fs.existsSync(migrationsFolder)) {
    throw new Error(`[Migration] Migrations folder not found at: ${migrationsFolder}`);
  }

  const shouldClosePool = !options.pool;
  const pool = options.pool ?? new Pool({ connectionString: databaseUrl });

  try {
    logger.log('[Migration] Ensuring database prerequisites (extensions & uuidv7)...');
    await pool.query('CREATE EXTENSION IF NOT EXISTS postgis;');
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    await pool.query(`
      CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
        SELECT (
          lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') ||
          '7' || substr(encode(gen_random_bytes(2), 'hex'), 2, 3) ||
          '8' || substr(encode(gen_random_bytes(2), 'hex'), 2, 3) ||
          encode(gen_random_bytes(6), 'hex')
        )::uuid;
      $$ LANGUAGE sql VOLATILE;
    `);

    logger.log(`[Migration] Running Drizzle migrations from: ${migrationsFolder}`);
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    logger.log('[Migration] Drizzle schema migrations applied successfully.');

    if (fs.existsSync(customSqlPath)) {
      logger.log(`[Migration] Applying repeatable custom SQL from: ${customSqlPath}`);
      const customSql = fs.readFileSync(customSqlPath, 'utf8');
      await pool.query(customSql);
      logger.log('[Migration] Repeatable custom SQL applied successfully.');
    } else {
      logger.log(`[Migration] No custom SQL file found at ${customSqlPath}, skipping custom SQL.`);
    }

    logger.log('[Migration] Complete migration operation succeeded.');
  } catch (error) {
    logger.error('[Migration] Migration operation failed:', error);
    throw error;
  } finally {
    if (shouldClosePool) {
      await pool.end();
    }
  }
}

// CLI execution handler
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('[Migration] Finished with exit code 0.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Migration] Exiting with code 1 due to error:', err);
      process.exit(1);
    });
}

import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { runDatabasePreflight, type PreflightOptions, type PreflightReport } from './preflight';
import { runMigrations } from './migrate';
import { runDatabaseSeed, type SeedOptions } from './seed';
import * as schema from './schema';

export interface ResetOptions extends PreflightOptions {
  skipSeed?: boolean;
  adminSeed?: SeedOptions['admin'];
}

export interface ResetResult {
  preflight: PreflightReport;
  citiesCount: number;
  governoratesCount: number;
  vetClinicsCount: number;
  catalogRevision: number;
  adminCreated: boolean;
  usersCount: number;
  postsCount: number;
}

export async function runDatabaseReset(options: ResetOptions = {}): Promise<ResetResult> {
  const logger = options.logger ?? console;
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;

  if (!databaseUrl && !options.pool) {
    throw new Error('[Reset] DATABASE_URL is not set and no pg Pool was provided.');
  }

  // 1. Read-only preflight check
  logger.log('[Reset] Step 1/5: Running database preflight check...');
  const preflight = await runDatabasePreflight(options);

  const shouldClosePool = !options.pool;
  const pool = options.pool ?? new Pool({ connectionString: databaseUrl });

  try {
    // 2. Wipe application objects and migration history
    logger.log('[Reset] Step 2/5: Wiping application objects and migration history...');
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE;');
    await pool.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        -- Drop all views not belonging to an extension
        FOR r IN (
          SELECT c.relname AS viewname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'v'
            AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.objid = c.oid AND d.deptype = 'e'
            )
        ) LOOP
          EXECUTE 'DROP VIEW IF EXISTS public.' || quote_ident(r.viewname) || ' CASCADE';
        END LOOP;

        -- Drop all tables not belonging to an extension
        FOR r IN (
          SELECT c.relname AS tablename
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.objid = c.oid AND d.deptype = 'e'
            )
        ) LOOP
          EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;

        -- Drop all user-defined types (enums) not belonging to an extension
        FOR r IN (
          SELECT t.typname
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public' AND t.typtype = 'e'
            AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.objid = t.oid AND d.deptype = 'e'
            )
        ) LOOP
          EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
        END LOOP;
      END $$;
    `);

    // 3. Re-create prerequisites
    logger.log('[Reset] Step 3/5: Installing prerequisites (PostGIS, pgcrypto, uuidv7)...');
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS postgis;');
      await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    } catch {
      // Ignored if non-superuser and extensions already exist
    }
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

    // 4. Apply all migrations from clean state
    logger.log('[Reset] Step 4/5: Applying all Drizzle migrations and custom SQL...');
    await runMigrations({ pool, logger });

    // 5. Seed standard baseline dataset
    let citiesCount = 0;
    let governoratesCount = 0;
    let vetClinicsCount = 0;
    let catalogRevision = 1;
    let adminCreated = false;

    if (!options.skipSeed) {
      logger.log('[Reset] Step 5/5: Seeding authoritative baseline data (Cities, Imported Vet Clinics, Admin)...');
      const db = drizzle(pool, { schema });
      await runDatabaseSeed(db, { admin: options.adminSeed });

      const cityRes = await pool.query<{ count: string; gov_count: string }>(`
        SELECT
          count(*)::text AS count,
          count(DISTINCT governorate)::text AS gov_count
        FROM cities
        WHERE status = 'OFFICIAL'
      `);
      citiesCount = parseInt(cityRes.rows[0]?.count ?? '0', 10);
      governoratesCount = parseInt(cityRes.rows[0]?.gov_count ?? '0', 10);

      const clinicRes = await pool.query<{ count: string }>(`
        SELECT count(*)::text AS count FROM vet_clinics
      `);
      vetClinicsCount = parseInt(clinicRes.rows[0]?.count ?? '0', 10);

      const revRes = await pool.query<{ revision: number }>(`
        SELECT revision FROM city_catalog_revisions WHERE id = 1
      `);
      catalogRevision = revRes.rows[0]?.revision ?? 1;

      const adminRes = await pool.query<{ count: string }>(`
        SELECT count(*)::text AS count FROM admin_users
      `);
      adminCreated = parseInt(adminRes.rows[0]?.count ?? '0', 10) > 0;
    } else {
      logger.log('[Reset] Step 5/5: Skipping standard seed (--skip-seed specified).');
    }

    const countRes = await pool.query<{ user_count: string; post_count: string }>(`
      SELECT
        (SELECT count(*)::text FROM users) AS user_count,
        (SELECT count(*)::text FROM posts) AS post_count
    `);
    const usersCount = parseInt(countRes.rows[0]?.user_count ?? '0', 10);
    const postsCount = parseInt(countRes.rows[0]?.post_count ?? '0', 10);

    logger.log(
      `[Reset] ✅ Canonical baseline rebuild complete: ${citiesCount} official cities, ${governoratesCount} governorates, ${vetClinicsCount} vet clinics, revision=${catalogRevision}, users=${usersCount}, posts=${postsCount}.`,
    );

    return {
      preflight,
      citiesCount,
      governoratesCount,
      vetClinicsCount,
      catalogRevision,
      adminCreated,
      usersCount,
      postsCount,
    };
  } finally {
    if (shouldClosePool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const isCheckOnly = args.includes('--check');
  const allowProduction = args.includes('--force') || args.includes('--allow-production');
  const allowRemote = args.includes('--allow-remote');
  const skipSeed = args.includes('--skip-seed');

  if (isCheckOnly) {
    runDatabasePreflight({ allowProduction, allowRemote })
      .then((report) => {
        console.log('[Reset CLI] Preflight check passed:\n', JSON.stringify(report, null, 2));
        process.exit(0);
      })
      .catch((err: Error) => {
        console.error('[Reset CLI] Preflight check failed:', err.message);
        process.exit(1);
      });
  } else {
    runDatabaseReset({ allowProduction, allowRemote, skipSeed })
      .then((result) => {
        console.log(
          `[Reset CLI] Finished successfully: ${result.citiesCount} Cities, ${result.vetClinicsCount} Vet Clinics.`,
        );
        process.exit(0);
      })
      .catch((err: Error) => {
        console.error('[Reset CLI] Reset operation failed:', err);
        process.exit(1);
      });
  }
}

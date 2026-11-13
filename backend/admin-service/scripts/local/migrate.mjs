// Applies the same schema setup as test/test-database.helper.js to any Postgres URL.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(here, '../../../drizzle/migrations');
const customSqlPath = path.resolve(here, '../../../drizzle/custom.sql');

export async function migrate(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 2 });
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS postgis');
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
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
    const journal = JSON.parse(await fs.readFile(path.join(migrationsDirectory, 'meta/_journal.json'), 'utf8'));
    for (const entry of journal.entries) {
      await pool.query(await fs.readFile(path.join(migrationsDirectory, `${entry.tag}.sql`), 'utf8'));
    }
    await pool.query(await fs.readFile(customSqlPath, 'utf8'));
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await migrate(process.argv[2]);
  console.log('migrated');
}

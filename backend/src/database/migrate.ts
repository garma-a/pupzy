import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function main() {
  console.log('Connecting to database...');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool);

  console.log('Running migrations...');
  try {
    await migrate(db, { migrationsFolder: './drizzle/migrations' });
    console.log('Migrations complete!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await pool.end();
  }
}

main();

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './src/database/schema';

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://pupzy:pupzy@localhost:5432/pupzy',
  });
  const db = drizzle(pool, { schema });
  
  try {
    const res = await db.select().from(schema.users).limit(1);
    console.log(res);
  } catch (err) {
    console.error("RAW ERROR OBJECT:", err);
  }
  await pool.end();
}

main();

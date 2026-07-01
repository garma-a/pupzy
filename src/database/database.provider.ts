import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DATABASE_TOKEN = 'DATABASE';

export const databaseProvider = {
  provide: DATABASE_TOKEN,
  useFactory: (databaseUrl: string) => {
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
    });
    return drizzle(pool, { schema });
  },
  inject: ['DATABASE_URL'],
};

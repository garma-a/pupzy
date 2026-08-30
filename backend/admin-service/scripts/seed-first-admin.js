import 'dotenv/config';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Pool } = pg;

export async function seedFirstAdmin(options = {}) {
  const logger = options.logger ?? console;
  const email = (options.email ?? process.env.ADMIN_SEED_EMAIL)?.trim().toLowerCase();
  const password = options.password ?? process.env.ADMIN_SEED_PASSWORD;
  const fullName = (options.fullName ?? process.env.ADMIN_SEED_FULL_NAME)?.trim();
  const databaseUrl = options.databaseUrl ?? (options.pool ? undefined : process.env.DATABASE_URL);

  if (!options.pool && !databaseUrl) {
    throw new Error('DATABASE_URL, ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD, and ADMIN_SEED_FULL_NAME are required.');
  }
  if (!email || !password || !fullName) {
    throw new Error('DATABASE_URL, ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD, and ADMIN_SEED_FULL_NAME are required.');
  }
  if (password.length < 12) {
    throw new Error('ADMIN_SEED_PASSWORD must be at least 12 characters.');
  }

  const shouldClosePool = !options.pool;
  const pool = options.pool ?? new Pool({ connectionString: databaseUrl, max: 1 });

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO admin_users (email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, 'SUPER_ADMIN', true)
       ON CONFLICT DO NOTHING
       RETURNING id, email, role, is_active`,
      [email, passwordHash, fullName],
    );

    if (result.rows.length > 0) {
      logger.log('First SUPER_ADMIN created. Remove the seed environment variables now.');
      return {
        created: true,
        admin: result.rows[0],
      };
    }

    logger.log(`Administrator account already exists for "${email}". Skipping bootstrap without modification.`);
    return {
      created: false,
      email,
    };
  } finally {
    if (shouldClosePool) {
      await pool.end();
    }
  }
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) || process.argv[1].endsWith('seed-first-admin.js'));

if (isDirectRun) {
  seedFirstAdmin()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(`Admin bootstrap error: ${err.message}`);
      process.exit(1);
    });
}

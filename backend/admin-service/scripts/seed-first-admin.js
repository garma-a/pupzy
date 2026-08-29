import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Pool } = pg;
const email = process.env.ADMIN_SEED_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_SEED_PASSWORD;
const fullName = process.env.ADMIN_SEED_FULL_NAME?.trim();
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || !email || !password || !fullName) {
  throw new Error('DATABASE_URL, ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD, and ADMIN_SEED_FULL_NAME are required.');
}
if (password.length < 12) throw new Error('ADMIN_SEED_PASSWORD must be at least 12 characters.');

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO admin_users (email, password_hash, full_name, role)
     VALUES ($1, $2, $3, 'SUPER_ADMIN')`,
    [email, passwordHash, fullName],
  );
  console.log('First SUPER_ADMIN created. Remove the seed environment variables now.');
} finally {
  await pool.end();
}

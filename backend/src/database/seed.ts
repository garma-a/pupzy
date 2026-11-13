import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as bcrypt from 'bcryptjs';
import * as schema from './schema';
import { seedOfficialCities } from '../cities/seed';

import * as dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool, { schema });

export interface SeedOptions {
  admin?: {
    email?: string;
    password?: string;
    fullName?: string;
  };
}

export interface SeededAdminResult {
  id?: string;
  email?: string;
  created: boolean;
}

export async function seedInitialAdmin(
  database = db,
  options: SeedOptions['admin'] = {},
): Promise<SeededAdminResult | null> {
  const email = (options?.email ?? process.env.ADMIN_SEED_EMAIL)?.trim().toLowerCase();
  const password = options?.password ?? process.env.ADMIN_SEED_PASSWORD;
  const fullName = (options?.fullName ?? process.env.ADMIN_SEED_FULL_NAME)?.trim() ?? 'Pupzy Administrator';

  if (!email || !password) {
    return null;
  }

  if (password.length < 12) {
    throw new Error('ADMIN_SEED_PASSWORD must be at least 12 characters.');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const inserted = await database
    .insert(schema.adminUsers)
    .values({
      email,
      passwordHash,
      fullName,
      role: 'SUPER_ADMIN',
      isActive: true,
    })
    .onConflictDoNothing()
    .returning({ id: schema.adminUsers.id, email: schema.adminUsers.email });

  if (inserted.length > 0) {
    const admin = inserted[0];
    console.log(`✓ Seeded initial SUPER_ADMIN (${admin.email}).`);
    return { id: admin.id, email: admin.email, created: true };
  }

  console.log(`ℹ Initial admin bootstrap skipped: administrator already exists (${email}).`);
  return { email, created: false };
}

export async function runDatabaseSeed(database = db, options: SeedOptions = {}) {
  console.log('Seeding official Egyptian city catalog...');
  const result = await seedOfficialCities(database);
  console.log(`✓ Seeded ${result.totalSeeded} official cities across ${result.governorateCount} governorates.`);

  console.log('Vet clinics are provided by the reviewed release migration; nothing to seed here.');

  // ─── Initial Admin Account Seeding ─────────────────────────────────────────
  await seedInitialAdmin(database, options.admin);

  console.log('✅ Seeding complete.');
}

if (require.main === module) {
  runDatabaseSeed()
    .then(async () => {
      await pool.end();
    })
    .catch(async (err) => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}

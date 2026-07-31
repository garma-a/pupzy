/**
 * seed-vet-clinics.ts
 *
 * Reads scripts/output/vet_clinics_raw.json (produced by collect-vet-clinics.ts)
 * and inserts all entries into the vet_clinics table.
 *
 * For each clinic:
 *  1. Resolves city_id via PostGIS KNN on cities.center_point (nearest city)
 *  2. Derives area_name from city_hint in the raw JSON
 *  3. Upserts on osm_id — safe to re-run without duplicates
 *
 * Run:
 *   DATABASE_URL=postgresql://... npx ts-node scripts/seed-vet-clinics.ts
 *
 * Or pipe through your existing db:seed npm script if you have one.
 */

import * as fs from 'fs';
import * as path from 'path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { vetClinics, type NewVetClinic } from '../src/schema/vet-clinics';
import type { VetClinicRaw } from './collect-vet-clinics';

// ─── Config ───────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('✗ DATABASE_URL environment variable is not set.');
  process.exit(1);
}

const INPUT_PATH = path.join(__dirname, 'output', 'vet_clinics_raw.json');
const BATCH_SIZE = 50; // rows per INSERT batch

// ─── DB setup ─────────────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool);

// ─── City Resolution ──────────────────────────────────────────────────────────
/**
 * For a given (lat, lon), find the nearest city in your cities table using
 * the PostGIS <-> KNN operator. This is O(log n) with the GIST index.
 *
 * Returns null if the cities table is empty or the query fails.
 */
async function resolveNearestCityId(latitude: number, longitude: number): Promise<string | null> {
  const result = await db.execute<{ id: string }>(sql`
    SELECT id
    FROM cities
    ORDER BY center_point <-> ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
    LIMIT 1
  `);

  return (result.rows[0]?.id as string) ?? null;
}

// ─── Batch Insert ─────────────────────────────────────────────────────────────

async function insertBatch(rows: NewVetClinic[]): Promise<number> {
  if (rows.length === 0) return 0;

  // ON CONFLICT (osm_id) DO NOTHING — idempotent re-seeding
  // osm_id is nullable (MANUAL entries), so only OSM rows have the dedup guard.
  const result = await db
    .insert(vetClinics)
    .values(rows)
    .onConflictDoNothing({ target: vetClinics.osm_id })
    .returning({ id: vetClinics.id });

  return result.length;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Pubzy — Vet Clinics Seeder');
  console.log(`Reading: ${INPUT_PATH}\n`);

  if (!fs.existsSync(INPUT_PATH)) {
    console.error('✗ Raw data file not found.');
    console.error('  Run collect-vet-clinics.ts first to generate it.');
    process.exit(1);
  }

  const raw: VetClinicRaw[] = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'));

  console.log(`Loaded ${raw.length} raw clinic entries.`);

  // Check if cities table has data — city_id resolution will silently return
  // null on every row if the cities table hasn't been seeded yet.
  const cityCount = await db.execute<{ count: string }>(sql`SELECT COUNT(*)::text AS count FROM cities`);
  const totalCities = parseInt(cityCount.rows[0]?.count ?? '0', 10);
  console.log(`Cities table has ${totalCities} rows.\n`);

  if (totalCities === 0) {
    console.warn(
      '⚠ Cities table is empty. All clinic city_id values will be NULL.\n' +
        '  Seed your cities table first, then re-run this script for full resolution.\n',
    );
  }

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  // ── City-resolution cache — avoids redundant KNN queries ─────────────────
  // Key: "lat_3dp:lon_3dp" (3 decimal places ≈ 111m grid, good enough for
  // city matching). Clinics in the same neighbourhood will share cache hits.
  const cityCache = new Map<string, string | null>();

  async function getCachedCityId(lat: number, lon: number): Promise<string | null> {
    const key = `${lat.toFixed(3)}:${lon.toFixed(3)}`;
    if (cityCache.has(key)) return cityCache.get(key)!;
    const id = await resolveNearestCityId(lat, lon);
    cityCache.set(key, id);
    return id;
  }

  // ── Process in batches ────────────────────────────────────────────────────
  for (let i = 0; i < raw.length; i += BATCH_SIZE) {
    const chunk = raw.slice(i, i + BATCH_SIZE);
    const batch: NewVetClinic[] = [];

    for (const clinic of chunk) {
      try {
        const cityId = await getCachedCityId(clinic.latitude, clinic.longitude);

        batch.push({
          name_english: clinic.name_english,
          name_arabic: clinic.name_arabic,
          city_id: cityId,
          // Prefer OSM city_hint as area_name; fall back to governorate_hint
          area_name: clinic.city_hint ?? clinic.governorate_hint ?? null,
          // Drizzle's customType toDriver handles the ST_MakePoint wrapping
          coordinates: {
            longitude: clinic.longitude,
            latitude: clinic.latitude,
          },
          phone_number: clinic.phone_number,
          address: clinic.address,
          website: clinic.website,
          source: 'OSM',
          osm_id: BigInt(clinic.osm_id),
          is_active: true,
        });
      } catch (err) {
        console.error(`  ✗ Error preparing clinic osm_id=${clinic.osm_id}: ${(err as Error).message}`);
        errors++;
      }
    }

    try {
      const count = await insertBatch(batch);
      inserted += count;
      skipped += batch.length - count;
    } catch (err) {
      console.error(`  ✗ Batch insert failed (rows ${i}–${i + chunk.length}): ${(err as Error).message}`);
      errors += batch.length;
    }

    const pct = Math.round(((i + chunk.length) / raw.length) * 100);
    process.stdout.write(`\r  Progress: ${pct}% (${i + chunk.length}/${raw.length})`);
  }

  console.log('\n');
  console.log('─── Seed Summary ───────────────────────────────');
  console.log(`  Inserted:  ${inserted}`);
  console.log(`  Skipped (already exist): ${skipped}`);
  console.log(`  Errors:    ${errors}`);
  console.log(`  City cache hits: ${cityCache.size} unique grid cells resolved`);
  console.log('────────────────────────────────────────────────\n');

  if (inserted > 0) {
    console.log('✓ Seeding complete.');
  } else {
    console.log('ℹ No new rows inserted — the table may already be fully seeded.');
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error('\nFatal error:', err);
  await pool.end();
  process.exit(1);
});

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from './schema';
import { seedOfficialCities } from '../cities/seed';
import * as fs from 'fs';
import * as path from 'path';

import * as dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool, { schema });

export async function runDatabaseSeed(database = db) {
  console.log('Seeding official Egyptian city catalog...');
  const result = await seedOfficialCities(database);
  console.log(`✓ Seeded ${result.totalSeeded} official cities across ${result.governorateCount} governorates.`);

  // ─── Vet Clinics Seeding ───────────────────────────────────────────────────
  console.log('Seeding vet clinics (Egypt)...');

  const rawPath = path.join(__dirname, 'data/vet_clinics_raw.json');

  if (!fs.existsSync(rawPath)) {
    console.log('Fetching vet clinics from Overpass API (Egypt)...');
    const endpoints = [
      'https://lz4.overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://overpass-api.de/api/interpreter',
    ];
    let fetchedData: { elements: Array<Record<string, any>> } | null = null;
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, {
          method: 'POST',
          headers: {
            'User-Agent': 'PupzyVetCollector/1.0 (https://pupzy.app)',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body:
            'data=' +
            encodeURIComponent(
              `[out:json][timeout:60];area["ISO3166-1"="EG"]->.searchArea;(node["amenity"="veterinary"](area.searchArea);way["amenity"="veterinary"](area.searchArea);relation["amenity"="veterinary"](area.searchArea););out center body;`,
            ),
        });
        const text = await res.text();
        if (text.startsWith('{')) {
          fetchedData = JSON.parse(text);
          console.log(`✓ Fetched from ${ep}`);
          break;
        }
      } catch {
        // try next endpoint
      }
    }

    if (fetchedData) {
      const clinics = [];
      for (const el of fetchedData.elements) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        const tags = el.tags ?? {};
        const name = tags.name ?? tags['name:en'] ?? tags['name:ar'];
        if (!lat || !lon || !name) continue;
        clinics.push({
          osm_id: el.id,
          osm_type: el.type,
          name_english: tags['name:en'] ?? (/[\u0600-\u06FF]/.test(name) ? null : name),
          name_arabic: tags['name:ar'] ?? (/[\u0600-\u06FF]/.test(name) ? name : null),
          latitude: lat,
          longitude: lon,
          phone_number: tags.phone ?? tags['contact:phone'] ?? null,
          address: tags['addr:full'] ?? tags['addr:street'] ?? null,
          governorate_hint: tags['addr:governorate'] ?? null,
          city_hint: tags['addr:city'] ?? tags['addr:district'] ?? null,
          website: tags.website ?? tags['contact:website'] ?? null,
        });
      }
      fs.mkdirSync(path.dirname(rawPath), { recursive: true });
      fs.writeFileSync(rawPath, JSON.stringify(clinics, null, 2), 'utf-8');
    }
  }

  if (fs.existsSync(rawPath)) {
    const raw = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
    console.log(`Loaded ${raw.length} raw vet clinic entries.`);

    const cityCache = new Map<string, string | null>();
    const batch: schema.NewVetClinic[] = [];

    for (const clinic of raw) {
      const key = `${clinic.latitude.toFixed(3)}:${clinic.longitude.toFixed(3)}`;
      let cityId = cityCache.get(key);
      if (cityId === undefined) {
        const res = await database.execute<{ id: string }>(sql`
          SELECT id FROM cities
          WHERE status = 'OFFICIAL'
          ORDER BY center_point <-> ST_SetSRID(ST_MakePoint(${clinic.longitude}, ${clinic.latitude}), 4326)
          LIMIT 1
        `);
        cityId = res.rows[0]?.id ?? null;
        cityCache.set(key, cityId);
      }

      batch.push({
        nameEnglish: clinic.name_english,
        nameArabic: clinic.name_arabic,
        cityId,
        areaName: clinic.city_hint ?? clinic.governorate_hint ?? null,
        coordinates: {
          longitude: clinic.longitude,
          latitude: clinic.latitude,
        },
        phoneNumber: clinic.phone_number,
        address: clinic.address,
        website: clinic.website,
        source: 'OSM',
        osmId: BigInt(clinic.osm_id),
        isActive: true,
      });
    }

    if (batch.length > 0) {
      const count = await database
        .insert(schema.vetClinics)
        .values(batch)
        .onConflictDoNothing({
          target: schema.vetClinics.osmId,
          where: sql`osm_id IS NOT NULL`,
        })
        .returning({ id: schema.vetClinics.id });
      console.log(`Seeded ${count.length} vet clinics into vet_clinics table.`);
    }
  }

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

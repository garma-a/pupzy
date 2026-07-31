/**
 * collect-vet-clinics.ts
 *
 * Fetches ALL veterinary clinics in Egypt from OpenStreetMap via the Overpass API.
 * Free, no API key required. Covers ~300–500 entries across all governorates.
 *
 * Output: scripts/output/vet_clinics_raw.json
 *
 * Run:
 *   npx ts-node scripts/collect-vet-clinics.ts
 *
 * Then feed the output into seed-vet-clinics.ts to populate the DB.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Egypt Bounding Box ──────────────────────────────────────────────────────
// lat_min, lon_min, lat_max, lon_max
// Slightly generous bbox to catch border-area clinics
const EGYPT_BBOX = '22.0,24.7,31.8,37.0';

// Overpass QL query — fetches nodes, ways (buildings), and relations
// "out center" gives centroid for non-node elements
const OVERPASS_QUERY = `
[out:json][timeout:120];
(
  node["amenity"="veterinary"](${EGYPT_BBOX});
  way["amenity"="veterinary"](${EGYPT_BBOX});
  relation["amenity"="veterinary"](${EGYPT_BBOX});
);
out center body;
`.trim();

// Mirrors — tried in order, first success wins
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// ─── OSM Types ───────────────────────────────────────────────────────────────

interface OsmTags {
  name?: string;
  'name:ar'?: string;
  'name:en'?: string;
  phone?: string;
  'contact:phone'?: string;
  'addr:street'?: string;
  'addr:housenumber'?: string;
  'addr:city'?: string;
  'addr:district'?: string;
  'addr:governorate'?: string;
  'addr:full'?: string;
  website?: string;
  'contact:website'?: string;
  opening_hours?: string;
  [key: string]: string | undefined;
}

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: OsmTags;
}

interface OsmApiResponse {
  version: number;
  elements: OsmElement[];
}

// ─── Output Shape ─────────────────────────────────────────────────────────────
// This is the raw shape stored in vet_clinics_raw.json.
// The seed script will enrich it with city_id from your cities table.

export interface VetClinicRaw {
  osm_id: number;
  osm_type: 'node' | 'way' | 'relation';
  name_english: string | null;
  name_arabic: string | null;
  latitude: number;
  longitude: number;
  phone_number: string | null;
  address: string | null;
  /** Hint used by the seed script for city_id lookup — not stored in DB */
  governorate_hint: string | null;
  /** Hint used by the seed script for area_name — not stored in DB */
  city_hint: string | null;
  website: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildAddress(tags: OsmTags): string | null {
  if (tags['addr:full']) return tags['addr:full'];

  const parts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:district'],
    tags['addr:city'],
    tags['addr:governorate'],
  ].filter((p): p is string => Boolean(p));

  return parts.length > 0 ? parts.join(', ') : null;
}

function normalizePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  // Handle semicolons (multiple numbers) — take the first
  const first = raw.split(';')[0].trim();
  // Normalize Egyptian numbers: 002 -> +2, 0020 -> +20
  return first
    .replace(/^002(?!0)/, '+2')
    .replace(/^0020/, '+20')
    .replace(/[\s\-()]/g, '');
}

function isArabic(str: string): boolean {
  return /[\u0600-\u06FF]/.test(str);
}

function isLatin(str: string): boolean {
  return /^[a-zA-Z\s\-'.&]/.test(str);
}

function extractClinic(el: OsmElement): VetClinicRaw | null {
  const tags = el.tags ?? {};

  // ── Coordinates ──────────────────────────────────────────────────────────
  let lat: number | undefined;
  let lon: number | undefined;

  if (el.type === 'node') {
    lat = el.lat;
    lon = el.lon;
  } else {
    // way or relation: Overpass "out center" gives the centroid
    lat = el.center?.lat;
    lon = el.center?.lon;
  }

  if (lat === undefined || lon === undefined) return null;

  // ── Name Extraction ───────────────────────────────────────────────────────
  // Priority: explicit lang tags > script-detect from name > null
  const nameEn: string | null =
    tags['name:en'] ??
    (tags.name && isLatin(tags.name) ? tags.name : null);

  const nameAr: string | null =
    tags['name:ar'] ??
    (tags.name && isArabic(tags.name) ? tags.name : null);

  // Skip completely unnamed entries — they're noise
  if (!nameEn && !nameAr && !tags.name) return null;

  // If we have a generic `name` but couldn't classify it, put it in name_english
  const fallbackName = tags.name ?? null;

  return {
    osm_id: el.id,
    osm_type: el.type,
    name_english: nameEn ?? (nameAr ? null : fallbackName),
    name_arabic: nameAr,
    latitude: lat,
    longitude: lon,
    phone_number: normalizePhone(tags.phone ?? tags['contact:phone']),
    address: buildAddress(tags),
    governorate_hint: tags['addr:governorate'] ?? null,
    city_hint: tags['addr:city'] ?? tags['addr:district'] ?? null,
    website: tags.website ?? tags['contact:website'] ?? null,
  };
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchOverpass(endpoint: string): Promise<OsmApiResponse> {
  console.log(`  Trying ${endpoint}...`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(OVERPASS_QUERY)}`,
    signal: AbortSignal.timeout(130_000), // 130s — slightly above Overpass timeout
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<OsmApiResponse>;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Pubzy — Vet Clinics Data Collector');
  console.log('Source: OpenStreetMap via Overpass API');
  console.log('Region: Egypt (bbox)\n');

  let rawData: OsmApiResponse | null = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      rawData = await fetchOverpass(endpoint);
      console.log(`✓ Success from ${endpoint}`);
      break;
    } catch (err) {
      console.warn(`  ✗ Failed: ${(err as Error).message}`);
    }
  }

  if (!rawData) {
    console.error('\n✗ All Overpass endpoints failed.');
    console.error('  Check your internet connection and try again.');
    process.exit(1);
  }

  const totalElements = rawData.elements.length;
  console.log(`\nTotal OSM elements: ${totalElements}`);

  const clinics: VetClinicRaw[] = [];
  const stats = { noCoords: 0, noName: 0, ok: 0 };

  for (const el of rawData.elements) {
    const clinic = extractClinic(el);
    if (!clinic) {
      const hasCoords = el.lat !== undefined || el.center !== undefined;
      if (!hasCoords) stats.noCoords++;
      else stats.noName++;
      continue;
    }
    clinics.push(clinic);
    stats.ok++;
  }

  console.log(`\nExtracted:  ${stats.ok} clinics`);
  console.log(`Skipped (no coordinates): ${stats.noCoords}`);
  console.log(`Skipped (no name):        ${stats.noName}`);

  // ── Coverage summary by governorate hint ─────────────────────────────────
  const govCounts: Record<string, number> = {};
  for (const c of clinics) {
    const gov = c.governorate_hint ?? 'Unknown';
    govCounts[gov] = (govCounts[gov] ?? 0) + 1;
  }
  console.log('\nCoverage by governorate hint:');
  Object.entries(govCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([gov, count]) => console.log(`  ${gov}: ${count}`));

  // ── Write output ──────────────────────────────────────────────────────────
  const outputDir = path.join(__dirname, 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, 'vet_clinics_raw.json');
  fs.writeFileSync(outputPath, JSON.stringify(clinics, null, 2), 'utf-8');

  console.log(`\n✓ Saved ${clinics.length} clinics → ${outputPath}`);
  console.log('\nSample (first 3 entries):');
  console.log(JSON.stringify(clinics.slice(0, 3), null, 2));
  console.log('\nNext step: run seed-vet-clinics.ts to populate the DB.');
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});

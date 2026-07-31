/**
 * schema/vet-clinics.ts
 *
 * Drizzle ORM schema for the vet_clinics table.
 *
 * Design notes:
 * - coordinates uses the same geometry(Point, 4326) type as posts.coordinates
 * - osm_id is stored for idempotent re-seeding (skip if already exists)
 * - city_id is a soft FK — resolved during seeding via KNN on cities.center_point
 * - name_english / name_arabic follow Pubzy no-abbreviations convention
 * - The GIST index on coordinates powers ST_DWithin and the <-> KNN operator
 *   used in findNearest queries (no seq scan even across 1000+ clinics)
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  bigint,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── Reuse the same geometry custom type from your posts schema ───────────────
// If you already export `geometryPoint` from schema/posts.ts, import it from
// there instead of redefining it here.
const geometryPoint = customType<{
  data: { longitude: number; latitude: number };
  driverData: string; // WKB hex string from PostGIS
}>({
  dataType() {
    return 'geometry(Point, 4326)';
  },
  toDriver(value) {
    // PostGIS expects ST_SetSRID(ST_MakePoint(lon, lat), 4326)
    return sql`ST_SetSRID(ST_MakePoint(${value.longitude}, ${value.latitude}), 4326)`;
  },
  fromDriver(value) {
    // WKB comes back as a hex string — we parse it in the service layer.
    // Returning raw here; ST_X / ST_Y are used in raw SQL reads (see service).
    return value as unknown as { longitude: number; latitude: number };
  },
});

// ─── Source Enum ──────────────────────────────────────────────────────────────

export const vetClinicSourceEnum = pgEnum('vet_clinic_source', [
  'OSM',           // OpenStreetMap Overpass API (primary seed source)
  'GOOGLE_PLACES', // Google Places API (optional enrichment pass)
  'MANUAL',        // Hand-curated entry via AdminJS
]);

// ─── Table ────────────────────────────────────────────────────────────────────

export const vetClinics = pgTable(
  'vet_clinics',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // ── Names ──────────────────────────────────────────────────────────────
    // At least one of these will be non-null for every row.
    // Flutter shows name_arabic first for Arabic-locale users.
    name_english: varchar('name_english', { length: 200 }),
    name_arabic: varchar('name_arabic', { length: 200 }),

    // ── Location ───────────────────────────────────────────────────────────
    // city_id resolved during seeding via KNN against cities.center_point.
    // Nullable because some OSM entries fall outside your seeded cities list.
    city_id: uuid('city_id'), // FK -> cities(id) — add FK in migration if needed

    // Human-readable district / neighbourhood (e.g. "Maadi", "Mohandessin")
    area_name: varchar('area_name', { length: 200 }),

    // PostGIS POINT(longitude, latitude) — same SRID as posts.coordinates
    // NEVER exposed as raw WKB to the client; service extracts lat/lng via SQL.
    coordinates: geometryPoint('coordinates').notNull(),

    // ── Contact ────────────────────────────────────────────────────────────
    phone_number: text('phone_number'),   // E.164 preferred: +201XXXXXXXXX
    address: text('address'),             // Full human-readable address
    website: text('website'),

    // ── Metadata ───────────────────────────────────────────────────────────
    source: vetClinicSourceEnum('source').notNull().default('OSM'),

    // OSM node/way/relation ID — used as dedup key during re-seeding.
    // NULL for GOOGLE_PLACES and MANUAL entries.
    osm_id: bigint('osm_id', { mode: 'bigint' }),

    // Soft-delete flag. Use AdminJS to mark a closed clinic inactive
    // rather than deleting it (keeps historical data intact).
    is_active: boolean('is_active').notNull().default(true),

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // ── Primary spatial index ─────────────────────────────────────────────
    // Powers the <-> KNN operator in findNearest — index-only scan, O(log n).
    coordinatesGistIndex: index('idx_vet_clinics_coordinates').using(
      'gist',
      table.coordinates,
    ),

    // ── OSM dedup index ───────────────────────────────────────────────────
    // Allows the seed script to do INSERT ... ON CONFLICT (osm_id) DO NOTHING.
    osmIdUniqueIndex: uniqueIndex('idx_vet_clinics_osm_id').on(table.osm_id),

    // ── Active city filter ────────────────────────────────────────────────
    // Powers queries like "all active clinics in city X" for admin dashboards.
    activeCityIndex: index('idx_vet_clinics_active_city').on(
      table.is_active,
      table.city_id,
    ),
  }),
);

// ─── Types ────────────────────────────────────────────────────────────────────

export type VetClinicRow = typeof vetClinics.$inferSelect;
export type NewVetClinic = typeof vetClinics.$inferInsert;

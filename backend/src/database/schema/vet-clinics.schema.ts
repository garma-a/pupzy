/**
 * vet-clinics.schema.ts
 *
 * Drizzle ORM schema for the `vet_clinics` table.
 *
 * ## Design decisions
 *
 * **UUIDv7 primary key** — monotonically increasing (time-sortable), consistent
 * with every other Pubzy table (posts, cities, users, etc.).
 *
 * **customType for PostGIS geometry** — uses `customType` with `toDriver` generating
 * `ST_SetSRID(ST_MakePoint(lon, lat), 4326)` so Drizzle ORM writes valid PostGIS
 * EWKB points into PostgreSQL without driver parsing errors.
 *
 * **Soft FK on city_id** — no `.references()` call intentionally.
 * The seeder may run before the cities table is fully stable, and some OSM
 * clinics fall outside the seeded city boundaries. The migration SQL declares
 * `REFERENCES cities(id) ON DELETE SET NULL` to preserve clinic rows if a city
 * is ever removed.
 *
 * **Partial unique index on osmId** — uses `.where(isNotNull(table.osmId))`.
 * Enforces uniqueness for non-null OSM IDs while allowing multiple MANUAL rows.
 *
 * **is_active soft-delete** — closed clinics are never hard-deleted.
 * AdminJS sets is_active = false. The `findNearest` query always filters
 * WHERE is_active = true.
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
import { sql, isNotNull } from 'drizzle-orm';

// ─── PostGIS Geometry Custom Type ─────────────────────────────────────────────

export const geometryPoint = customType<{
  data: { longitude: number; latitude: number };
  driverData: string;
}>({
  dataType() {
    return 'geometry(Point, 4326)';
  },
  toDriver(value) {
    return sql`ST_GeomFromEWKT(${`SRID=4326;POINT(${value.longitude} ${value.latitude})`})`;
  },
  fromDriver(value) {
    return value as unknown as { longitude: number; latitude: number };
  },
});

// ─── Source Enum ──────────────────────────────────────────────────────────────

export const vetClinicSourceEnum = pgEnum('vet_clinic_source', [
  'OSM',           // OpenStreetMap Overpass API — primary seed source
  'GOOGLE_PLACES', // Google Places API — optional enrichment pass
  'MANUAL',        // Hand-curated entry via AdminJS
]);

// ─── Table ────────────────────────────────────────────────────────────────────

export const vetClinics = pgTable(
  'vet_clinics',
  {
    /** Primary key — UUIDv7. */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    // ── Names ────────────────────────────────────────────────────────────────
    nameEnglish: varchar('name_english', { length: 200 }),
    nameArabic: varchar('name_arabic', { length: 200 }),

    // ── Location ─────────────────────────────────────────────────────────────
    cityId: uuid('city_id'),
    areaName: varchar('area_name', { length: 200 }),

    /** PostGIS POINT(longitude, latitude), SRID=4326. */
    coordinates: geometryPoint('coordinates').notNull(),

    // ── Contact ──────────────────────────────────────────────────────────────
    phoneNumber: text('phone_number'),
    address: text('address'),
    website: text('website'),

    // ── Metadata ─────────────────────────────────────────────────────────────
    source: vetClinicSourceEnum('source').notNull().default('OSM'),
    osmId: bigint('osm_id', { mode: 'bigint' }),
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    coordinatesGistIdx: index('idx_vet_clinics_coordinates')
      .using('gist', table.coordinates),

    osmIdUniqueIdx: uniqueIndex('idx_vet_clinics_osm_id')
      .on(table.osmId)
      .where(isNotNull(table.osmId)),

    activeCityIdx: index('idx_vet_clinics_active_city')
      .on(table.isActive, table.cityId),
  }),
);

// ─── TypeScript types ─────────────────────────────────────────────────────────

export type VetClinicRow = typeof vetClinics.$inferSelect;
export type NewVetClinic = typeof vetClinics.$inferInsert;

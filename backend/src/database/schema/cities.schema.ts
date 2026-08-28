import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, timestamp, geometry, uniqueIndex, index, integer, check } from 'drizzle-orm/pg-core';
import { cityLifecycleStatusEnum } from './enums';

/**
 * `cities` table — authoritative reference catalog for Egyptian ADM2 areas (cities/districts).
 *
 * ## Usage
 * - City picker on onboarding — `findAll()` returns official cities sorted A-Z
 * - Nearest-city resolution — `center_point` GIST index powers ST_Distance queries
 * - Feed scoping — `city_id` FK on posts scopes feed results to a city
 *
 * ## Lifecycle semantics
 * - `OFFICIAL`: Authoritative selectable cities in active local catalog (351 ADM2 areas).
 * - `LEGACY`: Historical cities retained for backward-compatible references.
 * - `RETIRED`: Former official cities removed or superseded in upstream releases.
 *
 * ## Indexes
 * - `unique_city_name_english_per_governorate` — ensures unique English display name within each governorate
 * - `unique_city_source_code` — ensures unique internal upstream source identity (OCHA P-code)
 * - `idx_cities_governorate` — filters/groups by governorate
 * - `idx_cities_status` — filters by lifecycle state (e.g. active official cities)
 * - `idx_cities_center_point` — GIST spatial index for distance-based discovery
 *
 * ## Coordinates
 * - `center_point`: PostGIS POINT(longitude latitude) with SRID 4326.
 *   Represents an approximate WGS84 representative point (centroid / locality center)
 *   used for distance calculations and discovery, not administrative boundary polygon membership.
 */
export const cities = pgTable(
  'cities',
  {
    /** Internal city ID. Primary key, UUIDv7. Preserved as application-facing identity. */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** English display name, e.g. 'Aswan (Kism)' or 'Cairo'. */
    nameEnglish: varchar('name_english', { length: 100 }).notNull(),

    /** Arabic display name, e.g. 'قسم أسوان' or 'القاهرة'. */
    nameArabic: varchar('name_arabic', { length: 100 }).notNull(),

    /** Governorate this city belongs to, e.g. 'Aswan' or 'Cairo'. */
    governorate: varchar('governorate', { length: 100 }).notNull(),

    /** Internal upstream source code (e.g. OCHA P-code 'EG2801'). Unique when set. */
    sourceCode: varchar('source_code', { length: 100 }),

    /** Untouched upstream English source name (e.g. 'Aswan'). */
    sourceNameEnglish: varchar('source_name_english', { length: 100 }),

    /** Untouched upstream Arabic source name (e.g. 'قسم أسوان'). */
    sourceNameArabic: varchar('source_name_arabic', { length: 100 }),

    /** Explicit lifecycle status: OFFICIAL, LEGACY, or RETIRED. */
    status: cityLifecycleStatusEnum('status').notNull().default('OFFICIAL'),

    /**
     * Approximate WGS84 representative point for distance-based discovery.
     * PostGIS POINT(longitude latitude). SRID=4326.
     */
    centerPoint: geometry('center_point', { type: 'point', srid: 4326 }).notNull(),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /**
     * Prevents duplicate city rows on repeated seed runs.
     */
    uniqueCityNameEnglishPerGovernorate: uniqueIndex('unique_city_name_english_per_governorate').on(
      table.nameEnglish,
      table.governorate,
    ),

    /** Internal source code unique index. */
    uniqueCitySourceCode: uniqueIndex('unique_city_source_code').on(table.sourceCode),

    /** Enables filtering and grouping by governorate. */
    governorateIdx: index('idx_cities_governorate').on(table.governorate),

    /** Enables fast filtering by lifecycle status (official only). */
    statusIdx: index('idx_cities_status').on(table.status),

    /** PostGIS GIST spatial index on representative point. */
    centerPointGistIdx: index('idx_cities_center_point').using('gist', table.centerPoint),
  }),
);

/**
 * Singleton revision shared by City release migrations and API instances.
 *
 * A successful City release increments this value in the same transaction as
 * its data changes. Each API instance compares it before serving process-local
 * cached lists or UUID lookups, so a deployment overlap cannot retain an old
 * cache generation after the database has advanced.
 */
export const cityCatalogRevisions = pgTable(
  'city_catalog_revisions',
  {
    id: integer('id').primaryKey().default(1),
    revision: integer('revision').notNull().default(1),
  },
  (table) => ({
    singletonId: check('city_catalog_revisions_singleton_id', sql`${table.id} = 1`),
  }),
);

/** TypeScript type for a full `cities` row. */
export type City = typeof cities.$inferSelect;

/** TypeScript type for inserting a new `cities` row. */
export type NewCity = typeof cities.$inferInsert;

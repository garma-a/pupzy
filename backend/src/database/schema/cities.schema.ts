import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, timestamp, geometry, uniqueIndex, index } from 'drizzle-orm/pg-core';

/**
 * `cities` table — seeded lookup table for Egyptian cities and districts.
 *
 * ## Usage
 * - City picker on onboarding — `findAll()` returns the full list sorted A-Z
 * - Nearest-city resolution — `center_point` GIST index powers ST_Distance queries
 * - Feed scoping — `city_id` FK on posts scopes feed results to a city
 *
 * ## Indexes
 * - `uq_cities_name_english_governorate` — prevents duplicate rows on repeated seed runs
 * - `idx_cities_governorate` — filters/groups by governorate
 * - `idx_cities_center_point` — GIST, added in custom migration SQL (Drizzle cannot express USING GIST)
 *
 * ## Caching
 * Redis-cached — city lookups never hit this table on the hot path.
 */
export const cities = pgTable(
  'cities',
  {
    /** Internal city ID. Primary key, UUIDv7. */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** English display name, e.g. 'Cairo'. */
    nameEnglish: varchar('name_english', { length: 100 }).notNull(),

    /** Arabic display name, e.g. 'القاهرة'. */
    nameArabic: varchar('name_arabic', { length: 100 }).notNull(),

    /** Governorate/Province this city belongs to, e.g. 'Cairo'. */
    governorate: varchar('governorate', { length: 100 }).notNull(),

    /**
     * Center coordinates of the city.
     * PostGIS POINT(longitude latitude). SRID=4326.
     * Powers the "nearest city to my GPS" suggestion during onboarding.
     * GIST index added in custom migration SQL — see drizzle/migrations/custom.sql.
     */
    centerPoint: geometry('center_point', { type: 'point', srid: 4326 }).notNull(),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /**
     * Prevents duplicate city rows on repeated seed runs.
     * gen_random_uuid() never collides on PK so without this a re-seed inserts duplicates.
     */
    uniqueNameEnglishGovernorate: uniqueIndex('uq_cities_name_english_governorate').on(
      table.nameEnglish,
      table.governorate,
    ),

    /** Enables filtering and grouping by governorate. */
    governorateIdx: index('idx_cities_governorate').on(table.governorate),

    // NOTE: GIST index on center_point cannot be expressed here.
    // See custom migration SQL: CREATE INDEX idx_cities_center_point ON cities USING GIST (center_point);
  }),
);

/** TypeScript type for a full `cities` row. */
export type City = typeof cities.$inferSelect;

/** TypeScript type for inserting a new `cities` row. */
export type NewCity = typeof cities.$inferInsert;

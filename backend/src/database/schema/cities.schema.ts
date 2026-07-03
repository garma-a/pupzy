import { pgTable, uuid, varchar, timestamp, geometry } from 'drizzle-orm/pg-core';

/**
 * `cities` table — lookup table for cities/governorates in Egypt.
 * Contains geospatial data for nearest-city resolution.
 */
export const cities = pgTable(
  'cities',
  {
    /** Internal City ID. Primary key, UUIDv4. */
    id: uuid('id').primaryKey().defaultRandom(),

    /** English name of the city. */
    nameEn: varchar('name_en', { length: 100 }).notNull(),

    /** Arabic name of the city. */
    nameAr: varchar('name_ar', { length: 100 }).notNull(),

    /** Governorate/Province name. */
    governorate: varchar('governorate', { length: 100 }).notNull(),
    
    /**
     * PostGIS Point representing the center of the city.
     * Used to resolve the nearest city based on user's GPS coordinates.
     */
    centerGeom: geometry('center_geom', { type: 'point', srid: 4326 }).notNull(),
    
    /**
     * Optional boundary polygon for precise border resolution (for v2).
     */
    boundaryGeom: geometry('boundary_geom', { type: 'polygon', srid: 4326 }),
    
    /** Timestamp of row creation. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }
);

/** TypeScript type for a full City row. */
export type City = typeof cities.$inferSelect;

/** TypeScript type for inserting a new City row. */
export type NewCity = typeof cities.$inferInsert;

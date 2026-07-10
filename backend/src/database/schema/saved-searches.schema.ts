import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, numeric, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { cities } from './cities.schema';
import { postTypeEnum, speciesTypeEnum, productCategoryEnum } from './enums';

/**
 * `saved_searches` — user alert system for new matching posts.
 *
 * ## Purpose
 * When a new ADOPTION or PRODUCT post is created, the service queries this
 * table for matching alerts and fires `SYSTEM_ANNOUNCEMENT` notifications
 * to those users.
 *
 * ## Scope
 * Only ADOPTION and PRODUCT are supported.
 * RESCUE and LOST are real-time emergencies that use push notifications directly
 * and are not suitable for alert-based discovery.
 *
 * ## Implementation status
 * Schema defined. Matching logic deferred to a future iteration.
 *
 * ## Match query pattern
 * The post-creation hook queries this table using idx_saved_searches_match
 * (post_type, city_id, species) to find all matching alert subscriptions
 * efficiently before firing notifications.
 *
 * ## City scoping
 * `city_id = NULL` means "watch all cities nationwide" — a broader alert.
 */
export const savedSearches = pgTable(
  'saved_searches',
  {
    /** Internal saved search ID. Primary key, UUIDv4. */
    id: uuid('id').primaryKey().default(sql`uuidv7()`),

    /** FK → users (owner of this alert). CASCADE on user delete. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * User-defined label for the alert, e.g. "Persian cat in Cairo".
     * Shown in the saved searches list in the app.
     */
    label: varchar('label', { length: 200 }),

    /**
     * Which section this alert watches.
     * Only ADOPTION and PRODUCT are valid — enforced in resolver.
     */
    postType: postTypeEnum('post_type').notNull(),

    /**
     * FK → cities. NULL means watch all cities.
     * SET NULL if the city row is ever deleted (won't happen in practice).
     */
    cityId: uuid('city_id').references(() => cities.id, { onDelete: 'set null' }),

    /** Species filter for adoption alerts. NULL means all species. */
    species: speciesTypeEnum('species'),

    /** Breed filter. NULL means all breeds. Partial text match in service layer. */
    breed: varchar('breed', { length: 100 }),

    /** Product category filter. NULL means all categories. PRODUCT alerts only. */
    marketCategory: productCategoryEnum('market_category'),

    /**
     * Maximum price filter. NULL means no ceiling. PRODUCT alerts only.
     * NUMERIC(10,2) for exact decimal comparison with product_posts.price_amount.
     */
    maxPrice: numeric('max_price', { precision: 10, scale: 2 }),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /** "My alerts" list — all saved searches for a given user. */
    userIdx: index('idx_saved_searches_user').on(table.userId),

    /**
     * Match index — used by the post-creation hook to find matching alerts.
     * Covers the most selective filter combination.
     */
    matchIdx: index('idx_saved_searches_match').on(
      table.postType,
      table.cityId,
      table.species,
    ),
  }),
);

/** TypeScript type for a full `saved_searches` row. */
export type SavedSearch = typeof savedSearches.$inferSelect;

/** TypeScript type for inserting a new `saved_searches` row. */
export type NewSavedSearch = typeof savedSearches.$inferInsert;

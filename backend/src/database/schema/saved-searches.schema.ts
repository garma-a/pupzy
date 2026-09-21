import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, numeric, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { cities } from './cities.schema';
import { postTypeEnum, speciesTypeEnum, productCategoryEnum } from './enums';

/**
 * `saved_searches` — retired saved-search storage, retained temporarily.
 *
 * ## Status (ticket 18)
 * The saved-search feature was never finished and is retired: no GraphQL type,
 * admin resource or runtime code reads or writes it. This table and export stay
 * only so old deployed code can finish accessing it during deployment overlap.
 * Account Deletion still removes retained rows, and ticket 19 owns the forward
 * migration that contracts (drops) this storage after old callers are retired.
 *
 * ## Historical purpose
 * When a new ADOPTION or PRODUCT post was created, the intended service would
 * query this table for matching alerts and fire `SYSTEM_ANNOUNCEMENT`
 * notifications. That matching logic never shipped.
 *
 * ## City scoping
 * `city_id = NULL` means "watch all cities nationwide" — a broader alert.
 */
export const savedSearches = pgTable(
  'saved_searches',
  {
    /** Internal saved search ID. Primary key, UUIDv7. */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

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
    matchIdx: index('idx_saved_searches_match').on(table.postType, table.cityId, table.species),
  }),
);

/** TypeScript type for a full `saved_searches` row. */
export type SavedSearch = typeof savedSearches.$inferSelect;

/** TypeScript type for inserting a new `saved_searches` row. */
export type NewSavedSearch = typeof savedSearches.$inferInsert;

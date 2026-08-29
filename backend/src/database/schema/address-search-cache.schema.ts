import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const addressSearchCache = pgTable(
  'address_search_cache',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    normalizedQuery: text('normalized_query').notNull().unique(),
    results: jsonb('results').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    normalizedQueryIdx: index('idx_address_search_cache_normalized_query').on(table.normalizedQuery),
    createdAtIdx: index('idx_address_search_cache_created_at').on(table.createdAt),
  }),
);

export type AddressSearchCacheRow = typeof addressSearchCache.$inferSelect;
export type NewAddressSearchCache = typeof addressSearchCache.$inferInsert;

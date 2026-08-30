import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const addressSearchCache = pgTable('address_search_cache', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  normalizedQuery: text('normalized_query').notNull().unique(),
  results: jsonb('results').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AddressSearchCacheRow = typeof addressSearchCache.$inferSelect;
export type NewAddressSearchCache = typeof addressSearchCache.$inferInsert;

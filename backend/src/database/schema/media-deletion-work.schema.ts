import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { mediaDeletionStatusEnum } from './enums';

/**
 * `media_deletion_work` table — transactional outbox for durable R2 deletion
 * and CDN purge of removed comment images.
 *
 * Retries idempotently until success or visible for operator intervention (status = 'FAILED').
 */
export const mediaDeletionWork = pgTable(
  'media_deletion_work',
  {
    /** Primary key (UUIDv7 for time-ordered insertion). */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** Immutable R2 object storage key to be deleted (e.g. `comments/{commentId}/{mediaId}.webp`). */
    storageKey: text('storage_key').notNull(),

    /** Public CDN URL to be purged from CDN cache. */
    cdnUrl: text('cdn_url').notNull(),

    /** Processing status ('PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'). */
    status: mediaDeletionStatusEnum('status').notNull().default('PENDING'),

    /** Count of deletion attempts so far. */
    attempts: integer('attempts').notNull().default(0),

    /** Error message from the last failed attempt (if any). */
    lastError: text('last_error'),

    /** Work item creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Work item last updated timestamp. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('idx_media_deletion_work_status').on(table.status),
  }),
);

export type MediaDeletionWork = typeof mediaDeletionWork.$inferSelect;
export type NewMediaDeletionWork = typeof mediaDeletionWork.$inferInsert;

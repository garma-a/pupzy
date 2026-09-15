import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { adminUsers } from './admin-users.schema';

/**
 * `blocked_media_hashes` table — stores SHA-256 digests of images confirmed
 * and permanently removed as inappropriate by administrators.
 *
 * Enforces exact duplicate blocking on future comment image uploads
 * with safe generic errors and zero leakage of original moderation context.
 */
export const blockedMediaHashes = pgTable(
  'blocked_media_hashes',
  {
    /** Primary key (UUIDv7 for time-ordered generation). */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** SHA-256 hex digest of the blocked image file. */
    sha256: text('sha256').notNull(),

    /** Administrative moderation reason/context for internal audit. */
    reason: text('reason'),

    /** Administrator who permanently removed and blocked the media. */
    blockedByAdminId: uuid('blocked_by_admin_id').references(() => adminUsers.id, { onDelete: 'set null' }),

    /** Timestamp when the hash was recorded. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sha256Idx: uniqueIndex('unique_blocked_media_hashes_sha256').on(table.sha256),
  }),
);

export type BlockedMediaHash = typeof blockedMediaHashes.$inferSelect;
export type NewBlockedMediaHash = typeof blockedMediaHashes.$inferInsert;

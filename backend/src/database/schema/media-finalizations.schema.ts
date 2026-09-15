import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { mediaFinalizationStatusEnum } from './enums';

/**
 * `media_finalizations` table — durable obligations for media copies that are
 * in flight or need compensation.
 *
 * ## Why this exists
 * Moving a staged upload to its permanent key happens outside database
 * transactions. A timestamp grace window cannot prove that a slow or crashed
 * copy has finished, and it cannot force account deletion to retry a failed
 * compensation. This table is the durable record that does both.
 *
 * ## Lifecycle
 * 1. `UploadService.finalizeMedia` inserts an `IN_FLIGHT` row in the same short
 *    transaction that authorizes the copy, then heartbeats `updatedAt` while
 *    the R2 operations run.
 * 2. On success for a live account the row is deleted.
 * 3. When the account became deletion-blocked during the copy, the row moves to
 *    `COMPENSATION_REQUIRED`; the permanent object is deleted and only then is
 *    the row removed. A failed compensation keeps the row with `last_error` so
 *    account deletion or the cron retries it.
 * 4. Account deletion refuses to sweep storage or report completion while a
 *    fresh `IN_FLIGHT` row exists, and resolves stale or compensation rows
 *    itself before sweeping.
 *
 * ## No foreign key to `users`
 * The obligation must survive the deletion of the user row, so `user_id` is a
 * plain indexed UUID without a foreign key.
 */
export const mediaFinalizations = pgTable(
  'media_finalizations',
  {
    /** Obligation ID (UUIDv7). */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** Owner of the staged upload. Retained until the obligation is resolved. */
    userId: uuid('user_id').notNull(),

    /** Media ID returned by the presigned upload flow. */
    mediaId: varchar('media_id', { length: 64 }).notNull(),

    /** Staging object key that was copied from. */
    stagingKey: text('staging_key').notNull(),

    /** Permanent object key that may have been created. */
    finalKey: text('final_key').notNull(),

    /** Current obligation state. */
    status: mediaFinalizationStatusEnum('status').notNull().default('IN_FLIGHT'),

    /** Last compensation or reconciliation error, for operator visibility. */
    lastError: text('last_error'),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Last heartbeat timestamp. A finalization renews this between R2 calls so
     * the row only appears stale once the process can no longer be copying.
     */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_media_finalizations_user_id').on(table.userId),
    statusUpdatedIdx: index('idx_media_finalizations_status_updated').on(table.status, table.updatedAt),
  }),
);

export type MediaFinalization = typeof mediaFinalizations.$inferSelect;
export type NewMediaFinalization = typeof mediaFinalizations.$inferInsert;

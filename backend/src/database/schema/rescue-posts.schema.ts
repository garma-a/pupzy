import { pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { posts } from './posts.schema';
import { speciesTypeEnum, reporterRoleEnum } from './enums';

/**
 * `rescue_posts` — CTI extension table for `post_type = 'RESCUE'`.
 *
 * ## CTI pattern
 * Shares the primary key with `posts`. Joined ONLY on the single-post
 * detail screen — never on feed or list queries.
 *
 * ## Urgency
 * The `urgency` field lives on the base `posts` table (required for RESCUE,
 * enforced by CHECK constraint `chk_posts_urgency_by_type`).
 *
 * ## Reporter role — coordination signal
 * `reporter_role` tells responders what kind of help is needed:
 * - REPORTING    → Animal spotted, reporter no longer on site — go find it
 * - ON_SITE      → Reporter with animal — send help to this location
 * - CAN_TRANSPORT → Reporter can move animal — provide a destination (vet/shelter)
 */
export const rescuePosts = pgTable('rescue_posts', {
  /**
   * Shared primary key with `posts.id`.
   * Using the same UUID ties this row 1:1 to its base post row.
   */
  postId: uuid('post_id')
    .primaryKey()
    .references(() => posts.id, { onDelete: 'cascade' }),

  /** Animal species. Used for filtering and display. */
  species: speciesTypeEnum('species').notNull(),

  /**
   * Free-text condition description, e.g. "Cat with a broken leg, bleeding from left ear."
   * Shown prominently on the detail screen so responders know what to expect.
   */
  conditionSummary: varchar('condition_summary', { length: 500 }).notNull(),

  /** Coordination signal — see table-level comment above. */
  reporterRole: reporterRoleEnum('reporter_role').notNull(),
});

/** TypeScript type for a full `rescue_posts` row. */
export type RescuePost = typeof rescuePosts.$inferSelect;

/** TypeScript type for inserting a new `rescue_posts` row. */
export type NewRescuePost = typeof rescuePosts.$inferInsert;

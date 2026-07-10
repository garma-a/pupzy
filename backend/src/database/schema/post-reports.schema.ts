import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { posts } from './posts.schema';
import { users } from './users.schema';
import { reportReasonEnum } from './enums';

/**
 * `post_reports` — content moderation reports submitted by users.
 *
 * ## Flow
 * 1. User taps "Report" on any post.
 * 2. A `post_reports` row is inserted.
 * 3. A DB trigger increments `posts.report_count` on insert.
 *    Trigger SQL: see drizzle/migrations/custom.sql.
 * 4. AdminJS moderation queue sorts posts by `report_count DESC`
 *    using `idx_posts_moderation` (partial index on FLAGGED posts).
 *
 * ## One report per user per post
 * The unique constraint `uq_post_report` prevents duplicate reports from
 * the same user on the same post.
 *
 * ## Admin action
 * When an admin reviews and removes a post via AdminJS, the `after` hook
 * creates a `POST_REMOVED_BY_ADMIN` notification for the creator.
 */
export const postReports = pgTable(
  'post_reports',
  {
    /** Internal report ID. Primary key, UUIDv4. */
    id: uuid('id').primaryKey().default(sql`uuidv7()`),

    /** FK → posts. CASCADE on post delete. */
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),

    /** FK → users (person who submitted the report). CASCADE on user delete. */
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Structured reason category. Helps admins triage reports faster. */
    reason: reportReasonEnum('reason').notNull(),

    /**
     * Optional free-text detail from the reporter.
     * Provides context beyond the reason category.
     */
    details: text('details'),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /**
     * One report per user per post.
     * Prevents users from inflating report counts on posts they dislike.
     */
    uniqueReport: uniqueIndex('uq_post_report').on(table.postId, table.reporterId),

    /** Lets the system fetch all reports for a given post (for admin review). */
    postIdx: index('idx_post_reports_post').on(table.postId),
  }),
);

/** TypeScript type for a full `post_reports` row. */
export type PostReport = typeof postReports.$inferSelect;

/** TypeScript type for inserting a new `post_reports` row. */
export type NewPostReport = typeof postReports.$inferInsert;

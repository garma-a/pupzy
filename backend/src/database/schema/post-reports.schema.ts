import { sql } from 'drizzle-orm';
import { pgTable, pgEnum, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { posts } from './posts.schema';
import { users } from './users.schema';
import { adminUsers } from './admin-users.schema';
import { reportReasonEnum } from './enums';

/**
 * Administrative review outcome for a Post Report. Mirrors the Pupzy Account
 * Report outcome vocabulary so administrators see one external meaning for
 * reports: `NO_ACTION` dismisses the complaint, `ACTION_TAKEN` records that an
 * existing Post moderation action resolved it. The append-only
 * `moderation_actions` table remains the authoritative audit trail.
 */
export const postReportReviewOutcomeEnum = pgEnum('post_report_review_outcome', ['NO_ACTION', 'ACTION_TAKEN']);

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
    /** Internal report ID. Primary key, UUIDv7. */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

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

    /**
     * Timestamp when an administrator reviewed the report. NULL while open.
     * Existing reports migrate as open and unreviewed.
     */
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    /** FK → admin_users. Reviewing administrator. SET NULL if the admin is removed. */
    reviewedByAdminId: uuid('reviewed_by_admin_id').references(() => adminUsers.id, { onDelete: 'set null' }),

    /** Explicit review outcome. NULL while open. */
    reviewOutcome: postReportReviewOutcomeEnum('review_outcome'),
  },
  (table) => ({
    /**
     * One report per user per post.
     * Prevents users from inflating report counts on posts they dislike.
     */
    uniquePostReportPerPostAndReporter: uniqueIndex('unique_post_report_per_post_and_reporter').on(
      table.postId,
      table.reporterId,
    ),

    /** Lets the system fetch all reports for a given post (for admin review). */
    postIdx: index('idx_post_reports_post').on(table.postId),

    /** Supports atomically closing every open report for a moderated Post. */
    postUnreviewedIdx: index('idx_post_reports_post_unreviewed')
      .on(table.postId)
      .where(sql`"reviewed_at" IS NULL`),

    /** Supports the shared moderation-report allowance's rolling reporter lookup. */
    reporterCreatedIdx: index('idx_post_reports_reporter_created').on(table.reporterId, table.createdAt),
  }),
);

export type PostReportReviewOutcome = (typeof postReportReviewOutcomeEnum.enumValues)[number];

/** TypeScript type for a full `post_reports` row. */
export type PostReport = typeof postReports.$inferSelect;

/** TypeScript type for inserting a new `post_reports` row. */
export type NewPostReport = typeof postReports.$inferInsert;

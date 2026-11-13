import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { comments } from './comments.schema';
import { users } from './users.schema';
import { adminUsers } from './admin-users.schema';
import { reportReasonEnum } from './enums';
import { postReportReviewOutcomeEnum } from './post-reports.schema';

/**
 * `comment_reports` — content moderation reports submitted by users on comments or replies.
 *
 * ## Uniqueness
 * Unique index on (commentId, reporterId) enforces at most one report per user per comment.
 *
 * ## Account qualification & moderation
 * Reports from users with completed profiles (full_name IS NOT NULL) created > 24 hours
 * ago count toward automatic hiding thresholds:
 * - 1 qualifying INAPPROPRIATE_CONTENT report hides comment images (status = 'IMAGE_HIDDEN').
 * - 3 qualifying reports of any reason hide the whole comment (status = 'HIDDEN').
 * Reports from newer or incomplete accounts enter the queue for admin review without
 * affecting hiding thresholds.
 */
export const commentReports = pgTable(
  'comment_reports',
  {
    /** Internal report ID. Primary key, UUIDv7. */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** FK → comments. CASCADE on comment delete. */
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),

    /** FK → users (person who submitted the report). CASCADE on user delete. */
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Structured reason category. */
    reason: reportReasonEnum('reason').notNull(),

    /** Optional free-text details from reporter. */
    details: text('details'),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Timestamp when report was reviewed during moderation/restoration. NULL if unreviewed. */
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    /**
     * FK → admin_users. Reviewing administrator, set by the admin service when it closes the
     * report. NULL while open and for reports closed before this column existed. SET NULL if the
     * admin is removed. The mobile API never reads or writes it.
     */
    reviewedByAdminId: uuid('reviewed_by_admin_id').references(() => adminUsers.id, { onDelete: 'set null' }),

    /** Review outcome (same enum as Post Reports). NULL while open and for older closed reports. */
    reviewOutcome: postReportReviewOutcomeEnum('review_outcome'),
  },
  (table) => ({
    uniqueCommentReportPerCommentAndReporter: uniqueIndex('unique_comment_report_per_comment_and_reporter').on(
      table.commentId,
      table.reporterId,
    ),
    commentIdx: index('idx_comment_reports_comment').on(table.commentId),
    reporterCreatedIdx: index('idx_comment_reports_reporter_created').on(table.reporterId, table.createdAt),
    commentUnreviewedIdx: index('idx_comment_reports_comment_unreviewed')
      .on(table.commentId)
      .where(sql`"reviewed_at" IS NULL`),
  }),
);

export type CommentReport = typeof commentReports.$inferSelect;
export type NewCommentReport = typeof commentReports.$inferInsert;

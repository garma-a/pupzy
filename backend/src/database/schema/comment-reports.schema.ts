import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { comments } from './comments.schema';
import { users } from './users.schema';
import { reportReasonEnum } from './enums';

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
  },
  (table) => ({
    uniqueCommentReportPerCommentAndReporter: uniqueIndex('unique_comment_report_per_comment_and_reporter').on(
      table.commentId,
      table.reporterId,
    ),
    commentIdx: index('idx_comment_reports_comment').on(table.commentId),
    reporterCreatedIdx: index('idx_comment_reports_reporter_created').on(table.reporterId, table.createdAt),
  }),
);

export type CommentReport = typeof commentReports.$inferSelect;
export type NewCommentReport = typeof commentReports.$inferInsert;

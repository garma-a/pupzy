import { sql } from 'drizzle-orm';
import { pgTable, pgEnum, uuid, text, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { adminUsers } from './admin-users.schema';

/**
 * `account_reports` — moderation complaints about another Pupzy Account's
 * conduct rather than about one specific contribution.
 *
 * ## Canonical language
 * Domain docs call this a "Pupzy Account Report". GraphQL keeps the codebase
 * term `User` and exposes the additive `reportUser` mutation.
 *
 * ## Open/reviewed lifecycle
 * A report is open while `reviewed_at IS NULL`. The partial unique index
 * `unique_open_account_report_per_reporter_and_reported` allows at most one
 * open report per (reporter, reported account) pair while permitting a new
 * report after the previous one is reviewed.
 *
 * ## Source context
 * `source_type` + `source_id` optionally reference exactly one interaction
 * supplied as moderation evidence (a Post, a Comment or Reply, a Contact
 * Request, or an Adoption Application). The reference never changes the report
 * target from the Pupzy Account and never creates a separate Post or Comment
 * Report. The pair is either both present or both absent.
 *
 * ## Privacy
 * Rows are only visible to administrators. Reporting never consults Blocks,
 * and an account report never automatically suspends or bans its target.
 */
export const accountReportReasonEnum = pgEnum('account_report_reason', [
  'HARASSMENT',
  'SPAM',
  'SCAM_OR_FRAUD',
  'IMPERSONATION',
  'INAPPROPRIATE_CONDUCT',
  'SAFETY_CONCERN',
  'OTHER',
]);

export const accountReportSourceTypeEnum = pgEnum('account_report_source_type', [
  'POST',
  'COMMENT',
  'CONTACT_REQUEST',
  'ADOPTION_APPLICATION',
]);

/**
 * Administrative review outcome. `NO_ACTION` closes the report without
 * changing the reported account; `ACTION_TAKEN` records that an existing
 * moderation action (for example a user ban) resolved it. The append-only
 * `moderation_actions` table remains the authoritative audit trail.
 */
export const accountReportReviewOutcomeEnum = pgEnum('account_report_review_outcome', ['NO_ACTION', 'ACTION_TAKEN']);

export const accountReports = pgTable(
  'account_reports',
  {
    /** Internal report ID. Primary key, UUIDv7. */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** FK → users. The reporting Pupzy Account. CASCADE on Account Deletion. */
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** FK → users. The reported Pupzy Account. CASCADE on Account Deletion. */
    reportedUserId: uuid('reported_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Account-specific reason category. Never the content-only reason set. */
    reason: accountReportReasonEnum('reason').notNull(),

    /** Optional free-text details. Required (nonblank) only for OTHER. */
    details: text('details'),

    /** Optional evidence surface kind. NULL when no source context is supplied. */
    sourceType: accountReportSourceTypeEnum('source_type'),

    /**
     * Optional evidence row ID interpreted by `source_type`.
     * Deliberately not a foreign key: the reference is moderation evidence and
     * must never cascade a report away or create a second report.
     */
    sourceId: uuid('source_id'),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Timestamp when an administrator reviewed the report. NULL while open. */
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    /** FK → admin_users. Reviewing administrator. SET NULL if the admin is removed. */
    reviewedByAdminId: uuid('reviewed_by_admin_id').references(() => adminUsers.id, { onDelete: 'set null' }),

    /** Explicit review outcome. NULL while open. */
    reviewOutcome: accountReportReviewOutcomeEnum('review_outcome'),
  },
  (table) => [
    uniqueIndex('unique_open_account_report_per_reporter_and_reported')
      .on(table.reporterId, table.reportedUserId)
      .where(sql`"reviewed_at" IS NULL`),
    index('idx_account_reports_reported_created').on(table.reportedUserId, table.createdAt),
    index('idx_account_reports_reporter_created').on(table.reporterId, table.createdAt),
    check('account_reports_no_self_report', sql`${table.reporterId} <> ${table.reportedUserId}`),
    check('account_reports_source_pair', sql`(${table.sourceType} IS NULL) = (${table.sourceId} IS NULL)`),
  ],
);

export type AccountReportReason = (typeof accountReportReasonEnum.enumValues)[number];
export type AccountReportSourceType = (typeof accountReportSourceTypeEnum.enumValues)[number];
export type AccountReportReviewOutcome = (typeof accountReportReviewOutcomeEnum.enumValues)[number];
export type AccountReport = typeof accountReports.$inferSelect;
export type NewAccountReport = typeof accountReports.$inferInsert;

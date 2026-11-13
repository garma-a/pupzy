import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { adminUsers } from './admin-users.schema';
import { cities } from './cities.schema';

export const announcementStatusEnum = pgEnum('announcement_status', ['PENDING', 'SENDING', 'SENT', 'FAILED']);
export const announcementAudienceEnum = pgEnum('announcement_audience', ['ALL', 'CITY']);

/**
 * `announcements` — an administrator's Announcement and its durable fan-out
 * progress.
 *
 * ## Lifecycle
 * The admin service writes one row (status PENDING) and one audit row in a
 * single transaction and returns; it never creates notifications. The Nest
 * `AdminAnnouncementProcessor` then fans the Announcement out in bounded
 * batches. Each batch creates its notifications and push delivery intents in
 * ONE transaction that also advances `cursor_user_id` and the counters, so a
 * crash loses at most the batch in flight and a resume cannot duplicate
 * anything. PENDING -> SENDING -> SENT, or FAILED with `failure_reason`.
 *
 * ## Frozen audience
 * Recipients are the accounts with `created_at <= audience_cutoff_at`, walked
 * in `users.id` order from `cursor_user_id`. An account that registers after
 * the send never receives it. Eligibility (not banned, no deletion request) and
 * a City audience's home City are read live per batch.
 *
 * An Announcement cannot be edited or unsent: the admin resource is read-only.
 */
export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** The SUPER_ADMIN who sent it. SET NULL keeps history if the account is removed. */
    sentByAdminId: uuid('sent_by_admin_id').references(() => adminUsers.id, { onDelete: 'set null' }),

    /**
     * Idempotency key the compose page generates once per draft. A repeated send
     * with the same key (double click, retry, replay) finds this row instead of
     * creating a second announcement, which could not be unsent.
     */
    requestKey: uuid('request_key').notNull(),

    audience: announcementAudienceEnum('audience').notNull(),

    /** The chosen home City for a `CITY` audience. NULL for everyone. */
    audienceCityId: uuid('audience_city_id').references(() => cities.id, { onDelete: 'set null' }),

    /** English name of the City at send time, so history survives a City change. */
    audienceCityName: varchar('audience_city_name', { length: 200 }),

    titleEn: varchar('title_en', { length: 80 }).notNull(),
    bodyEn: varchar('body_en', { length: 500 }).notNull(),
    titleAr: varchar('title_ar', { length: 80 }).notNull(),
    bodyAr: varchar('body_ar', { length: 500 }).notNull(),

    status: announcementStatusEnum('status').notNull().default('PENDING'),

    /** Why a FAILED announcement stopped. */
    failureReason: text('failure_reason'),

    /** Accounts registered after this instant are not recipients. Set once at send. */
    audienceCutoffAt: timestamp('audience_cutoff_at', { withTimezone: true }).notNull().defaultNow(),

    /** Exact eligible-recipient count confirmed by the administrator at send time. */
    expectedRecipients: integer('expected_recipients').notNull(),

    /** Last `users.id` handled. The next batch starts after it. NULL before the first batch. */
    cursorUserId: uuid('cursor_user_id'),

    /** In-app notifications created so far. */
    inAppCount: integer('in_app_count').notNull().default(0),

    /** Push delivery intents created so far (one per registered device of an opted-in recipient). */
    pushIntentCount: integer('push_intent_count').notNull().default(0),

    /** Consecutive failed batches; reset by a successful batch. */
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),

    /** Earliest time a worker may try again after a failed batch (backoff). */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),

    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /** Fan-out work queue: only unfinished announcements are ever scanned. */
    workIdx: index('idx_announcements_work')
      .on(table.nextAttemptAt, table.createdAt)
      .where(sql`status IN ('PENDING', 'SENDING')`),
    historyIdx: index('idx_announcements_created').on(table.createdAt),
    requestKeyUq: uniqueIndex('uq_announcements_request_key').on(table.requestKey),
    audienceCheck: check(
      'announcements_audience_city',
      sql`${table.audience} <> 'ALL' OR ${table.audienceCityId} IS NULL`,
    ),
    textNotBlank: check(
      'announcements_text_not_blank',
      sql`btrim(${table.titleEn}) <> '' AND btrim(${table.bodyEn}) <> '' AND btrim(${table.titleAr}) <> '' AND btrim(${table.bodyAr}) <> ''`,
    ),
  }),
);

export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;

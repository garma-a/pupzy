import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { posts } from './posts.schema';
import { notifications } from './notifications.schema';
import { notificationTypeEnum } from './enums';

/**
 * `post_completion_notification_events` — durable outbox for post completion events.
 *
 * When a creator or administrator closes a rescue as Rescued (or completes a post),
 * this row and its stable closure-time audience snapshot are captured atomically
 * inside the closing transaction.
 */
export const postCompletionNotificationEvents = pgTable(
  'post_completion_notification_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    postType: varchar('post_type', { length: 32 }).notNull(),
    outcome: varchar('outcome', { length: 32 }).notNull(),
    closingActorId: uuid('closing_actor_id').references(() => users.id, { onDelete: 'set null' }),
    type: notificationTypeEnum('type').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body').notNull(),
    titleArabic: varchar('title_arabic', { length: 200 }).notNull(),
    bodyArabic: text('body_arabic').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    totalRecipients: integer('total_recipients').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    postStatusIdx: index('idx_post_completion_events_post_status').on(table.postId, table.status),
  }),
);

/**
 * `post_completion_recipients` — stable audience snapshot for a completion event.
 *
 * Captures deduplicated boosters, savers, comment/reply authors, contact requesters
 * and adoption applicants at closure time. Processed in bounded restartable batches.
 */
export const postCompletionRecipients = pgTable(
  'post_completion_recipients',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    eventId: uuid('event_id')
      .notNull()
      .references(() => postCompletionNotificationEvents.id, { onDelete: 'cascade' }),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),
    notificationId: uuid('notification_id').references(() => notifications.id, { onDelete: 'set null' }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventRecipientUq: uniqueIndex('uq_post_completion_recipients_event_user').on(table.eventId, table.recipientId),
    dueIdx: index('idx_post_completion_recipients_due').on(table.status, table.nextAttemptAt, table.id),
    postStatusIdx: index('idx_post_completion_recipients_post_status').on(table.postId, table.status),
    processingLeaseIdx: index('idx_post_completion_recipients_lease').on(table.leaseExpiresAt),
  }),
);

export type PostCompletionNotificationEvent = typeof postCompletionNotificationEvents.$inferSelect;
export type NewPostCompletionNotificationEvent = typeof postCompletionNotificationEvents.$inferInsert;
export type PostCompletionRecipient = typeof postCompletionRecipients.$inferSelect;
export type NewPostCompletionRecipient = typeof postCompletionRecipients.$inferInsert;

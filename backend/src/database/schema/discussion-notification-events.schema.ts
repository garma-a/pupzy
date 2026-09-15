import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { posts } from './posts.schema';
import { comments } from './comments.schema';
import { notificationTypeEnum } from './enums';

/**
 * Durable outbox for Comment discussion notifications.
 *
 * A source mutation writes this row in its own transaction. The existing
 * NestJS API later creates the user-visible notification, so a process crash
 * after source commit cannot drop the event.
 */
export const discussionNotificationEvents = pgTable(
  'discussion_notification_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    sourceEventId: varchar('source_event_id', { length: 160 }).notNull(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    type: notificationTypeEnum('type').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body').notNull(),
    relatedPostId: uuid('related_post_id').references(() => posts.id, { onDelete: 'set null' }),
    relatedCommentId: uuid('related_comment_id').references(() => comments.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 16 }).notNull().default('PENDING'),
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
    sourceEventUnique: uniqueIndex('uq_discussion_notification_events_source').on(table.sourceEventId),
    dueIdx: index('idx_discussion_notification_events_due').on(
      table.status,
      table.nextAttemptAt,
      table.createdAt,
      table.id,
    ),
    processingLeaseIdx: index('idx_discussion_notification_events_processing_lease').on(table.leaseExpiresAt),
  }),
);

export type DiscussionNotificationEvent = typeof discussionNotificationEvents.$inferSelect;
export type NewDiscussionNotificationEvent = typeof discussionNotificationEvents.$inferInsert;

import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { posts } from './posts.schema';
import { contactRequests } from './contact-requests.schema';
import { adoptionApplications } from './adoption-applications.schema';
import { notificationTypeEnum } from './enums';

/**
 * `notifications` — in-app notification inbox for users.
 *
 * ## Creation sources
 * | type                              | Created by                                                        |
 * |-----------------------------------|-------------------------------------------------------------------|
 * | NEW_UPVOTE                        | Service layer on post_upvotes INSERT                              |
 * | POST_SAVED                        | Service layer on post_saves INSERT                                |
 * | CONTACT_REQUEST_RECEIVED          | Service layer on contact_requests INSERT                          |
 * | CONTACT_REQUEST_APPROVED          | Service layer on contact_requests UPDATE (status → APPROVED)      |
 * | CONTACT_REQUEST_REJECTED          | Service layer on contact_requests UPDATE (status → REJECTED)      |
 * | ADOPTION_APPLICATION_RECEIVED     | Service layer on adoption_applications INSERT                     |
 * | ADOPTION_APPLICATION_APPROVED     | Service layer on adoption_applications UPDATE (status → APPROVED) |
 * | ADOPTION_APPLICATION_REJECTED     | Service layer on adoption_applications UPDATE (status → REJECTED) |
 * | POST_REMOVED_BY_ADMIN             | AdminJS `after` hook on post status update → REMOVED              |
 * | POST_INACTIVITY_NUDGE             | Auto-removal cron (fires before removing the post)               |
 * | SYSTEM_ANNOUNCEMENT               | Service layer when a new post matches a saved search alert        |
 *
 * ## Related entity FKs
 * All three FK columns are nullable. SET NULL on delete so historical
 * notifications survive even if the related entity is later removed.
 *
 * ## Partial index for unread badge
 * `idx_notifications_unread` is a partial index (WHERE is_read = false).
 * Cannot be expressed in Drizzle — added in custom migration SQL.
 */
export const notifications = pgTable(
  'notifications',
  {
    /** Internal notification ID. Primary key, UUIDv4. */
    id: uuid('id').primaryKey().default(sql`uuidv7()`),

    /** FK → users (notification recipient). CASCADE on user delete. */
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** What triggered this notification — drives icon, routing, and copy. */
    type: notificationTypeEnum('type').notNull(),

    /** Short notification headline, e.g. "Ahmed upvoted your rescue post". */
    title: varchar('title', { length: 200 }).notNull(),

    /** Full notification body shown in the inbox. */
    body: text('body').notNull(),

    /**
     * Optional link to the related post.
     * SET NULL if the post is later deleted.
     */
    relatedPostId: uuid('related_post_id').references(() => posts.id, {
      onDelete: 'set null',
    }),

    /**
     * Optional link to the related contact request.
     * SET NULL if the contact request is later deleted.
     */
    relatedContactRequestId: uuid('related_contact_request_id').references(
      () => contactRequests.id,
      { onDelete: 'set null' },
    ),

    /**
     * Optional link to the related adoption application.
     * SET NULL if the application is later deleted.
     */
    relatedApplicationId: uuid('related_application_id').references(
      () => adoptionApplications.id,
      { onDelete: 'set null' },
    ),

    /** Whether the recipient has read this notification. */
    isRead: boolean('is_read').notNull().default(false),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /**
     * Primary query pattern: fetch latest notifications for a user.
     * `ORDER BY created_at DESC` with a per-recipient filter.
     */
    recipientTimeIdx: index('idx_notifications_recipient_time').on(
      table.recipientId,
      table.createdAt,
    ),

    /*
     * Partial index for unread badge count:
     *   CREATE INDEX idx_notifications_unread ON notifications (recipient_id, created_at)
     *   WHERE is_read = false;
     * Cannot be expressed here — see custom migration SQL.
     */
  }),
);

/** TypeScript type for a full `notifications` row. */
export type Notification = typeof notifications.$inferSelect;

/** TypeScript type for inserting a new `notifications` row. */
export type NewNotification = typeof notifications.$inferInsert;

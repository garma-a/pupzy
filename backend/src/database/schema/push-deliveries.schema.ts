import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { notifications } from './notifications.schema';
import { deviceRegistrations } from './device-registrations.schema';

/**
 * Lifecycle of one durable push delivery intent.
 *
 * - PENDING: due for a provider send attempt.
 * - PROCESSING: claimed by a worker under a lease.
 * - DELIVERED: the provider accepted the message (not a promise of receipt).
 * - SUPPRESSED: terminal skip because the recipient opted out, is isolated
 *   from the source actor, is unavailable, or the token no longer belongs to
 *   the recipient. The in-app notification is preserved.
 * - FAILED: bounded attempts exhausted; visible for operator intervention.
 */
export const PUSH_DELIVERY_STATUSES = ['PENDING', 'PROCESSING', 'DELIVERED', 'SUPPRESSED', 'FAILED'] as const;
export type PushDeliveryStatus = (typeof PUSH_DELIVERY_STATUSES)[number];

/**
 * `push_deliveries` — durable outbox for provider push delivery.
 *
 * A source transaction inserts one intent per registered device in the same
 * transaction as the notification row, so a rolled-back notification can never
 * produce a push. The always-on push worker claims due intents with a database
 * lease and sends them outside database transactions.
 *
 * ## Deduplication
 * `(notification_id, device_id)` is unique: repeated enqueue or recovery
 * attempts create at most one intent per notification per device.
 *
 * ## Cleanup
 * Intents cascade with their notification, recipient, and device registration.
 * A sign-out or token takeover therefore cancels queued work instead of
 * retrying it.
 */
export const pushDeliveries = pgTable(
  'push_deliveries',
  {
    /** Internal delivery ID. Primary key, UUIDv7. */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** FK → notifications. CASCADE: no notification means nothing to push. */
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),

    /** FK → users (recipient). CASCADE on account deletion. */
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Optional source actor for Block rechecks. SET NULL when the actor is
     * deleted; a missing actor only relaxes the isolation recheck, it cannot
     * leak an isolated relationship.
     */
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),

    /** FK → device_registrations. CASCADE when the device unregisters. */
    deviceId: uuid('device_id')
      .notNull()
      .references(() => deviceRegistrations.id, { onDelete: 'cascade' }),

    /** Delivery state; see `PUSH_DELIVERY_STATUSES`. */
    status: varchar('status', { length: 16 }).notNull().default('PENDING'),

    /** Bounded attempt counter; incremented when a worker claims the intent. */
    attempts: integer('attempts').notNull().default(0),

    /** Last provider or recheck failure, kept for observability. */
    lastError: text('last_error'),

    /** Earliest time a worker may claim this intent (backoff). */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),

    /** Worker lease token; guarded writes prevent stale workers from winning. */
    leaseToken: uuid('lease_token'),

    /** Lease expiry; an expired PROCESSING intent is claimable again. */
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),

    /** Provider acceptance timestamp. */
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Row last-update timestamp. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    notificationDeviceUnique: uniqueIndex('uq_push_deliveries_notification_device').on(
      table.notificationId,
      table.deviceId,
    ),
    dueIdx: index('idx_push_deliveries_due').on(table.status, table.nextAttemptAt, table.createdAt, table.id),
    processingLeaseIdx: index('idx_push_deliveries_processing_lease').on(table.leaseExpiresAt),
    deviceIdx: index('idx_push_deliveries_device').on(table.deviceId),
    recipientIdx: index('idx_push_deliveries_recipient').on(table.recipientId),
  }),
);

export type PushDelivery = typeof pushDeliveries.$inferSelect;
export type NewPushDelivery = typeof pushDeliveries.$inferInsert;

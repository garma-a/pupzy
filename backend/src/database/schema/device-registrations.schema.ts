import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users.schema';

/** Mobile platforms accepted by device registration. */
export const DEVICE_PLATFORMS = ['ANDROID', 'IOS'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/**
 * `device_registrations` — provider push tokens owned by one Pupzy Account.
 *
 * ## Ownership and rotation
 * `token` is globally unique. Registering a token is idempotent for its current
 * owner and moves ownership when a different account registers the same token
 * (token rotation/reassignment, or a shared device after an incomplete
 * sign-out). Pending push intents for the previous owner are cancelled in the
 * registration transaction, and the delivery worker rechecks ownership before
 * sending, so a reassigned token cannot keep receiving the former account's
 * notifications.
 *
 * ## Cleanup
 * Rows cascade with their account (Account Deletion) and are deleted by
 * `unregisterDevice` (sign-out). Deleting a registration cascades its pending
 * `push_deliveries` intents.
 */
export const deviceRegistrations = pgTable(
  'device_registrations',
  {
    /** Internal registration ID. Primary key, UUIDv7. */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** FK → users (owner). CASCADE on account deletion. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Provider token (FCM registration token). Globally unique so ownership is
     * unambiguous and reassignment is a single-row update.
     */
    token: varchar('token', { length: 512 }).notNull(),

    /** Mobile platform the token belongs to. */
    platform: varchar('platform', { length: 16 }).notNull(),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Row last-update timestamp (refreshed on idempotent re-registration). */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenUnique: uniqueIndex('uq_device_registrations_token').on(table.token),
    userIdx: index('idx_device_registrations_user').on(table.userId),
  }),
);

export type DeviceRegistration = typeof deviceRegistrations.$inferSelect;
export type NewDeviceRegistration = typeof deviceRegistrations.$inferInsert;

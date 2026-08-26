import { sql } from 'drizzle-orm';
import { pgTable, pgEnum, uuid, varchar, text, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** Roles for internal staff accounts. */
export const adminRoleEnum = pgEnum('admin_role', ['ADMIN', 'SUPER_ADMIN']);

/**
 * Internal staff accounts for the standalone admin service. These accounts
 * are deliberately separate from mobile-app user accounts.
 */
export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    email: varchar('email', { length: 255 }).notNull().unique(),
    /** bcrypt hash. Never store or log the plaintext password anywhere. */
    passwordHash: text('password_hash').notNull(),
    fullName: varchar('full_name', { length: 120 }).notNull(),
    role: adminRoleEnum('role').notNull().default('ADMIN'),
    /** Prefer deactivation over deletion so audit history remains attributable. */
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: uniqueIndex('unique_admin_users_email').on(table.email),
    emailCaseInsensitiveIdx: uniqueIndex('unique_admin_users_email_ci').on(sql`lower(${table.email})`),
  }),
);

export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;

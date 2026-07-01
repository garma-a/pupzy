import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['USER', 'ADMIN']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  firebaseUid: varchar('firebase_uid', { length: 128 }).notNull().unique(),
  fullName: varchar('full_name', { length: 120 }), // null until completeProfile()
  email: varchar('email', { length: 255 }).notNull().unique(),
  profilePictureUrl: text('profile_picture_url'),
  phoneNumber: varchar('phone_number', { length: 20 }),
  role: userRoleEnum('role').notNull().default('USER'),
  cityId: uuid('city_id'), // FK to cities table (add later)
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// TypeScript types inferred from schema — zero duplication
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

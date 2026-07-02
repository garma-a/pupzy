import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
  index,
  boolean,
} from 'drizzle-orm/pg-core';

/**
 * `user_role` enum — controls feature access throughout the app.
 *
 * - `USER`  — Standard user. Created automatically on first login.
 * - `ADMIN` — Elevated access. Assigned manually by system administrators.
 */
export const userRoleEnum = pgEnum('user_role', ['USER', 'ADMIN']);

/**
 * `users` table — central identity table for the Pupzy platform.
 *
 * ## Identity model
 * User identity is managed by Firebase Auth (Google sign-in).
 * This table stores application-level data and references the Firebase UID.
 *
 * ## Row lifecycle
 * 1. **First login** — `FirebaseAuthGuard` calls `UsersService.findOrCreate()`,
 *    which inserts a row with just `firebaseUid`, `email`, and `profilePictureUrl`.
 * 2. **Profile completion** — User calls the `completeProfile` mutation to set
 *    `fullName`, `phoneNumber`, and `cityId`.
 *
 * ## Indexes
 * | Column       | Index type   | Reason                                    |
 * |--------------|--------------|-------------------------------------------|
 * | firebase_uid | UNIQUE (auto)| Hot path — looked up on every request     |
 * | email        | UNIQUE (auto)| Uniqueness + account recovery lookups     |
 * | city_id      | B-tree       | Prevents full-table scans for city queries|
 * | created_at   | B-tree       | Sorting + cursor pagination               |
 */
export const users = pgTable(
  'users',
  {
    /** Internal Pupzy user ID. Primary key, UUIDv4, auto-generated. */
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Firebase Auth UID. Never changes for a given user.
     * Used to link every Firebase token to a Pupzy user row.
     */
    firebaseUid: varchar('firebase_uid', { length: 128 }).notNull().unique(),

    /**
     * User's display name. Null until `completeProfile` is called.
     * Max 120 chars matches the GraphQL SDL validation constraint.
     */
    fullName: varchar('full_name', { length: 120 }),

    /** Email address sourced from Firebase Auth. Unique per user. */
    email: varchar('email', { length: 255 }).notNull().unique(),

    /**
     * Authentication provider that was used for signup (e.g. Google, Facebook, password).
     * Populated from Firebase token's sign_in_provider.
     */
    authProvider: varchar('auth_provider', { length: 50 }).notNull(),

    /** URL of the user's profile picture, sourced from their Google account. */
    profilePictureUrl: text('profile_picture_url'),

    /**
     * Phone number stored securely as an AES-256-GCM encrypted blob.
     * Null until `completeProfile` is called.
     * Used later to construct WhatsApp wa.me/ links.
     */
    phoneNumber: text('phone_number'),

    /** Application-level role. Defaults to USER on creation. */
    role: userRoleEnum('role').notNull().default('USER'),

    /**
     * Placeholder for Block 2 verified badges.
     * Denotes whether a user has passed additional identity verification.
     */
    isVerified: boolean('is_verified').notNull().default(false),

    /**
     * Foreign key to the `cities` table (not yet created).
     * Null until `completeProfile` is called.
     * Indexed to avoid full-table scans when querying users by city.
     */
    cityId: uuid('city_id'),

    /** Timestamp of row creation. Set once by the database. */
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    /**
     * Timestamp of last update. Manually set in `UsersRepository.update()`.
     *
     * Note: A PostgreSQL trigger (`set_updated_at`) is recommended for
     * production to auto-update this on any UPDATE outside the repository.
     * See drizzle/migrations/README.md for the trigger SQL.
     */
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    /**
     * Index on city_id — prevents full-table scans when listing users
     * in a city, or when joining users to the cities table.
     */
    cityIdIdx: index('idx_users_city_id').on(table.cityId),

    /**
     * Index on created_at — used for sorting newest users first and
     * for cursor-based pagination queries.
     */
    createdAtIdx: index('idx_users_created_at').on(table.createdAt),
  }),
);

/** TypeScript type for a full User row — inferred from schema, zero duplication. */
export type User = typeof users.$inferSelect;

/** TypeScript type for inserting a new User row. */
export type NewUser = typeof users.$inferInsert;

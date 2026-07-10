import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { cities } from './cities.schema';

/**
 * `users` table — central identity table for the Pupzy platform.
 *
 * ## Identity model
 * User identity is managed by Firebase Auth (Google + Facebook via FlutterFire).
 * `firebase_user_id` is the ONLY link between Firebase and this table.
 * Both Google and Facebook sign-in produce a Firebase UID — Firebase manages
 * multi-provider identity internally, so we never need to store the provider.
 *
 * ## Row lifecycle
 * 1. **First login** — `FirebaseAuthGuard` calls `UsersService.findOrCreate()`,
 *    inserting a row with just `firebase_user_id`, `email`, and `profile_picture_url`.
 * 2. **Profile completion** — User calls `completeProfile` to set
 *    `full_name`, `phone_number`, and `home_city_id`.
 *
 * ## Post counters
 * The 5 `*_post_count` columns are maintained by a single DB trigger so they
 * stay correct even when posts are changed directly via AdminJS (which bypasses
 * NestJS resolvers). The trigger is defined in custom migration SQL.
 *
 * ## Phone encryption
 * `phone_number` is stored as an AES-256-GCM encrypted blob. Decrypted
 * server-side only for approved WhatsApp contact links and product seller contact.
 *
 * ## Indexes
 * | Column                  | Index type | Reason                                    |
 * |-------------------------|------------|-------------------------------------------|
 * | firebase_user_id        | UNIQUE     | Hot path — looked up on every request     |
 * | email                   | UNIQUE     | Uniqueness + account recovery lookups     |
 * | home_city_id            | B-tree     | Prevents full-table scans by city         |
 * | last_known_location     | GIST       | ST_Distance proximity queries (custom SQL)|
 */
export const users = pgTable(
  'users',
  {
    /** Internal Pupzy user ID. Primary key, UUIDv4, auto-generated. */
    id: uuid('id').primaryKey().default(sql`uuidv7()`),

    // ── Firebase Auth ─────────────────────────────────────────────────────────
    /**
     * Firebase Auth UID. Never changes for a given user.
     * Used to link every Firebase ID token to a Pupzy user row.
     * Both Google and Facebook sign-in produce the same firebase_user_id.
     */
    firebaseUserId: varchar('firebase_user_id', { length: 128 }).notNull().unique(),

    /** Email address sourced from Firebase Auth. Unique per user. */
    email: varchar('email', { length: 255 }).notNull().unique(),

    // ── Profile ───────────────────────────────────────────────────────────────
    /**
     * Display name. NULL until `completeProfile` is called.
     * Max 120 chars matches the GraphQL SDL validation constraint.
     */
    fullName: varchar('full_name', { length: 120 }),

    /** Arabic display name. Optional. */
    fullNameArabic: varchar('full_name_arabic', { length: 120 }),

    /**
     * Profile picture URL synced from Firebase Auth on first sign-in.
     * User can override via `updateProfile`.
     */
    profilePictureUrl: text('profile_picture_url'),

    /**
     * Trust badge. Set to `true` after the user completes at least one
     * successful adoption or sale. Shown on profile cards and post cards.
     */
    isVerified: boolean('is_verified').notNull().default(false),

    // ── Phone — encrypted at rest ─────────────────────────────────────────────
    /**
     * AES-256-GCM encrypted phone number. NULL until `completeProfile` is called.
     * Decrypted server-side only for:
     *   - Approved contact request WhatsApp links (RESCUE/LOST/ADOPTION)
     *   - Product seller contact (PRODUCT — no approval gate)
     */
    phoneNumber: text('phone_number'),

    // ── Location ──────────────────────────────────────────────────────────────
    /**
     * City set during `completeProfile`. Feeds default to this city when the
     * client sends no location override.
     * FK → cities with SET NULL on city delete (won't happen in practice).
     */
    homeCityId: uuid('home_city_id').references(() => cities.id, {
      onDelete: 'set null',
    }),

    /**
     * Last known GPS position as a PostGIS POINT. Updated when the Flutter
     * app has location permission. Used for proximity sort within a city.
     * NEVER exposed to other users.
     * GIST index added in custom migration SQL.
     */
    lastKnownLocation: text('last_known_location'),

    // ── Post counters — profile stats ─────────────────────────────────────────
    /**
     * All 5 counters are maintained TOGETHER by a single DB trigger so they
     * stay accurate even when posts are changed directly via AdminJS.
     * Trigger SQL: see drizzle/migrations/custom.sql.
     */
    postCount: integer('post_count').notNull().default(0),
    rescuePostCount: integer('rescue_post_count').notNull().default(0),
    lostPostCount: integer('lost_post_count').notNull().default(0),
    adoptionPostCount: integer('adoption_post_count').notNull().default(0),
    productPostCount: integer('product_post_count').notNull().default(0),

    // ── Preferences ───────────────────────────────────────────────────────────
    /** Preferred interface language. Arabic default for Egypt. */
    languagePreference: varchar('language_preference', { length: 10 })
      .notNull()
      .default('ar'),

    /** Whether push notifications are enabled. */
    notificationsEnabled: boolean('notifications_enabled').notNull().default(true),

    /**
     * Timestamp of the user's most recent authenticated request.
     * Updated by the auth guard on every request.
     */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),

    /** Row creation timestamp. Set once by the database. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Row last-update timestamp. Manually set in `UsersRepository.update()`.
     * A DB trigger (`set_updated_at`) is recommended — see custom migration SQL.
     */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /** Prevents full-table scans when listing users in a city. */
    homeCityIdx: index('idx_users_home_city').on(table.homeCityId),

    /**
     * GIST index on last_known_location for ST_Distance proximity queries.
     * Cannot be expressed here — see custom migration SQL.
     */
    // NOTE: CREATE INDEX idx_users_last_known_location ON users USING GIST (last_known_location);
    // (omitted — Drizzle cannot express USING GIST for text/custom types)
  }),
);

/** TypeScript type for a full `users` row — inferred from schema, zero duplication. */
export type User = typeof users.$inferSelect;

/** TypeScript type for inserting a new `users` row. */
export type NewUser = typeof users.$inferInsert;

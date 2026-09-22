import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, boolean, integer, timestamp, index, geometry } from 'drizzle-orm/pg-core';
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
    /** Internal Pupzy user ID. Primary key, UUIDv7, auto-generated. */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

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
     * Effective profile picture URL shown to clients. Initially synced from
     * Firebase Auth on first sign-in, then either a provider URL or an owned
     * avatar URL after the user sets one. NULL means "no photo" (initials).
     */
    profilePictureUrl: text('profile_picture_url'),

    /**
     * R2 storage key of the user's owned avatar, e.g.
     * `avatars/{userId}/{mediaId}.webp`. NULL while the profile uses a
     * provider-synced picture or no picture at all. Only this owned key is
     * ever queued for deletion; third-party provider URLs are never treated
     * as owned objects.
     */
    profilePhotoStorageKey: text('profile_photo_storage_key'),

    /**
     * When the user explicitly set or removed their profile picture.
     * NULL means the account has never made an avatar choice, so an initial
     * provider picture remains eligible for provider synchronization. Once
     * set, provider synchronization never overrides the user's decision.
     */
    profilePhotoChangedAt: timestamp('profile_photo_changed_at', { withTimezone: true }),

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
    lastKnownLocation: geometry('last_known_location', { type: 'point', srid: 4326 }),

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
    /**
     * Explicitly synchronized notification language (`ar` or `en`).
     * NULL until the account synchronizes a choice: the historic `ar` database
     * default was never a user decision, so unsynchronized accounts and legacy
     * rows resolve to English instead.
     */
    languagePreference: varchar('language_preference', { length: 10 }),

    /** Whether push notifications are enabled. */
    notificationsEnabled: boolean('notifications_enabled').notNull().default(true),

    /**
     * Version of the Terms this account most recently accepted.
     * NULL until the account explicitly accepts a published version; the
     * backend never fabricates consent, so legacy rows stay NULL.
     */
    termsAcceptedVersion: varchar('terms_accepted_version', { length: 64 }),

    /**
     * When {@link termsAcceptedVersion} was accepted.
     * Re-accepting the same version preserves this timestamp; accepting a new
     * version replaces it. NULL whenever no acceptance is recorded.
     */
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),

    // ── Moderation (admin panel) ─────────────────────────────────────────────
    /** Set by an admin. Banned users are rejected by FirebaseAuthGuard. */
    isBanned: boolean('is_banned').notNull().default(false),
    bannedAt: timestamp('banned_at', { withTimezone: true }),
    banReason: text('ban_reason'),
    bannedByAdminId: uuid('banned_by_admin_id'),

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

    /**
     * Timestamp until which an outstanding pre-signed upload URL issued to this user
     * remains valid. Persisted to ensure outstanding upload protection survives process restarts.
     */
    uploadGraceUntil: timestamp('upload_grace_until', { withTimezone: true }),
  },
  (table) => ({
    /** Prevents full-table scans when listing users in a city. */
    homeCityIdx: index('idx_users_home_city').on(table.homeCityId),

    bannedIdx: index('idx_users_banned')
      .on(table.bannedAt)
      .where(sql`is_banned = true`),

    lastKnownLocationGistIdx: index('idx_users_last_known_location').using('gist', table.lastKnownLocation),
  }),
);

/** TypeScript type for a full `users` row — inferred from schema, zero duplication. */
export type User = typeof users.$inferSelect;

/** TypeScript type for inserting a new `users` row. */
export type NewUser = typeof users.$inferInsert;

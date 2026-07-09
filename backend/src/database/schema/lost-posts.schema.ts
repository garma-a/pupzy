import { pgTable, uuid, varchar, text, boolean, date, index } from 'drizzle-orm/pg-core';
import { posts } from './posts.schema';
import { speciesTypeEnum, lostFoundTypeEnum, foundAnimalConditionEnum } from './enums';

/**
 * `lost_posts` — CTI extension table for `post_type = 'LOST'`.
 *
 * ## Dual-direction design
 * A single table covers both directions of the Lost & Found section,
 * discriminated by `report_type`:
 * - `LOST_PET`    → Owner is looking for their own pet
 * - `FOUND_STRAY` → Reporter has found a stray animal of unknown ownership
 *
 * This avoids creating a 5th `post_type` while keeping the data model clean.
 *
 * ## Field-set integrity
 * LOST_PET and FOUND_STRAY share some columns and have mutually exclusive fields.
 * The CHECK constraint `chk_lost_posts_report_fields` (in custom migration SQL)
 * ensures you cannot mix field sets:
 *   - LOST_PET  → `date_last_seen` required; `current_condition`,
 *                  `is_currently_safe_with_reporter`, `date_found` must be NULL
 *   - FOUND_STRAY → `current_condition`, `is_currently_safe_with_reporter`,
 *                   `date_found` required; `pet_name`, `date_last_seen` must be NULL
 *
 * ## Status transitions
 * - LOST_PET    → REUNITED when the pet comes home
 * - FOUND_STRAY → RESOLVED when the animal is homed or owner is identified
 *
 * ## Urgency
 * Lives on the base `posts` table. Required for BOTH directions.
 */
export const lostPosts = pgTable(
  'lost_posts',
  {
    /**
     * Shared primary key with `posts.id`.
     */
    postId: uuid('post_id')
      .primaryKey()
      .references(() => posts.id, { onDelete: 'cascade' }),

    /**
     * LOST_PET: owner is looking for their pet.
     * FOUND_STRAY: reporter found a stray animal.
     * Drives which fields are required/nullable (enforced by CHECK constraint).
     */
    reportType: lostFoundTypeEnum('report_type').notNull(),

    // ── Shared by both directions ─────────────────────────────────────────────

    /** Animal species. Used for filtering and display. */
    species: speciesTypeEnum('species').notNull(),

    /** Breed, if known. Helps with identification. */
    breed: varchar('breed', { length: 100 }),

    /**
     * Physical description, e.g. "Black and white cat with a scar on the left ear."
     * The most useful matching field for visual identification.
     */
    colorAndMarkings: varchar('color_and_markings', { length: 300 }),

    /**
     * Whether the animal has a collar with an identification tag.
     * A collar tag is what lets a finder trace the owner directly.
     */
    hasCollarWithIdentificationTag: boolean('has_collar_with_identification_tag'),

    /**
     * How the pet was lost (LOST_PET) or how the animal was found (FOUND_STRAY).
     * Free-text context for the post.
     */
    circumstances: text('circumstances'),

    // ── LOST_PET only fields ──────────────────────────────────────────────────

    /**
     * Pet's name. Optional — you might post on behalf of a neighbor without
     * knowing the pet name.
     * NULL for FOUND_STRAY (enforced by CHECK constraint).
     */
    petName: varchar('pet_name', { length: 100 }),

    /**
     * Date the pet was last seen.
     * Required for LOST_PET; must be NULL for FOUND_STRAY.
     * Enforced by CHECK constraint `chk_lost_posts_report_fields`.
     */
    dateLastSeen: date('date_last_seen'),

    // ── FOUND_STRAY only fields ───────────────────────────────────────────────

    /**
     * Physical condition of the found animal.
     * Required for FOUND_STRAY; must be NULL for LOST_PET.
     * Enforced by CHECK constraint.
     */
    currentCondition: foundAnimalConditionEnum('current_condition'),

    /**
     * Whether the reporter currently has the animal in a safe location.
     * Required for FOUND_STRAY. Tells responders whether the animal needs
     * immediate rescue or just rehoming assistance.
     */
    isCurrentlySafeWithReporter: boolean('is_currently_safe_with_reporter'),

    /**
     * Date the reporter found the stray animal.
     * Required for FOUND_STRAY; must be NULL for LOST_PET.
     * Enforced by CHECK constraint.
     */
    dateFound: date('date_found'),
  },
  (table) => ({
    /**
     * Enables the "Lost only / Found only" sub-filter within the Lost & Found tab.
     * Low cardinality (2 values) but worth indexing given how frequently
     * users will filter by direction.
     */
    reportTypeIdx: index('idx_lost_posts_report_type').on(table.reportType),
  }),
);

/** TypeScript type for a full `lost_posts` row. */
export type LostPost = typeof lostPosts.$inferSelect;

/** TypeScript type for inserting a new `lost_posts` row. */
export type NewLostPost = typeof lostPosts.$inferInsert;

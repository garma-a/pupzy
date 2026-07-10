import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { posts } from './posts.schema';
import { users } from './users.schema';
import { requestStatusEnum, speciesTypeEnum, genderTypeEnum, livingSituationEnum } from './enums';

/**
 * `adoption_applications` — responsible matching questionnaire.
 *
 * ## Purpose
 * The primary differentiator of Pupzy's adoption section over unmoderated
 * classifieds. Every applicant answers a structured set of questions that
 * let the owner assess compatibility before approving contact.
 *
 * ## Visibility
 * Never appears in any public feed. Visible only to the applicant
 * and the listing owner.
 *
 * ## One application per user per listing
 * The unique constraint `uq_adoption_application` prevents duplicate applications.
 * A rejected applicant cannot re-apply.
 *
 * ## Preference fields
 * Species/breed/age/gender preference fields are informational — they describe
 * what the applicant is ideally looking for, not filtering criteria.
 */
export const adoptionApplications = pgTable(
  'adoption_applications',
  {
    /** Internal application ID. Primary key, UUIDv4. */
    id: uuid('id').primaryKey().default(sql`uuidv7()`),

    /**
     * FK → posts (must be an ADOPTION post — enforced in resolver).
     * CASCADE on post delete.
     */
    targetPostId: uuid('target_post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),

    /** FK → users (the person applying). CASCADE on user delete. */
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Application lifecycle.
     * PENDING → owner has not responded yet.
     * APPROVED → WhatsApp contact unlocked for applicant.
     * REJECTED → applicant cannot re-apply (unique constraint prevents it).
     */
    status: requestStatusEnum('status').notNull().default('PENDING'),

    // ── Preference fields (informational) ─────────────────────────────────────
    speciesPreference: speciesTypeEnum('species_preference'),
    breedPreference: varchar('breed_preference', { length: 100 }),
    agePreference: varchar('age_preference', { length: 100 }),
    genderPreference: genderTypeEnum('gender_preference'),

    // ── Living situation ──────────────────────────────────────────────────────
    /** Type of home the applicant lives in. */
    livingSituation: livingSituationEnum('living_situation').notNull(),

    /** Whether the applicant has an outdoor area (balcony, garden, etc.). */
    hasOutdoorAccess: boolean('has_outdoor_access').notNull(),

    /** Whether there are other pets in the applicant's home. */
    hasOtherPetsAtHome: boolean('has_other_pets_at_home').notNull(),

    /** Whether there are children in the applicant's home. */
    hasChildrenAtHome: boolean('has_children_at_home').notNull(),

    /**
     * How many hours per day someone is home with the pet.
     * Important for high-energy animals that need constant company.
     */
    hoursAtHomePerDay: integer('hours_at_home_per_day'),

    /**
     * Description of past experience with pets.
     * Free-text — quality matters more than length.
     */
    previousPetExperience: text('previous_pet_experience'),

    /**
     * Why the applicant wants to adopt this specific animal.
     * Required — the single most important field for owner assessment.
     */
    whyAdopt: text('why_adopt').notNull(),

    // ── Commitments ───────────────────────────────────────────────────────────
    /** Whether the applicant agrees to a home visit if the owner requests one. */
    consentHomeVisit: boolean('consent_home_visit').notNull().default(false),

    /** Whether the applicant can provide a vet reference for any existing pets. */
    canProvideVetReference: boolean('can_provide_vet_reference').notNull().default(false),

    /** Timestamp when the owner approved or rejected the application. */
    respondedAt: timestamp('responded_at', { withTimezone: true }),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /**
     * One application per applicant per adoption post.
     * Prevents duplicate or re-application after rejection.
     */
    uniqueApplication: uniqueIndex('uq_adoption_application').on(
      table.targetPostId,
      table.applicantId,
    ),

    /** "My applications" list — all applications by this user across all posts. */
    applicantIdx: index('idx_adoption_applications_applicant').on(table.applicantId),

    /** Owner's inbox — all applications for a given post, filterable by status. */
    postStatusIdx: index('idx_adoption_applications_post_status').on(
      table.targetPostId,
      table.status,
    ),
  }),
);

/** TypeScript type for a full `adoption_applications` row. */
export type AdoptionApplication = typeof adoptionApplications.$inferSelect;

/** TypeScript type for inserting a new `adoption_applications` row. */
export type NewAdoptionApplication = typeof adoptionApplications.$inferInsert;

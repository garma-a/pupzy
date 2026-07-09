import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { posts } from './posts.schema';
import {
  speciesTypeEnum,
  genderTypeEnum,
  ageUnitEnum,
  spaceRequirementEnum,
} from './enums';

/**
 * `adoption_posts` — CTI extension table for `post_type = 'ADOPTION'`.
 *
 * ## CTI pattern
 * Shares the primary key with `posts`. Joined ONLY on the single-post
 * detail screen — never on feed or list queries.
 *
 * ## Coordinate privacy
 * Coordinates are NEVER returned to clients for adoption posts.
 * City name + distance in km only. Exact location revealed only through
 * the approved WhatsApp contact-request flow.
 *
 * ## Ranking
 * `effective_score` drives Hot feed sorting. Recalculated immediately on
 * every upvote/save and on every view-flush cron run (view contribution is weak).
 *
 * ## Auto-removal
 * `last_engaged_at` on the base post is updated on upvotes and saves ONLY.
 * Views alone are too passive to keep an adoption listing alive.
 * Auto-removed after 30 days of no explicit engagement.
 *
 * ## Personality tags
 * Stored as `text[]` — Drizzle ORM does not reliably support PG enum arrays.
 * Each value is validated against the `PersonalityTag` TypeScript union in the
 * service layer before insert. GIN index enables array-containment filter queries.
 * See custom migration SQL for GIN index definition.
 *
 * ## Age pairing
 * `age_value` and `age_unit` must both be set or both be NULL.
 * Enforced by CHECK constraint `chk_adoption_age_pairing` in custom migration SQL.
 */
export const adoptionPosts = pgTable(
  'adoption_posts',
  {
    /**
     * Shared primary key with `posts.id`.
     */
    postId: uuid('post_id')
      .primaryKey()
      .references(() => posts.id, { onDelete: 'cascade' }),

    /** Pet's name. Required for adoption listings. */
    petName: varchar('pet_name', { length: 100 }).notNull(),

    /** Animal species. */
    species: speciesTypeEnum('species').notNull(),

    /** Breed, if known. Used for filtered browsing and saved-search alerts. */
    breed: varchar('breed', { length: 100 }),

    /**
     * Numeric part of age, e.g. 3 (meaning "3 months").
     * Must be paired with `age_unit`. Both NULL = age unknown.
     * Enforced by CHECK constraint `chk_adoption_age_pairing`.
     */
    ageValue: integer('age_value'),

    /**
     * Unit for `age_value`. Must be paired with `age_value`.
     * Enforced by CHECK constraint `chk_adoption_age_pairing`.
     */
    ageUnit: ageUnitEnum('age_unit'),

    /** Pet's gender. */
    gender: genderTypeEnum('gender').notNull(),

    /** Whether the pet has received core vaccinations. */
    vaccinated: boolean('vaccinated').notNull().default(false),

    /** Whether the pet has been spayed/neutered. */
    neutered: boolean('neutered').notNull().default(false),

    /**
     * Any ongoing health conditions or notes for potential adopters.
     * Optional — a healthy pet has no health notes.
     */
    healthNotes: text('health_notes'),

    /**
     * Array of personality tags describing the pet's temperament.
     * Stored as `text[]` — validated against `PersonalityTag` union in service layer.
     * GIN index on this column is added in custom migration SQL:
     *   CREATE INDEX idx_adoption_personality_tags ON adoption_posts USING GIN (personality_tags);
     */
    personalityTags: text('personality_tags').array().notNull().default([]),

    /**
     * Space the pet needs in the adopter's home.
     * Used to pre-filter incompatible adopters.
     */
    spaceRequirement: spaceRequirementEnum('space_requirement'),

    /**
     * Whether the adopter must have prior experience with this species.
     * Shown prominently on the detail screen.
     */
    priorPetExperienceRequired: boolean('prior_pet_experience_required')
      .notNull()
      .default(false),

    /**
     * Any additional requirements for adopters beyond the structured fields.
     * Free-text, e.g. "Must have a fenced garden."
     */
    additionalRequirements: text('additional_requirements'),

    /**
     * Where the pet currently is, e.g. "Foster home in Maadi".
     * Shown on the feed card as a soft location indicator (no exact coordinates).
     */
    currentlyWith: varchar('currently_with', { length: 200 }),
  },
  (table) => ({
    /**
     * B-tree index on species for species-filtered adoption browsing.
     * GIN index on personality_tags is in custom migration SQL (Drizzle cannot express USING GIN).
     */
    speciesIdx: index('idx_adoption_posts_species').on(table.species),
  }),
);

/** TypeScript type for a full `adoption_posts` row. */
export type AdoptionPost = typeof adoptionPosts.$inferSelect;

/** TypeScript type for inserting a new `adoption_posts` row. */
export type NewAdoptionPost = typeof adoptionPosts.$inferInsert;

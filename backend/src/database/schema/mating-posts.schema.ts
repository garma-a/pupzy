import { pgTable, uuid, varchar, integer, boolean, text, index } from 'drizzle-orm/pg-core';
import { posts } from './posts.schema';
import { speciesTypeEnum, genderTypeEnum, ageUnitEnum } from './enums';

/**
 * `mating_posts` — CTI extension table for `post_type = 'MATING'`.
 *
 * ## CTI pattern
 * Shares the primary key with `posts`. Joined ONLY on the single-post
 * detail screen (`matingPostDetail` query) — never on feed/list queries.
 *
 * ## Coordinate privacy
 * Coordinates are NEVER returned to clients for MATING posts — same model
 * as ADOPTION. City name only. The parent `posts.coordinates` column stores
 * the resolved city's centroid (NOT the user's real GPS — MATING never
 * collects it) purely to satisfy the NOT NULL constraint on that column;
 * see the mission plan §0.3 decision 1 for why.
 *
 * ## Gender
 * Unlike ADOPTION, `gender: UNKNOWN` is rejected at the application layer
 * (validated in the input validator, not here — the underlying enum is
 * shared with ADOPTION, where UNKNOWN is legitimate).
 */
export const matingPosts = pgTable(
  'mating_posts',
  {
    postId: uuid('post_id')
      .primaryKey()
      .references(() => posts.id, { onDelete: 'cascade' }),
    petName: varchar('pet_name', { length: 100 }).notNull(),
    species: speciesTypeEnum('species').notNull(),
    breed: varchar('breed', { length: 100 }).notNull(),
    gender: genderTypeEnum('gender').notNull(), // MALE | FEMALE only — enforced in validator
    ageValue: integer('age_value').notNull(),
    ageUnit: ageUnitEnum('age_unit').notNull(),
    isPurebred: boolean('is_purebred').notNull().default(true),
    hasPedigreeCertificate: boolean('has_pedigree_certificate').notNull().default(false),
    vaccinated: boolean('vaccinated').notNull().default(true),
    dewormed: boolean('dewormed').notNull().default(true),
    /** e.g., "First pick of the litter" / "Free mating" */
    termsSummary: text('terms_summary'),
    /** e.g., "Must be vaccinated; meeting hosted at our home" */
    matingConditions: text('mating_conditions'),
  },
  (table) => ({
    speciesGenderIdx: index('idx_mating_posts_species_gender').on(table.species, table.gender),
  }),
);

export type MatingPostRow = typeof matingPosts.$inferSelect;
export type NewMatingPostRow = typeof matingPosts.$inferInsert;

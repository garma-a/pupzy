import { pgTable, uuid, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { posts } from './posts.schema';
import { users } from './users.schema';

/**
 * `post_saves` — engagement table for saved/bookmarked posts.
 *
 * ## Scope
 * All 4 post types.
 * - RESCUE, LOST, ADOPTION → save = "following this post"
 * - PRODUCT → save acts as a buyer wishlist/bookmark
 *
 * ## Toggle mechanic
 * DELETE = un-save. Composite PK enforces at most one save per user per post.
 *
 * ## Side effects (enforced in service layer, same transaction)
 * On INSERT or DELETE:
 *   1. UPDATE posts SET save_count = save_count ± 1
 *   2. Recompute posts.effective_score
 *   3. SET posts.last_engaged_at = now()
 */
export const postSaves = pgTable(
  'post_saves',
  {
    /** FK → posts. CASCADE on post delete. */
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),

    /** FK → users. CASCADE on user delete. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Timestamp of the save action. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /**
     * Composite PK enforces one save per user per post.
     * Also serves as the primary lookup index.
     */
    pk: primaryKey({ columns: [table.postId, table.userId] }),

    /**
     * Powers the saved posts list — newest saved first.
     * Ordered by createdAt DESC: `SELECT * FROM post_saves WHERE user_id = $1 ORDER BY created_at DESC`
     */
    userCreatedIdx: index('idx_post_saves_user_created').on(table.userId, table.createdAt),
  }),
);

/** TypeScript type for a full `post_saves` row. */
export type PostSave = typeof postSaves.$inferSelect;

/** TypeScript type for inserting a new `post_saves` row. */
export type NewPostSave = typeof postSaves.$inferInsert;

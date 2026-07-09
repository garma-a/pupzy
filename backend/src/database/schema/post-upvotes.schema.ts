import { pgTable, uuid, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { posts } from './posts.schema';
import { users } from './users.schema';

/**
 * `post_upvotes` — engagement table for upvotes.
 *
 * ## Scope
 * RESCUE, LOST, ADOPTION only. Resolver rejects upvotes on PRODUCT.
 * `posts.upvote_count` stays 0 for all PRODUCT rows.
 *
 * ## Toggle mechanic
 * DELETE = un-upvote. There is no separate "remove upvote" row — the
 * composite PK ensures at most one upvote per user per post.
 *
 * ## Side effects (enforced in service layer, same transaction)
 * On INSERT or DELETE:
 *   1. UPDATE posts SET upvote_count = upvote_count ± 1
 *   2. Recompute posts.effective_score using the ADOPTION formula
 *   3. SET posts.last_engaged_at = now()
 */
export const postUpvotes = pgTable(
  'post_upvotes',
  {
    /** FK → posts. CASCADE on post delete. */
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),

    /** FK → users. CASCADE on user delete. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Timestamp of the upvote action. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /**
     * Composite PK enforces one upvote per user per post.
     * Also serves as the primary lookup index.
     */
    pk: primaryKey({ columns: [table.postId, table.userId] }),

    /**
     * Enables fetching all posts a user has upvoted (profile / "my upvotes" list).
     */
    userIdx: index('idx_post_upvotes_user').on(table.userId),
  }),
);

/** TypeScript type for a full `post_upvotes` row. */
export type PostUpvote = typeof postUpvotes.$inferSelect;

/** TypeScript type for inserting a new `post_upvotes` row. */
export type NewPostUpvote = typeof postUpvotes.$inferInsert;

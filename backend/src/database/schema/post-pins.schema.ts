import { sql } from 'drizzle-orm';
import { pgTable, uuid, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { posts } from './posts.schema';
import { comments } from './comments.schema';

/**
 * `post_pins` — highlights exactly one top-level Comment per Post.
 *
 * ## Uniqueness
 * A Post can have at most one pinned comment at the database level.
 *
 * ## Cascade
 * Cascades on post deletion or comment deletion.
 */
export const postPins = pgTable(
  'post_pins',
  {
    /** Unique pin record ID (UUIDv7 for time-ordered generation). */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** The post whose author pinned the comment. Unique per post. */
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),

    /** The pinned comment. */
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),

    /** When the pin was created. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** When the pin was last updated / replaced. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /** Enforces at most one pin per post at the database level. */
    postUnique: uniqueIndex('idx_post_pins_post_id').on(table.postId),

    /** Index for fast lookups of pins by comment ID (e.g. during deletion/moderation). */
    commentIdx: index('idx_post_pins_comment_id').on(table.commentId),
  }),
);

export type PostPin = typeof postPins.$inferSelect;
export type NewPostPin = typeof postPins.$inferInsert;

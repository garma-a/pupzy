import { sql } from 'drizzle-orm';
import { pgTable, uuid, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { comments } from './comments.schema';

/**
 * `comment_boosts` — engagement table for boosts on comments and replies.
 *
 * ## Uniqueness
 * A user can have at most one boost per comment or reply.
 *
 * ## Cascade
 * Cascades on user deletion or comment deletion.
 */
export const commentBoosts = pgTable(
  'comment_boosts',
  {
    /** Unique boost record ID (UUIDv7 for time-ordered generation). */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** User who boosted the comment or reply. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Target comment or reply. */
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),

    /** Timestamp of the boost action. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /** Enforces at most one boost relationship per user per comment/reply. */
    userCommentUnique: unique('uq_comment_boosts_user_comment').on(table.userId, table.commentId),

    /** Index for fast lookups of all boosts for a comment. */
    commentIdx: index('idx_comment_boosts_comment_id').on(table.commentId),
  }),
);

export type CommentBoost = typeof commentBoosts.$inferSelect;
export type NewCommentBoost = typeof commentBoosts.$inferInsert;

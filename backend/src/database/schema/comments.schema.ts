import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, index, foreignKey } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { posts } from './posts.schema';
import { commentStatusEnum } from './enums';

/**
 * `comments` table — stores user-created discussion contributions on posts.
 *
 * ## Hierarchy
 * - Top-level comment: `parent_id` is null.
 * - Reply: `parent_id` references a top-level comment (introduced in subsequent tickets).
 *
 * ## Visibility
 * Active comments are returned in discussion queries.
 * Removed or hidden comments are excluded from public reads.
 */
export const comments = pgTable(
  'comments',
  {
    /** Unique comment ID (UUIDv7 for time-ordered generation). */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** Target post ID. Cascades on post deletion. */
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),

    /** Comment author ID. Cascades on user deletion. */
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Null for top-level comments; references parent comment for replies. */
    parentId: uuid('parent_id'),

    /** Trimmed plain text content (1..1000 unicode characters for top-level). */
    text: text('text').notNull(),

    /** Lifecycle and moderation state. */
    status: commentStatusEnum('status').notNull().default('ACTIVE'),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Row update timestamp. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    postStatusCreatedIdx: index('idx_comments_post_status_created').on(
      table.postId,
      table.status,
      table.createdAt,
      table.id,
    ),
    authorCreatedIdx: index('idx_comments_author_created').on(table.authorId, table.createdAt),
    parentIdx: index('idx_comments_parent_id').on(table.parentId),
    parentFk: foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'comments_parent_id_comments_id_fk',
    }).onDelete('cascade'),
  }),
);

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;

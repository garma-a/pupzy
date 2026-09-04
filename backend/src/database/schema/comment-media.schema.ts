import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, index, timestamp } from 'drizzle-orm/pg-core';
import { comments } from './comments.schema';

/**
 * `comment_media` table — images attached to top-level comments.
 *
 * ## Constraints
 * - 1:1 in Ticket 06 (max 1 image per top-level comment).
 * - CASCADE deletes when the parent comment is deleted.
 * - Stores immutable R2 storage key rather than public URL.
 * - Indexed SHA-256 digest for exact-match deduplication and moderation.
 */
export const commentMedia = pgTable(
  'comment_media',
  {
    /** Internal media ID (UUIDv7 for time-ordered generation). */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** FK -> comments. Cascades on comment deletion. */
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),

    /** Immutable object key inside the R2 bucket, e.g. `comments/{commentId}/{mediaId}.webp`. */
    storageKey: text('storage_key').notNull(),

    /** SHA-256 digest of verified image bytes for exact-match moderation. */
    sha256: text('sha256').notNull(),

    /** Pixel width (at most 480). */
    width: integer('width').notNull(),

    /** Pixel height (at most 480). */
    height: integer('height').notNull(),

    /** Exact file size in bytes (at most 100,000). */
    fileSizeBytes: integer('file_size_bytes').notNull(),

    /** Verified MIME type ('image/webp'). */
    fileContentType: text('file_content_type').notNull().default('image/webp'),

    /** Render order. 0 = primary image. */
    displayOrder: integer('display_order').notNull().default(0),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Row update timestamp. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    commentIdIdx: index('idx_comment_media_comment_id').on(table.commentId),
    sha256Idx: index('idx_comment_media_sha256').on(table.sha256),
    commentDisplayOrderIdx: index('idx_comment_media_comment_display_order').on(table.commentId, table.displayOrder),
  }),
);

export type CommentMedia = typeof commentMedia.$inferSelect;
export type NewCommentMedia = typeof commentMedia.$inferInsert;

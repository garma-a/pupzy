import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, varchar, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { timestamp } from 'drizzle-orm/pg-core';
import { posts } from './posts.schema';

/**
 * `post_media` table — images attached to a post.
 *
 * ## Relationship
 * 1:many with posts. Up to 4 images enforced in the service layer.
 * Cascade deleted when the parent post is deleted.
 *
 * ## Upload flow
 * 1. Flutter calls `requestUploadUrl` — backend generates a presigned R2 PUT URL.
 *    No database write at this stage.
 * 2. Flutter uploads bytes directly to Cloudflare R2 via HTTP PUT.
 *    The NestJS backend never handles the raw bytes.
 * 3. Flutter calls `createPost` with the resulting public CDN URLs.
 * 4. Service inserts `posts` + extension table + `post_media` in one transaction.
 *
 * ## Deletion flow
 * When a post is deleted (soft or hard), the service reads `cloudflare_storage_key`
 * from every `post_media` row and calls the R2 delete API for each key before
 * (or after) removing the DB rows.
 */
export const postMedia = pgTable(
  'post_media',
  {
    /** Internal media ID. Primary key, UUIDv4. */
    id: uuid('id').primaryKey().default(sql`uuidv7()`),

    /**
     * FK → posts. CASCADE ensures media rows are cleaned up when a post is deleted.
     * The service still handles R2 object deletion separately.
     */
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),

    /**
     * Public CDN URL served by Cloudflare R2.
     * This is what Flutter renders in <Image> widgets.
     */
    publicUrl: text('public_url').notNull(),

    /**
     * Object key inside the R2 bucket, e.g. `posts/{postId}/{uuid}.webp`.
     * Stored so the post-removal flow can call the R2 delete API.
     * UNIQUE because each object occupies exactly one row.
     */
    cloudflareStorageKey: text('cloudflare_storage_key').notNull().unique(),

    /**
     * Render order. 0 = primary thumbnail shown on feed cards.
     * Subsequent images shown in the detail-screen gallery.
     * Max 4 images enforced by service layer, not a DB constraint.
     */
    displayOrder: integer('display_order').notNull().default(0),

    /** MIME type of the uploaded file, e.g. 'image/webp'. */
    fileContentType: varchar('file_content_type', { length: 100 }),

    /** File size in bytes. Used for storage quota checks. */
    fileSizeBytes: integer('file_size_bytes'),

    /**
     * Pixel width. Sent from Flutter before upload so the client can
     * pre-allocate the placeholder size before the image loads.
     */
    width: integer('width'),

    /**
     * Pixel height. Same purpose as `width`.
     */
    height: integer('height'),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /** Orders images within a post — used to fetch them in display_order ASC. */
    postDisplayOrderIdx: index('idx_post_media_post_display_order').on(
      table.postId,
      table.displayOrder,
    ),

    /** Enforces R2 object key uniqueness. */
    cloudflareKeyUniq: uniqueIndex('uq_post_media_cloudflare_storage_key').on(
      table.cloudflareStorageKey,
    ),
  }),
);

/** TypeScript type for a full `post_media` row. */
export type PostMedia = typeof postMedia.$inferSelect;

/** TypeScript type for inserting a new `post_media` row. */
export type NewPostMedia = typeof postMedia.$inferInsert;

import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, varchar, index, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { posts } from './posts.schema';
import { stagedUploadPurposeEnum, stagedUploadStatusEnum } from './enums';

/**
 * `staged_uploads` table — durable authority for owner-bound, purpose-bound,
 * expiring, single-use media upload tickets.
 *
 * ## Lifecycle
 * 1. ISSUED: Ticket created via `requestMediaUploadUrl` (or future comment upload).
 *    Owner, purpose, staging key, declared metadata, and expiry recorded.
 * 2. CLAIMED: Atomically claimed by post (or comment) creation to prevent concurrent reuse.
 * 3. FINALIZED: Media verified and copied to permanent R2 location.
 * 4. FAILED: Upload expired, object missing, or finalization failed.
 *
 * PostgreSQL is the source of truth; process-local cache is optional acceleration.
 */
export const stagedUploads = pgTable(
  'staged_uploads',
  {
    /** Internal media ticket ID. Primary key, UUIDv7. */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** Owner of the upload ticket. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Purpose of the staged upload ('POST_MEDIA' | 'COMMENT_IMAGE'). */
    purpose: stagedUploadPurposeEnum('purpose').notNull().default('POST_MEDIA'),

    /** Opaque R2 staging object key, e.g. `staging/{userId}/{mediaId}.webp`. */
    stagingKey: text('staging_key').notNull().unique(),

    /** MIME type declared by client, e.g. 'image/webp'. */
    declaredContentType: varchar('declared_content_type', { length: 100 }).notNull(),

    /** File size in bytes declared by client. */
    declaredFileSizeBytes: integer('declared_file_size_bytes').notNull(),

    /** Current lifecycle state ('ISSUED' | 'CLAIMED' | 'FINALIZED' | 'FAILED'). */
    status: stagedUploadStatusEnum('status').notNull().default('ISSUED'),

    /** Ticket expiration timestamp. After this, ticket cannot be claimed. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    /** ID of the post consuming this staged upload (set upon claim). */
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'set null' }),

    /** Final R2 object key after successful finalization, e.g. `posts/{postId}/{mediaId}.webp`. */
    finalStorageKey: text('final_storage_key'),

    /** Error message if finalization failed. */
    errorMessage: text('error_message'),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Last update timestamp. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdPurposeIdx: index('idx_staged_uploads_user_purpose').on(table.userId, table.purpose),
    statusExpiresAtIdx: index('idx_staged_uploads_status_expires_at').on(table.status, table.expiresAt),
  }),
);

export type StagedUpload = typeof stagedUploads.$inferSelect;
export type NewStagedUpload = typeof stagedUploads.$inferInsert;

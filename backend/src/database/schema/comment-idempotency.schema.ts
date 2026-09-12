import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, jsonb, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { comments } from './comments.schema';

/**
 * `comment_idempotency` table — durable author-scoped client request ID tracking.
 *
 * ## Guarantee
 * - Identical retry with same clientRequestId + same canonical payload: returns original result.
 * - Conflicting retry with same clientRequestId + different payload: throws ConflictError.
 * - Survives API process restarts and redeployments.
 */
export const commentIdempotency = pgTable(
  'comment_idempotency',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** Scoped to the authenticated author. */
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Client-provided request identifier. */
    clientRequestId: varchar('client_request_id', { length: 255 }).notNull(),

    /** SHA-256 fingerprint of the canonical request parameters (e.g. postId + text). */
    requestHash: varchar('request_hash', { length: 64 }).notNull(),

    /** Reference to the created comment. Cascades if comment is purged. */
    commentId: uuid('comment_id').references(() => comments.id, { onDelete: 'cascade' }),

    /** Stored canonical JSON response for immediate replay. */
    responsePayload: jsonb('response_payload').notNull(),

    /** Creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    authorClientReqUnique: unique('uq_comment_idempotency_author_client_req').on(table.authorId, table.clientRequestId),
    createdAtIdx: index('idx_comment_idempotency_created_at').on(table.createdAt),
  }),
);

export type CommentIdempotency = typeof commentIdempotency.$inferSelect;
export type NewCommentIdempotency = typeof commentIdempotency.$inferInsert;

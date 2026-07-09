import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { posts } from './posts.schema';
import { users } from './users.schema';
import { requestStatusEnum } from './enums';

/**
 * `contact_requests` — WhatsApp unlock gate for RESCUE, LOST, ADOPTION.
 *
 * ## Scope
 * RESCUE, LOST, ADOPTION only.
 * PRODUCT exposes the seller's phone number directly on the detail screen
 * (no approval gate required for classifieds).
 *
 * ## Flow
 * 1. Requester submits `requestContact` mutation (inserts this row as PENDING).
 * 2. Owner receives `CONTACT_REQUEST_RECEIVED` notification.
 * 3. Owner runs `approveContactRequest` mutation (sets status = APPROVED).
 * 4. Resolver decrypts owner's `phone_number` from users table.
 * 5. Resolver builds `wa.me/{decryptedPhone}` link at query time — NOT stored.
 * 6. Flutter opens WhatsApp via `url_launcher`.
 *
 * ## One request per user per post
 * The unique constraint `uq_contact_request` prevents a rejected requester from
 * re-applying by spamming new requests.
 */
export const contactRequests = pgTable(
  'contact_requests',
  {
    /** Internal request ID. Primary key, UUIDv4. */
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * FK → posts. CASCADE on post delete.
     * Only RESCUE, LOST, ADOPTION posts accepted — enforced in resolver.
     */
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),

    /** FK → users (the person requesting contact). CASCADE on user delete. */
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Message from the requester to the post owner.
     * Context for why they want to connect — helps owner decide.
     */
    message: text('message').notNull(),

    /**
     * Lifecycle of the request.
     * PENDING → waiting for owner response.
     * APPROVED → wa.me link unlocked for requester.
     * REJECTED → requester cannot re-apply (unique constraint prevents it).
     */
    status: requestStatusEnum('status').notNull().default('PENDING'),

    /** Timestamp when the owner approved or rejected the request. */
    respondedAt: timestamp('responded_at', { withTimezone: true }),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /**
     * One request per user per post.
     * Prevents a rejected user from spamming new requests.
     */
    uniqueRequest: uniqueIndex('uq_contact_request').on(table.postId, table.requesterId),

    /** Used by "my contact requests sent" list. */
    requesterIdx: index('idx_contact_requests_requester').on(table.requesterId),

    /** Used by owner to see pending/approved requests on their post. */
    postStatusIdx: index('idx_contact_requests_post_status').on(
      table.postId,
      table.status,
    ),
  }),
);

/** TypeScript type for a full `contact_requests` row. */
export type ContactRequest = typeof contactRequests.$inferSelect;

/** TypeScript type for inserting a new `contact_requests` row. */
export type NewContactRequest = typeof contactRequests.$inferInsert;

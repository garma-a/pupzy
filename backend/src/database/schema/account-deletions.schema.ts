import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, integer, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { accountDeletionStatusEnum, accountDeletionStepEnum } from './enums';

/**
 * `account_deletions` table — durable record of account deletion requests and cleanup progress.
 *
 * ## Lifecycle
 * 1. User confirms deletion -> status=PENDING, step=ACCEPTED.
 * 2. Access blocked immediately; profile and content hidden.
 * 3. Stepwise cleanup progresses:
 *    - POSTS_DELETED: Owned posts and dependent data removed.
 *    - DATA_CLEANED: Interactions, notifications redacted, user row removed.
 *    - STORAGE_CLEANED: Permanent photos and staged uploads erased from R2.
 *    - FIREBASE_USER_DELETED: User removed from Firebase Authentication.
 *    - COMPLETED: All cleanup obligations verified finished.
 *
 * ## Bounded retention & purge
 * `purge_at` is set (e.g. 30 days post-completion) to clean up security audit state
 * without keeping identifiable user data permanently.
 */
export const accountDeletions = pgTable(
  'account_deletions',
  {
    /** Unique deletion request ID (UUIDv7). */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),

    /** Original Pupzy user ID. Retained for correlation during cleanup. */
    userId: uuid('user_id').notNull(),

    /**
     * Firebase UID of the deleted identity.
     * Used by FirebaseAuthGuard to immediately reject stale tokens.
     */
    firebaseUserId: varchar('firebase_user_id', { length: 128 }).notNull(),

    /** User's email at the time of deletion. */
    email: varchar('email', { length: 255 }).notNull(),

    /** Current overall lifecycle status of the deletion request. */
    status: accountDeletionStatusEnum('status').notNull().default('PENDING'),

    /** Granular step reached in cleanup execution. */
    step: accountDeletionStepEnum('step').notNull().default('ACCEPTED'),

    /** SHA-256 hash of the progress token used for unauthenticated status polling. */
    progressTokenHash: varchar('progress_token_hash', { length: 128 }).notNull(),

    /**
     * Captured storage targets: permanent R2 keys and staged upload prefixes.
     * Persisted before database rows are erased.
     */
    mediaCleanupScope: jsonb('media_cleanup_scope'),

    /** Number of retry attempts made for storage deletion. */
    storageCleanupAttempts: integer('storage_cleanup_attempts').notNull().default(0),

    /** Number of retry attempts made for Firebase Auth user deletion. */
    firebaseCleanupAttempts: integer('firebase_cleanup_attempts').notNull().default(0),

    /** Last error message encountered during retryable cleanup. */
    lastError: text('last_error'),

    /** Earliest timestamp when retry should be attempted (for backoff). */
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),

    /** Grace window for late uploads arriving via pre-signed URLs (10 min). */
    stagedUploadGraceUntil: timestamp('staged_upload_grace_until', { withTimezone: true }),

    /** Timestamp when deletion was accepted and access blocked. */
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),

    /** Timestamp when all cleanup steps successfully concluded. */
    completedAt: timestamp('completed_at', { withTimezone: true }),

    /** Timestamp when this audit/blocking record should be purged. */
    purgeAt: timestamp('purge_at', { withTimezone: true }),

    /** Row creation timestamp. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Row update timestamp. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    firebaseUserIdx: uniqueIndex('idx_account_deletions_firebase_user').on(table.firebaseUserId),
    userIdx: index('idx_account_deletions_user_id').on(table.userId),
    statusRetryIdx: index('idx_account_deletions_status_retry').on(table.status, table.nextRetryAt),
    purgeIdx: index('idx_account_deletions_purge').on(table.purgeAt),
  }),
);

export type AccountDeletion = typeof accountDeletions.$inferSelect;
export type NewAccountDeletion = typeof accountDeletions.$inferInsert;

/**
 * Centralized predicate: returns true if the given account deletion status
 * represents an account whose access and profile recreation must be blocked.
 * Covers PENDING, COMPLETED, and FAILED (so that prolonged external outages
 * never allow stale sessions to recreate or access the account).
 */
export function isAccountDeletionBlockedStatus(status?: string | null): boolean {
  if (!status) return false;
  return status === 'PENDING' || status === 'COMPLETED' || status === 'FAILED';
}

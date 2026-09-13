import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { eq, and, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import { FIREBASE_ADMIN_TOKEN } from '../auth/firebase.module';
import {
  users,
  posts,
  postMedia,
  postSaves,
  postUpvotes,
  postReports,
  notifications,
  savedSearches,
  contactRequests,
  adoptionApplications,
  rescuePosts,
  lostPosts,
  adoptionPosts,
  productPosts,
  matingPosts,
  moderationActions,
  accountDeletions,
  isAccountDeletionBlockedStatus,
  type User,
  type AccountDeletion,
} from '../database/schema';
import { AccountDeletionRepository } from './account-deletion.repository';
import { UsersRepository } from './users.repository';
import { UploadService } from '../upload/upload.service';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { ForbiddenError, NotFoundError } from '../common/errors/app.errors';

export interface AccountDeletionPayload {
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  deletionId: string;
  progressToken?: string | null;
  message: string;
  acceptedAt: Date;
  completedAt?: Date | null;
}

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);
  private readonly activeCleanups = new Set<string>();

  constructor(
    private readonly accountDeletionRepository: AccountDeletionRepository,
    private readonly usersRepository: UsersRepository,
    private readonly uploadService: UploadService,
    private readonly config: ConfigService,
    @Inject(FIREBASE_ADMIN_TOKEN) private readonly firebaseApp: App,
    @Inject(DATABASE_TOKEN) private readonly db: NodePgDatabase<Record<string, unknown>>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * Initiates the account deletion process for the currently authenticated user.
   *
   * ## Requirements enforced:
   * 1. Target identity is derived solely from verified authentication (user).
   * 2. Server-side verification that authentication occurred within the preceding 5 minutes.
   * 3. Durable acceptance record created before destructive changes.
   * 4. Immediate blocking of account access and content visibility.
   * 5. Idempotent: safe to repeat on network retry.
   */
  async initiateDeletion(
    user: User,
    authTime: number | undefined,
    customProgressToken?: string,
  ): Promise<AccountDeletionPayload> {
    const isEnabled = this.config.get<boolean>('ACCOUNT_DELETION_ENABLED', false);
    if (!isEnabled) {
      throw new ForbiddenError('ACCOUNT_DELETION_DISABLED');
    }

    // 1. Verify recent authentication (within 5 minutes = 300 seconds)
    if (!authTime || typeof authTime !== 'number') {
      throw new ForbiddenError('RECENT_AUTHENTICATION_REQUIRED');
    }
    const currentEpochSeconds = Math.floor(Date.now() / 1000);
    // Disallow future auth times (with 30s tolerance for slight clock skew)
    if (authTime > currentEpochSeconds + 30) {
      throw new ForbiddenError('INVALID_AUTHENTICATION_TIME');
    }
    if (currentEpochSeconds - authTime > 300) {
      throw new ForbiddenError('RECENT_AUTHENTICATION_REQUIRED');
    }

    // 2. Check idempotency: does an active deletion record already exist for this Firebase UID?
    const existing = await this.accountDeletionRepository.findByFirebaseUserId(user.firebaseUserId);
    if (existing) {
      this.logger.log(`Duplicate deletion request for Firebase UID ${user.firebaseUserId}, returning existing status.`);
      return {
        status: existing.status,
        deletionId: existing.id,
        progressToken: customProgressToken ?? null,
        message:
          existing.status === 'COMPLETED'
            ? 'Your account and all associated data have been permanently deleted.'
            : 'Account deletion has been accepted and cleanup is in progress.',
        acceptedAt: existing.acceptedAt,
        completedAt: existing.completedAt,
      };
    }

    // 3. Generate or use credentials for unauthenticated progress tracking
    const deletionId = generateUuidV7();
    const progressToken =
      customProgressToken && customProgressToken.length >= 16
        ? customProgressToken
        : crypto.randomBytes(32).toString('hex');
    const progressTokenHash = crypto.createHash('sha256').update(progressToken).digest('hex');

    // 4. Check for outstanding presigned upload URLs (10-minute validity window)
    const lastUploadGrace = await this.uploadService.getLastUploadGraceUntil(user.id);

    // 5. Durably persist acceptance in PostgreSQL and immediately hide content across the platform
    const deletionRecord = await this.db.transaction(async (tx) => {
      // Lock user row FOR UPDATE to serialize with any concurrent upload issuance or post creation
      const [lockedUser] = await tx.select().from(users).where(eq(users.id, user.id)).for('update');

      const dbGrace = lockedUser?.uploadGraceUntil ?? null;
      let effectiveGraceUntil = dbGrace && dbGrace.getTime() > Date.now() ? dbGrace : null;
      if (lastUploadGrace && lastUploadGrace.getTime() > Date.now()) {
        if (!effectiveGraceUntil || lastUploadGrace.getTime() > effectiveGraceUntil.getTime()) {
          effectiveGraceUntil = lastUploadGrace;
        }
      }

      // Immediately hide all user posts across feeds and search
      await tx.update(posts).set({ status: 'REMOVED' }).where(eq(posts.creatorId, user.id));

      // Mark user banned immediately to ensure zero-window access block
      await tx.update(users).set({ isBanned: true, banReason: 'ACCOUNT_DELETED' }).where(eq(users.id, user.id));

      const record = await this.accountDeletionRepository.create(
        {
          id: deletionId,
          userId: user.id,
          firebaseUserId: user.firebaseUserId,
          email: user.email,
          status: 'PENDING',
          step: 'ACCEPTED',
          progressTokenHash,
          stagedUploadGraceUntil: effectiveGraceUntil,
          acceptedAt: new Date(),
          purgeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days retention
        },
        tx,
      );

      return record;
    });

    // 6. Invalidate warm caches immediately
    await this.invalidateUserCaches(user.id, user.firebaseUserId);

    // 7. Execute cleanup
    try {
      await this.executeCleanup(deletionRecord, user);
      const updated = await this.accountDeletionRepository.findById(deletionId);
      return {
        status: updated?.status ?? 'PENDING',
        deletionId,
        progressToken,
        message:
          updated?.status === 'COMPLETED'
            ? 'Your account and all associated data have been permanently deleted.'
            : 'Account deletion has been accepted and cleanup is in progress.',
        acceptedAt: deletionRecord.acceptedAt,
        completedAt: updated?.completedAt ?? null,
      };
    } catch (err) {
      this.logger.error(
        `Error during account deletion execution for user ${user.id}: ${err instanceof Error ? err.stack : String(err)}`,
      );
      // Even if background execution encountered a transient failure, the request was accepted durably.
      await this.accountDeletionRepository.update(deletionId, {
        lastError: err instanceof Error ? err.message : String(err),
        nextRetryAt: new Date(Date.now() + 10_000),
      });

      return {
        status: 'PENDING',
        deletionId,
        progressToken,
        message: 'Account deletion has been accepted and cleanup is in progress.',
        acceptedAt: deletionRecord.acceptedAt,
        completedAt: null,
      };
    }
  }

  /**
   * Executes the full cleanup sequence across database, storage, and Firebase Auth.
   * Designed to be idempotent and safe to resume from any step.
   */
  async executeCleanup(deletionRecord: AccountDeletion, userHint?: User): Promise<void> {
    if (this.activeCleanups.has(deletionRecord.id)) {
      this.logger.log(`Cleanup already in progress for deletion ${deletionRecord.id}, skipping duplicate execution.`);
      return;
    }
    this.activeCleanups.add(deletionRecord.id);

    try {
      const userId = deletionRecord.userId;
      const firebaseUserId = deletionRecord.firebaseUserId;

      // ── STEP 1: Database and Community Cleanup ────────────────────────────────
      if (deletionRecord.step === 'ACCEPTED') {
        await this.cleanupDatabaseData(deletionRecord, userHint);
      }

      // ── STEP 2: Storage Cleanup (R2 permanent photos + staged uploads) ─────────
      if (deletionRecord.step === 'POSTS_DELETED' || deletionRecord.step === 'DATA_CLEANED') {
        // Reload fresh record from database to prevent acting on stale in-memory state
        const fresh = await this.accountDeletionRepository.findById(deletionRecord.id);
        if (!fresh || fresh.status === 'COMPLETED') return;
        deletionRecord.step = fresh.step;
        deletionRecord.mediaCleanupScope = fresh.mediaCleanupScope;
        deletionRecord.stagedUploadGraceUntil = fresh.stagedUploadGraceUntil;

        // 1. Check if staged upload grace window is still active.
        // Defer storage cleanup until all issued upload URLs expire.
        // Crucially: DO NOT delete or discard permanent media keys before grace expires,
        // so any in-flight asynchronous finalization cannot recreate permanent objects undetected.
        if (deletionRecord.stagedUploadGraceUntil && deletionRecord.stagedUploadGraceUntil.getTime() > Date.now()) {
          this.logger.log(
            `Staged upload grace window active until ${deletionRecord.stagedUploadGraceUntil.toISOString()} for deletion ${deletionRecord.id}. Deferring storage cleanup.`,
          );
          await this.accountDeletionRepository.update(deletionRecord.id, {
            nextRetryAt: deletionRecord.stagedUploadGraceUntil,
          });
          return; // Do not delete permanent keys or advance to STORAGE_CLEANED yet!
        }

        // 2. Grace period has passed or was null: safe to delete permanent media keys and staged prefix!
        const scope = deletionRecord.mediaCleanupScope as { mediaKeys?: string[]; stagedPrefix?: string } | null;
        if (scope?.mediaKeys && scope.mediaKeys.length > 0) {
          await this.uploadService.deleteObjects(scope.mediaKeys);
        }

        const stagedPrefix = scope?.stagedPrefix ?? `staging/${deletionRecord.userId}/`;
        await this.uploadService.deletePrefix(stagedPrefix);

        await this.accountDeletionRepository.update(deletionRecord.id, {
          step: 'STORAGE_CLEANED',
        });
        deletionRecord.step = 'STORAGE_CLEANED';
      }

      // ── STEP 3: Firebase Auth User Deletion ───────────────────────────────────
      if (deletionRecord.step === 'STORAGE_CLEANED') {
        await this.cleanupFirebaseAuth(firebaseUserId);
        await this.accountDeletionRepository.update(deletionRecord.id, {
          step: 'FIREBASE_USER_DELETED',
        });
        deletionRecord.step = 'FIREBASE_USER_DELETED';
      }

      // ── STEP 4: Completion ────────────────────────────────────────────────────
      if (deletionRecord.step === 'FIREBASE_USER_DELETED') {
        await this.accountDeletionRepository.update(deletionRecord.id, {
          status: 'COMPLETED',
          step: 'COMPLETED',
          completedAt: new Date(),
          mediaCleanupScope: null, // Purge storage keys after successful cleanup
        });
        this.logger.log(`Account deletion fully completed for user ${userId} (Firebase UID: ${firebaseUserId})`);
      }
    } finally {
      this.activeCleanups.delete(deletionRecord.id);
    }
  }

  /**
   * Cleans all database data in an isolated transaction:
   * - Captures permanent and staged media keys into account_deletions before deletion
   * - Reconciles saves, upvotes, and reports on other users' surviving posts
   * - Removes dependent applications, contact requests, saved searches
   * - Redacts surviving notifications and moderation records
   * - Permanently removes owned posts (all types, including unresolved rescue/lost)
   * - Deletes the user row from `users`
   */
  private async cleanupDatabaseData(deletionRecord: AccountDeletion, userHint?: User): Promise<void> {
    const userId = deletionRecord.userId;
    const user = userHint ?? (await this.usersRepository.findById(userId));

    await this.db.transaction(async (tx) => {
      // 0. Lock the deletion row FOR UPDATE to serialize with any concurrent worker or cron
      const [currentDeletionRow] = await tx
        .select()
        .from(accountDeletions)
        .where(eq(accountDeletions.id, deletionRecord.id))
        .for('update');

      const currentDeletion = currentDeletionRow ?? deletionRecord;

      // If database cleanup was already completed by a concurrent worker, do not repeat or overwrite!
      if (currentDeletion.step !== 'ACCEPTED') {
        deletionRecord.step = currentDeletion.step;
        deletionRecord.mediaCleanupScope = currentDeletion.mediaCleanupScope;
        return;
      }

      // Lock the user row if it exists
      await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`).catch(() => {});

      // 1. Fetch all posts owned by this user
      const userPosts = await tx.select({ id: posts.id }).from(posts).where(eq(posts.creatorId, userId));

      const userPostIds = userPosts.map((p) => p.id);

      // 2. Capture media keys before deleting database rows (preserving any keys captured on earlier attempt)
      const existingScope = currentDeletion.mediaCleanupScope as {
        mediaKeys?: string[];
        stagedPrefix?: string;
      } | null;
      let mediaKeys: string[] = [];
      if (existingScope?.mediaKeys && existingScope.mediaKeys.length > 0) {
        mediaKeys = [...existingScope.mediaKeys];
      } else if (userPostIds.length > 0) {
        const mediaRows = await tx
          .select({ key: postMedia.cloudflareStorageKey })
          .from(postMedia)
          .where(inArray(postMedia.postId, userPostIds));
        for (const m of mediaRows) {
          if (m.key) mediaKeys.push(m.key);
        }
      }

      // Persist captured media scope and checkpoint step: 'DATA_CLEANED' atomically in the SAME transaction
      const cleanupScope = {
        mediaKeys,
        stagedPrefix: existingScope?.stagedPrefix ?? `staging/${userId}/`,
      };
      await tx
        .update(accountDeletions)
        .set({
          mediaCleanupScope: cleanupScope,
          step: 'DATA_CLEANED',
        })
        .where(eq(accountDeletions.id, deletionRecord.id));

      deletionRecord.mediaCleanupScope = cleanupScope;
      deletionRecord.step = 'DATA_CLEANED';

      // 3. Reconcile upvotes on OTHER users' surviving posts
      const upvotes = await tx
        .select({ postId: postUpvotes.postId })
        .from(postUpvotes)
        .where(eq(postUpvotes.userId, userId));

      for (const upvote of upvotes) {
        if (!userPostIds.includes(upvote.postId)) {
          await tx
            .update(posts)
            .set({
              upvoteCount: sql`GREATEST(0, ${posts.upvoteCount} - 1)`,
              effectiveScore: sql`
                CASE WHEN ${posts.postType} = 'ADOPTION' THEN
                  GREATEST(0.0, (GREATEST(0, ${posts.upvoteCount} - 1) * 3 + ${posts.saveCount} * 2 + ${posts.viewCount} * 0.1 + 1)
                  / POWER(EXTRACT(EPOCH FROM (now() - ${posts.createdAt})) / 3600.0 + 2, 1.5))
                ELSE ${posts.effectiveScore}
                END
              `,
            })
            .where(eq(posts.id, upvote.postId));
        }
      }
      await tx.delete(postUpvotes).where(eq(postUpvotes.userId, userId));

      // 4. Reconcile saves on OTHER users' surviving posts
      const saves = await tx.select({ postId: postSaves.postId }).from(postSaves).where(eq(postSaves.userId, userId));

      for (const save of saves) {
        if (!userPostIds.includes(save.postId)) {
          await tx
            .update(posts)
            .set({
              saveCount: sql`GREATEST(0, ${posts.saveCount} - 1)`,
              effectiveScore: sql`
                CASE
                  WHEN ${posts.postType} = 'ADOPTION' THEN
                    GREATEST(0.0, (${posts.upvoteCount} * 3 + GREATEST(0, ${posts.saveCount} - 1) * 2 + ${posts.viewCount} * 0.1 + 1)
                    / POWER(EXTRACT(EPOCH FROM (now() - ${posts.createdAt})) / 3600.0 + 2, 1.5))
                  WHEN ${posts.postType} = 'PRODUCT' THEN
                    GREATEST(0.0, (${posts.viewCount} * 1 + GREATEST(0, ${posts.saveCount} - 1) * 5 + 1)
                    / POWER(EXTRACT(EPOCH FROM (now() - ${posts.createdAt})) / 3600.0 + 2, 1.5))
                  ELSE ${posts.effectiveScore}
                END
              `,
            })
            .where(eq(posts.id, save.postId));
        }
      }
      await tx.delete(postSaves).where(eq(postSaves.userId, userId));

      // 5. Reconcile reports submitted by this user
      const reports = await tx
        .select({ postId: postReports.postId })
        .from(postReports)
        .where(eq(postReports.reporterId, userId));

      for (const report of reports) {
        if (!userPostIds.includes(report.postId)) {
          await tx
            .update(posts)
            .set({
              reportCount: sql`GREATEST(0, ${posts.reportCount} - 1)`,
            })
            .where(eq(posts.id, report.postId));
        }
      }
      await tx.delete(postReports).where(eq(postReports.reporterId, userId));

      // 6. Delete applications & contact requests
      await tx.delete(savedSearches).where(eq(savedSearches.userId, userId));
      await tx.delete(adoptionApplications).where(eq(adoptionApplications.applicantId, userId));
      await tx.delete(contactRequests).where(eq(contactRequests.requesterId, userId));

      if (userPostIds.length > 0) {
        await tx.delete(adoptionApplications).where(inArray(adoptionApplications.targetPostId, userPostIds));
        await tx.delete(contactRequests).where(inArray(contactRequests.postId, userPostIds));
      }

      // 7. Redact surviving notifications & moderation metadata
      await tx.delete(notifications).where(eq(notifications.recipientId, userId));

      if (user) {
        // Redact user's name from surviving notifications received by others
        if (user.fullName && user.fullName.trim().length > 0) {
          await tx.execute(sql`
            UPDATE "notifications"
            SET
              "title" = REPLACE("title", ${user.fullName}, 'Someone'),
              "body" = REPLACE("body", ${user.fullName}, 'Someone')
            WHERE "title" LIKE ${'%' + user.fullName + '%'} OR "body" LIKE ${'%' + user.fullName + '%'};
          `);
        }
        if (user.fullNameArabic && user.fullNameArabic.trim().length > 0) {
          await tx.execute(sql`
            UPDATE "notifications"
            SET
              "title" = REPLACE("title", ${user.fullNameArabic}, 'مستخدم'),
              "body" = REPLACE("body", ${user.fullNameArabic}, 'مستخدم')
            WHERE "title" LIKE ${'%' + user.fullNameArabic + '%'} OR "body" LIKE ${'%' + user.fullNameArabic + '%'};
          `);
        }
        if (user.email && user.email.trim().length > 0) {
          await tx.execute(sql`
            UPDATE "notifications"
            SET
              "body" = REPLACE("body", ${user.email}, '[deleted]')
            WHERE "body" LIKE ${'%' + user.email + '%'};
          `);
        }
        if (user.phoneNumber && user.phoneNumber.trim().length > 0) {
          await tx.execute(sql`
            UPDATE "notifications"
            SET
              "body" = REPLACE("body", ${user.phoneNumber}, '[deleted]')
            WHERE "body" LIKE ${'%' + user.phoneNumber + '%'};
          `);
        }
      }

      // Redact moderation actions targeting this user or their posts
      await tx
        .update(moderationActions)
        .set({
          reason: 'Redacted (account deleted)',
          metadata: null,
        })
        .where(and(eq(moderationActions.targetType, 'USER'), eq(moderationActions.targetId, userId)));

      if (userPostIds.length > 0) {
        await tx
          .update(moderationActions)
          .set({
            reason: 'Redacted (account deleted)',
            metadata: null,
          })
          .where(and(eq(moderationActions.targetType, 'POST'), inArray(moderationActions.targetId, userPostIds)));
      }

      // 8. Permanently remove all owned posts and their extension rows
      if (userPostIds.length > 0) {
        await tx.delete(postMedia).where(inArray(postMedia.postId, userPostIds));
        await tx.delete(rescuePosts).where(inArray(rescuePosts.postId, userPostIds));
        await tx.delete(lostPosts).where(inArray(lostPosts.postId, userPostIds));
        await tx.delete(adoptionPosts).where(inArray(adoptionPosts.postId, userPostIds));
        await tx.delete(productPosts).where(inArray(productPosts.postId, userPostIds));
        await tx.delete(matingPosts).where(inArray(matingPosts.postId, userPostIds));
        await tx.delete(postReports).where(inArray(postReports.postId, userPostIds));
        await tx.delete(posts).where(inArray(posts.id, userPostIds));
      }

      // 9. Delete user row from `users` table
      await tx.delete(users).where(eq(users.id, userId));
    });
  }

  /**
   * Deletes permanent R2 media objects and staged upload prefixes.
   */
  private async cleanupStorageData(deletionRecord: AccountDeletion): Promise<void> {
    const scope = deletionRecord.mediaCleanupScope as { mediaKeys?: string[]; stagedPrefix?: string } | null;

    if (scope?.mediaKeys && scope.mediaKeys.length > 0) {
      try {
        await this.uploadService.deleteObjects(scope.mediaKeys);
      } catch (err) {
        this.logger.warn(`Storage deleteObjects failed: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    }

    const stagedPrefix = scope?.stagedPrefix ?? `staging/${deletionRecord.userId}/`;
    try {
      await this.uploadService.deletePrefix(stagedPrefix);
    } catch (err) {
      this.logger.warn(`Storage deletePrefix failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  /**
   * Deletes the user from Firebase Authentication.
   * Tolerates user-not-found as safe idempotency.
   */
  private async cleanupFirebaseAuth(firebaseUserId: string): Promise<void> {
    try {
      await getAuth(this.firebaseApp).deleteUser(firebaseUserId);
      this.logger.log(`Firebase user deleted: ${firebaseUserId}`);
    } catch (err: unknown) {
      const firebaseError = err as { code?: string; message?: string };
      if (firebaseError?.code === 'auth/user-not-found') {
        this.logger.log(`Firebase user ${firebaseUserId} was already absent. Safe retry result.`);
        return;
      }
      this.logger.error(`Failed to delete Firebase user ${firebaseUserId}: ${firebaseError?.message ?? String(err)}`);
      throw err;
    }
  }

  /**
   * Retrieves deletion progress using the scoped deletionId and progressToken.
   * Public: does not require or grant ordinary account access.
   */
  async getProgress(deletionId: string, progressToken: string): Promise<AccountDeletionPayload> {
    const hash = crypto.createHash('sha256').update(progressToken).digest('hex');
    const record = await this.accountDeletionRepository.findById(deletionId);

    if (!record || record.progressTokenHash !== hash) {
      throw new NotFoundError('Account deletion record not found or invalid progress token');
    }

    let message = 'Account deletion accepted and cleanup is underway.';
    if (record.status === 'COMPLETED') {
      message = 'Your account and all associated data have been permanently deleted.';
    } else if (record.status === 'FAILED') {
      message = 'Cleanup encountered an issue and will be automatically retried.';
    }

    return {
      status: record.status,
      deletionId: record.id,
      progressToken: null,
      message,
      acceptedAt: record.acceptedAt,
      completedAt: record.completedAt,
    };
  }

  /**
   * Checks if an identity is either currently being deleted or was permanently deleted.
   * Used by FirebaseAuthGuard and UsersService to block access immediately.
   */
  async isDeletedOrPending(firebaseUserId: string): Promise<boolean> {
    const record = await this.accountDeletionRepository.findByFirebaseUserId(firebaseUserId);
    if (!record) return false;
    return isAccountDeletionBlockedStatus(record.status);
  }

  /**
   * Invalidates process-local and cache-manager user resolution caches.
   */
  private async invalidateUserCaches(userId: string, firebaseUserId: string): Promise<void> {
    await Promise.all([
      this.cacheManager.del(`user_resolve:${firebaseUserId}`),
      this.cacheManager.del(`user_resolve_id:${userId}`),
    ]);
  }
}

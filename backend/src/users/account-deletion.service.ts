import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { eq, and, or, inArray, sql } from 'drizzle-orm';
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
  accountReports,
  comments,
  commentReports,
  notifications,
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
import {
  MediaFinalizationRepository,
  MEDIA_FINALIZATION_LEASE_MS,
  MEDIA_FINALIZATION_ORPHAN_TTL_MS,
} from '../upload/media-finalization.repository';
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
    @Inject(MediaFinalizationRepository)
    private readonly mediaFinalizationRepository: MediaFinalizationRepository,
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

    // 2. Check idempotency: does an active deletion record already exist for this identity?
    const existing =
      (await this.accountDeletionRepository.findByFirebaseUserId(user.firebaseUserId)) ??
      (await this.accountDeletionRepository.findByUserId(user.id));
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
    const { record: deletionRecord, isExisting } = await this.db.transaction(async (tx) => {
      // Serialize concurrent deletion attempts for the same identity using an advisory transaction lock
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'account_deletion:' + user.firebaseUserId}))`);

      // Re-check existence inside the serialized transaction to guarantee one deletion job per identity
      const [existingInTx] = await tx
        .select()
        .from(accountDeletions)
        .where(or(eq(accountDeletions.firebaseUserId, user.firebaseUserId), eq(accountDeletions.userId, user.id)))
        .orderBy(sql`${accountDeletions.createdAt} DESC`)
        .limit(1);

      if (existingInTx) {
        return { record: existingInTx, isExisting: true };
      }

      // Lock user row FOR UPDATE to serialize with any concurrent upload issuance or post creation
      const [lockedUser] = await tx.select().from(users).where(eq(users.id, user.id)).for('update');

      const persistedUploadGraceUntil = lockedUser?.uploadGraceUntil ?? null;
      let effectiveGraceUntil =
        persistedUploadGraceUntil && persistedUploadGraceUntil.getTime() > Date.now()
          ? persistedUploadGraceUntil
          : null;
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

      return { record, isExisting: false };
    });

    if (isExisting) {
      this.logger.log(`Duplicate deletion request for Firebase UID ${user.firebaseUserId}, returning existing status.`);
      return {
        status: deletionRecord.status,
        deletionId: deletionRecord.id,
        progressToken: customProgressToken ?? null,
        message:
          deletionRecord.status === 'COMPLETED'
            ? 'Your account and all associated data have been permanently deleted.'
            : 'Account deletion has been accepted and cleanup is in progress.',
        acceptedAt: deletionRecord.acceptedAt,
        completedAt: deletionRecord.completedAt,
      };
    }

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
        if (deletionRecord.stagedUploadGraceUntil && deletionRecord.stagedUploadGraceUntil.getTime() > Date.now()) {
          this.logger.log(
            `Staged upload grace window active until ${deletionRecord.stagedUploadGraceUntil.toISOString()} for deletion ${deletionRecord.id}. Deferring storage cleanup.`,
          );
          await this.accountDeletionRepository.update(deletionRecord.id, {
            nextRetryAt: deletionRecord.stagedUploadGraceUntil,
          });
          return; // Do not delete permanent keys or advance to STORAGE_CLEANED yet!
        }

        // 2. Resolve durable media-finalization obligations. A fresh in-flight copy
        // can still create a permanent object, so deletion defers until its lease
        // expires. Stale or compensation-required obligations are deleted now, and
        // a storage failure keeps the row and this step retryable.
        const obligations = await this.resolveMediaFinalizationObligations(userId);
        if (!obligations.resolved) {
          this.logger.log(
            `Media finalization obligation still in flight for deletion ${deletionRecord.id}. Deferring storage cleanup until ${obligations.retryAt.toISOString()}.`,
          );
          await this.accountDeletionRepository.update(deletionRecord.id, {
            nextRetryAt: obligations.retryAt,
          });
          return; // Completion must wait until every outstanding copy is resolved!
        }

        // 3. All outstanding copies are resolved: safe to delete permanent media
        // keys and the staged prefix.
        await this.cleanupStorageData(deletionRecord);

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
   * - Removes dependent applications and contact requests
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

      // Lock the account row so a concurrent avatar replacement either commits
      // before this capture (and its object is deleted below) or waits on the
      // row lock and then finds the account gone, compensating its own object.
      const [lockedUser] = await tx.select().from(users).where(eq(users.id, userId)).for('update');

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

      // Owned avatar media is captured even when post media was preserved from
      // an earlier attempt. Only the owned storage key is an object to delete;
      // a third-party provider picture URL is never treated as owned media.
      if (lockedUser?.profilePhotoStorageKey && !mediaKeys.includes(lockedUser.profilePhotoStorageKey)) {
        mediaKeys.push(lockedUser.profilePhotoStorageKey);
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

      // Report rows are deleted below together with their free text. Collect
      // their ids first so every append-only moderation audit correlated with
      // them can be redacted after the rows are gone.
      const userCommentIds = (
        await tx.select({ id: comments.id }).from(comments).where(eq(comments.authorId, userId))
      ).map((row) => row.id);

      const userPostReportIds = (
        await tx
          .select({ id: postReports.id })
          .from(postReports)
          .where(
            userPostIds.length > 0
              ? or(eq(postReports.reporterId, userId), inArray(postReports.postId, userPostIds))
              : eq(postReports.reporterId, userId),
          )
      ).map((row) => row.id);

      const userAccountReportIds = (
        await tx
          .select({ id: accountReports.id })
          .from(accountReports)
          .where(or(eq(accountReports.reporterId, userId), eq(accountReports.reportedUserId, userId)))
      ).map((row) => row.id);

      const userCommentReportIds = (
        await tx
          .select({ id: commentReports.id })
          .from(commentReports)
          .where(
            userCommentIds.length > 0
              ? or(eq(commentReports.reporterId, userId), inArray(commentReports.commentId, userCommentIds))
              : eq(commentReports.reporterId, userId),
          )
      ).map((row) => row.id);

      // 5. Remove reports submitted by this user. The `trg_post_report_count`
      // database trigger is the single counter authority: deleting each report
      // row decrements its Post's report_count exactly once and never below zero.
      await tx.delete(postReports).where(eq(postReports.reporterId, userId));

      // 5b. Remove Pupzy Account Reports and Comment Reports involving this
      // account. Open report rows are personal safety data and free-text
      // details must not survive; every completed review already has an
      // append-only moderation_actions entry, which is retained (redacted)
      // instead of the personal report content.
      await tx
        .delete(accountReports)
        .where(or(eq(accountReports.reporterId, userId), eq(accountReports.reportedUserId, userId)));

      if (userCommentIds.length > 0) {
        await tx
          .delete(commentReports)
          .where(or(eq(commentReports.reporterId, userId), inArray(commentReports.commentId, userCommentIds)));
      } else {
        await tx.delete(commentReports).where(eq(commentReports.reporterId, userId));
      }

      // 6. Delete applications & contact requests
      await tx.delete(adoptionApplications).where(eq(adoptionApplications.applicantId, userId));
      await tx.delete(contactRequests).where(eq(contactRequests.requesterId, userId));

      if (userPostIds.length > 0) {
        await tx.delete(adoptionApplications).where(inArray(adoptionApplications.targetPostId, userPostIds));
        await tx.delete(contactRequests).where(inArray(contactRequests.postId, userPostIds));
      }

      // 7. Redact surviving notifications & moderation metadata
      await tx.delete(notifications).where(eq(notifications.recipientId, userId));

      if (user) {
        // Redact user's name from surviving notifications received by others,
        // including the Arabic columns produced by the bilingual templates.
        if (user.fullName && user.fullName.trim().length > 0) {
          await tx.execute(sql`
            UPDATE "notifications"
            SET
              "title" = REPLACE("title", ${user.fullName}, 'Someone'),
              "body" = REPLACE("body", ${user.fullName}, 'Someone'),
              "title_arabic" = REPLACE("title_arabic", ${user.fullName}, 'Someone'),
              "body_arabic" = REPLACE("body_arabic", ${user.fullName}, 'Someone')
            WHERE "title" LIKE ${'%' + user.fullName + '%'}
              OR "body" LIKE ${'%' + user.fullName + '%'}
              OR "title_arabic" LIKE ${'%' + user.fullName + '%'}
              OR "body_arabic" LIKE ${'%' + user.fullName + '%'};
          `);
        }
        if (user.fullNameArabic && user.fullNameArabic.trim().length > 0) {
          await tx.execute(sql`
            UPDATE "notifications"
            SET
              "title" = REPLACE("title", ${user.fullNameArabic}, 'مستخدم'),
              "body" = REPLACE("body", ${user.fullNameArabic}, 'مستخدم'),
              "title_arabic" = REPLACE("title_arabic", ${user.fullNameArabic}, 'مستخدم'),
              "body_arabic" = REPLACE("body_arabic", ${user.fullNameArabic}, 'مستخدم')
            WHERE "title" LIKE ${'%' + user.fullNameArabic + '%'}
              OR "body" LIKE ${'%' + user.fullNameArabic + '%'}
              OR "title_arabic" LIKE ${'%' + user.fullNameArabic + '%'}
              OR "body_arabic" LIKE ${'%' + user.fullNameArabic + '%'};
          `);
        }
        if (user.email && user.email.trim().length > 0) {
          await tx.execute(sql`
            UPDATE "notifications"
            SET
              "body" = REPLACE("body", ${user.email}, '[deleted]'),
              "body_arabic" = REPLACE("body_arabic", ${user.email}, '[deleted]')
            WHERE "body" LIKE ${'%' + user.email + '%'} OR "body_arabic" LIKE ${'%' + user.email + '%'};
          `);
        }
        if (user.phoneNumber && user.phoneNumber.trim().length > 0) {
          await tx.execute(sql`
            UPDATE "notifications"
            SET
              "body" = REPLACE("body", ${user.phoneNumber}, '[deleted]'),
              "body_arabic" = REPLACE("body_arabic", ${user.phoneNumber}, '[deleted]')
            WHERE "body" LIKE ${'%' + user.phoneNumber + '%'} OR "body_arabic" LIKE ${'%' + user.phoneNumber + '%'};
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

      // Audits targeting the account's Comments, or correlated with any report
      // row just deleted (as its author, target, or evidence), must survive
      // only in redacted form.
      const auditedReportIds = [...userPostReportIds, ...userAccountReportIds, ...userCommentReportIds];
      if (userCommentIds.length > 0 || auditedReportIds.length > 0) {
        const commentTargetClause =
          userCommentIds.length > 0
            ? sql`(target_type = 'COMMENT' AND target_id = ANY(ARRAY[${sql.join(
                userCommentIds.map((id) => sql`${id}::uuid`),
                sql`, `,
              )}]))`
            : sql`false`;
        const reportCorrelationClause =
          auditedReportIds.length > 0
            ? sql`(
                metadata->>'reportId' = ANY(ARRAY[${sql.join(
                  auditedReportIds.map((id) => sql`${id}::text`),
                  sql`, `,
                )}])
                OR EXISTS (
                  SELECT 1 FROM jsonb_array_elements_text(COALESCE(metadata->'closedPostReportIds', '[]'::jsonb)) AS x
                  WHERE x = ANY(ARRAY[${sql.join(
                    auditedReportIds.map((id) => sql`${id}::text`),
                    sql`, `,
                  )}])
                )
                OR EXISTS (
                  SELECT 1 FROM jsonb_array_elements_text(COALESCE(metadata->'closedCommentReportIds', '[]'::jsonb)) AS x
                  WHERE x = ANY(ARRAY[${sql.join(
                    auditedReportIds.map((id) => sql`${id}::text`),
                    sql`, `,
                  )}])
                )
                OR EXISTS (
                  SELECT 1 FROM jsonb_array_elements_text(COALESCE(metadata->'closedAccountReportIds', '[]'::jsonb)) AS x
                  WHERE x = ANY(ARRAY[${sql.join(
                    auditedReportIds.map((id) => sql`${id}::text`),
                    sql`, `,
                  )}])
                )
              )`
            : sql`false`;

        await tx.execute(sql`
          UPDATE moderation_actions
          SET reason = 'Redacted (account deleted)', metadata = NULL
          WHERE ${commentTargetClause} OR ${reportCorrelationClause}
        `);
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
   * Resolves every durable media-finalization obligation for a user before
   * account deletion sweeps storage.
   *
   * - Fresh `IN_FLIGHT` rows mean a live copy may still create a permanent
   *   object: nothing is swept and the caller retries after the lease expires.
   * - Stale `IN_FLIGHT` rows had no heartbeat for the full lease, so the process
   *   can no longer be copying; their permanent and staging objects are removed.
   * - `COMPENSATION_REQUIRED` rows had a copy during a blocked account; their
   *   permanent object is removed here.
   *
   * Rows are deleted only after their objects are gone. A storage failure
   * propagates so the deletion request stays retryable instead of completing.
   */
  private async resolveMediaFinalizationObligations(
    userId: string,
  ): Promise<{ resolved: true } | { resolved: false; retryAt: Date }> {
    const obligations = await this.mediaFinalizationRepository.findByUserId(userId);
    if (obligations.length === 0) return { resolved: true };

    const now = Date.now();
    const freshInFlight = obligations.filter(
      (obligation) =>
        obligation.status === 'IN_FLIGHT' && obligation.updatedAt.getTime() + MEDIA_FINALIZATION_LEASE_MS > now,
    );
    if (freshInFlight.length > 0) {
      const earliestExpiry = Math.min(
        ...freshInFlight.map((obligation) => obligation.updatedAt.getTime() + MEDIA_FINALIZATION_LEASE_MS),
      );
      return { resolved: false, retryAt: new Date(earliestExpiry) };
    }

    for (const obligation of obligations) {
      await this.uploadService.deleteObjects([obligation.finalKey]);
      if (obligation.status === 'IN_FLIGHT') {
        await this.uploadService.deleteObjects([obligation.stagingKey]);
      }
      await this.mediaFinalizationRepository.delete(obligation.id);
    }

    return { resolved: true };
  }

  /**
   * Maintenance pass for obligations that no deletion request will resolve:
   * removes abandoned `IN_FLIGHT` bookkeeping and retries failed compensations.
   * Invoked by {@link AccountDeletionCron}.
   */
  async reconcileAbandonedMediaFinalizations(limit = 20): Promise<void> {
    const staleBefore = new Date(Date.now() - MEDIA_FINALIZATION_ORPHAN_TTL_MS);
    const abandoned = await this.mediaFinalizationRepository.findStale(staleBefore, limit);

    for (const obligation of abandoned) {
      if (obligation.status === 'COMPENSATION_REQUIRED') {
        try {
          await this.uploadService.deleteObjects([obligation.finalKey]);
          await this.mediaFinalizationRepository.delete(obligation.id);
          this.logger.log(`Resolved orphaned media compensation obligation ${obligation.id}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `Media compensation obligation ${obligation.id} could not be resolved; will retry: ${message}`,
          );
          await this.mediaFinalizationRepository.recordError(obligation.id, message);
        }
        continue;
      }

      // Abandoned IN_FLIGHT bookkeeping: the crash happened long ago, and the
      // surviving post still owns its object. Account deletion captures the key
      // from post_media, so dropping the row cannot leave media behind.
      await this.mediaFinalizationRepository.delete(obligation.id);
      this.logger.warn(
        `Removed abandoned media finalization obligation ${obligation.id} for user ${obligation.userId}`,
      );
    }
  }

  /**
   * Deletes permanent R2 media objects and staged upload prefixes.
   *
   * Runs entirely outside database transactions. The caller resolves all durable
   * media-finalization obligations first, so this sweep only runs once no copy
   * can recreate a permanent object. Outstanding presigned upload URLs are
   * covered by the caller's `stagedUploadGraceUntil` check.
   */
  private async cleanupStorageData(deletionRecord: AccountDeletion): Promise<void> {
    const scope = deletionRecord.mediaCleanupScope as { mediaKeys?: string[]; stagedPrefix?: string } | null;

    if (scope?.mediaKeys && scope.mediaKeys.length > 0) {
      await this.uploadService.deleteObjects(scope.mediaKeys);
    }

    const stagedPrefix = scope?.stagedPrefix ?? `staging/${deletionRecord.userId}/`;
    await this.uploadService.deletePrefix(stagedPrefix);
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

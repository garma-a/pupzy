import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import { CommentsRepository, FinalizedCommentMedia, isUniqueViolation } from './comments.repository';
import { QuotaReservation } from './comments-quota.manager';
import { ReportQuotaReservation } from '../moderation-reports/moderation-report-quota.manager';
import { PostsRepository } from '../posts/posts.repository';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import { CreateCommentDto } from './dto/create-comment.input';
import { CreateReplyDto } from './dto/create-reply.input';
import {
  CommentsQueryDto,
  RepliesQueryDto,
  decodeCommentCursor,
  encodeCommentCursor,
} from './dto/comments-query.input';
import { Comment, CommentMedia, CommentIdempotency } from '../database/schema';
import { NotFoundError, ConflictError, AppError, ValidationError } from '../common/errors/app.errors';
import { UploadService } from '../upload/upload.service';
import { MediaDeletionProcessor } from '../upload/media-deletion.processor';
import { ConfigService } from '@nestjs/config';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { RequestCommentImageUploadDto } from './dto/request-comment-image-upload.input';
import { ReportCommentInput } from './dto/report-comment.input';
import { assertImageCommentAllowed } from './comment-image-eligibility';
import { NotificationsService } from '../notifications/notifications.service';
import { DiscussionNotificationProcessor } from '../notifications/discussion-notification.processor';
import { UsersService } from '../users/users.service';

export interface CommentEdge {
  node: Comment;
  cursor: string;
}

export interface CommentConnection {
  edges: CommentEdge[];
  pageInfo: {
    endCursor: string | null;
    hasNextPage: boolean;
  };
}

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly commentsRepository: CommentsRepository,
    private readonly postsRepository: PostsRepository,
    private readonly uploadService: UploadService,
    private readonly config: ConfigService,
    private readonly mediaDeletionProcessor?: MediaDeletionProcessor,
    // Retained optional injection positions for backwards-compatible test wiring;
    // durable discussion events are now written by CommentsRepository.
    private readonly _notificationsService?: NotificationsService,
    private readonly _usersService?: UsersService,
    @Optional()
    @Inject(AccountIsolationPolicy)
    private readonly isolationPolicy?: AccountIsolationPolicy,
    @Optional()
    @Inject(DiscussionNotificationProcessor)
    private readonly discussionNotifications?: DiscussionNotificationProcessor,
  ) {}

  /**
   * Neutral preflight: true when the viewer is isolated from the other account.
   * The authoritative recheck always happens inside the repository transaction,
   * so this only avoids quota/media side effects for an obviously blocked write.
   */
  private async isViewerIsolated(viewerId: string | null | undefined, otherAccountId: string): Promise<boolean> {
    if (!viewerId || !this.isolationPolicy) return false;
    return this.isolationPolicy.isIsolated(viewerId, otherAccountId);
  }

  /**
   * Centralized resolution helper for idempotent replays.
   * Ensures replays apply current deletion, moderation, and Post reachability
   * rather than returning a frozen or stale snapshot.
   */
  async resolveExistingCommentReplay(existingIdempotency: CommentIdempotency, requestHash: string): Promise<Comment> {
    // 1. Conflict verification
    if (existingIdempotency.requestHash !== requestHash) {
      throw new ConflictError('Client request ID was previously used with different parameters');
    }

    // 2. Resolve target comment ID
    const payload = existingIdempotency.responsePayload;
    let payloadId: string | undefined;
    if (typeof payload === 'object' && payload !== null && 'id' in payload && typeof payload.id === 'string') {
      payloadId = payload.id;
    }
    const targetCommentId = existingIdempotency.commentId ?? payloadId;
    if (!targetCommentId) {
      throw new NotFoundError('Comment', 'unknown');
    }

    // 3. Fetch fresh comment from DB
    const comment = await this.commentsRepository.findCommentById(targetCommentId);
    if (!comment) {
      throw new NotFoundError('Comment', targetCommentId);
    }

    // 4. Check parent Post reachability
    const post = await this.postsRepository.findById(comment.postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', comment.postId);
    }

    // 5. Apply reachability and visibility
    if (!comment.parentId) {
      // Top-level comment
      if (comment.status === 'REMOVED') {
        throw new NotFoundError('Comment', comment.id);
      }
      if (comment.status === 'DELETED' || comment.status === 'HIDDEN') {
        if (comment.replyCount > 0) {
          return {
            ...comment,
            text: comment.status === 'DELETED' ? '[Deleted]' : '[Hidden]',
          };
        }
        throw new NotFoundError('Comment', comment.id);
      }
      if (comment.status === 'ACTIVE' || comment.status === 'IMAGE_HIDDEN') {
        return comment;
      }
      throw new NotFoundError('Comment', comment.id);
    } else {
      // Reply
      const parentComment = await this.commentsRepository.findCommentById(comment.parentId);
      if (!parentComment || parentComment.status === 'REMOVED') {
        throw new NotFoundError('Comment', comment.id);
      }
      if ((parentComment.status === 'DELETED' || parentComment.status === 'HIDDEN') && parentComment.replyCount === 0) {
        throw new NotFoundError('Comment', comment.id);
      }
      if (comment.status === 'REMOVED' || comment.status === 'DELETED' || comment.status === 'HIDDEN') {
        throw new NotFoundError('Comment', comment.id);
      }
      if (comment.status === 'ACTIVE' || comment.status === 'IMAGE_HIDDEN') {
        return comment;
      }
      throw new NotFoundError('Comment', comment.id);
    }
  }

  /**
   * Publishes a text-only top-level Comment beneath an eligible Post.
   *
   * ## Idempotency
   * - Identical retry with same clientRequestId + same canonical payload: returns original result.
   * - Conflict retry with same clientRequestId + different payload: throws ConflictError.
   * - Survives restarts and deployments.
   *
   * ## Rate Limiting
   * - Max 10 comment creations per minute per user.
   * - Max 100 comment creations per day per user.
   * - Idempotent re-execution does NOT consume rate limit budget.
   *
   * ## Post Eligibility
   * - Post must exist and must NOT have status = 'REMOVED'.
   * - Allowed for all non-Removed business statuses (ACTIVE, RESOLVED, REUNITED, ADOPTED, SOLD, ANIMAL_DECEASED).
   * - Image attachments (`mediaIds`) are allowed only beneath RESCUE and LOST
   *   Posts; disallowed image publication is rejected here before quota or
   *   staged-media finalization and rechecked inside the committing transaction.
   */
  async createComment(userId: string, input: CreateCommentDto): Promise<Comment> {
    const { postId, text, clientRequestId } = input;

    // 1. Canonical payload fingerprinting
    const canonicalPayload = JSON.stringify({
      postId,
      text,
      mediaIds: input.mediaIds ?? [],
    });
    const requestHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

    // 2. Durable author-scoped idempotency check FIRST
    const existingIdempotency = await this.commentsRepository.findIdempotencyRecord(userId, clientRequestId);
    if (existingIdempotency) {
      this.logger.log(`Idempotent replay for comment clientRequestId=${clientRequestId} author=${userId}`);
      return this.resolveExistingCommentReplay(existingIdempotency, requestHash);
    }

    // 3. Post eligibility check (existence, lifecycle, and account isolation)
    const post = await this.postsRepository.findById(postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', postId);
    }
    if (await this.isViewerIsolated(userId, post.creatorId)) {
      throw new NotFoundError('Post', postId);
    }

    if (input.mediaIds && input.mediaIds.length > 0) {
      assertImageCommentAllowed(post.postType);
    }

    // 4. Per-user atomic rate limiting (10/min, 100/day)
    let quotaReservation: QuotaReservation | undefined;
    if (typeof this.commentsRepository.reserveCreationQuota === 'function') {
      quotaReservation = await this.commentsRepository.reserveCreationQuota(userId, clientRequestId);
    } else {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
      const minuteCount = await this.commentsRepository.countRecentCreationsByAuthor(userId, oneMinuteAgo);
      if (minuteCount >= 10) {
        throw new AppError('Comment creation rate limit exceeded (max 10 per minute)', 'RATE_LIMITED');
      }

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const dayCount = await this.commentsRepository.countRecentCreationsByAuthor(userId, oneDayAgo);
      if (dayCount >= 100) {
        throw new AppError('Comment creation rate limit exceeded (max 100 per day)', 'RATE_LIMITED');
      }
      quotaReservation = { admissionId: '', rollback: async () => {} };
    }

    // 5. Finalize staged comment images if attached
    const commentId = generateUuidV7();
    let mediaItems: FinalizedCommentMedia[] | undefined;

    if (input.mediaIds && input.mediaIds.length > 0) {
      try {
        mediaItems = await this.uploadService.finalizeCommentImages(input.mediaIds, userId, commentId, { postId });
      } catch (finalizeErr) {
        // If media was already used, check if this was a concurrent duplicate that already succeeded or is in-flight (AC 8)
        if (finalizeErr instanceof AppError && finalizeErr.code === 'COMMENT_MEDIA_ALREADY_USED') {
          for (let attempt = 0; attempt < 20; attempt++) {
            const recheck = await this.commentsRepository.findIdempotencyRecord(userId, clientRequestId);
            if (recheck) {
              this.logger.log(`Concurrent duplicate resolved to existing comment clientRequestId=${clientRequestId}`);
              if (quotaReservation) {
                await quotaReservation.rollback().catch(() => {});
              }
              return this.resolveExistingCommentReplay(recheck, requestHash);
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        if (quotaReservation) {
          await quotaReservation.rollback().catch(() => {});
        }
        throw finalizeErr;
      }
    }

    // 6. Transactional comment creation + counter update + media insert
    try {
      const newComment = await this.commentsRepository.createCommentWithCounter({
        commentId,
        postId,
        authorId: userId,
        text,
        clientRequestId,
        requestHash,
        mediaItems,
      });
      this.discussionNotifications?.requestImmediateRun();

      // 7. Cleanup staging objects after successful DB commit
      if (mediaItems && mediaItems.length > 0) {
        for (const item of mediaItems) {
          if (item.stagingKey) {
            await this.uploadService.deleteObject(item.stagingKey).catch((delErr) => {
              this.logger.warn(`Failed to delete staging object ${item.stagingKey} after copy: ${delErr}`);
            });
          }
        }
      }

      return newComment;
    } catch (err) {
      // If DB transaction failed due to unique constraint on clientRequestId (concurrent identical request won), recheck idempotency! (AC 8)
      if (isUniqueViolation(err)) {
        for (let attempt = 0; attempt < 20; attempt++) {
          const recheck = await this.commentsRepository.findIdempotencyRecord(userId, clientRequestId);
          if (recheck) {
            if (mediaItems && mediaItems.length > 0) {
              for (const item of mediaItems) {
                await this.uploadService.deleteObject(item.storageKey).catch(() => {});
                await this.commentsRepository
                  .queueMediaDeletionWork(item.storageKey, this.getCommentMediaPublicUrl(item.storageKey))
                  .catch(() => {});
              }
              await this.uploadService.markMediaFailed(
                mediaItems.map((m) => m.id),
                'Duplicate request superseded',
              );
            }
            if (quotaReservation) {
              await quotaReservation.rollback().catch(() => {});
            }
            return this.resolveExistingCommentReplay(recheck, requestHash);
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      // Compensate R2 if DB transaction fails: delete final objects and queue for deletion outbox
      if (mediaItems && mediaItems.length > 0) {
        for (const item of mediaItems) {
          await this.uploadService.deleteObject(item.storageKey).catch(() => {});
          await this.commentsRepository
            .queueMediaDeletionWork(item.storageKey, this.getCommentMediaPublicUrl(item.storageKey))
            .catch(() => {});
        }
        await this.uploadService.markMediaFailed(
          mediaItems.map((m) => m.id),
          'Database transaction failed',
        );
      }
      if (quotaReservation) {
        await quotaReservation.rollback().catch(() => {});
      }
      throw err;
    }
  }

  /**
   * Delegates ticket issuance to UploadService.
   */
  async requestCommentImageUploadUrl(userId: string, input: RequestCommentImageUploadDto) {
    if (!this.uploadService) {
      throw new AppError('Upload service is unavailable', 'INTERNAL_ERROR');
    }
    const ticket = await this.uploadService.requestCommentImageUploadUrl(userId, input);
    return {
      ...ticket,
      expiresAt: ticket.expiresAt instanceof Date ? ticket.expiresAt.toISOString() : String(ticket.expiresAt),
      mimeType:
        (ticket as { mimeType?: string }).mimeType ??
        (ticket as { allowedContentType?: string }).allowedContentType ??
        'image/webp',
    };
  }

  /**
   * Resolves configured CDN base URL for public Comment media.
   * Priority: COMMENT_MEDIA_CDN_BASE -> R2_PUBLIC_URL -> https://cdn.pupzy.net
   */
  getMediaBaseUrl(): string {
    const commentCdnBase = process.env.COMMENT_MEDIA_CDN_BASE || this.config?.get<string>('COMMENT_MEDIA_CDN_BASE');
    if (commentCdnBase) {
      return commentCdnBase.replace(/\/+$/, '');
    }
    const r2Public = process.env.R2_PUBLIC_URL || this.config?.get<string>('R2_PUBLIC_URL');
    if (r2Public) {
      return r2Public.replace(/\/+$/, '');
    }
    return 'https://cdn.pupzy.net';
  }

  /**
   * Derives safe public URL for Comment media from immutable storageKey and configured base URL.
   */
  getCommentMediaPublicUrl(storageKey: string): string {
    const base = this.getMediaBaseUrl();
    const cleanKey = storageKey.replace(/^\/+/, '');
    return `${base}/${cleanKey}`;
  }

  /**
   * Fetches media records for a comment.
   */
  async getCommentMedia(commentId: string): Promise<CommentMedia[]> {
    return this.commentsRepository.findMediaByCommentId(commentId);
  }

  /**
   * Queries visible top-level Comments for a Post using keyset pagination.
   *
   * ## Removed Post guard
   * - If the Post does not exist or is REMOVED, throws NotFoundError (exposes no discussion).
   *
   * ## Keyset pagination
   * - Keyset pagination with deterministic tie-breaking (createdAt DESC, id DESC).
   * - Opaque cursor encoding and decoding.
   */
  async getComments(input: CommentsQueryDto, viewerId?: string | null): Promise<CommentConnection> {
    const { postId, sort, first, after } = input;

    // Check post eligibility (existence, lifecycle, and account isolation)
    const post = await this.postsRepository.findById(postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', postId);
    }
    if (await this.isViewerIsolated(viewerId, post.creatorId)) {
      throw new NotFoundError('Post', postId);
    }

    const cursorPayload = after ? decodeCommentCursor(after) : undefined;
    const rows = await this.commentsRepository.findTopLevelCommentsByPostId(
      postId,
      first,
      sort,
      cursorPayload,
      viewerId,
    );

    const hasNextPage = rows.length > first;
    const items = hasNextPage ? rows.slice(0, first) : rows;

    const edges: CommentEdge[] = items.map((comment) => ({
      node: comment,
      cursor: encodeCommentCursor(comment, sort),
    }));

    const endCursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;

    return {
      edges,
      pageInfo: {
        endCursor,
        hasNextPage,
      },
    };
  }

  /**
   * Publishes a text-only Reply beneath an active top-level Comment.
   *
   * ## Rules
   * - Cannot reply to a Reply (max 1 level of nesting).
   * - Cannot reply to DELETED, HIDDEN, or REMOVED comments.
   * - Cannot reply under a REMOVED post.
   * - Shares rate limit budget with comment creation (10/min, 100/day).
   * - Durable author-scoped idempotency.
   */
  async createReply(userId: string, input: CreateReplyDto): Promise<Comment> {
    const { commentId, text, clientRequestId } = input;

    // 1. Canonical payload fingerprinting
    const canonicalPayload = JSON.stringify({ commentId, text });
    const requestHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

    // 2. Durable author-scoped idempotency check FIRST
    const existingIdempotency = await this.commentsRepository.findIdempotencyRecord(userId, clientRequestId);
    if (existingIdempotency) {
      this.logger.log(`Idempotent replay for reply clientRequestId=${clientRequestId} author=${userId}`);
      return this.resolveExistingCommentReplay(existingIdempotency, requestHash);
    }

    // 3. Check parent comment eligibility
    const parentComment = await this.commentsRepository.findCommentById(commentId);
    if (!parentComment) {
      throw new NotFoundError('Comment', commentId);
    }
    if (parentComment.parentId !== null) {
      throw new ValidationError('Replies cannot receive replies');
    }
    if (parentComment.status !== 'ACTIVE' && parentComment.status !== 'IMAGE_HIDDEN') {
      throw new NotFoundError('Comment', commentId);
    }

    // 4. Check parent post eligibility (existence, lifecycle, and account isolation)
    const post = await this.postsRepository.findById(parentComment.postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', parentComment.postId);
    }
    // A Reply is unreachable when the viewer is isolated from the parent
    // Comment's author (whole branch hidden) or from the Post's creator.
    if (await this.isViewerIsolated(userId, parentComment.authorId)) {
      throw new NotFoundError('Comment', commentId);
    }
    if (await this.isViewerIsolated(userId, post.creatorId)) {
      throw new NotFoundError('Comment', commentId);
    }

    // 5. Shared per-user atomic rate limiting (10/min, 100/day)
    let quotaReservation: QuotaReservation | undefined;
    if (typeof this.commentsRepository.reserveCreationQuota === 'function') {
      quotaReservation = await this.commentsRepository.reserveCreationQuota(userId, clientRequestId);
    } else {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
      const minuteCount = await this.commentsRepository.countRecentCreationsByAuthor(userId, oneMinuteAgo);
      if (minuteCount >= 10) {
        throw new AppError('Comment creation rate limit exceeded (max 10 per minute)', 'RATE_LIMITED');
      }

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const dayCount = await this.commentsRepository.countRecentCreationsByAuthor(userId, oneDayAgo);
      if (dayCount >= 100) {
        throw new AppError('Comment creation rate limit exceeded (max 100 per day)', 'RATE_LIMITED');
      }
      quotaReservation = { admissionId: '', rollback: async () => {} };
    }

    // 6. Transactional reply creation with row-level locks and counter updates
    try {
      const reply = await this.commentsRepository.createReplyWithCounters({
        commentId,
        authorId: userId,
        text,
        clientRequestId,
        requestHash,
      });
      this.discussionNotifications?.requestImmediateRun();

      return reply;
    } catch (err) {
      if (isUniqueViolation(err)) {
        for (let attempt = 0; attempt < 20; attempt++) {
          const recheck = await this.commentsRepository.findIdempotencyRecord(userId, clientRequestId);
          if (recheck) {
            if (quotaReservation) {
              await quotaReservation.rollback().catch(() => {});
            }
            return this.resolveExistingCommentReplay(recheck, requestHash);
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      if (quotaReservation) {
        await quotaReservation.rollback().catch(() => {});
      }
      throw err;
    }
  }

  /**
   * Queries visible Replies for a top-level Comment using keyset pagination.
   *
   * ## Eligibility & Visibility
   * - Parent comment must exist, must be top-level (parentId is null), and must not be REMOVED or HIDDEN.
   * - If parent comment is DELETED and has replyCount === 0, it disappears from public results (NotFoundError).
   * - If the parent comment's post is REMOVED, throws NotFoundError (hides replies).
   * - Keyset pagination oldest first (createdAt ASC, id ASC).
   */
  async getReplies(input: RepliesQueryDto, viewerId?: string | null): Promise<CommentConnection> {
    const { commentId, first, after } = input;

    // Check parent comment
    const parentComment = await this.commentsRepository.findCommentById(commentId);
    if (!parentComment) {
      throw new NotFoundError('Comment', commentId);
    }
    if (parentComment.parentId !== null) {
      throw new ValidationError('Replies cannot receive replies');
    }
    if (parentComment.status === 'REMOVED') {
      throw new NotFoundError('Comment', commentId);
    }
    if ((parentComment.status === 'DELETED' || parentComment.status === 'HIDDEN') && parentComment.replyCount === 0) {
      throw new NotFoundError('Comment', commentId);
    }
    // A top-level Comment authored by an isolated account makes its whole branch
    // unreachable, so the Replies query reuses the neutral not-found behavior.
    if (await this.isViewerIsolated(viewerId, parentComment.authorId)) {
      throw new NotFoundError('Comment', commentId);
    }

    // Check parent post (existence, lifecycle, and account isolation)
    const post = await this.postsRepository.findById(parentComment.postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Comment', commentId);
    }
    if (await this.isViewerIsolated(viewerId, post.creatorId)) {
      throw new NotFoundError('Comment', commentId);
    }

    const cursorPayload = after ? decodeCommentCursor(after) : undefined;
    const rows = await this.commentsRepository.findRepliesByCommentId(commentId, first, cursorPayload, viewerId);

    const hasNextPage = rows.length > first;
    const items = hasNextPage ? rows.slice(0, first) : rows;

    const edges: CommentEdge[] = items.map((reply) => ({
      node: reply,
      cursor: encodeCommentCursor(reply),
    }));

    const endCursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;

    return {
      edges,
      pageInfo: {
        endCursor,
        hasNextPage,
      },
    };
  }

  /**
   * Deletes an authored Comment or Reply.
   * - Enforces author ownership.
   * - Idempotent: returns true if already DELETED.
   * - Irreversible: updates status to DELETED.
   * - Decrements engagement counters transactionally.
   */
  async deleteComment(userId: string, commentId: string): Promise<boolean> {
    const cdnBase = this.getMediaBaseUrl();
    const result = await this.commentsRepository.deleteCommentWithCounters(commentId, userId, cdnBase);
    if (this.mediaDeletionProcessor) {
      this.mediaDeletionProcessor.processPendingWork().catch(() => {});
    }
    return result;
  }

  private readonly boostToggleTimestamps = new Map<string, number[]>();

  /**
   * Enforces 60 Comment Boost toggles per minute per authenticated user.
   */
  private checkBoostRateLimit(userId: string): void {
    const now = Date.now();
    const windowStart = now - 60 * 1000;
    const timestamps = this.boostToggleTimestamps.get(userId) ?? [];
    const valid = timestamps.filter((t) => t > windowStart);
    if (valid.length >= 60) {
      throw new AppError('Comment boost rate limit exceeded (max 60 per minute)', 'RATE_LIMITED');
    }
    valid.push(now);
    this.boostToggleTimestamps.set(userId, valid);
  }

  /**
   * Resets the boost toggle rate limit window for a user (useful for testing).
   */
  async resetBoostRateLimit(userId: string): Promise<void> {
    this.boostToggleTimestamps.delete(userId);
    if (typeof this.commentsRepository.resetQuota === 'function') {
      await this.commentsRepository.resetQuota(userId, 'COMMENT_BOOST_TOGGLE').catch(() => {});
    }
  }

  /**
   * Toggles a boost on a Comment or Reply.
   * - Rate limited to 60 per minute per authenticated user.
   * - Reversible: adds boost if not present, removes if already present.
   * - Transactional update of denormalized boostCount.
   */
  async toggleCommentBoost(
    userId: string,
    commentId: string,
  ): Promise<{ commentId: string; isBoostedByMe: boolean; boostedByMe: boolean; boostCount: number }> {
    // 1. Rate limiting (60 per minute)
    let boostReservation: QuotaReservation | undefined;
    if (typeof this.commentsRepository.checkAndRecordBoostQuota === 'function') {
      boostReservation = await this.commentsRepository.checkAndRecordBoostQuota(userId);
    } else {
      this.checkBoostRateLimit(userId);
    }

    try {
      // 2. Transactional toggle in repository
      const result = await this.commentsRepository.toggleBoost(commentId, userId);
      if (result.isBoostedByMe) this.discussionNotifications?.requestImmediateRun();

      return {
        commentId,
        isBoostedByMe: result.isBoostedByMe,
        boostedByMe: result.isBoostedByMe,
        boostCount: result.boostCount,
      };
    } catch (err) {
      if (boostReservation) {
        await boostReservation.rollback().catch(() => {});
      }
      throw err;
    }
  }

  /**
   * Checks if a user has boosted a specific comment or reply.
   */
  async isCommentBoostedByUser(commentId: string, userId: string): Promise<boolean> {
    return this.commentsRepository.isCommentBoostedByUser(commentId, userId);
  }

  /**
   * Pins an eligible top-level Comment beneath a Post.
   * Only the Post author can pin. Atomically replaces any existing pin.
   */
  async pinComment(userId: string, commentId: string): Promise<Comment> {
    const result = await this.commentsRepository.pinComment(commentId, userId);
    this.discussionNotifications?.requestImmediateRun();

    return result.comment;
  }

  /**
   * Unpins the currently pinned Comment beneath a Post.
   * Only the Post author can unpin.
   */
  async unpinComment(userId: string, postId: string): Promise<boolean> {
    return this.commentsRepository.unpinComment(postId, userId);
  }

  /**
   * Checks if a comment is currently pinned on a post.
   */
  async isCommentPinned(postId: string, commentId: string): Promise<boolean> {
    return this.commentsRepository.isCommentPinned(postId, commentId);
  }

  /**
   * Reports an abusive Comment or Reply.
   * - Enforces 10 reports per authenticated user per day.
   * - Validates target comment exists, not DELETED/REMOVED, and not beneath a REMOVED post.
   * - Rejects self-reporting.
   * - Enforces one report per user per comment (returns conflict on duplicate).
   * - Saves all reports for read-only AdminJS moderation queue.
   * - Automatically evaluates hiding thresholds for qualifying reports:
   *   * Qualifying report: user created > 24 hours ago with completed profile (fullName !== null).
   *   * 1 qualifying INAPPROPRIATE_CONTENT -> hides images (IMAGE_HIDDEN), text & counts remain.
   *   * 3 qualifying reports of any reason -> hides whole comment (HIDDEN), decrements counts, invalidates pin.
   *   * Newer/incomplete accounts enter queue but don't count toward auto-hiding.
   */
  async reportComment(userId: string, input: ReportCommentInput): Promise<boolean> {
    const { commentId, reason, details } = input;

    // 1. Rate limiting: shared moderation-report allowance (10 per rolling 24h)
    let reportReservation: ReportQuotaReservation | undefined;
    if (typeof this.commentsRepository.checkAndRecordReportQuota === 'function') {
      reportReservation = await this.commentsRepository.checkAndRecordReportQuota(userId);
    } else {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const dailyCount = await this.commentsRepository.countRecentReportsByReporter(userId, oneDayAgo);
      if (dailyCount >= 10) {
        throw new AppError('Daily comment report limit reached (10 per day)', 'RATE_LIMITED');
      }
    }

    try {
      // 2. Delegate transactional reporting & threshold checks to repository.
      // It consumes the reservation in the same transaction as the report row.
      return await this.commentsRepository.reportComment({
        commentId,
        reporterId: userId,
        reason,
        details,
        quotaAdmissionId: reportReservation?.admissionId,
      });
    } catch (err) {
      if (reportReservation) {
        await reportReservation.rollback().catch(() => {});
      }
      throw err;
    }
  }

  /**
   * Operational reconciliation of comment, reply, and boost counters.
   * Repairs any counter drift to reflect the reachability-consistent state.
   */
  async reconcileCommentCounters(options?: {
    postId?: string;
  }): Promise<{ postsRepaired: number; commentsRepaired: number }> {
    return this.commentsRepository.reconcileCommentCounters(options);
  }
}

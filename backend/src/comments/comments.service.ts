import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { CommentsRepository } from './comments.repository';
import { PostsRepository } from '../posts/posts.repository';
import { CreateCommentDto } from './dto/create-comment.input';
import { CreateReplyDto } from './dto/create-reply.input';
import {
  CommentsQueryDto,
  RepliesQueryDto,
  decodeCommentCursor,
  encodeCommentCursor,
} from './dto/comments-query.input';
import { Comment } from '../database/schema';
import { NotFoundError, ConflictError, AppError, ValidationError } from '../common/errors/app.errors';

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
  ) {}

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
   * - Allowed for all non-Removed business statuses (ACTIVE, RESOLVED, REUNITED, ADOPTED, SOLD).
   */
  async createComment(userId: string, input: CreateCommentDto): Promise<Comment> {
    const { postId, text, clientRequestId } = input;

    // 1. Post eligibility check
    const post = await this.postsRepository.findById(postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', postId);
    }

    // 2. Canonical payload fingerprinting
    const canonicalPayload = JSON.stringify({ postId, text });
    const requestHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

    // 3. Durable author-scoped idempotency check
    const existingIdempotency = await this.commentsRepository.findIdempotencyRecord(userId, clientRequestId);
    if (existingIdempotency) {
      if (existingIdempotency.requestHash === requestHash) {
        this.logger.log(`Idempotent replay for comment clientRequestId=${clientRequestId} author=${userId}`);
        return existingIdempotency.responsePayload as Comment;
      }
      throw new ConflictError('Client request ID was previously used with different parameters');
    }

    // 4. Per-user rate limiting (10/min, 100/day)
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

    // 5. Transactional comment creation + counter update
    return this.commentsRepository.createCommentWithCounter({
      postId,
      authorId: userId,
      text,
      clientRequestId,
      requestHash,
    });
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
  async getComments(input: CommentsQueryDto): Promise<CommentConnection> {
    const { postId, sort, first, after } = input;

    // Check post eligibility
    const post = await this.postsRepository.findById(postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', postId);
    }

    const cursorPayload = after ? decodeCommentCursor(after) : undefined;
    const rows = await this.commentsRepository.findTopLevelCommentsByPostId(postId, first, sort, cursorPayload);

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

    // 1. Check parent comment eligibility
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

    // 2. Check parent post eligibility
    const post = await this.postsRepository.findById(parentComment.postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', parentComment.postId);
    }

    // 3. Canonical payload fingerprinting
    const canonicalPayload = JSON.stringify({ commentId, text });
    const requestHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

    // 4. Durable author-scoped idempotency check
    const existingIdempotency = await this.commentsRepository.findIdempotencyRecord(userId, clientRequestId);
    if (existingIdempotency) {
      if (existingIdempotency.requestHash === requestHash) {
        this.logger.log(`Idempotent replay for reply clientRequestId=${clientRequestId} author=${userId}`);
        return existingIdempotency.responsePayload as Comment;
      }
      throw new ConflictError('Client request ID was previously used with different parameters');
    }

    // 5. Shared per-user rate limiting (10/min, 100/day)
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

    // 6. Transactional reply creation with row-level locks and counter updates
    return this.commentsRepository.createReplyWithCounters({
      commentId,
      authorId: userId,
      text,
      clientRequestId,
      requestHash,
    });
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
  async getReplies(input: RepliesQueryDto): Promise<CommentConnection> {
    const { commentId, first, after } = input;

    // Check parent comment
    const parentComment = await this.commentsRepository.findCommentById(commentId);
    if (!parentComment) {
      throw new NotFoundError('Comment', commentId);
    }
    if (parentComment.parentId !== null) {
      throw new ValidationError('Replies cannot receive replies');
    }
    if (parentComment.status === 'REMOVED' || parentComment.status === 'HIDDEN') {
      throw new NotFoundError('Comment', commentId);
    }
    if (parentComment.status === 'DELETED' && parentComment.replyCount === 0) {
      throw new NotFoundError('Comment', commentId);
    }

    // Check parent post
    const post = await this.postsRepository.findById(parentComment.postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Comment', commentId);
    }

    const cursorPayload = after ? decodeCommentCursor(after) : undefined;
    const rows = await this.commentsRepository.findRepliesByCommentId(commentId, first, cursorPayload);

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
    return this.commentsRepository.deleteCommentWithCounters(commentId, userId);
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
  resetBoostRateLimit(userId: string): void {
    this.boostToggleTimestamps.delete(userId);
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
    this.checkBoostRateLimit(userId);

    // 2. Transactional toggle in repository
    const result = await this.commentsRepository.toggleBoost(commentId, userId);

    return {
      commentId,
      isBoostedByMe: result.isBoostedByMe,
      boostedByMe: result.isBoostedByMe,
      boostCount: result.boostCount,
    };
  }

  /**
   * Checks if a user has boosted a specific comment or reply.
   */
  async isCommentBoostedByUser(commentId: string, userId: string): Promise<boolean> {
    return this.commentsRepository.isCommentBoostedByUser(commentId, userId);
  }
}

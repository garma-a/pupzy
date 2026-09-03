import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { CommentsRepository } from './comments.repository';
import { PostsRepository } from '../posts/posts.repository';
import { CreateCommentDto } from './dto/create-comment.input';
import { CommentsQueryDto, decodeCommentCursor, encodeCommentCursor } from './dto/comments-query.input';
import { Comment } from '../database/schema';
import { NotFoundError, ConflictError, AppError } from '../common/errors/app.errors';

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
    const { postId, first, after } = input;

    // Check post eligibility
    const post = await this.postsRepository.findById(postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', postId);
    }

    const cursorPayload = after ? decodeCommentCursor(after) : undefined;
    const rows = await this.commentsRepository.findTopLevelCommentsByPostId(postId, first, cursorPayload);

    const hasNextPage = rows.length > first;
    const items = hasNextPage ? rows.slice(0, first) : rows;

    const edges: CommentEdge[] = items.map((comment) => ({
      node: comment,
      cursor: encodeCommentCursor(comment),
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
}

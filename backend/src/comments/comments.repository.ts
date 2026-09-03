import { Injectable, Inject } from '@nestjs/common';
import { eq, and, ne, sql, gte, lt, or, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import { comments, commentIdempotency, posts, Comment, CommentIdempotency } from '../database/schema';
import { NotFoundError, ConflictError } from '../common/errors/app.errors';
import { CommentCursorPayload } from './dto/comments-query.input';

@Injectable()
export class CommentsRepository {
  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Finds a durable idempotency record by author and clientRequestId.
   */
  async findIdempotencyRecord(authorId: string, clientRequestId: string): Promise<CommentIdempotency | null> {
    const rows = await this.db
      .select()
      .from(commentIdempotency)
      .where(and(eq(commentIdempotency.authorId, authorId), eq(commentIdempotency.clientRequestId, clientRequestId)))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Counts how many comments (top-level or replies) the author has created since a given timestamp.
   */
  async countRecentCreationsByAuthor(authorId: string, since: Date): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(comments)
      .where(and(eq(comments.authorId, authorId), gte(comments.createdAt, since)));

    return result[0]?.count ?? 0;
  }

  /**
   * Transactionally creates a top-level Comment, increments the Post's commentCount,
   * and records durable idempotency metadata.
   */
  async createCommentWithCounter(params: {
    postId: string;
    authorId: string;
    text: string;
    clientRequestId: string;
    requestHash: string;
  }): Promise<Comment> {
    const { postId, authorId, text, clientRequestId, requestHash } = params;

    try {
      return await this.db.transaction(async (tx) => {
        // 1. Insert the comment
        const [newComment] = await tx
          .insert(comments)
          .values({
            postId,
            authorId,
            text,
            status: 'ACTIVE',
          })
          .returning();

        // 2. Increment post commentCount atomically, ensuring post is not REMOVED
        const updatedPosts = await tx
          .update(posts)
          .set({
            commentCount: sql`${posts.commentCount} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(posts.id, postId), ne(posts.status, 'REMOVED')))
          .returning({ id: posts.id });

        if (!updatedPosts || updatedPosts.length === 0) {
          throw new NotFoundError('Post', postId);
        }

        // 3. Record durable author-scoped idempotency
        await tx.insert(commentIdempotency).values({
          authorId,
          clientRequestId,
          requestHash,
          commentId: newComment.id,
          responsePayload: newComment,
        });

        return newComment;
      });
    } catch (error) {
      // Handle Postgres unique violation on (author_id, client_request_id)
      const err = error as { code?: string; constraint?: string };
      if (
        err.code === '23505' &&
        (err.constraint?.includes('comment_idempotency') || err.constraint?.includes('author_client_req'))
      ) {
        const existing = await this.findIdempotencyRecord(authorId, clientRequestId);
        if (existing) {
          if (existing.requestHash === requestHash) {
            return existing.responsePayload as Comment;
          }
          throw new ConflictError('Client request ID was previously used with different parameters');
        }
      }
      throw error;
    }
  }

  /**
   * Fetches visible top-level comments for a post ordered by createdAt DESC, id DESC.
   * Returns up to limit + 1 items for keyset continuation detection.
   */
  async findTopLevelCommentsByPostId(postId: string, limit: number, cursor?: CommentCursorPayload): Promise<Comment[]> {
    const conditions = [
      eq(comments.postId, postId),
      sql`${comments.parentId} IS NULL`,
      inArray(comments.status, ['ACTIVE', 'IMAGE_HIDDEN']),
    ];

    if (cursor) {
      const cursorDate = new Date(cursor.createdAt);
      conditions.push(
        or(lt(comments.createdAt, cursorDate), and(eq(comments.createdAt, cursorDate), lt(comments.id, cursor.id)))!,
      );
    }

    return this.db
      .select()
      .from(comments)
      .where(and(...conditions))
      .orderBy(sql`${comments.createdAt} DESC`, sql`${comments.id} DESC`)
      .limit(limit + 1);
  }

  /**
   * Finds a comment by ID.
   */
  async findCommentById(id: string): Promise<Comment | null> {
    const rows = await this.db.select().from(comments).where(eq(comments.id, id)).limit(1);

    return rows[0] ?? null;
  }
}

import { Injectable, Inject } from '@nestjs/common';
import { eq, and, ne, sql, gte, gt, lt, or, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import DataLoader from 'dataloader';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import { comments, commentIdempotency, commentBoosts, posts, Comment, CommentIdempotency } from '../database/schema';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../common/errors/app.errors';
import { CommentCursorPayload, CommentSortOrder } from './dto/comments-query.input';

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
   * Fetches visible top-level comments for a post ordered by:
   * - TOP: boostCount DESC, createdAt DESC, id DESC.
   * - NEWEST: createdAt DESC, id DESC.
   * Returns up to limit + 1 items for keyset continuation detection.
   * Includes deleted comments that have visible replies (replyCount > 0) as tombstones.
   */
  async findTopLevelCommentsByPostId(
    postId: string,
    limit: number,
    sort: CommentSortOrder = 'TOP',
    cursor?: CommentCursorPayload,
  ): Promise<Comment[]> {
    const conditions = [
      eq(comments.postId, postId),
      sql`${comments.parentId} IS NULL`,
      sql`(${comments.status} IN ('ACTIVE', 'IMAGE_HIDDEN') OR (${comments.status} = 'DELETED' AND ${comments.replyCount} > 0))`,
    ];

    if (cursor) {
      const cursorDate = new Date(cursor.createdAt);
      if (sort === 'TOP' && cursor.boostCount !== undefined) {
        const cursorBoost = cursor.boostCount;
        const cursorId = cursor.id;
        conditions.push(
          sql`(${comments.boostCount} < ${cursorBoost} OR (${comments.boostCount} = ${cursorBoost} AND (${comments.createdAt} < ${cursorDate} OR (${comments.createdAt} = ${cursorDate} AND ${comments.id} < ${cursorId}))))`,
        );
      } else {
        conditions.push(
          or(lt(comments.createdAt, cursorDate), and(eq(comments.createdAt, cursorDate), lt(comments.id, cursor.id)))!,
        );
      }
    }

    const orderBys =
      sort === 'TOP'
        ? [sql`${comments.boostCount} DESC`, sql`${comments.createdAt} DESC`, sql`${comments.id} DESC`]
        : [sql`${comments.createdAt} DESC`, sql`${comments.id} DESC`];

    const rows = await this.db
      .select()
      .from(comments)
      .where(and(...conditions))
      .orderBy(...orderBys)
      .limit(limit + 1);

    return rows.map((c) => {
      if (c.status === 'DELETED') {
        return { ...c, text: '[Deleted]' };
      }
      return c;
    });
  }

  /**
   * Fetches visible replies for a top-level comment ordered by createdAt ASC, id ASC.
   * Returns up to limit + 1 items for keyset continuation detection.
   */
  async findRepliesByCommentId(commentId: string, limit: number, cursor?: CommentCursorPayload): Promise<Comment[]> {
    const conditions = [eq(comments.parentId, commentId), inArray(comments.status, ['ACTIVE', 'IMAGE_HIDDEN'])];

    if (cursor) {
      const cursorDate = new Date(cursor.createdAt);
      conditions.push(
        or(gt(comments.createdAt, cursorDate), and(eq(comments.createdAt, cursorDate), gt(comments.id, cursor.id)))!,
      );
    }

    return this.db
      .select()
      .from(comments)
      .where(and(...conditions))
      .orderBy(sql`${comments.createdAt} ASC`, sql`${comments.id} ASC`)
      .limit(limit + 1);
  }

  /**
   * Transactionally creates a Reply beneath a top-level Comment, increments the parent's
   * replyCount and post's commentCount atomically, and records durable idempotency metadata.
   */
  async createReplyWithCounters(params: {
    commentId: string;
    authorId: string;
    text: string;
    clientRequestId: string;
    requestHash: string;
  }): Promise<Comment> {
    const { commentId, authorId, text, clientRequestId, requestHash } = params;

    try {
      return await this.db.transaction(async (tx) => {
        // 1. Lock parent comment with FOR UPDATE
        const [parent] = await tx.select().from(comments).where(eq(comments.id, commentId)).for('update');

        if (!parent) {
          throw new NotFoundError('Comment', commentId);
        }

        // Nesting check: Replies cannot receive replies
        if (parent.parentId !== null) {
          throw new ValidationError('Replies cannot receive replies');
        }

        // Status check: parent must be ACTIVE or IMAGE_HIDDEN (cannot reply to DELETED, HIDDEN, or REMOVED)
        if (parent.status !== 'ACTIVE' && parent.status !== 'IMAGE_HIDDEN') {
          throw new NotFoundError('Comment', commentId);
        }

        // 2. Lock parent post with FOR UPDATE to prevent race with post removal
        const [post] = await tx.select().from(posts).where(eq(posts.id, parent.postId)).for('update');

        if (!post || post.status === 'REMOVED') {
          throw new NotFoundError('Post', parent.postId);
        }

        // 3. Insert reply
        const [newReply] = await tx
          .insert(comments)
          .values({
            postId: parent.postId,
            authorId,
            parentId: parent.id,
            text,
            status: 'ACTIVE',
            replyCount: 0,
          })
          .returning();

        // 4. Increment parent comment's reply_count
        await tx
          .update(comments)
          .set({
            replyCount: sql`${comments.replyCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(comments.id, parent.id));

        // 5. Increment post's comment_count
        await tx
          .update(posts)
          .set({
            commentCount: sql`${posts.commentCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(posts.id, parent.postId));

        // 6. Record durable idempotency
        await tx.insert(commentIdempotency).values({
          authorId,
          clientRequestId,
          requestHash,
          commentId: newReply.id,
          responsePayload: newReply,
        });

        return newReply;
      });
    } catch (error) {
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
   * Transactionally deletes a comment or reply.
   * - Enforces author ownership (rejects other users and post authors).
   * - Idempotent: returns true if already DELETED.
   * - Irreversible: updates status to DELETED.
   * - Decrements engagement counts transactionally.
   */
  async deleteCommentWithCounters(commentId: string, userId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // 1. Lock target comment
      const [comment] = await tx.select().from(comments).where(eq(comments.id, commentId)).for('update');

      if (!comment) {
        throw new NotFoundError('Comment', commentId);
      }

      // 2. Ownership check: author only
      if (comment.authorId !== userId) {
        throw new ForbiddenError('You can only delete your own comments or replies');
      }

      // 3. Idempotent check
      if (comment.status === 'DELETED') {
        return true;
      }

      const wasVisible = comment.status === 'ACTIVE' || comment.status === 'IMAGE_HIDDEN';

      // 4. Mark status DELETED
      await tx
        .update(comments)
        .set({
          status: 'DELETED',
          updatedAt: new Date(),
        })
        .where(eq(comments.id, commentId));

      // 5. Decrement counters if the item was visible
      if (wasVisible) {
        if (comment.parentId) {
          // It is a Reply: decrement parent comment's reply_count and post's comment_count
          await tx
            .update(comments)
            .set({
              replyCount: sql`GREATEST(0, ${comments.replyCount} - 1)`,
              updatedAt: new Date(),
            })
            .where(eq(comments.id, comment.parentId));

          await tx
            .update(posts)
            .set({
              commentCount: sql`GREATEST(0, ${posts.commentCount} - 1)`,
              updatedAt: new Date(),
            })
            .where(eq(posts.id, comment.postId));
        } else {
          // It is a top-level Comment: decrement post's comment_count
          await tx
            .update(posts)
            .set({
              commentCount: sql`GREATEST(0, ${posts.commentCount} - 1)`,
              updatedAt: new Date(),
            })
            .where(eq(posts.id, comment.postId));
        }
      }

      return true;
    });
  }

  /**
   * Finds a comment by ID.
   */
  async findCommentById(id: string): Promise<Comment | null> {
    const rows = await this.db.select().from(comments).where(eq(comments.id, id)).limit(1);

    return rows[0] ?? null;
  }

  /**
   * Transactionally toggles a boost on a comment or reply.
   * - Validates comment existence and status IN ('ACTIVE', 'IMAGE_HIDDEN').
   * - Rejects self-boosts (authorId === userId).
   * - Rejects boosts under a REMOVED post.
   * - Atomically inserts or deletes the comment_boosts row.
   * - Updates comment boostCount transactionally (GREATEST(0, boost_count - 1) on remove).
   */
  async toggleBoost(commentId: string, userId: string): Promise<{ isBoostedByMe: boolean; boostCount: number }> {
    return this.db.transaction(async (tx) => {
      // 1. Lock target comment
      const [comment] = await tx.select().from(comments).where(eq(comments.id, commentId)).for('update');

      if (!comment) {
        throw new NotFoundError('Comment', commentId);
      }

      // 2. Status check: must be ACTIVE or IMAGE_HIDDEN (cannot boost DELETED, HIDDEN, or REMOVED)
      if (comment.status !== 'ACTIVE' && comment.status !== 'IMAGE_HIDDEN') {
        throw new NotFoundError('Comment', commentId);
      }

      // 3. Self-boost rejection
      if (comment.authorId === userId) {
        throw new ForbiddenError('You cannot boost your own comment or reply');
      }

      // 4. Check parent post status
      const [post] = await tx.select().from(posts).where(eq(posts.id, comment.postId)).for('share');

      if (!post || post.status === 'REMOVED') {
        throw new NotFoundError('Post', comment.postId);
      }

      // 5. Check existing boost
      const [existing] = await tx
        .select()
        .from(commentBoosts)
        .where(and(eq(commentBoosts.userId, userId), eq(commentBoosts.commentId, commentId)))
        .for('update');

      if (existing) {
        // Remove boost
        await tx
          .delete(commentBoosts)
          .where(and(eq(commentBoosts.userId, userId), eq(commentBoosts.commentId, commentId)));

        const [updated] = await tx
          .update(comments)
          .set({
            boostCount: sql`GREATEST(0, ${comments.boostCount} - 1)`,
            updatedAt: new Date(),
          })
          .where(eq(comments.id, commentId))
          .returning({ boostCount: comments.boostCount });

        return {
          isBoostedByMe: false,
          boostCount: updated.boostCount,
        };
      } else {
        // Add boost
        await tx.insert(commentBoosts).values({
          userId,
          commentId,
        });

        const [updated] = await tx
          .update(comments)
          .set({
            boostCount: sql`${comments.boostCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(comments.id, commentId))
          .returning({ boostCount: comments.boostCount });

        return {
          isBoostedByMe: true,
          boostCount: updated.boostCount,
        };
      }
    });
  }

  /**
   * Checks if a user has boosted a specific comment or reply.
   */
  async isCommentBoostedByUser(commentId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: commentBoosts.id })
      .from(commentBoosts)
      .where(and(eq(commentBoosts.commentId, commentId), eq(commentBoosts.userId, userId)))
      .limit(1);

    return rows.length > 0;
  }

  /**
   * Creates a DataLoader that batch-checks "has this user boosted each comment?"
   * Accepts composite keys in the format `${userId}:${commentId}`.
   */
  createCommentBoostedByMeLoader(): DataLoader<string, boolean> {
    return new DataLoader<string, boolean>(
      async (keys: readonly string[]) => {
        if (keys.length === 0) return [];

        const pairs = keys.map((key) => {
          const colonIndex = key.indexOf(':');
          return {
            key,
            userId: key.substring(0, colonIndex),
            commentId: key.substring(colonIndex + 1),
          };
        });

        const userToCommentIds = new Map<string, string[]>();
        for (const { userId, commentId } of pairs) {
          if (!userId || !commentId) continue;
          const list = userToCommentIds.get(userId) ?? [];
          list.push(commentId);
          userToCommentIds.set(userId, list);
        }

        const boostedSet = new Set<string>();

        await Promise.all(
          Array.from(userToCommentIds.entries()).map(async ([userId, commentIds]) => {
            const rows = await this.db
              .select({ commentId: commentBoosts.commentId })
              .from(commentBoosts)
              .where(and(eq(commentBoosts.userId, userId), inArray(commentBoosts.commentId, commentIds)));

            for (const row of rows) {
              boostedSet.add(`${userId}:${row.commentId}`);
            }
          }),
        );

        return keys.map((key) => boostedSet.has(key));
      },
      { cache: true, maxBatchSize: 100 },
    );
  }
}

import { Injectable, Inject } from '@nestjs/common';
import { eq, and, ne, sql, gte, gt, lt, or, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import DataLoader from 'dataloader';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import {
  comments,
  commentIdempotency,
  commentBoosts,
  postPins,
  posts,
  stagedUploads,
  commentMedia,
  Comment,
  CommentIdempotency,
  CommentMedia,
} from '../database/schema';
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
   * stores attached comment media, and records durable idempotency metadata.
   */
  async createCommentWithCounter(params: {
    commentId?: string;
    postId: string;
    authorId: string;
    text: string;
    clientRequestId: string;
    requestHash: string;
    mediaData?: {
      id: string;
      storageKey: string;
      sha256: string;
      width: number;
      height: number;
      fileSizeBytes: number;
      fileContentType: string;
      displayOrder: number;
    };
  }): Promise<Comment> {
    const { commentId, postId, authorId, text, clientRequestId, requestHash, mediaData } = params;

    try {
      return await this.db.transaction(async (tx) => {
        // 1. Insert the comment
        const [newComment] = await tx
          .insert(comments)
          .values({
            ...(commentId ? { id: commentId } : {}),
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

        // 3. Insert media relationship if attached and finalize staged upload in DB
        if (mediaData) {
          await tx.insert(commentMedia).values({
            id: mediaData.id,
            commentId: newComment.id,
            storageKey: mediaData.storageKey,
            sha256: mediaData.sha256,
            width: mediaData.width,
            height: mediaData.height,
            fileSizeBytes: mediaData.fileSizeBytes,
            fileContentType: mediaData.fileContentType,
            displayOrder: mediaData.displayOrder,
          });

          await tx
            .update(stagedUploads)
            .set({
              status: 'FINALIZED',
              finalStorageKey: mediaData.storageKey,
              updatedAt: new Date(),
            })
            .where(eq(stagedUploads.id, mediaData.id));
        }

        // 4. Record durable author-scoped idempotency
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
   * Finds media attached to a comment, ordered by displayOrder ASC.
   */
  async findMediaByCommentId(commentId: string): Promise<CommentMedia[]> {
    return this.db
      .select()
      .from(commentMedia)
      .where(eq(commentMedia.commentId, commentId))
      .orderBy(sql`${commentMedia.displayOrder} ASC`);
  }

  /**
   * Batch-loads CommentMedia rows grouped by comment ID.
   */
  createCommentMediaByCommentIdLoader(): DataLoader<string, CommentMedia[]> {
    return new DataLoader<string, CommentMedia[]>(async (commentIds) => {
      const rows = await this.db
        .select()
        .from(commentMedia)
        .where(inArray(commentMedia.commentId, commentIds as string[]))
        .orderBy(sql`${commentMedia.displayOrder} ASC`);

      const map = new Map<string, CommentMedia[]>();
      for (const row of rows) {
        const list = map.get(row.commentId) ?? [];
        list.push(row);
        map.set(row.commentId, list);
      }

      return commentIds.map((id) => map.get(id) ?? []);
    });
  }

  /**
   * Finds the currently active pinned top-level comment for a post, if one exists.
   * Only returns the comment if its status is 'ACTIVE' or 'IMAGE_HIDDEN'.
   */
  async findPinnedCommentForPost(postId: string): Promise<Comment | null> {
    const rows = await this.db
      .select({ comment: comments })
      .from(postPins)
      .innerJoin(comments, eq(postPins.commentId, comments.id))
      .where(
        and(
          eq(postPins.postId, postId),
          eq(comments.postId, postId),
          sql`${comments.parentId} IS NULL`,
          inArray(comments.status, ['ACTIVE', 'IMAGE_HIDDEN']),
        ),
      )
      .limit(1);

    return rows[0]?.comment ?? null;
  }

  /**
   * Fetches visible top-level comments for a post ordered by:
   * - TOP: valid pinned comment first, then boostCount DESC, createdAt DESC, id DESC.
   * - NEWEST: valid pinned comment first, then createdAt DESC, id DESC.
   * Returns up to limit + 1 items for keyset continuation detection.
   * Includes deleted comments that have visible replies (replyCount > 0) as tombstones.
   * Excludes the pinned comment from subsequent positions to prevent duplication.
   */
  async findTopLevelCommentsByPostId(
    postId: string,
    limit: number,
    sort: CommentSortOrder = 'TOP',
    cursor?: CommentCursorPayload,
  ): Promise<Comment[]> {
    const pinnedComment = await this.findPinnedCommentForPost(postId);

    const baseConditions = [
      eq(comments.postId, postId),
      sql`${comments.parentId} IS NULL`,
      sql`(${comments.status} IN ('ACTIVE', 'IMAGE_HIDDEN') OR (${comments.status} = 'DELETED' AND ${comments.replyCount} > 0))`,
    ];

    if (pinnedComment) {
      baseConditions.push(ne(comments.id, pinnedComment.id));
    }

    const orderBys =
      sort === 'TOP'
        ? [sql`${comments.boostCount} DESC`, sql`${comments.createdAt} DESC`, sql`${comments.id} DESC`]
        : [sql`${comments.createdAt} DESC`, sql`${comments.id} DESC`];

    // Case 1: Cursor is after the pinned comment
    // The client has received the pinned comment on page 1 and is requesting regular comments starting from the top.
    if (cursor?.isPinned) {
      const rows = await this.db
        .select()
        .from(comments)
        .where(and(...baseConditions))
        .orderBy(...orderBys)
        .limit(limit + 1);

      return rows.map((c) => {
        const item = c.status === 'DELETED' ? { ...c, text: '[Deleted]' } : c;
        return Object.assign(item, { isPinned: false });
      });
    }

    // Case 2: Standard keyset cursor continuation
    if (cursor) {
      const cursorDate = new Date(cursor.createdAt);
      const cursorConditions = [...baseConditions];
      if (sort === 'TOP' && cursor.boostCount !== undefined) {
        const cursorBoost = cursor.boostCount;
        const cursorId = cursor.id;
        cursorConditions.push(
          sql`(${comments.boostCount} < ${cursorBoost} OR (${comments.boostCount} = ${cursorBoost} AND (${comments.createdAt} < ${cursorDate} OR (${comments.createdAt} = ${cursorDate} AND ${comments.id} < ${cursorId}))))`,
        );
      } else {
        cursorConditions.push(
          or(lt(comments.createdAt, cursorDate), and(eq(comments.createdAt, cursorDate), lt(comments.id, cursor.id)))!,
        );
      }

      const rows = await this.db
        .select()
        .from(comments)
        .where(and(...cursorConditions))
        .orderBy(...orderBys)
        .limit(limit + 1);

      return rows.map((c) => {
        const item = c.status === 'DELETED' ? { ...c, text: '[Deleted]' } : c;
        return Object.assign(item, { isPinned: false });
      });
    }

    // Case 3: Page 1 (no cursor)
    if (pinnedComment) {
      // Pinned comment takes slot 1. We query up to `limit` remaining items to evaluate hasNextPage.
      const rows = await this.db
        .select()
        .from(comments)
        .where(and(...baseConditions))
        .orderBy(...orderBys)
        .limit(limit);

      const formattedPinned = Object.assign(pinnedComment, { isPinned: true });
      const formattedRemaining = rows.map((c) => {
        const item = c.status === 'DELETED' ? { ...c, text: '[Deleted]' } : c;
        return Object.assign(item, { isPinned: false });
      });

      return [formattedPinned, ...formattedRemaining];
    }

    // No pinned comment on page 1
    const rows = await this.db
      .select()
      .from(comments)
      .where(and(...baseConditions))
      .orderBy(...orderBys)
      .limit(limit + 1);

    return rows.map((c) => {
      const item = c.status === 'DELETED' ? { ...c, text: '[Deleted]' } : c;
      return Object.assign(item, { isPinned: false });
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

      // 5. Delete pin record if this comment was pinned
      await tx.delete(postPins).where(eq(postPins.commentId, commentId));

      // 6. Decrement counters if the item was visible
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

  /**
   * Transactionally pins an active top-level comment beneath a post.
   * - Checks post exists, status !== 'REMOVED', creatorId === userId.
   * - Checks comment exists, parentId === null, status IN ('ACTIVE', 'IMAGE_HIDDEN').
   * - Atomic upsert into post_pins (replaces any existing pin for this post without gap).
   * - Returns comment with isPinned = true.
   */
  async pinComment(commentId: string, userId: string): Promise<Comment> {
    return this.db.transaction(async (tx) => {
      // 1. Lock and check the comment
      const [comment] = await tx.select().from(comments).where(eq(comments.id, commentId)).for('share');

      if (!comment) {
        throw new NotFoundError('Comment', commentId);
      }

      if (comment.parentId !== null) {
        throw new ValidationError('Only top-level comments can be pinned');
      }

      if (comment.status !== 'ACTIVE' && comment.status !== 'IMAGE_HIDDEN') {
        throw new NotFoundError('Comment', commentId);
      }

      // 2. Lock and check the post
      const [post] = await tx.select().from(posts).where(eq(posts.id, comment.postId)).for('share');

      if (!post || post.status === 'REMOVED') {
        throw new NotFoundError('Post', comment.postId);
      }

      // 3. Authorization check: Only post creator can pin
      if (post.creatorId !== userId) {
        throw new ForbiddenError('Only the post author can pin comments');
      }

      // 4. Atomic upsert into post_pins on postId conflict
      await tx
        .insert(postPins)
        .values({
          postId: post.id,
          commentId: comment.id,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: postPins.postId,
          set: {
            commentId: comment.id,
            updatedAt: new Date(),
          },
        });

      return Object.assign(comment, { isPinned: true });
    });
  }

  /**
   * Transactionally unpins the current pinned comment on a post.
   * - Checks post exists, status !== 'REMOVED', creatorId === userId.
   * - Idempotent: deletes from post_pins where postId = postId.
   * - Returns true.
   */
  async unpinComment(postId: string, userId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      // 1. Lock and check the post
      const [post] = await tx.select().from(posts).where(eq(posts.id, postId)).for('share');

      if (!post || post.status === 'REMOVED') {
        throw new NotFoundError('Post', postId);
      }

      // 2. Authorization check: Only post creator can unpin
      if (post.creatorId !== userId) {
        throw new ForbiddenError('Only the post author can unpin comments');
      }

      // 3. Delete from post_pins
      await tx.delete(postPins).where(eq(postPins.postId, postId));

      return true;
    });
  }

  /**
   * Checks if a specific comment is the currently active pinned comment for a post.
   */
  async isCommentPinned(postId: string, commentId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: postPins.id })
      .from(postPins)
      .innerJoin(comments, eq(postPins.commentId, comments.id))
      .where(
        and(
          eq(postPins.postId, postId),
          eq(postPins.commentId, commentId),
          sql`${comments.parentId} IS NULL`,
          inArray(comments.status, ['ACTIVE', 'IMAGE_HIDDEN']),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  /**
   * Creates a DataLoader that batch-loads the active pinned commentId for each postId.
   * Returns `null` if the post has no active pinned comment.
   */
  createPinnedCommentIdByPostIdLoader(): DataLoader<string, string | null> {
    return new DataLoader<string, string | null>(
      async (postIds: readonly string[]) => {
        if (postIds.length === 0) return [];

        const uniquePostIds = Array.from(new Set(postIds));

        const rows = await this.db
          .select({
            postId: postPins.postId,
            commentId: postPins.commentId,
          })
          .from(postPins)
          .innerJoin(comments, eq(postPins.commentId, comments.id))
          .where(
            and(
              inArray(postPins.postId, uniquePostIds),
              sql`${comments.parentId} IS NULL`,
              inArray(comments.status, ['ACTIVE', 'IMAGE_HIDDEN']),
            ),
          );

        const postToPinnedComment = new Map<string, string>();
        for (const row of rows) {
          postToPinnedComment.set(row.postId, row.commentId);
        }

        return postIds.map((id) => postToPinnedComment.get(id) ?? null);
      },
      { cache: true, maxBatchSize: 100 },
    );
  }
}

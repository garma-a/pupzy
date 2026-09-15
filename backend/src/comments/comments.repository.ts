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
  mediaDeletionWork,
  commentReports,
  discussionNotificationEvents,
  users,
  Post,
  Comment,
  CommentIdempotency,
  CommentMedia,
  CommentReport,
} from '../database/schema';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../common/errors/app.errors';
import { CommentCursorPayload, CommentSortOrder } from './dto/comments-query.input';
import { getCommentMediaPurgeUrls } from '../upload/media-delivery.util';
import { CommentsQuotaManager, QuotaReservation } from './comments-quota.manager';
import { withDbRetry } from '../common/utils/db-retry.util';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];
type DbExecutor = NodePgDatabase<typeof schema> | DbTransaction;

interface DatabaseErrorLike {
  code?: string;
  message?: string;
  cause?: { code?: string; message?: string };
  driverError?: { code?: string; message?: string };
}

type DiscussionNotificationType = 'NEW_COMMENT' | 'NEW_REPLY' | 'COMMENT_BOOSTED' | 'COMMENT_PINNED';

export interface FinalizedCommentMedia {
  id: string;
  commentId?: string;
  storageKey: string;
  stagingKey?: string;
  sha256: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  fileContentType: string;
  displayOrder: number;
}

/**
 * Global counter repair is deliberately paged. Keeping this modest means an
 * operational repair never turns its discovery query into an unbounded heap
 * allocation or holds discussion locks for more than one Post at a time.
 */
const COUNTER_RECONCILIATION_POST_BATCH_SIZE = 100;

export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const dbErr = err as DatabaseErrorLike;
  if (dbErr.code === '23505') return true;
  if (dbErr.cause?.code === '23505') return true;
  if (dbErr.driverError?.code === '23505') return true;
  const msg = `${dbErr.message ?? ''} ${dbErr.cause?.message ?? ''} ${dbErr.driverError?.message ?? ''}`;
  return msg.includes('23505') || msg.toLowerCase().includes('unique constraint');
}

@Injectable()
export class CommentsRepository {
  private readonly quotaManager: CommentsQuotaManager;

  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {
    this.quotaManager = new CommentsQuotaManager(this.db);
  }

  /**
   * Serializes one Post's discussion writes before acquiring any discussion row:
   * advisory Post key -> Post -> parent Comment -> target Comment -> pin/report
   * rows. The exclusive Post lock is deliberate, including validation-only
   * reads: report threshold crossings can update its counter and must never
   * upgrade a shared Post lock while another mutation holds one.
   *
   * `postId` comes from an unlocked preflight lookup only to choose this
   * advisory key. Every authorization and lifecycle check is repeated after
   * the transaction locks the canonical rows.
   */
  private async lockDiscussionPost(tx: DbExecutor, postId: string): Promise<Post> {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended('comment_discussion:' || ${postId}, 0))
    `);

    const [post] = await tx.select().from(posts).where(eq(posts.id, postId)).for('update');
    if (!post) throw new NotFoundError('Post', postId);
    return post;
  }

  private async getDiscussionActorName(tx: DbExecutor, actorId: string): Promise<string> {
    const [actor] = await tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, actorId)).limit(1);
    return actor?.fullName?.trim() || 'Someone';
  }

  /**
   * Writes a source event inside the same transaction as its discussion
   * mutation. The unique source identity is the first deduplication boundary;
   * the processor has a second unique boundary on the inbox row it creates.
   */
  private async enqueueDiscussionNotificationEvent(
    tx: DbExecutor,
    event: {
      sourceEventId: string;
      recipientId: string;
      actorId: string;
      type: DiscussionNotificationType;
      title: string;
      body: string;
      relatedPostId: string;
      relatedCommentId: string;
    },
  ): Promise<void> {
    if (event.recipientId === event.actorId) return;
    await tx.insert(discussionNotificationEvents).values(event).onConflictDoNothing();
  }

  /**
   * Atomically checks and reserves creation quota (10/min, 100/day).
   */
  async reserveCreationQuota(userId: string, clientRequestId?: string): Promise<QuotaReservation> {
    return this.quotaManager.reserveCreationQuota(userId, clientRequestId);
  }

  /**
   * Atomically checks and records quota for comment boost toggle (60/min).
   */
  async checkAndRecordBoostQuota(userId: string): Promise<QuotaReservation> {
    return this.quotaManager.checkAndRecordBoostQuota(userId);
  }

  /**
   * Atomically checks and records quota for comment report (10/day).
   */
  async checkAndRecordReportQuota(userId: string): Promise<QuotaReservation> {
    return this.quotaManager.checkAndRecordReportQuota(userId);
  }

  /**
   * Resets quota admissions for a user.
   */
  async resetQuota(userId: string, action?: string): Promise<void> {
    return this.quotaManager.resetQuota(userId, action);
  }

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
    mediaItems?: FinalizedCommentMedia[];
  }): Promise<Comment> {
    const { commentId, postId, authorId, text, clientRequestId, requestHash, mediaItems } = params;
    const itemsToInsert = mediaItems ?? [];

    try {
      return await withDbRetry(() =>
        this.db.transaction(async (tx) => {
          // The Post is always locked before discussion rows or counters.
          const post = await this.lockDiscussionPost(tx, postId);
          if (post.status === 'REMOVED') throw new NotFoundError('Post', postId);

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

          // 3. Insert media relationships if attached and finalize staged uploads in DB
          for (const item of itemsToInsert) {
            await tx.insert(commentMedia).values({
              id: item.id,
              commentId: newComment.id,
              storageKey: item.storageKey,
              sha256: item.sha256,
              width: item.width,
              height: item.height,
              fileSizeBytes: item.fileSizeBytes,
              fileContentType: item.fileContentType,
              displayOrder: item.displayOrder,
            });

            await tx
              .update(stagedUploads)
              .set({
                status: 'FINALIZED',
                finalStorageKey: item.storageKey,
                updatedAt: new Date(),
              })
              .where(eq(stagedUploads.id, item.id));
          }

          // 4. Record durable author-scoped idempotency
          await tx.insert(commentIdempotency).values({
            authorId,
            clientRequestId,
            requestHash,
            commentId: newComment.id,
            responsePayload: newComment,
          });

          const actorName = await this.getDiscussionActorName(tx, authorId);
          await this.enqueueDiscussionNotificationEvent(tx, {
            sourceEventId: `NEW_COMMENT:${newComment.id}`,
            recipientId: post.creatorId,
            actorId: authorId,
            type: 'NEW_COMMENT',
            title: 'New comment',
            body: `${actorName} commented on your post "${post.title}"`,
            relatedPostId: post.id,
            relatedCommentId: newComment.id,
          });

          return newComment;
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findIdempotencyRecord(authorId, clientRequestId);
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new ConflictError('Client request ID was previously used with different parameters');
          }
          const payload = existing.responsePayload;
          let payloadId: string | undefined;
          if (typeof payload === 'object' && payload !== null && 'id' in payload && typeof payload.id === 'string') {
            payloadId = payload.id;
          }
          const targetCommentId = existing.commentId ?? payloadId;
          if (targetCommentId) {
            const fresh = await this.findCommentById(targetCommentId);
            if (fresh) {
              return fresh;
            }
          }
          return existing.responsePayload as Comment;
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
      .innerJoin(posts, eq(postPins.postId, posts.id))
      .where(
        and(
          eq(postPins.postId, postId),
          eq(comments.postId, postId),
          sql`${comments.parentId} IS NULL`,
          inArray(comments.status, ['ACTIVE', 'IMAGE_HIDDEN']),
          ne(posts.status, 'REMOVED'),
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
      sql`(${comments.status} IN ('ACTIVE', 'IMAGE_HIDDEN') OR (${comments.status} IN ('DELETED', 'HIDDEN') AND ${comments.replyCount} > 0))`,
    ];

    if (pinnedComment) {
      baseConditions.push(ne(comments.id, pinnedComment.id));
    }

    const orderBys =
      sort === 'TOP'
        ? [sql`${comments.boostCount} DESC`, sql`${comments.createdAt} DESC`, sql`${comments.id} DESC`]
        : [sql`${comments.createdAt} DESC`, sql`${comments.id} DESC`];

    const formatRow = (c: Comment): Comment => {
      let item = c;
      if (c.status === 'DELETED') {
        item = { ...c, text: '[Deleted]' };
      } else if (c.status === 'HIDDEN') {
        item = { ...c, text: '[Hidden]' };
      }
      return Object.assign(item, { isPinned: false });
    };

    // Case 1: Cursor is after the pinned comment
    // The client has received the pinned comment on page 1 and is requesting regular comments starting from the top.
    if (cursor?.isPinned) {
      const rows = await this.db
        .select()
        .from(comments)
        .where(and(...baseConditions))
        .orderBy(...orderBys)
        .limit(limit + 1);

      return rows.map(formatRow);
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

      return rows.map(formatRow);
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
      const formattedRemaining = rows.map(formatRow);

      return [formattedPinned, ...formattedRemaining];
    }

    // No pinned comment on page 1
    const rows = await this.db
      .select()
      .from(comments)
      .where(and(...baseConditions))
      .orderBy(...orderBys)
      .limit(limit + 1);

    return rows.map(formatRow);
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
    replyId?: string;
    commentId: string;
    authorId: string;
    text: string;
    clientRequestId: string;
    requestHash: string;
  }): Promise<Comment> {
    const { replyId, commentId, authorId, text, clientRequestId, requestHash } = params;
    const parentBeforeLock = await this.findCommentById(commentId);
    if (!parentBeforeLock) throw new NotFoundError('Comment', commentId);

    try {
      return await withDbRetry(() =>
        this.db.transaction(async (tx) => {
          // Post -> parent is the discussion lock order.
          const post = await this.lockDiscussionPost(tx, parentBeforeLock.postId);
          if (post.status === 'REMOVED') throw new NotFoundError('Post', parentBeforeLock.postId);
          // 1. Lock parent comment with FOR UPDATE
          const [parent] = await tx.select().from(comments).where(eq(comments.id, commentId)).for('update');

          if (!parent || parent.status === 'REMOVED') {
            throw new NotFoundError('Comment', commentId);
          }

          // Nesting check: Replies cannot receive replies
          if (parent.parentId !== null) {
            throw new ValidationError('Replies cannot receive replies');
          }

          if ((parent.status === 'DELETED' || parent.status === 'HIDDEN') && parent.replyCount === 0) {
            throw new NotFoundError('Comment', commentId);
          }

          // Status check: parent must be ACTIVE or IMAGE_HIDDEN (cannot reply to DELETED, HIDDEN, or REMOVED)
          if (parent.status !== 'ACTIVE' && parent.status !== 'IMAGE_HIDDEN') {
            throw new NotFoundError('Comment', commentId);
          }

          // 3. Insert reply
          const [newReply] = await tx
            .insert(comments)
            .values({
              ...(replyId ? { id: replyId } : {}),
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

          const actorName = await this.getDiscussionActorName(tx, authorId);
          await this.enqueueDiscussionNotificationEvent(tx, {
            sourceEventId: `NEW_REPLY:${newReply.id}`,
            recipientId: parent.authorId,
            actorId: authorId,
            type: 'NEW_REPLY',
            title: 'New reply',
            body: `${actorName} replied to your comment`,
            relatedPostId: post.id,
            relatedCommentId: newReply.id,
          });

          return newReply;
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findIdempotencyRecord(authorId, clientRequestId);
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new ConflictError('Client request ID was previously used with different parameters');
          }
          const payload = existing.responsePayload;
          let payloadId: string | undefined;
          if (typeof payload === 'object' && payload !== null && 'id' in payload && typeof payload.id === 'string') {
            payloadId = payload.id;
          }
          const targetCommentId = existing.commentId ?? payloadId;
          if (targetCommentId) {
            const fresh = await this.findCommentById(targetCommentId);
            if (fresh) {
              return fresh;
            }
          }
          return existing.responsePayload as Comment;
        }
      }
      throw error;
    }
  }

  /**
   * Enqueues durable media deletion work for compensation or cleanup.
   */
  async queueMediaDeletionWork(storageKey: string, cdnUrl: string): Promise<void> {
    await this.db.insert(mediaDeletionWork).values({
      storageKey,
      cdnUrl,
      status: 'PENDING',
      attempts: 0,
    });
  }

  /**
   * Transactionally deletes a comment or reply.
   * - Enforces author ownership (rejects other users and post authors).
   * - Idempotent: returns true if already DELETED.
   * - Irreversible: updates status to DELETED.
   * - Immediately removes public media relationship and creates durable work for R2 deletion & CDN purge.
   * - Decrements engagement counts transactionally.
   */
  async deleteCommentWithCounters(
    commentId: string,
    userId: string,
    cdnBase: string = 'https://cdn.pupzy.net',
  ): Promise<boolean> {
    const commentBeforeLock = await this.findCommentById(commentId);
    if (!commentBeforeLock) throw new NotFoundError('Comment', commentId);

    return withDbRetry(() =>
      this.db.transaction(async (tx) => {
        // Post -> parent -> target is the discussion lock order.
        await this.lockDiscussionPost(tx, commentBeforeLock.postId);
        let lockedParent: Comment | undefined;
        if (commentBeforeLock.parentId) {
          [lockedParent] = await tx
            .select()
            .from(comments)
            .where(eq(comments.id, commentBeforeLock.parentId))
            .for('update');
        }
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

        // 4. Immediately remove public media relationship and queue durable work for R2 deletion and CDN purge
        const mediaRows = await tx.select().from(commentMedia).where(eq(commentMedia.commentId, commentId));
        if (mediaRows.length > 0) {
          await tx.delete(commentMedia).where(eq(commentMedia.commentId, commentId));
          for (const row of mediaRows) {
            const purgeUrls = getCommentMediaPurgeUrls(row.storageKey, { cdnBase });
            for (const cdnUrl of purgeUrls) {
              await tx.insert(mediaDeletionWork).values({
                storageKey: row.storageKey,
                cdnUrl,
                status: 'PENDING',
                attempts: 0,
              });
            }
          }
        }

        // 5. Mark status DELETED
        await tx
          .update(comments)
          .set({
            status: 'DELETED',
            updatedAt: new Date(),
          })
          .where(eq(comments.id, commentId));

        // 6. Delete pin record if this comment was pinned
        await tx.delete(postPins).where(eq(postPins.commentId, commentId));

        // 7. Decrement counters if the item was visible
        if (comment.parentId) {
          const parent = lockedParent;
          if (wasVisible && parent && parent.status !== 'REMOVED') {
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
          }
        } else {
          if (wasVisible) {
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
      }),
    );
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
    const commentBeforeLock = await this.findCommentById(commentId);
    if (!commentBeforeLock) throw new NotFoundError('Comment', commentId);

    return withDbRetry(() =>
      this.db.transaction(async (tx) => {
        const post = await this.lockDiscussionPost(tx, commentBeforeLock.postId);
        if (post.status === 'REMOVED') throw new NotFoundError('Post', commentBeforeLock.postId);

        let parent: Comment | undefined;
        if (commentBeforeLock.parentId) {
          [parent] = await tx.select().from(comments).where(eq(comments.id, commentBeforeLock.parentId)).for('update');
        }

        const [comment] = await tx.select().from(comments).where(eq(comments.id, commentId)).for('update');
        if (!comment || comment.postId !== post.id) throw new NotFoundError('Comment', commentId);

        // Status check: must be ACTIVE or IMAGE_HIDDEN (cannot boost DELETED, HIDDEN, or REMOVED)
        if (comment.status !== 'ACTIVE' && comment.status !== 'IMAGE_HIDDEN') {
          throw new NotFoundError('Comment', commentId);
        }

        // The parent is held FOR UPDATE before its Reply target.
        if (comment.parentId !== null) {
          if (!parent || parent.status === 'REMOVED') {
            throw new NotFoundError('Comment', commentId);
          }
          if ((parent.status === 'DELETED' || parent.status === 'HIDDEN') && parent.replyCount === 0) {
            throw new NotFoundError('Comment', commentId);
          }
        }

        if (comment.authorId === userId) {
          throw new ForbiddenError('You cannot boost your own comment or reply');
        }

        const [existing] = await tx
          .select()
          .from(commentBoosts)
          .where(and(eq(commentBoosts.userId, userId), eq(commentBoosts.commentId, commentId)))
          .for('update');

        if (existing) {
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

          return { isBoostedByMe: false, boostCount: updated.boostCount };
        }

        const [newBoost] = await tx
          .insert(commentBoosts)
          .values({ userId, commentId })
          .returning({ id: commentBoosts.id });
        const [updated] = await tx
          .update(comments)
          .set({
            boostCount: sql`${comments.boostCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(comments.id, commentId))
          .returning({ boostCount: comments.boostCount });

        const actorName = await this.getDiscussionActorName(tx, userId);
        await this.enqueueDiscussionNotificationEvent(tx, {
          sourceEventId: `COMMENT_BOOSTED:${newBoost.id}`,
          recipientId: comment.authorId,
          actorId: userId,
          type: 'COMMENT_BOOSTED',
          title: 'Comment boosted',
          body: `${actorName} boosted your ${comment.parentId ? 'reply' : 'comment'}`,
          relatedPostId: post.id,
          relatedCommentId: comment.id,
        });

        return { isBoostedByMe: true, boostCount: updated.boostCount };
      }),
    );
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
  async pinComment(
    commentId: string,
    userId: string,
  ): Promise<{ comment: Comment; isNewPin: boolean; postTitle: string }> {
    const commentBeforeLock = await this.findCommentById(commentId);
    if (!commentBeforeLock) throw new NotFoundError('Comment', commentId);

    return withDbRetry(() =>
      this.db.transaction(async (tx) => {
        const post = await this.lockDiscussionPost(tx, commentBeforeLock.postId);
        if (post.status === 'REMOVED') throw new NotFoundError('Post', commentBeforeLock.postId);

        const [comment] = await tx.select().from(comments).where(eq(comments.id, commentId)).for('update');
        if (!comment || comment.postId !== post.id) throw new NotFoundError('Comment', commentId);

        if (comment.parentId !== null) {
          throw new ValidationError('Only top-level comments can be pinned');
        }
        if (comment.status !== 'ACTIVE' && comment.status !== 'IMAGE_HIDDEN') {
          throw new NotFoundError('Comment', commentId);
        }
        if (post.creatorId !== userId) {
          throw new ForbiddenError('Only the post author can pin comments');
        }

        const [previousPin] = await tx.select().from(postPins).where(eq(postPins.postId, post.id));
        const isNewPin = !previousPin || previousPin.commentId !== comment.id;

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

        if (isNewPin) {
          await this.enqueueDiscussionNotificationEvent(tx, {
            sourceEventId: `COMMENT_PINNED:${generateUuidV7()}`,
            recipientId: comment.authorId,
            actorId: userId,
            type: 'COMMENT_PINNED',
            title: 'Comment pinned',
            body: `Your comment was pinned on "${post.title}"`,
            relatedPostId: post.id,
            relatedCommentId: comment.id,
          });
        }

        return {
          comment: Object.assign(comment, { isPinned: true }),
          isNewPin,
          postTitle: post.title,
        };
      }),
    );
  }

  /**
   * Transactionally unpins the current pinned comment on a post.
   * - Checks post exists, status !== 'REMOVED', creatorId === userId.
   * - Idempotent: deletes from post_pins where postId = postId.
   * - Returns true.
   */
  async unpinComment(postId: string, userId: string): Promise<boolean> {
    return withDbRetry(() =>
      this.db.transaction(async (tx) => {
        const post = await this.lockDiscussionPost(tx, postId);
        if (post.status === 'REMOVED') throw new NotFoundError('Post', postId);
        if (post.creatorId !== userId) {
          throw new ForbiddenError('Only the post author can unpin comments');
        }

        await tx.delete(postPins).where(eq(postPins.postId, postId));
        return true;
      }),
    );
  }

  /**
   * Checks if a specific comment is the currently active pinned comment for a post.
   */
  async isCommentPinned(postId: string, commentId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: postPins.id })
      .from(postPins)
      .innerJoin(comments, eq(postPins.commentId, comments.id))
      .innerJoin(posts, eq(postPins.postId, posts.id))
      .where(
        and(
          eq(postPins.postId, postId),
          eq(postPins.commentId, commentId),
          sql`${comments.parentId} IS NULL`,
          inArray(comments.status, ['ACTIVE', 'IMAGE_HIDDEN']),
          ne(posts.status, 'REMOVED'),
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
          .innerJoin(posts, eq(postPins.postId, posts.id))
          .where(
            and(
              inArray(postPins.postId, uniquePostIds),
              sql`${comments.parentId} IS NULL`,
              inArray(comments.status, ['ACTIVE', 'IMAGE_HIDDEN']),
              ne(posts.status, 'REMOVED'),
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

  /**
   * Counts how many reports the user has submitted within a given time window.
   */
  async countRecentReportsByReporter(reporterId: string, since: Date): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(commentReports)
      .where(and(eq(commentReports.reporterId, reporterId), gte(commentReports.createdAt, since)));

    return result[0]?.count ?? 0;
  }

  /**
   * Finds a report for a specific comment and reporter.
   */
  async findReportByCommentAndReporter(commentId: string, reporterId: string): Promise<CommentReport | null> {
    const rows = await this.db
      .select()
      .from(commentReports)
      .where(and(eq(commentReports.commentId, commentId), eq(commentReports.reporterId, reporterId)))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Fetches all reports submitted for a comment (for admin queue verification).
   */
  async findReportsByCommentId(commentId: string): Promise<CommentReport[]> {
    return this.db
      .select()
      .from(commentReports)
      .where(eq(commentReports.commentId, commentId))
      .orderBy(sql`${commentReports.createdAt} DESC`);
  }

  /**
   * Transactionally records a comment moderation report and evaluates automatic hiding thresholds.
   * - Checks target comment exists and status NOT IN ('DELETED', 'REMOVED').
   * - Checks target post exists and status !== 'REMOVED'.
   * - Rejects self-reports (comment.authorId === reporterId).
   * - Enforces one report per user per comment (returns conflict on duplicate).
   * - Inserts report into comment_reports (all reports stored for AdminJS queue).
   * - Counts qualifying reports:
   *   * Joined user created <= report.created_at - interval '24 hours'
   *   * Joined user full_name IS NOT NULL AND length(trim(full_name)) > 0
   * - If qualifying reports >= 3 and status IN ('ACTIVE', 'IMAGE_HIDDEN'):
   *   * Status -> 'HIDDEN'
   *   * Invalidate pin (delete from post_pins)
   *   * Decrement post comment_count (and parent reply_count if reply)
   * - Else if qualifying reports has >= 1 'INAPPROPRIATE_CONTENT' and status === 'ACTIVE':
   *   * Status -> 'IMAGE_HIDDEN'
   *   * Counts and pin remain unchanged
   */
  async reportComment(params: {
    commentId: string;
    reporterId: string;
    reason: schema.ReportReason;
    details?: string;
  }): Promise<boolean> {
    const { commentId, reporterId, reason, details } = params;
    const commentBeforeLock = await this.findCommentById(commentId);
    if (!commentBeforeLock) throw new NotFoundError('Comment', commentId);

    try {
      return await withDbRetry(() =>
        this.db.transaction(async (tx) => {
          // A report can change status, pins, and counters. It therefore takes
          // the same exclusive Post lock as every other discussion mutation.
          const post = await this.lockDiscussionPost(tx, commentBeforeLock.postId);
          if (post.status === 'REMOVED') throw new NotFoundError('Comment', commentId);

          let parent: Comment | undefined;
          if (commentBeforeLock.parentId) {
            [parent] = await tx
              .select()
              .from(comments)
              .where(eq(comments.id, commentBeforeLock.parentId))
              .for('update');
          }

          const [comment] = await tx.select().from(comments).where(eq(comments.id, commentId)).for('update');
          if (!comment || comment.postId !== post.id) throw new NotFoundError('Comment', commentId);
          if (comment.status === 'DELETED' || comment.status === 'REMOVED') {
            throw new NotFoundError('Comment', commentId);
          }

          if (comment.parentId !== null) {
            if (!parent || parent.status === 'REMOVED') {
              throw new NotFoundError('Comment', commentId);
            }
            if ((parent.status === 'DELETED' || parent.status === 'HIDDEN') && parent.replyCount === 0) {
              throw new NotFoundError('Comment', commentId);
            }
          }

          if (comment.authorId === reporterId) {
            throw new ForbiddenError('You cannot report your own comment');
          }

          const [existingReport] = await tx
            .select()
            .from(commentReports)
            .where(and(eq(commentReports.commentId, commentId), eq(commentReports.reporterId, reporterId)))
            .limit(1);
          if (existingReport) {
            throw new ConflictError('You have already reported this comment', 'COMMENT_ALREADY_REPORTED');
          }

          await tx.insert(commentReports).values({
            commentId,
            reporterId,
            reason,
            details: details ?? null,
          });

          const qualifyingStats = await tx.execute<{ total_qualifying: number; inappropriate_qualifying: number }>(sql`
          SELECT
            count(*)::int AS total_qualifying,
            count(*) FILTER (WHERE cr.reason = 'INAPPROPRIATE_CONTENT')::int AS inappropriate_qualifying
          FROM comment_reports cr
          JOIN users u ON u.id = cr.reporter_id
          WHERE cr.comment_id = ${commentId}
            AND cr.reviewed_at IS NULL
            AND u.created_at <= cr.created_at - interval '24 hours'
            AND u.full_name IS NOT NULL
            AND length(trim(u.full_name)) > 0
        `);

          const totalQualifying = Number(qualifyingStats.rows[0]?.total_qualifying ?? 0);
          const inappropriateQualifying = Number(qualifyingStats.rows[0]?.inappropriate_qualifying ?? 0);

          if (totalQualifying >= 3) {
            if (comment.status === 'ACTIVE' || comment.status === 'IMAGE_HIDDEN') {
              await tx
                .update(comments)
                .set({ status: 'HIDDEN', updatedAt: new Date() })
                .where(eq(comments.id, commentId));

              await tx.delete(postPins).where(eq(postPins.commentId, commentId));

              if (comment.parentId) {
                if (parent && parent.status !== 'REMOVED') {
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
                }
              } else {
                await tx
                  .update(posts)
                  .set({
                    commentCount: sql`GREATEST(0, ${posts.commentCount} - 1)`,
                    updatedAt: new Date(),
                  })
                  .where(eq(posts.id, comment.postId));
              }
            }
          } else if (inappropriateQualifying >= 1 && comment.status === 'ACTIVE') {
            await tx
              .update(comments)
              .set({ status: 'IMAGE_HIDDEN', updatedAt: new Date() })
              .where(eq(comments.id, commentId));
          }

          return true;
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('You have already reported this comment', 'COMMENT_ALREADY_REPORTED');
      }
      throw error;
    }
  }

  /**
   * Reconciles comment and reply counters to ensure reachability consistency.
   * - Computes reachable comment_count for posts:
   *   Visible top-level comments (ACTIVE, IMAGE_HIDDEN) + visible replies under non-REMOVED parents.
   * - Computes reachable reply_count for top-level comments:
   *   0 if parent is REMOVED, otherwise count of active/image_hidden replies.
   * - Computes boost_count for comments from comment_boosts table.
   * Returns counts of repaired posts and comments.
   */
  async reconcileCommentCounters(options?: {
    postId?: string;
  }): Promise<{ postsRepaired: number; commentsRepaired: number }> {
    let postsRepaired = 0;
    let commentsRepaired = 0;

    if (options?.postId) {
      return this.reconcileCommentCountersForPost({ postId: options.postId });
    }

    // A global repair deliberately commits each Post separately. Discovery is
    // keyset-paged rather than materializing every Post ID in Node. It is not
    // a database snapshot: a concurrently created/moved Post on or below the
    // cursor can be picked up by the next run. Each Post that is selected is
    // nevertheless recalculated only after its own canonical discussion locks
    // are held, so this scan never writes a stale count over a concurrent
    // discussion mutation.
    let afterPostId: string | undefined;
    while (true) {
      const postPage = await this.db
        .select({ id: posts.id })
        .from(posts)
        .where(afterPostId ? gt(posts.id, afterPostId) : undefined)
        .orderBy(posts.id)
        .limit(COUNTER_RECONCILIATION_POST_BATCH_SIZE);
      if (postPage.length === 0) break;

      for (const post of postPage) {
        const repaired = await this.reconcileCommentCountersForPost({ postId: post.id });
        postsRepaired += repaired.postsRepaired;
        commentsRepaired += repaired.commentsRepaired;
      }
      afterPostId = postPage[postPage.length - 1].id;
    }
    return { postsRepaired, commentsRepaired };
  }

  private async reconcileCommentCountersForPost(options: {
    postId: string;
  }): Promise<{ postsRepaired: number; commentsRepaired: number }> {
    return withDbRetry(() =>
      this.db.transaction(async (tx) => {
        await this.lockDiscussionPost(tx, options.postId);
        // 1. Reconcile posts comment_count
        const postFilter = options?.postId ? sql`WHERE p.id = ${options.postId}` : sql``;
        const postReconcileResult = await tx.execute<{ id: string }>(sql`
        WITH reachable_replies AS (
          SELECT c.post_id, count(*)::int AS reply_count
          FROM comments c
          JOIN comments p ON c.parent_id = p.id
          WHERE c.status IN ('ACTIVE', 'IMAGE_HIDDEN')
            AND p.status != 'REMOVED'
            ${options?.postId ? sql`AND c.post_id = ${options.postId}` : sql``}
          GROUP BY c.post_id
        ),
        reachable_top_level AS (
          SELECT post_id, count(*)::int AS top_count
          FROM comments
          WHERE parent_id IS NULL
            AND status IN ('ACTIVE', 'IMAGE_HIDDEN')
            ${options?.postId ? sql`AND post_id = ${options.postId}` : sql``}
          GROUP BY post_id
        ),
        computed_counts AS (
          SELECT 
            p.id AS post_id,
            COALESCE(tl.top_count, 0) + COALESCE(rr.reply_count, 0) AS expected_comment_count
          FROM posts p
          LEFT JOIN reachable_top_level tl ON p.id = tl.post_id
          LEFT JOIN reachable_replies rr ON p.id = rr.post_id
          ${postFilter}
        )
        UPDATE posts
        SET comment_count = cc.expected_comment_count,
            updated_at = now()
        FROM computed_counts cc
        WHERE posts.id = cc.post_id
          AND posts.comment_count != cc.expected_comment_count
        RETURNING posts.id
      `);

        // 2. Reconcile comments reply_count
        const replyReconcileResult = await tx.execute<{ id: string }>(sql`
        WITH computed_reply_counts AS (
          SELECT 
            p.id AS comment_id,
            CASE 
              WHEN p.status = 'REMOVED' THEN 0
              ELSE COALESCE(COUNT(c.id) FILTER (WHERE c.status IN ('ACTIVE', 'IMAGE_HIDDEN')), 0)::int
            END AS expected_reply_count
          FROM comments p
          LEFT JOIN comments c ON c.parent_id = p.id
          WHERE p.parent_id IS NULL
            ${options?.postId ? sql`AND p.post_id = ${options.postId}` : sql``}
          GROUP BY p.id, p.status
        )
        UPDATE comments
        SET reply_count = crc.expected_reply_count,
            updated_at = now()
        FROM computed_reply_counts crc
        WHERE comments.id = crc.comment_id
          AND comments.reply_count != crc.expected_reply_count
        RETURNING comments.id
      `);

        // 3. Reconcile comments boost_count
        const boostReconcileResult = await tx.execute<{ id: string }>(sql`
        WITH computed_boost_counts AS (
          SELECT 
            c.id AS comment_id,
            COALESCE(COUNT(cb.id), 0)::int AS expected_boost_count
          FROM comments c
          LEFT JOIN comment_boosts cb ON c.id = cb.comment_id
          ${options?.postId ? sql`WHERE c.post_id = ${options.postId}` : sql``}
          GROUP BY c.id
        )
        UPDATE comments
        SET boost_count = cbc.expected_boost_count,
            updated_at = now()
        FROM computed_boost_counts cbc
        WHERE comments.id = cbc.comment_id
          AND comments.boost_count != cbc.expected_boost_count
        RETURNING comments.id
      `);

        const repairedCommentIds = new Set<string>();
        for (const row of replyReconcileResult.rows) {
          repairedCommentIds.add(row.id);
        }
        for (const row of boostReconcileResult.rows) {
          repairedCommentIds.add(row.id);
        }

        return {
          postsRepaired: postReconcileResult.rows.length,
          commentsRepaired: repairedCommentIds.size,
        };
      }),
    );
  }
}

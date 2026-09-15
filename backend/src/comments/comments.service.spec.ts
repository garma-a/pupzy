import * as crypto from 'crypto';
import { CommentsService } from './comments.service';
import { CommentsRepository } from './comments.repository';
import { PostsRepository } from '../posts/posts.repository';
import { NotFoundError, ConflictError, AppError } from '../common/errors/app.errors';
import { Comment, Post } from '../database/schema';
import { UploadService } from '../upload/upload.service';
import { MediaDeletionProcessor } from '../upload/media-deletion.processor';

describe('CommentsService', () => {
  let service: CommentsService;
  let mockCommentsRepo: {
    findIdempotencyRecord: jest.Mock;
    countRecentCreationsByAuthor: jest.Mock;
    createCommentWithCounter: jest.Mock;
    findTopLevelCommentsByPostId: jest.Mock;
    findCommentById: jest.Mock;
    createReplyWithCounters: jest.Mock;
    findRepliesByCommentId: jest.Mock;
    deleteCommentWithCounters: jest.Mock;
    toggleBoost: jest.Mock;
    isCommentBoostedByUser: jest.Mock;
    pinComment: jest.Mock;
    unpinComment: jest.Mock;
    isCommentPinned: jest.Mock;
    queueMediaDeletionWork: jest.Mock;
    countRecentReportsByReporter: jest.Mock;
    reportComment: jest.Mock;
  };
  let mockPostsRepo: {
    findById: jest.Mock;
  };
  let mockUploadService: {
    finalizeCommentImages: jest.Mock;
    deleteObject: jest.Mock;
    markMediaFailed: jest.Mock;
    getPublicCdnUrl: jest.Mock;
  };
  let mockMediaDeletionProcessor: {
    processPendingWork: jest.Mock;
  };

  const userId = '01916327-0000-7000-8000-000000000001';
  const postId = '01916327-0000-7000-8000-000000000002';
  const otherUserId = '01916327-0000-7000-8000-000000000003';

  const mockPost: Partial<Post> = {
    id: postId,
    creatorId: userId,
    postType: 'RESCUE',
    title: 'Injured Dog',
    description: 'Needs help',
    status: 'ACTIVE',
    commentCount: 0,
  };

  const mockComment: Comment = {
    id: '01916327-0000-7000-8000-000000000010',
    postId,
    authorId: userId,
    parentId: null,
    text: 'I can foster this dog!',
    status: 'ACTIVE',
    replyCount: 0,
    boostCount: 0,
    createdAt: new Date('2026-09-04T00:00:00.000Z'),
    updatedAt: new Date('2026-09-04T00:00:00.000Z'),
  };

  const mockReply: Comment = {
    id: '01916327-0000-7000-8000-000000000020',
    postId,
    authorId: otherUserId,
    parentId: mockComment.id,
    text: 'I can help with transport!',
    status: 'ACTIVE',
    replyCount: 0,
    boostCount: 0,
    createdAt: new Date('2026-09-04T00:05:00.000Z'),
    updatedAt: new Date('2026-09-04T00:05:00.000Z'),
  };

  beforeEach(() => {
    mockCommentsRepo = {
      findIdempotencyRecord: jest.fn(),
      countRecentCreationsByAuthor: jest.fn().mockResolvedValue(0),
      createCommentWithCounter: jest.fn().mockResolvedValue(mockComment),
      findTopLevelCommentsByPostId: jest.fn(),
      findCommentById: jest.fn().mockImplementation((id: string) => {
        if (id === mockReply.id) return Promise.resolve(mockReply);
        return Promise.resolve(mockComment);
      }),
      createReplyWithCounters: jest.fn().mockResolvedValue(mockReply),
      findRepliesByCommentId: jest.fn(),
      deleteCommentWithCounters: jest.fn().mockResolvedValue(true),
      toggleBoost: jest.fn().mockResolvedValue({ isBoostedByMe: true, boostCount: 1 }),
      isCommentBoostedByUser: jest.fn().mockResolvedValue(false),
      pinComment: jest
        .fn()
        .mockResolvedValue({ comment: { ...mockComment, isPinned: true }, isNewPin: true, postTitle: 'Post Title' }),
      unpinComment: jest.fn().mockResolvedValue(true),
      isCommentPinned: jest.fn().mockResolvedValue(false),
      queueMediaDeletionWork: jest.fn().mockResolvedValue(undefined),
      countRecentReportsByReporter: jest.fn().mockResolvedValue(0),
      reportComment: jest.fn().mockResolvedValue(true),
    };

    mockPostsRepo = {
      findById: jest.fn().mockResolvedValue(mockPost),
    };

    mockUploadService = {
      finalizeCommentImages: jest.fn(),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      markMediaFailed: jest.fn().mockResolvedValue(undefined),
      getPublicCdnUrl: jest.fn().mockImplementation((k: string) => `https://cdn.pupzy.net/${k}`),
    };

    mockMediaDeletionProcessor = {
      processPendingWork: jest.fn().mockResolvedValue({ processed: 0, failed: 0 }),
    };

    service = new CommentsService(
      mockCommentsRepo as unknown as CommentsRepository,
      mockPostsRepo as unknown as PostsRepository,
      mockUploadService as unknown as UploadService,
      undefined,
      mockMediaDeletionProcessor as unknown as MediaDeletionProcessor,
    );
  });

  describe('createComment', () => {
    it('creates a top-level comment on an active post and returns canonical comment', async () => {
      const result = await service.createComment(userId, {
        clientRequestId: 'req-1',
        postId,
        text: 'I can foster this dog!',
      });

      expect(result).toEqual(mockComment);
      expect(mockPostsRepo.findById).toHaveBeenCalledWith(postId);
      expect(mockCommentsRepo.createCommentWithCounter).toHaveBeenCalledWith(
        expect.objectContaining({
          postId,
          authorId: userId,
          text: 'I can foster this dog!',
          clientRequestId: 'req-1',
          requestHash: crypto
            .createHash('sha256')
            .update(JSON.stringify({ postId, text: 'I can foster this dog!', mediaIds: [] }))
            .digest('hex'),
          mediaItems: undefined,
        }),
      );
    });

    it('allows comment creation on resolved, reunited, adopted, and sold post statuses', async () => {
      for (const status of ['RESOLVED', 'REUNITED', 'ADOPTED', 'SOLD'] as const) {
        mockPostsRepo.findById.mockResolvedValueOnce({ ...mockPost, status });
        const result = await service.createComment(userId, {
          clientRequestId: `req-${status}`,
          postId,
          text: `Comment on ${status} post`,
        });
        expect(result).toBeDefined();
      }
    });

    it('rejects comment creation if post does not exist', async () => {
      mockPostsRepo.findById.mockResolvedValueOnce(null);

      await expect(
        service.createComment(userId, {
          clientRequestId: 'req-2',
          postId: 'non-existent-post',
          text: 'Hello',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects comment creation on REMOVED post without creating comments', async () => {
      mockPostsRepo.findById.mockResolvedValueOnce({
        ...mockPost,
        status: 'REMOVED',
      });

      await expect(
        service.createComment(userId, {
          clientRequestId: 'req-3',
          postId,
          text: 'Hello',
        }),
      ).rejects.toThrow(NotFoundError);

      expect(mockCommentsRepo.createCommentWithCounter).not.toHaveBeenCalled();
    });

    it('returns original result on identical retry with same clientRequestId and payload', async () => {
      const payload = { postId, text: 'I can foster this dog!', mediaIds: [] };
      const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

      mockCommentsRepo.findIdempotencyRecord.mockResolvedValueOnce({
        id: 'idem-1',
        authorId: userId,
        clientRequestId: 'req-retry',
        requestHash: hash,
        commentId: mockComment.id,
        responsePayload: mockComment,
        createdAt: new Date(),
      });

      const result = await service.createComment(userId, {
        clientRequestId: 'req-retry',
        postId,
        text: 'I can foster this dog!',
      });

      expect(result).toEqual(mockComment);
      // Ensures no database insert on idempotency replay
      expect(mockCommentsRepo.createCommentWithCounter).not.toHaveBeenCalled();
      // Ensures idempotency check does not consume author rate limits
      expect(mockCommentsRepo.countRecentCreationsByAuthor).not.toHaveBeenCalled();
    });

    it('rejects with ConflictError when clientRequestId is reused with different payload', async () => {
      const originalPayload = { postId, text: 'Original text' };
      const originalHash = crypto.createHash('sha256').update(JSON.stringify(originalPayload)).digest('hex');

      mockCommentsRepo.findIdempotencyRecord.mockResolvedValueOnce({
        id: 'idem-2',
        authorId: userId,
        clientRequestId: 'req-conflict',
        requestHash: originalHash,
        commentId: mockComment.id,
        responsePayload: mockComment,
        createdAt: new Date(),
      });

      await expect(
        service.createComment(userId, {
          clientRequestId: 'req-conflict',
          postId,
          text: 'Different text',
        }),
      ).rejects.toThrow(ConflictError);

      expect(mockCommentsRepo.createCommentWithCounter).not.toHaveBeenCalled();
    });

    it('enforces per-user rate limit of 10 creations per minute', async () => {
      mockCommentsRepo.countRecentCreationsByAuthor.mockImplementation((authorId: string, since: Date) => {
        // If query is for last minute
        if (Date.now() - since.getTime() <= 65 * 1000) {
          return Promise.resolve(10);
        }
        return Promise.resolve(0);
      });

      await expect(
        service.createComment(userId, {
          clientRequestId: 'req-rate-min',
          postId,
          text: 'Spamming comments',
        }),
      ).rejects.toThrow(AppError);

      await expect(
        service.createComment(userId, {
          clientRequestId: 'req-rate-min',
          postId,
          text: 'Spamming comments',
        }),
      ).rejects.toThrow(/rate limit exceeded.*minute/);

      expect(mockCommentsRepo.createCommentWithCounter).not.toHaveBeenCalled();
    });

    it('enforces per-user rate limit of 100 creations per day', async () => {
      mockCommentsRepo.countRecentCreationsByAuthor.mockImplementation((authorId: string, since: Date) => {
        // If query is for last 24h
        if (Date.now() - since.getTime() > 65 * 1000) {
          return Promise.resolve(100);
        }
        return Promise.resolve(5); // Under minute limit
      });

      await expect(
        service.createComment(userId, {
          clientRequestId: 'req-rate-day',
          postId,
          text: 'Spamming comments',
        }),
      ).rejects.toThrow(AppError);

      await expect(
        service.createComment(userId, {
          clientRequestId: 'req-rate-day',
          postId,
          text: 'Spamming comments',
        }),
      ).rejects.toThrow(/rate limit exceeded.*day/);

      expect(mockCommentsRepo.createCommentWithCounter).not.toHaveBeenCalled();
    });

    it('isolates rate limits between different authenticated users', async () => {
      mockCommentsRepo.countRecentCreationsByAuthor.mockImplementation((authorId: string) => {
        return Promise.resolve(authorId === userId ? 10 : 0);
      });

      // User 1 is blocked
      await expect(
        service.createComment(userId, {
          clientRequestId: 'req-user1',
          postId,
          text: 'User 1 comment',
        }),
      ).rejects.toThrow(/rate limit exceeded/);

      // Other user succeeds
      const result = await service.createComment(otherUserId, {
        clientRequestId: 'req-user2',
        postId,
        text: 'User 2 comment',
      });
      expect(result).toBeDefined();
    });

    it('creates comment with two images, finalizes images, and cleans up staging objects', async () => {
      const mediaId1 = '01916327-0000-7000-8000-000000000051';
      const mediaId2 = '01916327-0000-7000-8000-000000000052';
      const finalizedItems = [
        {
          id: mediaId1,
          commentId: 'comment-1',
          storageKey: `comments/comment-1/${mediaId1}.webp`,
          stagingKey: `staging/${userId}/${mediaId1}`,
          sha256: 'hash1',
          width: 480,
          height: 480,
          fileSizeBytes: 50000,
          fileContentType: 'image/webp',
          displayOrder: 0,
        },
        {
          id: mediaId2,
          commentId: 'comment-1',
          storageKey: `comments/comment-1/${mediaId2}.webp`,
          stagingKey: `staging/${userId}/${mediaId2}`,
          sha256: 'hash2',
          width: 480,
          height: 480,
          fileSizeBytes: 60000,
          fileContentType: 'image/webp',
          displayOrder: 1,
        },
      ];

      mockUploadService.finalizeCommentImages.mockResolvedValueOnce(finalizedItems);

      const result = await service.createComment(userId, {
        clientRequestId: 'req-2-images',
        postId,
        text: 'Two images attached',
        mediaIds: [mediaId1, mediaId2],
      });

      expect(result).toBeDefined();
      expect(mockUploadService.finalizeCommentImages).toHaveBeenCalledWith(
        [mediaId1, mediaId2],
        userId,
        expect.any(String),
        { postId },
      );
      expect(mockCommentsRepo.createCommentWithCounter).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaItems: finalizedItems,
        }),
      );
      // Cleaned up private staging objects after commit
      expect(mockUploadService.deleteObject).toHaveBeenCalledWith(`staging/${userId}/${mediaId1}`);
      expect(mockUploadService.deleteObject).toHaveBeenCalledWith(`staging/${userId}/${mediaId2}`);
    });

    it('compensates and queues media deletion work when database commit fails', async () => {
      const mediaId1 = '01916327-0000-7000-8000-000000000051';
      const finalizedItems = [
        {
          id: mediaId1,
          commentId: 'comment-1',
          storageKey: `comments/comment-1/${mediaId1}.webp`,
          stagingKey: `staging/${userId}/${mediaId1}`,
          sha256: 'hash1',
          width: 480,
          height: 480,
          fileSizeBytes: 50000,
          fileContentType: 'image/webp',
          displayOrder: 0,
        },
      ];

      mockUploadService.finalizeCommentImages.mockResolvedValueOnce(finalizedItems);
      mockCommentsRepo.createCommentWithCounter.mockRejectedValueOnce(new Error('DB commit crash'));

      await expect(
        service.createComment(userId, {
          clientRequestId: 'req-db-fail',
          postId,
          text: 'Failing DB commit',
          mediaIds: [mediaId1],
        }),
      ).rejects.toThrow('DB commit crash');

      // Outbox compensation queued
      expect(mockCommentsRepo.queueMediaDeletionWork).toHaveBeenCalledWith(
        `comments/comment-1/${mediaId1}.webp`,
        `https://cdn.pupzy.net/comments/comment-1/${mediaId1}.webp`,
      );
      expect(mockUploadService.markMediaFailed).toHaveBeenCalledWith([mediaId1], 'Database transaction failed');
    });
  });

  describe('getComments', () => {
    it('returns empty connection when post has no comments', async () => {
      mockCommentsRepo.findTopLevelCommentsByPostId.mockResolvedValueOnce([]);

      const result = await service.getComments({
        postId,
        sort: 'TOP',
        first: 20,
      });

      expect(result).toEqual({
        edges: [],
        pageInfo: {
          endCursor: null,
          hasNextPage: false,
        },
      });
    });

    it('returns edges and pageInfo with hasNextPage=false when rows <= first', async () => {
      mockCommentsRepo.findTopLevelCommentsByPostId.mockResolvedValueOnce([mockComment]);

      const result = await service.getComments({
        postId,
        sort: 'TOP',
        first: 20,
      });

      expect(result.edges.length).toBe(1);
      expect(result.edges[0].node).toEqual(mockComment);
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(result.pageInfo.endCursor).toBeTruthy();
    });

    it('returns hasNextPage=true and slices extra row when rows > first', async () => {
      const comment2: Comment = {
        ...mockComment,
        id: '01916327-0000-7000-8000-000000000011',
        createdAt: new Date('2026-09-04T00:01:00.000Z'),
      };

      // Query returns 2 items when first = 1
      mockCommentsRepo.findTopLevelCommentsByPostId.mockResolvedValueOnce([mockComment, comment2]);

      const result = await service.getComments({
        postId,
        sort: 'NEWEST',
        first: 1,
      });

      expect(result.edges.length).toBe(1);
      expect(result.edges[0].node).toEqual(mockComment);
      expect(result.pageInfo.hasNextPage).toBe(true);
      expect(result.pageInfo.endCursor).toBeTruthy();
    });

    it('rejects discussion access if post is REMOVED', async () => {
      mockPostsRepo.findById.mockResolvedValueOnce({
        ...mockPost,
        status: 'REMOVED',
      });

      await expect(
        service.getComments({
          postId,
          sort: 'TOP',
          first: 20,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects discussion access if post does not exist', async () => {
      mockPostsRepo.findById.mockResolvedValueOnce(null);

      await expect(
        service.getComments({
          postId: 'non-existent-id',
          sort: 'TOP',
          first: 20,
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('createReply', () => {
    it('creates a reply beneath an active top-level comment', async () => {
      const result = await service.createReply(otherUserId, {
        clientRequestId: 'req-reply-1',
        commentId: mockComment.id,
        text: 'I can help with transport!',
      });

      expect(result).toEqual(mockReply);
      expect(mockCommentsRepo.findCommentById).toHaveBeenCalledWith(mockComment.id);
      expect(mockPostsRepo.findById).toHaveBeenCalledWith(postId);
      expect(mockCommentsRepo.createReplyWithCounters).toHaveBeenCalledWith({
        commentId: mockComment.id,
        authorId: otherUserId,
        text: 'I can help with transport!',
        clientRequestId: 'req-reply-1',
        requestHash: crypto
          .createHash('sha256')
          .update(JSON.stringify({ commentId: mockComment.id, text: 'I can help with transport!' }))
          .digest('hex'),
      });
    });

    it('rejects reply if parent comment does not exist', async () => {
      mockCommentsRepo.findCommentById.mockResolvedValueOnce(null);

      await expect(
        service.createReply(otherUserId, {
          clientRequestId: 'req-reply-notfound',
          commentId: 'non-existent-comment',
          text: 'Hello',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects reply nesting (cannot reply to a reply)', async () => {
      mockCommentsRepo.findCommentById.mockResolvedValueOnce({
        ...mockComment,
        parentId: 'parent-comment-id', // It is a reply!
      });

      await expect(
        service.createReply(otherUserId, {
          clientRequestId: 'req-reply-nest',
          commentId: mockComment.id,
          text: 'Nested reply attempt',
        }),
      ).rejects.toThrow(/Replies cannot receive replies/);
    });

    it('rejects reply to a DELETED comment', async () => {
      mockCommentsRepo.findCommentById.mockResolvedValueOnce({
        ...mockComment,
        status: 'DELETED',
      });

      await expect(
        service.createReply(otherUserId, {
          clientRequestId: 'req-reply-del',
          commentId: mockComment.id,
          text: 'Reply to deleted',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects reply to a REMOVED or HIDDEN comment', async () => {
      mockCommentsRepo.findCommentById.mockResolvedValueOnce({
        ...mockComment,
        status: 'REMOVED',
      });

      await expect(
        service.createReply(otherUserId, {
          clientRequestId: 'req-reply-rem',
          commentId: mockComment.id,
          text: 'Reply to removed',
        }),
      ).rejects.toThrow(NotFoundError);

      mockCommentsRepo.findCommentById.mockResolvedValueOnce({
        ...mockComment,
        status: 'HIDDEN',
      });

      await expect(
        service.createReply(otherUserId, {
          clientRequestId: 'req-reply-hid',
          commentId: mockComment.id,
          text: 'Reply to hidden',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects reply if post is REMOVED', async () => {
      mockPostsRepo.findById.mockResolvedValueOnce({
        ...mockPost,
        status: 'REMOVED',
      });

      await expect(
        service.createReply(otherUserId, {
          clientRequestId: 'req-reply-post-rem',
          commentId: mockComment.id,
          text: 'Reply under removed post',
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('returns original result on identical idempotency retry', async () => {
      const payload = { commentId: mockComment.id, text: 'I can help with transport!' };
      const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

      mockCommentsRepo.findIdempotencyRecord.mockResolvedValueOnce({
        id: 'idem-reply',
        authorId: otherUserId,
        clientRequestId: 'req-reply-retry',
        requestHash: hash,
        commentId: mockReply.id,
        responsePayload: mockReply,
        createdAt: new Date(),
      });

      const result = await service.createReply(otherUserId, {
        clientRequestId: 'req-reply-retry',
        commentId: mockComment.id,
        text: 'I can help with transport!',
      });

      expect(result).toEqual(mockReply);
      expect(mockCommentsRepo.createReplyWithCounters).not.toHaveBeenCalled();
      expect(mockCommentsRepo.countRecentCreationsByAuthor).not.toHaveBeenCalled();
    });

    it('rejects with ConflictError on reused clientRequestId with different payload', async () => {
      const payload = { commentId: mockComment.id, text: 'Original text' };
      const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

      mockCommentsRepo.findIdempotencyRecord.mockResolvedValueOnce({
        id: 'idem-conflict',
        authorId: otherUserId,
        clientRequestId: 'req-reply-conf',
        requestHash: hash,
        commentId: mockReply.id,
        responsePayload: mockReply,
        createdAt: new Date(),
      });

      await expect(
        service.createReply(otherUserId, {
          clientRequestId: 'req-reply-conf',
          commentId: mockComment.id,
          text: 'Different text',
        }),
      ).rejects.toThrow(ConflictError);
    });

    it('shares rate limits with comment creation (10/min, 100/day)', async () => {
      mockCommentsRepo.countRecentCreationsByAuthor.mockResolvedValueOnce(10);

      await expect(
        service.createReply(otherUserId, {
          clientRequestId: 'req-rate-limit',
          commentId: mockComment.id,
          text: 'Spamming replies',
        }),
      ).rejects.toThrow(/rate limit exceeded/);

      expect(mockCommentsRepo.createReplyWithCounters).not.toHaveBeenCalled();
    });
  });

  describe('getReplies', () => {
    it('returns empty connection when parent comment has no replies', async () => {
      mockCommentsRepo.findRepliesByCommentId.mockResolvedValueOnce([]);

      const result = await service.getReplies({
        commentId: mockComment.id,
        first: 20,
      });

      expect(result).toEqual({
        edges: [],
        pageInfo: {
          endCursor: null,
          hasNextPage: false,
        },
      });
    });

    it('returns replies with oldest first keyset pagination', async () => {
      mockCommentsRepo.findRepliesByCommentId.mockResolvedValueOnce([mockReply]);

      const result = await service.getReplies({
        commentId: mockComment.id,
        first: 20,
      });

      expect(result.edges.length).toBe(1);
      expect(result.edges[0].node).toEqual(mockReply);
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(result.pageInfo.endCursor).toBeTruthy();
    });

    it('rejects replies query if parent comment does not exist', async () => {
      mockCommentsRepo.findCommentById.mockResolvedValueOnce(null);

      await expect(
        service.getReplies({
          commentId: 'non-existent',
          first: 20,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects replies query if parent is a reply (cannot nest)', async () => {
      mockCommentsRepo.findCommentById.mockResolvedValueOnce({
        ...mockComment,
        parentId: 'parent-id',
      });

      await expect(
        service.getReplies({
          commentId: mockComment.id,
          first: 20,
        }),
      ).rejects.toThrow(/Replies cannot receive replies/);
    });

    it('rejects replies query if parent comment is DELETED and has replyCount === 0', async () => {
      mockCommentsRepo.findCommentById.mockResolvedValueOnce({
        ...mockComment,
        status: 'DELETED',
        replyCount: 0,
      });

      await expect(
        service.getReplies({
          commentId: mockComment.id,
          first: 20,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('allows replies query if parent comment is DELETED and has visible replies (tombstone)', async () => {
      mockCommentsRepo.findCommentById.mockResolvedValueOnce({
        ...mockComment,
        status: 'DELETED',
        replyCount: 1,
      });
      mockCommentsRepo.findRepliesByCommentId.mockResolvedValueOnce([mockReply]);

      const result = await service.getReplies({
        commentId: mockComment.id,
        first: 20,
      });

      expect(result.edges.length).toBe(1);
    });

    it('rejects replies query if parent post is REMOVED', async () => {
      mockPostsRepo.findById.mockResolvedValueOnce({
        ...mockPost,
        status: 'REMOVED',
      });

      await expect(
        service.getReplies({
          commentId: mockComment.id,
          first: 20,
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteComment', () => {
    it('delegates deletion to repository with cdnBase', async () => {
      const result = await service.deleteComment(userId, mockComment.id);
      expect(result).toBe(true);
      expect(mockCommentsRepo.deleteCommentWithCounters).toHaveBeenCalledWith(
        mockComment.id,
        userId,
        'https://cdn.pupzy.net',
      );
    });
  });

  describe('toggleCommentBoost', () => {
    it('toggles boost and returns canonical payload', async () => {
      mockCommentsRepo.toggleBoost.mockResolvedValueOnce({
        isBoostedByMe: true,
        boostCount: 5,
      });

      const result = await service.toggleCommentBoost(userId, mockComment.id);

      expect(result).toEqual({
        commentId: mockComment.id,
        isBoostedByMe: true,
        boostedByMe: true,
        boostCount: 5,
      });
      expect(mockCommentsRepo.toggleBoost).toHaveBeenCalledWith(mockComment.id, userId);
    });

    it('enforces 60 toggles per minute per authenticated user', async () => {
      const rateLimitedUserId = '01916327-0000-7000-8000-000000000099';
      mockCommentsRepo.toggleBoost.mockResolvedValue({
        isBoostedByMe: true,
        boostCount: 1,
      });

      // 60 requests should succeed
      for (let i = 0; i < 60; i++) {
        await service.toggleCommentBoost(rateLimitedUserId, mockComment.id);
      }

      // 61st request should be rejected with RATE_LIMITED
      await expect(service.toggleCommentBoost(rateLimitedUserId, mockComment.id)).rejects.toThrow(
        /rate limit exceeded.*60 per minute/,
      );
    });

    it('isolates boost rate limits between different users', async () => {
      const userA = '01916327-0000-7000-8000-000000000088';
      const userB = '01916327-0000-7000-8000-000000000089';
      mockCommentsRepo.toggleBoost.mockResolvedValue({
        isBoostedByMe: true,
        boostCount: 1,
      });

      // Exhaust User A's limit
      for (let i = 0; i < 60; i++) {
        await service.toggleCommentBoost(userA, mockComment.id);
      }

      await expect(service.toggleCommentBoost(userA, mockComment.id)).rejects.toThrow(/rate limit exceeded/);

      // User B is unaffected
      const resultB = await service.toggleCommentBoost(userB, mockComment.id);
      expect(resultB.commentId).toBe(mockComment.id);
    });
  });

  describe('isCommentBoostedByUser', () => {
    it('delegates to repository', async () => {
      mockCommentsRepo.isCommentBoostedByUser.mockResolvedValueOnce(true);
      const res = await service.isCommentBoostedByUser(mockComment.id, userId);
      expect(res).toBe(true);
      expect(mockCommentsRepo.isCommentBoostedByUser).toHaveBeenCalledWith(mockComment.id, userId);
    });
  });

  describe('pinComment', () => {
    it('delegates to repository with userId and commentId', async () => {
      const result = await service.pinComment(userId, mockComment.id);
      expect(result).toEqual({ ...mockComment, isPinned: true });
      expect(mockCommentsRepo.pinComment).toHaveBeenCalledWith(mockComment.id, userId);
    });
  });

  describe('unpinComment', () => {
    it('delegates to repository with userId and postId', async () => {
      const result = await service.unpinComment(userId, postId);
      expect(result).toBe(true);
      expect(mockCommentsRepo.unpinComment).toHaveBeenCalledWith(postId, userId);
    });
  });

  describe('isCommentPinned', () => {
    it('delegates to repository with postId and commentId', async () => {
      mockCommentsRepo.isCommentPinned.mockResolvedValueOnce(true);
      const result = await service.isCommentPinned(postId, mockComment.id);
      expect(result).toBe(true);
      expect(mockCommentsRepo.isCommentPinned).toHaveBeenCalledWith(postId, mockComment.id);
    });
  });

  describe('reportComment', () => {
    it('delegates to repository with reporterId, commentId, reason, and details', async () => {
      const result = await service.reportComment(userId, {
        commentId: mockComment.id,
        reason: 'SPAM',
        details: 'Spam advertising',
      });

      expect(result).toBe(true);
      expect(mockCommentsRepo.countRecentReportsByReporter).toHaveBeenCalledWith(userId, expect.any(Date));
      expect(mockCommentsRepo.reportComment).toHaveBeenCalledWith({
        commentId: mockComment.id,
        reporterId: userId,
        reason: 'SPAM',
        details: 'Spam advertising',
      });
    });

    it('enforces 10 reports per day limit', async () => {
      mockCommentsRepo.countRecentReportsByReporter.mockResolvedValueOnce(10);

      await expect(
        service.reportComment(userId, {
          commentId: mockComment.id,
          reason: 'SPAM',
        }),
      ).rejects.toThrow('Daily comment report limit reached (10 per day)');
      expect(mockCommentsRepo.reportComment).not.toHaveBeenCalled();
    });
  });
});

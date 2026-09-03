import * as crypto from 'crypto';
import { CommentsService } from './comments.service';
import { CommentsRepository } from './comments.repository';
import { PostsRepository } from '../posts/posts.repository';
import { NotFoundError, ConflictError, AppError } from '../common/errors/app.errors';
import { Comment, Post } from '../database/schema';

describe('CommentsService', () => {
  let service: CommentsService;
  let mockCommentsRepo: {
    findIdempotencyRecord: jest.Mock;
    countRecentCreationsByAuthor: jest.Mock;
    createCommentWithCounter: jest.Mock;
    findTopLevelCommentsByPostId: jest.Mock;
    findCommentById: jest.Mock;
  };
  let mockPostsRepo: {
    findById: jest.Mock;
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
    createdAt: new Date('2026-09-04T00:00:00.000Z'),
    updatedAt: new Date('2026-09-04T00:00:00.000Z'),
  };

  beforeEach(() => {
    mockCommentsRepo = {
      findIdempotencyRecord: jest.fn(),
      countRecentCreationsByAuthor: jest.fn().mockResolvedValue(0),
      createCommentWithCounter: jest.fn().mockResolvedValue(mockComment),
      findTopLevelCommentsByPostId: jest.fn(),
      findCommentById: jest.fn(),
    };

    mockPostsRepo = {
      findById: jest.fn().mockResolvedValue(mockPost),
    };

    service = new CommentsService(
      mockCommentsRepo as unknown as CommentsRepository,
      mockPostsRepo as unknown as PostsRepository,
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
      expect(mockCommentsRepo.createCommentWithCounter).toHaveBeenCalledWith({
        postId,
        authorId: userId,
        text: 'I can foster this dog!',
        clientRequestId: 'req-1',
        requestHash: crypto
          .createHash('sha256')
          .update(JSON.stringify({ postId, text: 'I can foster this dog!' }))
          .digest('hex'),
      });
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
      const payload = { postId, text: 'I can foster this dog!' };
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
});

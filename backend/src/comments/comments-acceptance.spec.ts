import { CommentsResolver } from './comments.resolver';
import { CommentsService } from './comments.service';
import { CommentsRepository } from './comments.repository';
import { PostsRepository } from '../posts/posts.repository';
import { Comment, Post } from '../database/schema';
import { ValidationError, NotFoundError, ForbiddenError } from '../common/errors/app.errors';
import type { GqlContext } from '../common/types/gql-context.type';

describe('Comments & Replies Acceptance Tests (Ticket 03)', () => {
  let resolver: CommentsResolver;
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
  };
  let mockPostsRepo: {
    findById: jest.Mock;
  };
  let loadUserMock: jest.Mock;

  const authorId = '01916327-0000-7000-8000-000000000001';
  const replyAuthorId = '01916327-0000-7000-8000-000000000002';
  const postCreatorId = '01916327-0000-7000-8000-000000000003';
  const thirdPartyUserId = '01916327-0000-7000-8000-000000000004';
  const postId = '01916327-0000-7000-8000-000000000010';
  const commentId = '01916327-0000-7000-8000-000000000020';
  const replyId = '01916327-0000-7000-8000-000000000030';

  const mockPost: Post = {
    id: postId,
    creatorId: postCreatorId,
    postType: 'RESCUE',
    title: 'Rescue Dog',
    description: 'Found near Maadi',
    status: 'ACTIVE',
    moderationStatus: 'APPROVED',
    urgency: 'HIGH',
    cityId: 'city-1',
    areaName: 'Maadi',
    latitude: 29.96,
    longitude: 31.28,
    marketCategory: null,
    upvoteCount: 5,
    saveCount: 2,
    viewCount: 20,
    effectiveScore: 10,
    commentCount: 2, // 1 visible comment + 1 visible reply
    createdAt: new Date('2026-09-04T00:00:00.000Z'),
    updatedAt: new Date('2026-09-04T00:00:00.000Z'),
  };

  const mockTopLevelComment: Comment = {
    id: commentId,
    postId,
    authorId,
    parentId: null,
    text: 'I can offer foster care for this dog.',
    status: 'ACTIVE',
    replyCount: 1,
    createdAt: new Date('2026-09-04T00:10:00.000Z'),
    updatedAt: new Date('2026-09-04T00:10:00.000Z'),
  };

  const mockReplyComment: Comment = {
    id: replyId,
    postId,
    authorId: replyAuthorId,
    parentId: commentId,
    text: 'Thank you! Where are you located?',
    status: 'ACTIVE',
    replyCount: 0,
    createdAt: new Date('2026-09-04T00:15:00.000Z'),
    updatedAt: new Date('2026-09-04T00:15:00.000Z'),
  };

  function createContext(userId: string): GqlContext {
    return {
      req: {} as GqlContext['req'],
      user: { id: userId },
      loaders: {
        userById: { load: loadUserMock } as unknown as GqlContext['loaders']['userById'],
        cityById: {} as GqlContext['loaders']['cityById'],
        mediaByPostId: {} as GqlContext['loaders']['mediaByPostId'],
        upvotedByMe: {} as GqlContext['loaders']['upvotedByMe'],
        savedByMe: {} as GqlContext['loaders']['savedByMe'],
      },
    };
  }

  beforeEach(() => {
    loadUserMock = jest
      .fn()
      .mockImplementation((id: string) => Promise.resolve({ id, fullName: `User ${id.slice(-4)}` }));

    mockCommentsRepo = {
      findIdempotencyRecord: jest.fn().mockResolvedValue(null),
      countRecentCreationsByAuthor: jest.fn().mockResolvedValue(0),
      createCommentWithCounter: jest.fn().mockResolvedValue(mockTopLevelComment),
      findTopLevelCommentsByPostId: jest.fn().mockResolvedValue([mockTopLevelComment]),
      findCommentById: jest.fn().mockImplementation((id: string) => {
        if (id === commentId) return Promise.resolve(mockTopLevelComment);
        if (id === replyId) return Promise.resolve(mockReplyComment);
        return Promise.resolve(null);
      }),
      createReplyWithCounters: jest.fn().mockResolvedValue(mockReplyComment),
      findRepliesByCommentId: jest.fn().mockResolvedValue([mockReplyComment]),
      deleteCommentWithCounters: jest.fn().mockImplementation((targetId: string, callerId: string) => {
        const item = targetId === commentId ? mockTopLevelComment : targetId === replyId ? mockReplyComment : null;
        if (!item) throw new NotFoundError('Comment', targetId);
        if (item.authorId !== callerId) throw new ForbiddenError('You can only delete your own comments or replies');
        return Promise.resolve(true);
      }),
      toggleBoost: jest.fn().mockImplementation((targetId: string, callerId: string) => {
        const item = targetId === commentId ? mockTopLevelComment : targetId === replyId ? mockReplyComment : null;
        if (!item) throw new NotFoundError('Comment', targetId);
        if (item.authorId === callerId) throw new ForbiddenError('You cannot boost your own comment or reply');
        return Promise.resolve({ isBoostedByMe: true, boostCount: 1 });
      }),
      isCommentBoostedByUser: jest.fn().mockResolvedValue(false),
    };

    mockPostsRepo = {
      findById: jest.fn().mockImplementation((id: string) => {
        if (id === postId) return Promise.resolve(mockPost);
        return Promise.resolve(null);
      }),
    };

    service = new CommentsService(
      mockCommentsRepo as unknown as CommentsRepository,
      mockPostsRepo as unknown as PostsRepository,
    );

    resolver = new CommentsResolver(service);
  });

  describe('1. Nesting Rejection', () => {
    it('rejects creating a reply beneath another reply (discussions have at most 1 level of nesting)', async () => {
      // Trying to reply to a reply (mockReplyComment has parentId !== null)
      const ctx = createContext(replyAuthorId);
      await expect(
        resolver.createReply(
          {
            clientRequestId: 'cr-nest-1',
            commentId: replyId, // replyId is a reply
            text: 'Trying to nest deeper',
          },
          ctx,
        ),
      ).rejects.toThrow(ValidationError);
      await expect(
        resolver.createReply(
          {
            clientRequestId: 'cr-nest-1',
            commentId: replyId,
            text: 'Trying to nest deeper',
          },
          ctx,
        ),
      ).rejects.toThrow(/Replies cannot receive replies/);
    });

    it('rejects listing replies for an item that is already a reply', async () => {
      await expect(resolver.replies(replyId, 20)).rejects.toThrow(/Replies cannot receive replies/);
    });
  });

  describe('2. Text Boundaries & Media Rejection on Replies', () => {
    it('accepts reply text with 1 to 500 Unicode characters', async () => {
      const ctx = createContext(replyAuthorId);
      const text500 = '🐾'.repeat(500);

      const res = await resolver.createReply(
        {
          clientRequestId: 'cr-boundary-1',
          commentId,
          text: text500,
        },
        ctx,
      );

      expect(res).toBeDefined();
    });

    it('rejects reply text exceeding 500 Unicode characters', async () => {
      const ctx = createContext(replyAuthorId);
      const text501 = 'a'.repeat(501);

      await expect(
        resolver.createReply(
          {
            clientRequestId: 'cr-boundary-2',
            commentId,
            text: text501,
          },
          ctx,
        ),
      ).rejects.toThrow(/between 1 and 500 characters/);
    });

    it('rejects empty or whitespace-only reply text', async () => {
      const ctx = createContext(replyAuthorId);

      await expect(
        resolver.createReply(
          {
            clientRequestId: 'cr-boundary-3',
            commentId,
            text: '    ',
          },
          ctx,
        ),
      ).rejects.toThrow(/Reply text cannot be empty/);
    });

    it('rejects replies containing media', async () => {
      const ctx = createContext(replyAuthorId);

      await expect(
        resolver.createReply(
          {
            clientRequestId: 'cr-media-1',
            commentId,
            text: 'Check this image',
            mediaIds: ['01916327-0000-7000-8000-000000000099'],
          },
          ctx,
        ),
      ).rejects.toThrow(/Replies cannot contain media/);
    });
  });

  describe('3. Ownership & Authorization', () => {
    it('allows an author to delete their own top-level comment', async () => {
      const ctx = createContext(authorId);
      const result = await resolver.deleteComment(commentId, ctx);
      expect(result).toBe(true);
      expect(mockCommentsRepo.deleteCommentWithCounters).toHaveBeenCalledWith(commentId, authorId);
    });

    it('allows an author to delete their own reply', async () => {
      const ctx = createContext(replyAuthorId);
      const result = await resolver.deleteComment(replyId, ctx);
      expect(result).toBe(true);
      expect(mockCommentsRepo.deleteCommentWithCounters).toHaveBeenCalledWith(replyId, replyAuthorId);
    });

    it('rejects third-party user attempting to delete another users comment', async () => {
      const ctx = createContext(thirdPartyUserId);
      await expect(resolver.deleteComment(commentId, ctx)).rejects.toThrow(ForbiddenError);
    });

    it('rejects post author attempting to delete another users comment (post authors have no deletion authority)', async () => {
      const ctx = createContext(postCreatorId);
      await expect(resolver.deleteComment(commentId, ctx)).rejects.toThrow(ForbiddenError);
      await expect(resolver.deleteComment(replyId, ctx)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('4. Idempotent Deletion', () => {
    it('is idempotent when deleting an already deleted comment', async () => {
      mockCommentsRepo.deleteCommentWithCounters.mockResolvedValueOnce(true);
      const ctx = createContext(authorId);

      const res1 = await resolver.deleteComment(commentId, ctx);
      expect(res1).toBe(true);

      const res2 = await resolver.deleteComment(commentId, ctx);
      expect(res2).toBe(true);
    });
  });

  describe('5. Tombstones & Privacy', () => {
    it('deleted top-level comment with surviving visible replies renders as a neutral tombstone', async () => {
      const tombstoneComment: Comment = {
        ...mockTopLevelComment,
        status: 'DELETED',
        replyCount: 2,
        text: 'Private original message',
      };

      const ctx = createContext(thirdPartyUserId);
      const author = await resolver.author(tombstoneComment, ctx);
      const text = resolver.text(tombstoneComment);

      // Never exposes original text or author identity
      expect(author).toBeNull();
      expect(text).toBe('[Deleted]');
      expect(loadUserMock).not.toHaveBeenCalled();
    });

    it('active comments expose author and original text', async () => {
      const ctx = createContext(thirdPartyUserId);
      const author = await resolver.author(mockTopLevelComment, ctx);
      const text = resolver.text(mockTopLevelComment);

      expect(author).toEqual({ id: authorId, fullName: 'User 0001' });
      expect(text).toBe('I can offer foster care for this dog.');
    });

    it('deleted top-level comment with no visible replies disappears from public results', async () => {
      // Parent is DELETED with replyCount: 0
      mockCommentsRepo.findCommentById.mockResolvedValueOnce({
        ...mockTopLevelComment,
        status: 'DELETED',
        replyCount: 0,
      });

      await expect(resolver.replies(commentId, 20)).rejects.toThrow(NotFoundError);
    });
  });

  describe('6. Post Removal & Restoration', () => {
    it('removing a Post hides discussion and rejects reply creation', async () => {
      mockPostsRepo.findById.mockResolvedValueOnce({
        ...mockPost,
        status: 'REMOVED',
      });

      const ctx = createContext(replyAuthorId);
      await expect(
        resolver.createReply(
          {
            clientRequestId: 'cr-removed-1',
            commentId,
            text: 'Should fail',
          },
          ctx,
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it('removing a Post hides its replies from public queries', async () => {
      mockPostsRepo.findById.mockResolvedValueOnce({
        ...mockPost,
        status: 'REMOVED',
      });

      await expect(resolver.replies(commentId, 20)).rejects.toThrow(NotFoundError);
    });

    it('restoring a Post re-exposes valid comments and replies', async () => {
      // Post is ACTIVE again
      mockPostsRepo.findById.mockResolvedValueOnce(mockPost);
      const result = await resolver.replies(commentId, 20);
      expect(result.edges.length).toBe(1);
      expect(result.edges[0].node.id).toBe(replyId);
    });
  });

  describe('7. Concurrent Parent Ineligibility', () => {
    it('rejects reply creation if parent comment was deleted concurrently', async () => {
      // Parent status changed to DELETED during request
      mockCommentsRepo.findCommentById.mockResolvedValueOnce({
        ...mockTopLevelComment,
        status: 'DELETED',
      });

      const ctx = createContext(replyAuthorId);
      await expect(
        resolver.createReply(
          {
            clientRequestId: 'cr-race-1',
            commentId,
            text: 'Race test',
          },
          ctx,
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('8. Comment Boosts & TOP Sorting Acceptance (Ticket 04)', () => {
    it('allows boosting top-level comments and replies by other users', async () => {
      const ctx = createContext(thirdPartyUserId);
      const res = await resolver.toggleCommentBoost(commentId, ctx);
      expect(res.commentId).toBe(commentId);
      expect(res.isBoostedByMe).toBe(true);
      expect(res.boostCount).toBe(1);
    });

    it('rejects self-boosts on own top-level comment', async () => {
      const ctx = createContext(authorId);
      await expect(resolver.toggleCommentBoost(commentId, ctx)).rejects.toThrow(ForbiddenError);
    });

    it('rejects self-boosts on own reply', async () => {
      const ctx = createContext(replyAuthorId);
      await expect(resolver.toggleCommentBoost(replyId, ctx)).rejects.toThrow(ForbiddenError);
    });

    it('rejects boost toggles on nonexistent comment', async () => {
      const ctx = createContext(thirdPartyUserId);
      await expect(resolver.toggleCommentBoost('01916327-0000-7000-8000-000000000099', ctx)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('passes TOP sort option to repository', async () => {
      await resolver.comments(postId, 'TOP', 20);
      expect(mockCommentsRepo.findTopLevelCommentsByPostId).toHaveBeenCalledWith(postId, 20, 'TOP', undefined);
    });

    it('passes NEWEST sort option to repository', async () => {
      await resolver.comments(postId, 'NEWEST', 20);
      expect(mockCommentsRepo.findTopLevelCommentsByPostId).toHaveBeenCalledWith(postId, 20, 'NEWEST', undefined);
    });
  });
});

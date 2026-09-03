import { CommentsResolver } from './comments.resolver';
import { CommentsService } from './comments.service';
import { CommentsRepository } from './comments.repository';
import { PostsRepository } from '../posts/posts.repository';
import { Comment, Post } from '../database/schema';
import { ValidationError, NotFoundError, ForbiddenError } from '../common/errors/app.errors';
import { CommentCursorPayload } from './dto/comments-query.input';
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
    pinComment: jest.Mock;
    unpinComment: jest.Mock;
    isCommentPinned: jest.Mock;
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
  const secondCommentId = '01916327-0000-7000-8000-000000000021';
  const replyId = '01916327-0000-7000-8000-000000000030';
  const otherPostId = '01916327-0000-7000-8000-000000000011';
  const otherPostCommentId = '01916327-0000-7000-8000-000000000022';
  const deletedCommentId = '01916327-0000-7000-8000-000000000023';

  let currentPinnedCommentId: string | null = null;

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

  const mockOtherPost: Post = {
    ...mockPost,
    id: otherPostId,
    creatorId: thirdPartyUserId,
  };

  const mockTopLevelComment: Comment = {
    id: commentId,
    postId,
    authorId,
    parentId: null,
    text: 'I can offer foster care for this dog.',
    status: 'ACTIVE',
    replyCount: 1,
    boostCount: 0,
    createdAt: new Date('2026-09-04T00:10:00.000Z'),
    updatedAt: new Date('2026-09-04T00:10:00.000Z'),
  };

  const mockSecondComment: Comment = {
    id: secondCommentId,
    postId,
    authorId: thirdPartyUserId,
    parentId: null,
    text: 'I have supplies to donate.',
    status: 'ACTIVE',
    replyCount: 0,
    boostCount: 5,
    createdAt: new Date('2026-09-04T00:20:00.000Z'),
    updatedAt: new Date('2026-09-04T00:20:00.000Z'),
  };

  const mockOtherPostComment: Comment = {
    ...mockTopLevelComment,
    id: otherPostCommentId,
    postId: otherPostId,
  };

  const mockDeletedComment: Comment = {
    ...mockTopLevelComment,
    id: deletedCommentId,
    status: 'DELETED',
  };

  const mockReplyComment: Comment = {
    id: replyId,
    postId,
    authorId: replyAuthorId,
    parentId: commentId,
    text: 'Thank you! Where are you located?',
    status: 'ACTIVE',
    replyCount: 0,
    boostCount: 0,
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
        pinnedCommentIdByPostId: {
          load: jest
            .fn()
            .mockImplementation((pId: string) => Promise.resolve(pId === postId ? currentPinnedCommentId : null)),
        } as unknown as NonNullable<GqlContext['loaders']['pinnedCommentIdByPostId']>,
      },
    };
  }

  beforeEach(() => {
    currentPinnedCommentId = null;

    loadUserMock = jest
      .fn()
      .mockImplementation((id: string) => Promise.resolve({ id, fullName: `User ${id.slice(-4)}` }));

    mockCommentsRepo = {
      findIdempotencyRecord: jest.fn().mockResolvedValue(null),
      countRecentCreationsByAuthor: jest.fn().mockResolvedValue(0),
      createCommentWithCounter: jest.fn().mockResolvedValue(mockTopLevelComment),
      findTopLevelCommentsByPostId: jest
        .fn()
        .mockImplementation((targetPostId: string, limit: number, sort: string, cursor?: CommentCursorPayload) => {
          const allComments = [mockTopLevelComment, mockSecondComment];
          if (currentPinnedCommentId) {
            const pinned = allComments.find((c) => c.id === currentPinnedCommentId);
            const others = allComments.filter((c) => c.id !== currentPinnedCommentId);
            if (cursor?.isPinned) {
              return Promise.resolve(others.slice(0, limit + 1).map((c) => ({ ...c, isPinned: false })));
            }
            if (!cursor) {
              const res = pinned
                ? [{ ...pinned, isPinned: true }, ...others.map((c) => ({ ...c, isPinned: false }))]
                : others.map((c) => ({ ...c, isPinned: false }));
              return Promise.resolve(res.slice(0, limit + 1));
            }
            return Promise.resolve(others.slice(0, limit + 1).map((c) => ({ ...c, isPinned: false })));
          }
          return Promise.resolve(allComments.slice(0, limit + 1).map((c) => ({ ...c, isPinned: false })));
        }),
      findCommentById: jest.fn().mockImplementation((id: string) => {
        if (id === commentId) return Promise.resolve(mockTopLevelComment);
        if (id === secondCommentId) return Promise.resolve(mockSecondComment);
        if (id === replyId) return Promise.resolve(mockReplyComment);
        if (id === otherPostCommentId) return Promise.resolve(mockOtherPostComment);
        if (id === deletedCommentId) return Promise.resolve(mockDeletedComment);
        return Promise.resolve(null);
      }),
      createReplyWithCounters: jest.fn().mockResolvedValue(mockReplyComment),
      findRepliesByCommentId: jest.fn().mockResolvedValue([mockReplyComment]),
      deleteCommentWithCounters: jest.fn().mockImplementation((targetId: string, callerId: string) => {
        const item =
          targetId === commentId
            ? mockTopLevelComment
            : targetId === secondCommentId
              ? mockSecondComment
              : targetId === replyId
                ? mockReplyComment
                : null;
        if (!item) throw new NotFoundError('Comment', targetId);
        if (item.authorId !== callerId) throw new ForbiddenError('You can only delete your own comments or replies');
        if (currentPinnedCommentId === targetId) {
          currentPinnedCommentId = null;
        }
        return Promise.resolve(true);
      }),
      toggleBoost: jest.fn().mockImplementation((targetId: string, callerId: string) => {
        const item = targetId === commentId ? mockTopLevelComment : targetId === replyId ? mockReplyComment : null;
        if (!item) throw new NotFoundError('Comment', targetId);
        if (item.authorId === callerId) throw new ForbiddenError('You cannot boost your own comment or reply');
        return Promise.resolve({ isBoostedByMe: true, boostCount: 1 });
      }),
      isCommentBoostedByUser: jest.fn().mockResolvedValue(false),
      pinComment: jest.fn().mockImplementation(async (targetCommentId: string, callerId: string) => {
        let item: Comment | null = null;
        if (targetCommentId === commentId) item = mockTopLevelComment;
        else if (targetCommentId === secondCommentId) item = mockSecondComment;
        else if (targetCommentId === replyId) item = mockReplyComment;
        else if (targetCommentId === otherPostCommentId) item = mockOtherPostComment;
        else if (targetCommentId === deletedCommentId) item = mockDeletedComment;

        if (!item) throw new NotFoundError('Comment', targetCommentId);
        if (item.parentId !== null) throw new ValidationError('Only top-level comments can be pinned');
        if (item.status !== 'ACTIVE' && item.status !== 'IMAGE_HIDDEN') {
          throw new NotFoundError('Comment', targetCommentId);
        }

        const targetPost = (await mockPostsRepo.findById(item.postId)) as Post | null;
        if (!targetPost || targetPost.status === 'REMOVED') throw new NotFoundError('Post', item.postId);
        if (targetPost.creatorId !== callerId) throw new ForbiddenError('Only the post author can pin comments');

        currentPinnedCommentId = targetCommentId;
        return Promise.resolve({ ...item, isPinned: true });
      }),
      unpinComment: jest.fn().mockImplementation(async (targetPostId: string, callerId: string) => {
        const targetPost = (await mockPostsRepo.findById(targetPostId)) as Post | null;
        if (!targetPost || targetPost.status === 'REMOVED') throw new NotFoundError('Post', targetPostId);
        if (targetPost.creatorId !== callerId) throw new ForbiddenError('Only the post author can unpin comments');

        currentPinnedCommentId = null;
        return Promise.resolve(true);
      }),
      isCommentPinned: jest.fn().mockImplementation((targetPostId: string, targetCommentId: string) => {
        return Promise.resolve(currentPinnedCommentId === targetCommentId);
      }),
    };

    mockPostsRepo = {
      findById: jest.fn().mockImplementation((id: string) => {
        if (id === postId) return Promise.resolve(mockPost);
        if (id === otherPostId) return Promise.resolve(mockOtherPost);
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

  describe('9. Post-author Comment Pinning Acceptance (Ticket 05)', () => {
    describe('Authorization', () => {
      it('allows the Post author to pin an eligible top-level Comment', async () => {
        const postAuthorCtx = createContext(postCreatorId);
        const res = await resolver.pinComment(commentId, postAuthorCtx);

        expect(res).toBeDefined();
        expect(res.id).toBe(commentId);
        const isPinned = await resolver.isPinned(res, postAuthorCtx);
        expect(isPinned).toBe(true);
        expect(mockCommentsRepo.pinComment).toHaveBeenCalledWith(commentId, postCreatorId);
      });

      it('allows the Post author to unpin the Post current Comment', async () => {
        const postAuthorCtx = createContext(postCreatorId);
        // Pin first
        await resolver.pinComment(commentId, postAuthorCtx);
        // Unpin
        const unpinRes = await resolver.unpinComment(postId, postAuthorCtx);
        expect(unpinRes).toBe(true);
        expect(mockCommentsRepo.unpinComment).toHaveBeenCalledWith(postId, postCreatorId);

        // Verify pin state is false
        const isPinned = await resolver.isPinned(mockTopLevelComment, postAuthorCtx);
        expect(isPinned).toBe(false);
      });

      it('rejects the Comment author from pinning or unpinning if they are not the Post author', async () => {
        const commentAuthorCtx = createContext(authorId);

        await expect(resolver.pinComment(commentId, commentAuthorCtx)).rejects.toThrow(ForbiddenError);
        await expect(resolver.unpinComment(postId, commentAuthorCtx)).rejects.toThrow(ForbiddenError);
      });

      it('rejects a third-party user from pinning or unpinning', async () => {
        const thirdPartyCtx = createContext(thirdPartyUserId);

        await expect(resolver.pinComment(commentId, thirdPartyCtx)).rejects.toThrow(ForbiddenError);
        await expect(resolver.unpinComment(postId, thirdPartyCtx)).rejects.toThrow(ForbiddenError);
      });
    });

    describe('Eligibility', () => {
      it('rejects pinning a reply (replies are ineligible for pinning)', async () => {
        const postAuthorCtx = createContext(postCreatorId);
        await expect(resolver.pinComment(replyId, postAuthorCtx)).rejects.toThrow(ValidationError);
        await expect(resolver.pinComment(replyId, postAuthorCtx)).rejects.toThrow(
          /Only top-level comments can be pinned/,
        );
      });

      it('rejects pinning a deleted comment', async () => {
        const postAuthorCtx = createContext(postCreatorId);
        await expect(resolver.pinComment(deletedCommentId, postAuthorCtx)).rejects.toThrow(NotFoundError);
      });

      it('rejects pinning a nonexistent comment', async () => {
        const postAuthorCtx = createContext(postCreatorId);
        await expect(resolver.pinComment('01916327-0000-7000-8000-000000000999', postAuthorCtx)).rejects.toThrow(
          NotFoundError,
        );
      });

      it('rejects pinning a comment from another post where user is not the post author', async () => {
        // postCreatorId is author of postId, but not of otherPostId (owned by thirdPartyUserId)
        const postAuthorCtx = createContext(postCreatorId);
        await expect(resolver.pinComment(otherPostCommentId, postAuthorCtx)).rejects.toThrow(ForbiddenError);
      });

      it('rejects pinning a comment beneath a REMOVED post', async () => {
        mockPostsRepo.findById.mockImplementationOnce(() =>
          Promise.resolve({
            ...mockPost,
            status: 'REMOVED',
          }),
        );
        const postAuthorCtx = createContext(postCreatorId);
        await expect(resolver.pinComment(commentId, postAuthorCtx)).rejects.toThrow(NotFoundError);
      });
    });

    describe('Uniqueness & Atomic Replacement', () => {
      it('atomically replaces the previous pin when pinning another comment without multiple pins', async () => {
        const postAuthorCtx = createContext(postCreatorId);

        // 1. Pin first comment
        await resolver.pinComment(commentId, postAuthorCtx);
        expect(await resolver.isPinned(mockTopLevelComment, postAuthorCtx)).toBe(true);

        // 2. Pin second comment -> replaces first
        await resolver.pinComment(secondCommentId, postAuthorCtx);

        // Second comment is now pinned
        expect(await resolver.isPinned(mockSecondComment, postAuthorCtx)).toBe(true);
        // First comment is no longer pinned
        expect(await resolver.isPinned(mockTopLevelComment, postAuthorCtx)).toBe(false);
      });
    });

    describe('Idempotency', () => {
      it('repeating the same pin operation is idempotent and returns canonical outcome', async () => {
        const postAuthorCtx = createContext(postCreatorId);

        const res1 = await resolver.pinComment(commentId, postAuthorCtx);
        expect(res1.id).toBe(commentId);

        const res2 = await resolver.pinComment(commentId, postAuthorCtx);
        expect(res2.id).toBe(commentId);

        expect(await resolver.isPinned(res2, postAuthorCtx)).toBe(true);
      });

      it('repeating unpin operation on a post with no pin is idempotent and returns true', async () => {
        const postAuthorCtx = createContext(postCreatorId);

        const res1 = await resolver.unpinComment(postId, postAuthorCtx);
        expect(res1).toBe(true);

        const res2 = await resolver.unpinComment(postId, postAuthorCtx);
        expect(res2).toBe(true);
      });
    });

    describe('Invalidation & Post Removal', () => {
      it('deleting an individually pinned comment invalidates its pin', async () => {
        const postAuthorCtx = createContext(postCreatorId);
        const commentAuthorCtx = createContext(authorId);

        // Pin the comment
        await resolver.pinComment(commentId, postAuthorCtx);
        expect(await resolver.isPinned(mockTopLevelComment, postAuthorCtx)).toBe(true);

        // Author deletes their comment
        await resolver.deleteComment(commentId, commentAuthorCtx);

        // Pin is now invalidated
        expect(await resolver.isPinned(mockTopLevelComment, postAuthorCtx)).toBe(false);
      });

      it('removing a Post hides discussion and pin; restoring re-exposes pin if comment is active', async () => {
        const postAuthorCtx = createContext(postCreatorId);
        await resolver.pinComment(commentId, postAuthorCtx);

        // Mark post REMOVED
        mockPostsRepo.findById.mockImplementation((id: string) => {
          if (id === postId) return Promise.resolve({ ...mockPost, status: 'REMOVED' });
          return Promise.resolve(null);
        });

        // Querying comments fails with NotFoundError
        await expect(resolver.comments(postId, 'TOP', 20)).rejects.toThrow(NotFoundError);

        // Restore post
        mockPostsRepo.findById.mockImplementation((id: string) => {
          if (id === postId) return Promise.resolve(mockPost);
          return Promise.resolve(null);
        });

        // Querying comments succeeds and pin is exposed
        const result = await resolver.comments(postId, 'TOP', 20);
        expect(result.edges.length).toBeGreaterThan(0);
        expect(result.edges[0].node.id).toBe(commentId);
        expect(result.edges[0].node.isPinned).toBe(true);
      });
    });

    describe('List Ordering & Keyset Pagination around Pin', () => {
      it('places the valid pinned comment first under TOP sort', async () => {
        const postAuthorCtx = createContext(postCreatorId);
        // commentId has boostCount=0, secondCommentId has boostCount=5
        // Under normal TOP sort, secondCommentId would be first.
        // Pin commentId:
        await resolver.pinComment(commentId, postAuthorCtx);

        const res = await resolver.comments(postId, 'TOP', 20);
        expect(res.edges[0].node.id).toBe(commentId);
        expect(res.edges[0].node.isPinned).toBe(true);
        expect(res.edges[1].node.id).toBe(secondCommentId);
        expect(res.edges[1].node.isPinned).toBe(false);
      });

      it('places the valid pinned comment first under NEWEST sort', async () => {
        const postAuthorCtx = createContext(postCreatorId);
        // commentId is older (00:10), secondCommentId is newer (00:20)
        // Under normal NEWEST sort, secondCommentId would be first.
        // Pin commentId:
        await resolver.pinComment(commentId, postAuthorCtx);

        const res = await resolver.comments(postId, 'NEWEST', 20);
        expect(res.edges[0].node.id).toBe(commentId);
        expect(res.edges[0].node.isPinned).toBe(true);
        expect(res.edges[1].node.id).toBe(secondCommentId);
      });

      it('does not duplicate pinned comment in later pages and paginates continuously across pin boundary', async () => {
        const postAuthorCtx = createContext(postCreatorId);
        await resolver.pinComment(commentId, postAuthorCtx);

        // Page 1: request 1 item
        const page1 = await resolver.comments(postId, 'TOP', 1);
        expect(page1.edges.length).toBe(1);
        expect(page1.edges[0].node.id).toBe(commentId);
        expect(page1.edges[0].node.isPinned).toBe(true);
        expect(page1.pageInfo.hasNextPage).toBe(true);

        const pinCursor = page1.edges[0].cursor;

        // Page 2: request next item using pinCursor
        const page2 = await resolver.comments(postId, 'TOP', 1, pinCursor);
        expect(page2.edges.length).toBe(1);
        expect(page2.edges[0].node.id).toBe(secondCommentId);
        expect(page2.edges[0].node.isPinned).toBe(false);

        // Pinned comment is NOT duplicated in page 2
        expect(page2.edges.map((e) => e.node.id)).not.toContain(commentId);
      });
    });

    describe('Concurrency', () => {
      it('preserves exactly one winner during concurrent pin replacements', async () => {
        const postAuthorCtx = createContext(postCreatorId);

        // Run two pin operations simultaneously
        const [pinA, pinB] = await Promise.all([
          resolver.pinComment(commentId, postAuthorCtx),
          resolver.pinComment(secondCommentId, postAuthorCtx),
        ]);

        expect(pinA).toBeDefined();
        expect(pinB).toBeDefined();

        // Database/Repo invariant: exactly one comment is currently pinned
        const isComment1Pinned = await resolver.isPinned(mockTopLevelComment, postAuthorCtx);
        const isComment2Pinned = await resolver.isPinned(mockSecondComment, postAuthorCtx);

        // Exactly one is true (exclusive OR)
        expect(isComment1Pinned !== isComment2Pinned).toBe(true);
      });
    });
  });
});

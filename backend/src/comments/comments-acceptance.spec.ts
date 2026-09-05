import * as crypto from 'crypto';
import { CommentsResolver, CommentMediaResolver } from './comments.resolver';
import { CommentsService } from './comments.service';
import { CommentsRepository } from './comments.repository';
import { PostsRepository } from '../posts/posts.repository';
import { Comment, Post, CommentMedia, ReportReason } from '../database/schema';
import { ValidationError, NotFoundError, ForbiddenError, AppError, ConflictError } from '../common/errors/app.errors';
import { CommentCursorPayload } from './dto/comments-query.input';
import { UploadService } from '../upload/upload.service';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import type { GqlContext } from '../common/types/gql-context.type';

describe('Comments & Replies Acceptance Tests (Ticket 03)', () => {
  let resolver: CommentsResolver;
  let mediaResolver: CommentMediaResolver;
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
    findMediaByCommentId: jest.Mock;
    countRecentReportsByReporter: jest.Mock;
    reportComment: jest.Mock;
  };
  let mockPostsRepo: {
    findById: jest.Mock;
  };
  let mockUploadService: {
    requestCommentImageUploadUrl: jest.Mock;
    finalizeCommentImage: jest.Mock;
    finalizeCommentImages: jest.Mock;
    deleteObject: jest.Mock;
    markMediaFailed: jest.Mock;
  };
  let mockConfigService: {
    get: jest.Mock;
  };
  let mockNotificationsService: {
    fireNotification: jest.Mock;
  };
  let mockUsersService: {
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
  const commentWithMediaId = '01916327-0000-7000-8000-000000000025';
  const mediaId = '01916327-0000-7000-8000-000000000050';

  const mockCommentMedia: CommentMedia = {
    id: mediaId,
    commentId: commentWithMediaId,
    storageKey: `comments/${commentWithMediaId}/${mediaId}.webp`,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    width: 320,
    height: 240,
    fileSizeBytes: 45000,
    fileContentType: 'image/webp',
    displayOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCommentWithMedia: Comment = {
    id: commentWithMediaId,
    postId,
    authorId,
    parentId: null,
    text: 'Check out this dog photo!',
    status: 'ACTIVE',
    replyCount: 0,
    boostCount: 0,
    createdAt: new Date('2026-09-04T00:30:00.000Z'),
    updatedAt: new Date('2026-09-04T00:30:00.000Z'),
  };

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
        commentMediaByCommentId: {
          load: jest
            .fn()
            .mockImplementation((cId: string) => Promise.resolve(cId === commentWithMediaId ? [mockCommentMedia] : [])),
        } as unknown as NonNullable<GqlContext['loaders']['commentMediaByCommentId']>,
      },
    };
  }

  beforeEach(() => {
    currentPinnedCommentId = null;

    loadUserMock = jest
      .fn()
      .mockImplementation((id: string) => Promise.resolve({ id, fullName: `User ${id.slice(-4)}` }));

    mockUploadService = {
      requestCommentImageUploadUrl: jest.fn().mockImplementation(() => {
        return Promise.resolve({
          mediaId: '01916327-0000-7000-8000-000000000050',
          uploadUrl: 'https://r2.example.com/staging/put',
          expiresAt: new Date(Date.now() + 600_000),
          maxSizeBytes: 100_000,
          maxWidth: 480,
          maxHeight: 480,
          mimeType: 'image/webp',
          allowedContentType: 'image/webp',
        });
      }),
      finalizeCommentImage: jest.fn().mockImplementation((mediaId: string, _userId: string, commentId: string) => {
        return Promise.resolve({
          id: mediaId,
          commentId,
          storageKey: `comments/${commentId}/${mediaId}.webp`,
          stagingKey: `staging/${_userId}/${mediaId}`,
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          width: 320,
          height: 240,
          fileSizeBytes: 45000,
          fileContentType: 'image/webp',
          displayOrder: 0,
        });
      }),
      finalizeCommentImages: jest.fn().mockImplementation((mediaIds: string[], userId: string, commentId: string) => {
        return Promise.resolve(
          mediaIds.map((id, index) => ({
            id,
            commentId,
            storageKey: `comments/${commentId}/${id}.webp`,
            stagingKey: `staging/${userId}/${id}`,
            sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            width: 320,
            height: 240,
            fileSizeBytes: 45000,
            fileContentType: 'image/webp',
            displayOrder: index,
          })),
        );
      }),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      markMediaFailed: jest.fn().mockResolvedValue(undefined),
    };

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'COMMENT_MEDIA_CDN_BASE') return 'https://cdn.pupzy.net';
        if (key === 'COMMENT_IMAGES_ENABLED') return 'true';
        return undefined;
      }),
    };

    mockNotificationsService = {
      fireNotification: jest.fn(),
    };

    mockUsersService = {
      findById: jest.fn().mockImplementation((id: string) => Promise.resolve({ id, fullName: `User ${id.slice(-4)}` })),
    };

    mockCommentsRepo = {
      findIdempotencyRecord: jest.fn().mockResolvedValue(null),
      countRecentCreationsByAuthor: jest.fn().mockResolvedValue(0),
      createCommentWithCounter: jest.fn().mockImplementation((data: { commentId?: string; mediaItems?: unknown[] }) => {
        if (data.mediaItems && data.mediaItems.length > 0) {
          return Promise.resolve({
            ...mockCommentWithMedia,
            id: data.commentId ?? commentWithMediaId,
          });
        }
        return Promise.resolve(mockTopLevelComment);
      }),
      queueMediaDeletionWork: jest.fn().mockResolvedValue(undefined),
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
        if (id === commentWithMediaId) return Promise.resolve(mockCommentWithMedia);
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
                : targetId === commentWithMediaId
                  ? mockCommentWithMedia
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

        const isNewPin = currentPinnedCommentId !== targetCommentId;
        currentPinnedCommentId = targetCommentId;
        return Promise.resolve({ comment: { ...item, isPinned: true }, isNewPin, postTitle: targetPost.title });
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
      findMediaByCommentId: jest.fn().mockImplementation((cId: string) => {
        if (cId === commentWithMediaId) return Promise.resolve([mockCommentMedia]);
        return Promise.resolve([]);
      }),
      countRecentReportsByReporter: jest.fn().mockResolvedValue(0),
      reportComment: jest.fn().mockResolvedValue(true),
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
      mockUploadService as unknown as UploadService,
      mockConfigService as unknown as ConfigService,
      undefined,
      mockNotificationsService as unknown as NotificationsService,
      mockUsersService as unknown as UsersService,
    );

    resolver = new CommentsResolver(service);
    mediaResolver = new CommentMediaResolver(service);
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
      expect(mockCommentsRepo.deleteCommentWithCounters).toHaveBeenCalledWith(commentId, authorId, expect.any(String));
    });

    it('allows an author to delete their own reply', async () => {
      const ctx = createContext(replyAuthorId);
      const result = await resolver.deleteComment(replyId, ctx);
      expect(result).toBe(true);
      expect(mockCommentsRepo.deleteCommentWithCounters).toHaveBeenCalledWith(
        replyId,
        replyAuthorId,
        expect.any(String),
      );
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

  describe('10. One Verified Image on a Comment Acceptance (Ticket 06)', () => {
    describe('Dedicated Additive Upload Mutation & Constraints', () => {
      it('returns opaque mediaId, presigned PUT URL, expiry, and authoritative constraints', async () => {
        const ctx = createContext(authorId);
        const ticket = await resolver.requestCommentImageUploadUrl(
          {
            contentType: 'image/webp',
            fileSizeBytes: 50000,
          },
          ctx,
        );

        expect(ticket).toBeDefined();
        expect(ticket.mediaId).toBe('01916327-0000-7000-8000-000000000050');
        expect(ticket.uploadUrl).toBe('https://r2.example.com/staging/put');
        expect(ticket.maxSizeBytes).toBe(100000);
        expect(ticket.maxWidth).toBe(480);
        expect(ticket.maxHeight).toBe(480);
        expect(ticket.mimeType).toBe('image/webp');
      });

      it('rejects upload ticket request for non-webp content type with COMMENT_MEDIA_INVALID_FORMAT', async () => {
        const ctx = createContext(authorId);
        await expect(
          resolver.requestCommentImageUploadUrl(
            {
              contentType: 'image/jpeg',
              fileSizeBytes: 50000,
            },
            ctx,
          ),
        ).rejects.toThrow('Only static WebP images are allowed');
      });

      it('rejects upload ticket request exceeding 100,000 bytes with COMMENT_MEDIA_TOO_LARGE', async () => {
        const ctx = createContext(authorId);
        await expect(
          resolver.requestCommentImageUploadUrl(
            {
              contentType: 'image/webp',
              fileSizeBytes: 100001,
            },
            ctx,
          ),
        ).rejects.toThrow('File size exceeds 100,000 bytes');
      });
    });

    describe('Kill Switch (COMMENT_IMAGES_ENABLED=false)', () => {
      it('blocks new comment image tickets while text comments and reads continue working', async () => {
        const ctx = createContext(authorId);

        // Turn off kill switch
        mockUploadService.requestCommentImageUploadUrl.mockRejectedValueOnce(
          new AppError('Comment images are currently disabled', 'COMMENT_IMAGES_DISABLED'),
        );

        await expect(
          resolver.requestCommentImageUploadUrl(
            {
              contentType: 'image/webp',
              fileSizeBytes: 50000,
            },
            ctx,
          ),
        ).rejects.toThrow('Comment images are currently disabled');

        // Text comments still work!
        const textComment = await resolver.createComment(
          {
            clientRequestId: 'req-text-during-killswitch',
            postId,
            text: 'Text comments continue to work even when images are disabled',
          },
          ctx,
        );
        expect(textComment).toBeDefined();
        expect(textComment.text).toBe(mockTopLevelComment.text);

        // Comment queries still work!
        const list = await resolver.comments(postId, 'NEWEST', 10);
        expect(list.edges.length).toBeGreaterThan(0);
      });
    });

    describe('Single Image Limit & Mandatory Text', () => {
      it('allows publishing a comment with 0 media IDs', async () => {
        const ctx = createContext(authorId);
        const result = await resolver.createComment(
          {
            clientRequestId: 'req-no-media',
            postId,
            text: 'Comment with no media',
            mediaIds: [],
          },
          ctx,
        );
        expect(result).toBeDefined();
      });

      it('allows publishing a comment with 1 valid media ID', async () => {
        const ctx = createContext(authorId);
        const result = await resolver.createComment(
          {
            clientRequestId: 'req-one-media',
            postId,
            text: 'Comment with 1 media item',
            mediaIds: [mediaId],
          },
          ctx,
        );
        expect(result).toBeDefined();
        expect(mockUploadService.finalizeCommentImages).toHaveBeenCalledWith([mediaId], authorId, expect.any(String), {
          postId,
        });
      });

      it('allows publishing a comment with 2 valid media IDs (Ticket 07)', async () => {
        const secondMediaId = '01916327-0000-7000-8000-000000000051';
        const ctx = createContext(authorId);
        const result = await resolver.createComment(
          {
            clientRequestId: 'req-two-media',
            postId,
            text: 'Comment with 2 media items',
            mediaIds: [mediaId, secondMediaId],
          },
          ctx,
        );
        expect(result).toBeDefined();
        expect(mockUploadService.finalizeCommentImages).toHaveBeenCalledWith(
          [mediaId, secondMediaId],
          authorId,
          expect.any(String),
          { postId },
        );
      });

      it('rejects publishing a comment with more than 2 media IDs', async () => {
        const ctx = createContext(authorId);
        await expect(
          resolver.createComment(
            {
              clientRequestId: 'req-too-many-media',
              postId,
              text: 'Comment with 3 media items',
              mediaIds: [mediaId, '01916327-0000-7000-8000-000000000051', '01916327-0000-7000-8000-000000000052'],
            },
            ctx,
          ),
        ).rejects.toThrow('Maximum 2 images allowed per comment');
      });

      it('rejects duplicate media IDs', async () => {
        const ctx = createContext(authorId);
        await expect(
          resolver.createComment(
            {
              clientRequestId: 'req-duplicate-media',
              postId,
              text: 'Comment with duplicate media',
              mediaIds: [mediaId, mediaId],
            },
            ctx,
          ),
        ).rejects.toThrow(/Duplicate media IDs/);
      });

      it('still requires non-empty text when attaching an image', async () => {
        const ctx = createContext(authorId);
        await expect(
          resolver.createComment(
            {
              clientRequestId: 'req-empty-text-with-image',
              postId,
              text: '   ',
              mediaIds: [mediaId],
            },
            ctx,
          ),
        ).rejects.toThrow('Comment text cannot be empty');
      });
    });

    describe('Safe Error Propagation & Staged Object Deletion', () => {
      it('propagates safe error when uploadService rejects invalid image format', async () => {
        const ctx = createContext(authorId);
        mockUploadService.finalizeCommentImages.mockRejectedValueOnce(
          new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT'),
        );

        await expect(
          resolver.createComment(
            {
              clientRequestId: 'req-invalid-format',
              postId,
              text: 'Trying corrupt image',
              mediaIds: [mediaId],
            },
            ctx,
          ),
        ).rejects.toThrow(AppError);
      });

      it('propagates COMMENT_MEDIA_NOT_AVAILABLE for unavailable / expired / wrong user media', async () => {
        const ctx = createContext(authorId);
        mockUploadService.finalizeCommentImages.mockRejectedValueOnce(
          new AppError('Media is not available', 'COMMENT_MEDIA_NOT_AVAILABLE'),
        );

        await expect(
          resolver.createComment(
            {
              clientRequestId: 'req-not-available',
              postId,
              text: 'Trying unavailable media',
              mediaIds: [mediaId],
            },
            ctx,
          ),
        ).rejects.toThrow('Media is not available');
      });

      it('rolls back staged object from R2 and queues media deletion outbox if database insert fails', async () => {
        const ctx = createContext(authorId);
        mockCommentsRepo.createCommentWithCounter.mockRejectedValueOnce(new Error('DB transaction error'));

        await expect(
          resolver.createComment(
            {
              clientRequestId: 'req-db-fail',
              postId,
              text: 'Failing DB insert',
              mediaIds: [mediaId],
            },
            ctx,
          ),
        ).rejects.toThrow('DB transaction error');

        expect(mockCommentsRepo.queueMediaDeletionWork).toHaveBeenCalledWith(
          expect.stringMatching(new RegExp(`^comments/[^/]+/${mediaId}\\.webp$`)),
          expect.stringContaining('https://cdn.pupzy.net'),
        );
        expect(mockUploadService.markMediaFailed).toHaveBeenCalledWith([mediaId], 'Database transaction failed');
      });
    });

    describe('Dynamic Public URL Resolution & R2 Operational Override', () => {
      it('resolves publicUrl using default COMMENT_MEDIA_CDN_BASE', () => {
        const url = mediaResolver.publicUrl(mockCommentMedia);
        expect(url).toBe(`https://cdn.pupzy.net/${mockCommentMedia.storageKey}`);
      });

      it('dynamically adapts when CDN base configuration changes without modifying DB rows', () => {
        mockConfigService.get.mockImplementation((key: string) => {
          if (key === 'COMMENT_MEDIA_CDN_BASE') return 'https://fallback-cdn.pupzy.net';
          return undefined;
        });

        const url = mediaResolver.publicUrl(mockCommentMedia);
        expect(url).toBe(`https://fallback-cdn.pupzy.net/${mockCommentMedia.storageKey}`);
      });
    });

    describe('Tombstone Privacy & Moderation', () => {
      it('returns empty media array when comment status is DELETED (tombstone)', async () => {
        const ctx = createContext(authorId);
        const media = await resolver.media(mockDeletedComment, ctx);
        expect(media).toEqual([]);
      });

      it('resolves media for ACTIVE comment', async () => {
        const ctx = createContext(authorId);
        const media = await resolver.media(mockCommentWithMedia, ctx);
        expect(media).toHaveLength(1);
        expect(media[0].id).toBe(mediaId);
      });
    });

    describe('Durable Idempotency with Media', () => {
      it('replays identical response on retry with same clientRequestId and mediaIds', async () => {
        const ctx = createContext(authorId);
        const hash = crypto
          .createHash('sha256')
          .update(
            JSON.stringify({
              postId,
              text: 'Check out this dog photo!',
              mediaIds: [mediaId],
            }),
          )
          .digest('hex');

        mockCommentsRepo.findIdempotencyRecord.mockResolvedValueOnce({
          id: 'idem-media-1',
          authorId,
          clientRequestId: 'req-idem-media',
          requestHash: hash,
          commentId: commentWithMediaId,
          responsePayload: mockCommentWithMedia,
          createdAt: new Date(),
        });

        const result = await resolver.createComment(
          {
            clientRequestId: 'req-idem-media',
            postId,
            text: 'Check out this dog photo!',
            mediaIds: [mediaId],
          },
          ctx,
        );

        expect(result.id).toBe(commentWithMediaId);
        // Does NOT re-finalize media on replay
        expect(mockUploadService.finalizeCommentImages).not.toHaveBeenCalled();
      });
    });

    describe('Scenario 8: Comment reporting and automatic hiding (Ticket 08)', () => {
      it('successfully reports a visible comment with valid reason and optional details', async () => {
        const ctx = createContext(thirdPartyUserId);
        const result = await resolver.reportComment(
          {
            commentId,
            reason: 'SPAM',
            details: 'This looks like spam advertising.',
          },
          ctx,
        );

        expect(result).toBe(true);
        expect(mockCommentsRepo.countRecentReportsByReporter).toHaveBeenCalledWith(thirdPartyUserId, expect.any(Date));
        expect(mockCommentsRepo.reportComment).toHaveBeenCalledWith({
          commentId,
          reporterId: thirdPartyUserId,
          reason: 'SPAM',
          details: 'This looks like spam advertising.',
        });
      });

      it('rejects self-reporting with ForbiddenError', async () => {
        const ctx = createContext(authorId);
        mockCommentsRepo.reportComment.mockRejectedValueOnce(new ForbiddenError('You cannot report your own comment'));

        await expect(
          resolver.reportComment(
            {
              commentId,
              reason: 'INAPPROPRIATE_CONTENT',
            },
            ctx,
          ),
        ).rejects.toThrow(ForbiddenError);
      });

      it('rejects duplicate report from the same user on the same comment', async () => {
        const ctx = createContext(thirdPartyUserId);
        mockCommentsRepo.reportComment.mockRejectedValueOnce(
          new ConflictError('You have already reported this comment', 'COMMENT_ALREADY_REPORTED'),
        );

        await expect(
          resolver.reportComment(
            {
              commentId,
              reason: 'SPAM',
            },
            ctx,
          ),
        ).rejects.toThrow(ConflictError);
      });

      it('enforces authenticated per-user daily limit of 10 reports per day', async () => {
        const ctx = createContext(thirdPartyUserId);
        mockCommentsRepo.countRecentReportsByReporter.mockResolvedValueOnce(10);

        await expect(
          resolver.reportComment(
            {
              commentId,
              reason: 'SPAM',
            },
            ctx,
          ),
        ).rejects.toThrow(AppError);
        expect(mockCommentsRepo.reportComment).not.toHaveBeenCalled();
      });

      it('hiding only images (IMAGE_HIDDEN): comment text and counts remain visible, but media resolves to empty array', async () => {
        const imageHiddenComment: Comment = {
          ...mockCommentWithMedia,
          status: 'IMAGE_HIDDEN',
        };

        const ctx = createContext(thirdPartyUserId);
        const textResult = resolver.text(imageHiddenComment);
        expect(textResult).toBe('Check out this dog photo!');

        const mediaResult = await resolver.media(imageHiddenComment, ctx);
        expect(mediaResult).toEqual([]);
      });

      it('hiding whole comment (HIDDEN): parent with surviving replies resolves as neutral tombstone', async () => {
        const hiddenCommentWithReplies: Comment = {
          ...mockTopLevelComment,
          status: 'HIDDEN',
          replyCount: 2,
        };

        const ctx = createContext(thirdPartyUserId);
        const textResult = resolver.text(hiddenCommentWithReplies);
        expect(textResult).toBe('[Hidden]');

        const authorResult = await resolver.author(hiddenCommentWithReplies, ctx);
        expect(authorResult).toBeNull();

        const mediaResult = await resolver.media(hiddenCommentWithReplies, ctx);
        expect(mediaResult).toEqual([]);

        const isPinnedResult = await resolver.isPinned(hiddenCommentWithReplies, ctx);
        expect(isPinnedResult).toBe(false);
      });

      it('validates input and rejects invalid report reasons and malformed UUIDs', async () => {
        const ctx = createContext(thirdPartyUserId);
        await expect(
          resolver.reportComment(
            {
              commentId: 'not-a-valid-uuid',
              reason: 'SPAM',
            },
            ctx,
          ),
        ).rejects.toThrow();

        await expect(
          resolver.reportComment(
            {
              commentId,
              reason: 'NON_EXISTENT_REASON' as unknown as ReportReason,
            },
            ctx,
          ),
        ).rejects.toThrow();
      });
    });

    describe('Administrative Comment Moderation (Ticket 09)', () => {
      it('masking removed comment (REMOVED): exposes neutral text, masks author, strips media, unpins', async () => {
        const removedComment: Comment = {
          ...mockTopLevelComment,
          status: 'REMOVED',
          replyCount: 1,
        };

        const ctx = createContext(thirdPartyUserId);
        const textResult = resolver.text(removedComment);
        expect(textResult).toBe('[Removed]');

        const authorResult = await resolver.author(removedComment, ctx);
        expect(authorResult).toBeNull();

        const mediaResult = await resolver.media(removedComment, ctx);
        expect(mediaResult).toEqual([]);

        const isPinnedResult = await resolver.isPinned(removedComment, ctx);
        expect(isPinnedResult).toBe(false);
      });

      it('restoring a removed post does NOT unmask or restore an individually REMOVED comment', async () => {
        // Even when post status is restored to ACTIVE, comment with status REMOVED remains masked
        const individuallyRemovedComment: Comment = {
          ...mockTopLevelComment,
          status: 'REMOVED',
        };

        const ctx = createContext(thirdPartyUserId);
        expect(resolver.text(individuallyRemovedComment)).toBe('[Removed]');
        expect(await resolver.author(individuallyRemovedComment, ctx)).toBeNull();
        expect(await resolver.media(individuallyRemovedComment, ctx)).toEqual([]);
      });
    });

    describe('Discussion Notifications Acceptance Tests (Ticket 10)', () => {
      it('NEW_COMMENT: fires notification to post owner when third-party comments', async () => {
        const ctx = createContext(thirdPartyUserId);
        const res = await resolver.createComment(
          {
            clientRequestId: 'cr-notif-comment-1',
            postId,
            text: 'I love this post!',
          },
          ctx,
        );

        expect(res).toBeDefined();
        expect(mockNotificationsService.fireNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            recipientId: postCreatorId,
            type: 'NEW_COMMENT',
            relatedPostId: postId,
            relatedCommentId: mockTopLevelComment.id,
          }),
          thirdPartyUserId,
        );
      });

      it('NEW_COMMENT: suppresses notification when post owner comments on own post', async () => {
        const ctx = createContext(postCreatorId);
        await resolver.createComment(
          {
            clientRequestId: 'cr-notif-comment-self',
            postId,
            text: 'Author update on post',
          },
          ctx,
        );

        expect(mockNotificationsService.fireNotification).not.toHaveBeenCalled();
      });

      it('NEW_COMMENT: suppresses notification on idempotent replay', async () => {
        const payloadHash = crypto
          .createHash('sha256')
          .update(JSON.stringify({ postId, text: 'Author update', mediaIds: [] }))
          .digest('hex');
        mockCommentsRepo.findIdempotencyRecord.mockResolvedValueOnce({
          responsePayload: mockTopLevelComment,
          requestHash: payloadHash,
        });

        const ctx = createContext(thirdPartyUserId);
        await resolver.createComment(
          {
            clientRequestId: 'cr-notif-replay',
            postId,
            text: 'Author update',
          },
          ctx,
        );

        expect(mockNotificationsService.fireNotification).not.toHaveBeenCalled();
      });

      it('NEW_REPLY: fires notification to parent author when third-party replies', async () => {
        const ctx = createContext(thirdPartyUserId);
        const res = await resolver.createReply(
          {
            clientRequestId: 'cr-notif-reply-1',
            commentId,
            text: 'Replying to you!',
          },
          ctx,
        );

        expect(res).toBeDefined();
        expect(mockNotificationsService.fireNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            recipientId: authorId,
            type: 'NEW_REPLY',
            relatedPostId: postId,
            relatedCommentId: mockReplyComment.id,
          }),
          thirdPartyUserId,
        );
      });

      it('NEW_REPLY: suppresses notification when parent author replies to own comment', async () => {
        const ctx = createContext(authorId);
        await resolver.createReply(
          {
            clientRequestId: 'cr-notif-reply-self',
            commentId,
            text: 'Replying to myself',
          },
          ctx,
        );

        expect(mockNotificationsService.fireNotification).not.toHaveBeenCalled();
      });

      it('NEW_REPLY: suppresses notification on idempotent replay', async () => {
        const payloadHash = crypto
          .createHash('sha256')
          .update(JSON.stringify({ commentId, text: 'Replying' }))
          .digest('hex');
        mockCommentsRepo.findIdempotencyRecord.mockResolvedValueOnce({
          responsePayload: mockReplyComment,
          requestHash: payloadHash,
        });

        const ctx = createContext(thirdPartyUserId);
        await resolver.createReply(
          {
            clientRequestId: 'cr-notif-reply-rep',
            commentId,
            text: 'Replying',
          },
          ctx,
        );

        expect(mockNotificationsService.fireNotification).not.toHaveBeenCalled();
      });

      it('COMMENT_BOOSTED: fires notification to author when boost is added', async () => {
        const ctx = createContext(thirdPartyUserId);
        const res = await resolver.toggleCommentBoost(commentId, ctx);

        expect(res.isBoostedByMe).toBe(true);
        expect(mockNotificationsService.fireNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            recipientId: authorId,
            type: 'COMMENT_BOOSTED',
            relatedPostId: postId,
            relatedCommentId: commentId,
          }),
          thirdPartyUserId,
        );
      });

      it('COMMENT_BOOSTED: does NOT fire notification when removing a boost', async () => {
        mockCommentsRepo.toggleBoost.mockResolvedValueOnce({
          isBoostedByMe: false,
          boostCount: 0,
        });

        const ctx = createContext(thirdPartyUserId);
        const res = await resolver.toggleCommentBoost(commentId, ctx);

        expect(res.isBoostedByMe).toBe(false);
        expect(mockNotificationsService.fireNotification).not.toHaveBeenCalled();
      });

      it('COMMENT_PINNED: fires notification to author when comment is pinned', async () => {
        const ctx = createContext(postCreatorId);
        const res = await resolver.pinComment(commentId, ctx);

        expect(res.id).toBe(commentId);
        expect(mockNotificationsService.fireNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            recipientId: authorId,
            type: 'COMMENT_PINNED',
            relatedPostId: postId,
            relatedCommentId: commentId,
          }),
          postCreatorId,
        );
      });

      it('COMMENT_PINNED: suppresses notification if pinned comment belongs to post author', async () => {
        mockCommentsRepo.pinComment.mockResolvedValueOnce({
          comment: { ...mockTopLevelComment, authorId: postCreatorId, isPinned: true },
          isNewPin: true,
          postTitle: mockPost.title,
        });

        const ctx = createContext(postCreatorId);
        await resolver.pinComment(commentId, ctx);

        expect(mockNotificationsService.fireNotification).not.toHaveBeenCalled();
      });

      it('COMMENT_PINNED: suppresses notification on idempotent re-pin (isNewPin is false)', async () => {
        mockCommentsRepo.pinComment.mockResolvedValueOnce({
          comment: { ...mockTopLevelComment, isPinned: true },
          isNewPin: false,
          postTitle: mockPost.title,
        });

        const ctx = createContext(postCreatorId);
        await resolver.pinComment(commentId, ctx);

        expect(mockNotificationsService.fireNotification).not.toHaveBeenCalled();
      });
    });
  });
});

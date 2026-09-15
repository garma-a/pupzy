import { CommentsResolver, CommentMediaResolver } from './comments.resolver';
import { CommentsService } from './comments.service';
import { Comment, CommentMedia } from '../database/schema';
import type { GqlContext } from '../common/types/gql-context.type';

describe('CommentsResolver', () => {
  let resolver: CommentsResolver;
  let mockCommentsService: {
    createComment: jest.Mock;
    createReply: jest.Mock;
    deleteComment: jest.Mock;
    getComments: jest.Mock;
    getReplies: jest.Mock;
    toggleCommentBoost: jest.Mock;
    isCommentBoostedByUser: jest.Mock;
  };
  let loadUserMock: jest.Mock;
  let mockContext: GqlContext;

  const userId = '01916327-0000-7000-8000-000000000001';
  const postId = '01916327-0000-7000-8000-000000000002';

  const mockComment: Comment = {
    id: '01916327-0000-7000-8000-000000000010',
    postId,
    authorId: userId,
    parentId: null,
    text: 'Great post!',
    status: 'ACTIVE',
    replyCount: 0,
    boostCount: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockCommentsService = {
      createComment: jest.fn().mockResolvedValue(mockComment),
      createReply: jest.fn(),
      deleteComment: jest.fn(),
      getComments: jest.fn().mockResolvedValue({
        edges: [{ node: mockComment, cursor: 'cursor-1' }],
        pageInfo: { endCursor: 'cursor-1', hasNextPage: false },
      }),
      getReplies: jest.fn(),
      toggleCommentBoost: jest.fn().mockResolvedValue({
        commentId: mockComment.id,
        isBoostedByMe: true,
        boostedByMe: true,
        boostCount: 4,
      }),
      isCommentBoostedByUser: jest.fn().mockResolvedValue(false),
      pinComment: jest.fn().mockResolvedValue({ ...mockComment, isPinned: true }),
      unpinComment: jest.fn().mockResolvedValue(true),
      isCommentPinned: jest.fn().mockResolvedValue(false),
    };

    loadUserMock = jest.fn().mockResolvedValue({ id: userId, fullName: 'Test User' });

    mockContext = {
      req: {} as GqlContext['req'],
      user: { id: userId },
      loaders: {
        userById: {
          load: loadUserMock,
        } as unknown as GqlContext['loaders']['userById'],
        cityById: {} as GqlContext['loaders']['cityById'],
        mediaByPostId: {} as GqlContext['loaders']['mediaByPostId'],
        upvotedByMe: {} as GqlContext['loaders']['upvotedByMe'],
        savedByMe: {} as GqlContext['loaders']['savedByMe'],
        commentBoostedByMe: {
          load: jest.fn().mockResolvedValue(true),
        } as unknown as NonNullable<GqlContext['loaders']['commentBoostedByMe']>,
        pinnedCommentIdByPostId: {
          load: jest.fn().mockResolvedValue(null),
        } as unknown as NonNullable<GqlContext['loaders']['pinnedCommentIdByPostId']>,
      },
    };

    resolver = new CommentsResolver(mockCommentsService as unknown as CommentsService);
  });

  it('delegates createComment to service with authenticated userId', async () => {
    const result = await resolver.createComment(
      {
        clientRequestId: 'req-1',
        postId,
        text: 'Great post!',
      },
      mockContext,
    );

    expect(result).toEqual(mockComment);
    expect(mockCommentsService.createComment).toHaveBeenCalledWith(userId, {
      clientRequestId: 'req-1',
      postId,
      text: 'Great post!',
      mediaIds: undefined,
    });
  });

  it('delegates createReply to service with authenticated userId', async () => {
    const mockReply: Comment = {
      ...mockComment,
      id: '01916327-0000-7000-8000-000000000020',
      parentId: mockComment.id,
      text: 'I agree!',
      replyCount: 0,
    };
    mockCommentsService.createReply = jest.fn().mockResolvedValue(mockReply);

    const result = await resolver.createReply(
      {
        clientRequestId: 'req-reply-1',
        commentId: mockComment.id,
        text: 'I agree!',
      },
      mockContext,
    );

    expect(result).toEqual(mockReply);
    expect(mockCommentsService.createReply).toHaveBeenCalledWith(userId, {
      clientRequestId: 'req-reply-1',
      commentId: mockComment.id,
      text: 'I agree!',
    });
  });

  it('delegates deleteComment to service with authenticated userId', async () => {
    mockCommentsService.deleteComment = jest.fn().mockResolvedValue(true);

    const result = await resolver.deleteComment(mockComment.id, mockContext);

    expect(result).toBe(true);
    expect(mockCommentsService.deleteComment).toHaveBeenCalledWith(userId, mockComment.id);
  });

  it('delegates comments query to service', async () => {
    const validCursor = Buffer.from(
      JSON.stringify({ createdAt: new Date().toISOString(), id: '01916327-0000-7000-8000-000000000001' }),
    ).toString('base64url');

    const result = await resolver.comments(postId, 'NEWEST', 10, validCursor);

    expect(result.edges.length).toBe(1);
    expect(mockCommentsService.getComments).toHaveBeenCalledWith({
      postId,
      sort: 'NEWEST',
      first: 10,
      after: validCursor,
    });
  });

  it('delegates replies query to service', async () => {
    const validCursor = Buffer.from(
      JSON.stringify({ createdAt: new Date().toISOString(), id: '01916327-0000-7000-8000-000000000001' }),
    ).toString('base64url');

    mockCommentsService.getReplies = jest.fn().mockResolvedValue({
      edges: [{ node: mockComment, cursor: 'cursor-reply-1' }],
      pageInfo: { endCursor: 'cursor-reply-1', hasNextPage: false },
    });

    const result = await resolver.replies(mockComment.id, 10, validCursor);

    expect(result.edges.length).toBe(1);
    expect(mockCommentsService.getReplies).toHaveBeenCalledWith({
      commentId: mockComment.id,
      first: 10,
      after: validCursor,
    });
  });

  it('resolves author via DataLoader to prevent N+1 queries when active', async () => {
    const author = await resolver.author(mockComment, mockContext);
    expect(author).toEqual({ id: userId, fullName: 'Test User' });
    expect(loadUserMock).toHaveBeenCalledWith(userId);
  });

  it('resolves author as null when comment is DELETED (tombstone)', async () => {
    const deletedComment: Comment = {
      ...mockComment,
      status: 'DELETED',
    };
    const author = await resolver.author(deletedComment, mockContext);
    expect(author).toBeNull();
    expect(loadUserMock).not.toHaveBeenCalled();
  });

  it('resolves text normally when comment is ACTIVE', () => {
    const text = resolver.text(mockComment);
    expect(text).toBe('Great post!');
  });

  it('resolves text as [Deleted] when comment is DELETED (tombstone)', () => {
    const deletedComment: Comment = {
      ...mockComment,
      status: 'DELETED',
      text: 'Original private text',
    };
    const text = resolver.text(deletedComment);
    expect(text).toBe('[Deleted]');
  });

  it('delegates toggleCommentBoost to service with authenticated userId and commentId', async () => {
    const result = await resolver.toggleCommentBoost(mockComment.id, mockContext);

    expect(result).toEqual({
      commentId: mockComment.id,
      isBoostedByMe: true,
      boostedByMe: true,
      boostCount: 4,
    });
    expect(mockCommentsService.toggleCommentBoost).toHaveBeenCalledWith(userId, mockComment.id);
  });

  it('resolves isBoostedByMe via DataLoader when authenticated', async () => {
    const isBoosted = await resolver.isBoostedByMe(mockComment, mockContext);
    expect(isBoosted).toBe(true);
    const loadSpy = jest.spyOn(mockContext.loaders.commentBoostedByMe!, 'load');
    expect(loadSpy).toHaveBeenCalledWith(`${userId}:${mockComment.id}`);
  });

  it('resolves isBoostedByMe as false when unauthenticated', async () => {
    const unauthContext: GqlContext = { ...mockContext, user: undefined, req: {} as GqlContext['req'] };
    const isBoosted = await resolver.isBoostedByMe(mockComment, unauthContext);
    expect(isBoosted).toBe(false);
  });

  it('resolves boostCount directly from comment entity', () => {
    expect(resolver.boostCount(mockComment)).toBe(3);
    expect(resolver.boostCount({ ...mockComment, boostCount: 0 })).toBe(0);
  });

  it('delegates pinComment to service with authenticated userId and commentId', async () => {
    const result = await resolver.pinComment(mockComment.id, mockContext);
    expect(result).toEqual({ ...mockComment, isPinned: true });
    expect(mockCommentsService.pinComment).toHaveBeenCalledWith(userId, mockComment.id);
  });

  it('delegates unpinComment to service with authenticated userId and postId', async () => {
    const result = await resolver.unpinComment(postId, mockContext);
    expect(result).toBe(true);
    expect(mockCommentsService.unpinComment).toHaveBeenCalledWith(userId, postId);
  });

  it('resolves isPinned as false for replies', async () => {
    const reply: Comment = {
      ...mockComment,
      parentId: 'parent-1',
    };
    const isPinned = await resolver.isPinned(reply, mockContext);
    expect(isPinned).toBe(false);
  });

  it('resolves isPinned from pre-populated comment property when present', async () => {
    const commentWithPin = { ...mockComment, isPinned: true } as Comment;
    const isPinned = await resolver.isPinned(commentWithPin, mockContext);
    expect(isPinned).toBe(true);
  });

  it('resolves isPinned via DataLoader when present', async () => {
    (mockContext.loaders.pinnedCommentIdByPostId!.load as jest.Mock).mockResolvedValueOnce(mockComment.id);
    const loadPinnedSpy = jest.spyOn(mockContext.loaders.pinnedCommentIdByPostId!, 'load');
    const isPinned = await resolver.isPinned(mockComment, mockContext);
    expect(isPinned).toBe(true);
    expect(loadPinnedSpy).toHaveBeenCalledWith(mockComment.postId);
  });

  it('delegates requestCommentImageUploadUrl to service with authenticated userId', async () => {
    const mockTicket = {
      mediaId: '01916327-0000-7000-8000-000000000020',
      uploadUrl: 'https://r2.example.com/put',
      expiresAt: '2026-09-04T12:00:00.000Z',
      maxSizeBytes: 100000,
      maxWidth: 480,
      maxHeight: 480,
      mimeType: 'image/webp',
    };
    mockCommentsService.requestCommentImageUploadUrl = jest.fn().mockResolvedValue(mockTicket);

    const result = await resolver.requestCommentImageUploadUrl(
      {
        clientRequestId: 'req-upload-1',
        fileSizeBytes: 50000,
        width: 300,
        height: 200,
        contentType: 'image/webp',
      },
      mockContext,
    );

    expect(result).toEqual(mockTicket);
    expect(mockCommentsService.requestCommentImageUploadUrl).toHaveBeenCalledWith(userId, {
      contentType: 'image/webp',
      fileSizeBytes: 50000,
    });
  });

  describe('media field resolver', () => {
    const mockMediaList = [
      {
        id: '01916327-0000-7000-8000-000000000030',
        commentId: mockComment.id,
        storageKey: 'comments/1/2.webp',
        sha256: 'abc',
        width: 300,
        height: 200,
        fileSizeBytes: 40000,
        fileContentType: 'image/webp',
        displayOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    it('returns empty array when comment status is not ACTIVE (e.g. DELETED tombstone)', async () => {
      const deletedComment = { ...mockComment, status: 'DELETED' as const };
      const media = await resolver.media(deletedComment, mockContext);
      expect(media).toEqual([]);
    });

    it('returns media via DataLoader when present', async () => {
      const loaderMock = jest.fn().mockResolvedValue(mockMediaList);
      const ctxWithLoader: GqlContext = {
        ...mockContext,
        loaders: {
          ...mockContext.loaders,
          commentMediaByCommentId: { load: loaderMock } as unknown as NonNullable<
            GqlContext['loaders']['commentMediaByCommentId']
          >,
        },
      };

      const media = await resolver.media(mockComment, ctxWithLoader);
      expect(media).toEqual(mockMediaList);
      expect(loaderMock).toHaveBeenCalledWith(mockComment.id);
    });

    it('falls back to service when DataLoader is absent', async () => {
      mockCommentsService.getCommentMedia = jest.fn().mockResolvedValue(mockMediaList);
      const media = await resolver.media(mockComment, mockContext);
      expect(media).toEqual(mockMediaList);
      expect(mockCommentsService.getCommentMedia).toHaveBeenCalledWith(mockComment.id);
    });
  });
});

describe('CommentMediaResolver', () => {
  it('resolves publicUrl using commentsService.getCommentMediaPublicUrl', () => {
    const mockCommentsService = {
      getCommentMediaPublicUrl: jest.fn().mockReturnValue('https://cdn.pupzy.net/comments/1/2.webp'),
    };
    const mediaResolver = new CommentMediaResolver(mockCommentsService as unknown as CommentsService);

    const result = mediaResolver.publicUrl({
      id: '01916327-0000-7000-8000-000000000030',
      storageKey: 'comments/1/2.webp',
    } as unknown as CommentMedia);

    expect(result).toBe('https://cdn.pupzy.net/comments/1/2.webp');
    expect(mockCommentsService.getCommentMediaPublicUrl).toHaveBeenCalledWith('comments/1/2.webp');
  });
});

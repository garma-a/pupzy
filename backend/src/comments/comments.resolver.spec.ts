import { CommentsResolver } from './comments.resolver';
import { CommentsService } from './comments.service';
import { Comment } from '../database/schema';
import type { GqlContext } from '../common/types/gql-context.type';

describe('CommentsResolver', () => {
  let resolver: CommentsResolver;
  let mockCommentsService: {
    createComment: jest.Mock;
    getComments: jest.Mock;
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
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockCommentsService = {
      createComment: jest.fn().mockResolvedValue(mockComment),
      getComments: jest.fn().mockResolvedValue({
        edges: [{ node: mockComment, cursor: 'cursor-1' }],
        pageInfo: { endCursor: 'cursor-1', hasNextPage: false },
      }),
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

  it('resolves author via DataLoader to prevent N+1 queries', async () => {
    const author = await resolver.author(mockComment, mockContext);
    expect(author).toEqual({ id: userId, fullName: 'Test User' });
    expect(loadUserMock).toHaveBeenCalledWith(userId);
  });
});

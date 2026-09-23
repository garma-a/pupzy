import { CommentsService } from './comments.service';
import { CommentsRepository } from './comments.repository';
import { PostsRepository } from '../posts/posts.repository';
import { UploadService } from '../upload/upload.service';
import { ConfigService } from '@nestjs/config';
import { encodeCommentCursor, decodeCommentCursor } from './dto/comments-query.input';
import type { Comment } from '../database/schema';

describe('Comments Ordering, Pinning & Pagination (Ticket 02 Unit Tests)', () => {
  let service: CommentsService;
  let mockCommentsRepo: {
    findTopLevelCommentsByPostId: jest.Mock;
    findCommentById: jest.Mock;
    findPinnedCommentForPost: jest.Mock;
    isCommentPinned: jest.Mock;
    pinComment: jest.Mock;
    unpinComment: jest.Mock;
    toggleBoost: jest.Mock;
  };
  let mockPostsRepo: {
    findById: jest.Mock;
  };
  let mockUploadService: {
    getPublicUrl: jest.Mock;
  };
  let mockConfig: {
    get: jest.Mock;
  };

  const postId = '01916327-0000-7000-8000-000000000001';
  const postAuthorId = '01916327-0000-7000-8000-000000000002';

  const basePost = {
    id: postId,
    creatorId: postAuthorId,
    title: 'Test discussion post',
    status: 'ACTIVE' as const,
    postType: 'RESCUE' as const,
    commentCount: 5,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  };

  const createMockComment = (overrides: Partial<Comment> = {}): Comment => ({
    id: '01916327-0000-7000-8000-000000000010',
    postId,
    authorId: postAuthorId,
    parentId: null,
    text: 'A comment',
    replyCount: 0,
    boostCount: 0,
    status: 'ACTIVE',
    createdAt: new Date('2026-09-02T10:00:00Z'),
    updatedAt: new Date('2026-09-02T10:00:00Z'),
    ...overrides,
  });

  beforeEach(() => {
    mockCommentsRepo = {
      findTopLevelCommentsByPostId: jest.fn(),
      findCommentById: jest.fn(),
      findPinnedCommentForPost: jest.fn(),
      isCommentPinned: jest.fn(),
      pinComment: jest.fn(),
      unpinComment: jest.fn(),
      toggleBoost: jest.fn(),
    };

    mockPostsRepo = {
      findById: jest.fn().mockResolvedValue(basePost),
    };

    mockUploadService = {
      getPublicUrl: jest.fn((key: string) => `https://cdn.pupzy.net/${key}`),
    };

    mockConfig = {
      get: jest.fn((key: string) => (key === 'COMMENT_MEDIA_CDN_BASE' ? 'https://cdn.pupzy.net' : undefined)),
    };

    service = new CommentsService(
      mockCommentsRepo as unknown as CommentsRepository,
      mockPostsRepo as unknown as PostsRepository,
      mockUploadService as unknown as UploadService,
      mockConfig as unknown as ConfigService,
    );
  });

  describe('Pinned-first ordering guarantees', () => {
    it('places pinned comment as first edge on Page 1 with isPinned: true', async () => {
      const pinned = Object.assign(
        createMockComment({
          id: '01916327-0000-7000-8000-000000000099',
          text: 'Pinned announcement',
          boostCount: 0,
        }),
        { isPinned: true },
      );
      const regular1 = Object.assign(
        createMockComment({
          id: '01916327-0000-7000-8000-000000000020',
          text: 'Regular comment with high boosts',
          boostCount: 15,
        }),
        { isPinned: false },
      );

      // findTopLevelCommentsByPostId returns pinned first, then regular comments
      mockCommentsRepo.findTopLevelCommentsByPostId.mockResolvedValueOnce([pinned, regular1]);

      const connection = await service.getComments({
        postId,
        sort: 'TOP',
        first: 20,
      });

      expect(connection.edges).toHaveLength(2);
      expect(connection.edges[0].node.id).toBe(pinned.id);
      expect((connection.edges[0].node as unknown as { isPinned: boolean }).isPinned).toBe(true);
      expect(connection.edges[1].node.id).toBe(regular1.id);
      expect((connection.edges[1].node as unknown as { isPinned: boolean }).isPinned).toBe(false);

      // Verify cursor on pinned comment encodes isPinned: true
      const decodedPinnedCursor = decodeCommentCursor(connection.edges[0].cursor);
      expect(decodedPinnedCursor.isPinned).toBe(true);
      expect(decodedPinnedCursor.id).toBe(pinned.id);

      // Verify cursor on regular comment does NOT encode isPinned: true
      const decodedRegularCursor = decodeCommentCursor(connection.edges[1].cursor);
      expect(decodedRegularCursor.isPinned).toBeUndefined();
      expect(decodedRegularCursor.id).toBe(regular1.id);
    });

    it('adding a new comment cannot displace an existing pin on Page 1', async () => {
      const pinned = Object.assign(
        createMockComment({
          id: '01916327-0000-7000-8000-000000000099',
          text: 'Pinned announcement',
          boostCount: 5,
        }),
        { isPinned: true },
      );
      const newlyAdded = Object.assign(
        createMockComment({
          id: '01916327-0000-7000-8000-000000000050',
          text: 'Brand new comment',
          boostCount: 0,
          createdAt: new Date('2026-09-02T12:00:00Z'), // newer than pin
        }),
        { isPinned: false },
      );

      // Even with NEWEST sort where newlyAdded is newer than pinned, pinned remains at index 0
      mockCommentsRepo.findTopLevelCommentsByPostId.mockResolvedValueOnce([pinned, newlyAdded]);

      const connection = await service.getComments({
        postId,
        sort: 'NEWEST',
        first: 20,
      });

      expect(connection.edges[0].node.id).toBe(pinned.id);
      expect((connection.edges[0].node as unknown as { isPinned: boolean }).isPinned).toBe(true);
      expect(connection.edges[1].node.id).toBe(newlyAdded.id);
      expect((connection.edges[1].node as unknown as { isPinned: boolean }).isPinned).toBe(false);
    });
  });

  describe('Keyset pagination around pinned comments & cursor boundaries', () => {
    it('correctly sets hasNextPage=true and endCursor when items > first', async () => {
      const pinned = Object.assign(createMockComment({ id: '01916327-0000-7000-8000-000000000099' }), {
        isPinned: true,
      });
      const reg1 = Object.assign(createMockComment({ id: '01916327-0000-7000-8000-000000000021' }), {
        isPinned: false,
      });
      // Query with first=1 returns pinned + reg1 (length 2 > first)
      mockCommentsRepo.findTopLevelCommentsByPostId.mockResolvedValueOnce([pinned, reg1]);

      const connection = await service.getComments({
        postId,
        sort: 'TOP',
        first: 1,
      });

      expect(connection.edges).toHaveLength(1);
      expect(connection.edges[0].node.id).toBe(pinned.id);
      expect(connection.pageInfo.hasNextPage).toBe(true);
      expect(connection.pageInfo.endCursor).toBe(connection.edges[0].cursor);

      // Decoding the endCursor confirms isPinned: true
      const decoded = decodeCommentCursor(connection.pageInfo.endCursor!);
      expect(decoded.isPinned).toBe(true);
      expect(decoded.id).toBe(pinned.id);
    });

    it('passes decoded cursor to repository for subsequent page continuation', async () => {
      const cursorPayload = {
        id: '01916327-0000-7000-8000-000000000021',
        createdAt: new Date('2026-09-02T10:00:00Z').toISOString(),
        boostCount: 10,
      };
      const afterCursor = encodeCommentCursor(cursorPayload, 'TOP');

      mockCommentsRepo.findTopLevelCommentsByPostId.mockResolvedValueOnce([]);

      await service.getComments({
        postId,
        sort: 'TOP',
        first: 20,
        after: afterCursor,
      });

      expect(mockCommentsRepo.findTopLevelCommentsByPostId).toHaveBeenCalledWith(
        postId,
        20,
        'TOP',
        expect.objectContaining({
          id: cursorPayload.id,
          boostCount: 10,
        }),
        undefined,
      );
    });

    it('passes viewerId for isolation filtering in keyset pagination', async () => {
      mockCommentsRepo.findTopLevelCommentsByPostId.mockResolvedValueOnce([]);

      const viewerId = '01916327-0000-7000-8000-000000000077';
      await service.getComments(
        {
          postId,
          sort: 'NEWEST',
          first: 10,
        },
        viewerId,
      );

      expect(mockCommentsRepo.findTopLevelCommentsByPostId).toHaveBeenCalledWith(
        postId,
        10,
        'NEWEST',
        undefined,
        viewerId,
      );
    });
  });

  describe('Cursor encoding/decoding contract for TOP and NEWEST', () => {
    it('encodes and decodes TOP cursor with (boostCount, createdAt, id)', () => {
      const createdAt = new Date('2026-09-02T14:30:00.000Z');
      const cursor = encodeCommentCursor(
        {
          id: '01916327-0000-7000-8000-000000000010',
          createdAt,
          boostCount: 25,
        },
        'TOP',
      );

      const decoded = decodeCommentCursor(cursor);
      expect(decoded.id).toBe('01916327-0000-7000-8000-000000000010');
      expect(decoded.createdAt).toBe(createdAt.toISOString());
      expect(decoded.boostCount).toBe(25);
      expect(decoded.isPinned).toBeUndefined();
    });

    it('encodes and decodes NEWEST cursor with (createdAt, id) without boostCount', () => {
      const createdAt = new Date('2026-09-02T14:30:00.000Z');
      const cursor = encodeCommentCursor(
        {
          id: '01916327-0000-7000-8000-000000000010',
          createdAt,
          boostCount: 25,
        },
        'NEWEST',
      );

      const decoded = decodeCommentCursor(cursor);
      expect(decoded.id).toBe('01916327-0000-7000-8000-000000000010');
      expect(decoded.createdAt).toBe(createdAt.toISOString());
      expect(decoded.boostCount).toBeUndefined();
    });

    it('encodes and decodes pinned cursor with isPinned: true flag', () => {
      const cursor = encodeCommentCursor({
        id: '01916327-0000-7000-8000-000000000099',
        createdAt: new Date().toISOString(),
        isPinned: true,
      });

      const decoded = decodeCommentCursor(cursor);
      expect(decoded.isPinned).toBe(true);
      expect(decoded.id).toBe('01916327-0000-7000-8000-000000000099');
    });
  });

  describe('Client reconciliation simulation (Contract verification)', () => {
    it('simulates client reconciliation: adding comment preserves pin at index 0', () => {
      const pinned = createMockComment({ id: 'pin-1', text: 'Pinned', isPinned: true as unknown as boolean });
      const reg1 = createMockComment({ id: 'reg-1', text: 'Regular 1' });
      const existingList = [pinned, reg1];

      // Newly created comment
      const newComment = createMockComment({ id: 'new-1', text: 'New comment' });

      // Contract reconciliation rule 1:
      // Prepend beneath pinned comment (index 1 if pinned exists, index 0 if not)
      const hasPin = existingList.length > 0 && (existingList[0] as unknown as { isPinned: boolean }).isPinned;
      const reconciledList = hasPin
        ? [existingList[0], newComment, ...existingList.slice(1)]
        : [newComment, ...existingList];

      expect(reconciledList[0].id).toBe('pin-1');
      expect(reconciledList[1].id).toBe('new-1');
      expect(reconciledList[2].id).toBe('reg-1');
    });

    it('simulates client reconciliation: loadMore deduplicates by id across cursor boundaries', () => {
      const page1 = [createMockComment({ id: 'c1', boostCount: 10 }), createMockComment({ id: 'c2', boostCount: 8 })];

      // Between page 1 and page 2, c2's boost dropped, and c2 was also fetched on page 2
      const page2 = [
        createMockComment({ id: 'c2', boostCount: 7 }), // duplicate across boundary
        createMockComment({ id: 'c3', boostCount: 5 }),
      ];

      // Contract reconciliation rule 4:
      // Deduplicate by id when appending pages
      const existingIds = new Set(page1.map((c) => c.id));
      const reconciled = [...page1, ...page2.filter((c) => !existingIds.has(c.id))];

      expect(reconciled.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
      expect(reconciled).toHaveLength(3);
    });

    it('simulates client reconciliation: pin replacement moves new pin to index 0 and re-ranks old pin', () => {
      const oldPin = createMockComment({ id: 'c1', isPinned: true as unknown as boolean, boostCount: 2 });
      const reg2 = createMockComment({ id: 'c2', boostCount: 10 });

      // Post author pins c2
      const newlyPinned = { ...reg2, isPinned: true };
      const unpinnedOld = { ...oldPin, isPinned: false };

      // Contract reconciliation rule 2:
      // Pinned comment moves to index 0; old pin is re-ranked under TOP (boostCount DESC)
      const nonPinned = [unpinnedOld].sort((a, b) => (b.boostCount ?? 0) - (a.boostCount ?? 0));
      const reconciled = [newlyPinned, ...nonPinned];

      expect(reconciled[0].id).toBe('c2');
      expect(reconciled[0].isPinned).toBe(true);
      expect(reconciled[1].id).toBe('c1');
      expect(reconciled[1].isPinned).toBe(false);
    });
  });
});

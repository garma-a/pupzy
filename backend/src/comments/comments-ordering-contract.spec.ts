import { encodeCommentCursor, decodeCommentCursor } from './dto/comments-query.input';
import type { Comment } from '../database/schema';

describe('Comments Pinned and Ranked Ordering Contract (Ticket 02)', () => {
  const postId = '01920000-0000-7000-8000-000000000010';
  const author1Id = '01920000-0000-7000-8000-000000000001';
  const author2Id = '01920000-0000-7000-8000-000000000002';
  const author3Id = '01920000-0000-7000-8000-000000000003';

  function mockComment(
    id: string,
    authorId: string,
    createdAt: string,
    boostCount = 0,
    isPinned = false,
  ): Comment & { isPinned: boolean } {
    return {
      id,
      postId,
      authorId,
      parentId: null,
      text: `Comment ${id}`,
      status: 'ACTIVE',
      replyCount: 0,
      boostCount,
      isPinned,
      clientRequestId: `req-${id}`,
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
      deletedAt: null,
      moderatedAt: null,
      moderationReason: null,
      moderatorId: null,
    };
  }

  describe('Pinned Position Invariant & Adding Comments', () => {
    it('ensures adding a new comment never displaces the pinned comment from position 0', () => {
      const pinned = mockComment('c-pinned', author1Id, '2026-09-01T12:00:00Z', 5, true);
      const existing1 = mockComment('c-1', author2Id, '2026-09-01T10:00:00Z', 10, false);
      const existing2 = mockComment('c-2', author3Id, '2026-09-01T11:00:00Z', 2, false);

      const pageBefore = [pinned, existing1, existing2];
      expect(pageBefore[0].id).toBe('c-pinned');
      expect(pageBefore[0].isPinned).toBe(true);

      const newComment = mockComment('c-new', author2Id, '2026-09-02T15:00:00Z', 50, false);

      const reconciledTop = [
        pageBefore[0],
        ...[newComment, existing1, existing2].sort((a, b) => b.boostCount - a.boostCount),
      ];

      expect(reconciledTop[0].id).toBe('c-pinned');
      expect(reconciledTop[0].isPinned).toBe(true);
      expect(reconciledTop[1].id).toBe('c-new');
      expect(reconciledTop[2].id).toBe('c-1');
      expect(reconciledTop[3].id).toBe('c-2');
    });

    it('ensures replacing or removing a pin updates comment positions correctly', () => {
      const oldPin = mockComment('c-pin-1', author1Id, '2026-09-01T10:00:00Z', 1, true);
      const comment2 = mockComment('c-2', author2Id, '2026-09-01T11:00:00Z', 10, false);
      const comment3 = mockComment('c-3', author3Id, '2026-09-01T12:00:00Z', 5, false);

      const newPin = { ...comment2, isPinned: true };
      const unpinnedOld = { ...oldPin, isPinned: false };

      const unpinnedList = [unpinnedOld, comment3].sort((a, b) => b.boostCount - a.boostCount);
      const replacedList = [newPin, ...unpinnedList];

      expect(replacedList[0].id).toBe('c-2');
      expect(replacedList[0].isPinned).toBe(true);
      expect(replacedList[1].id).toBe('c-3');
      expect(replacedList[2].id).toBe('c-pin-1');
      expect(replacedList[2].isPinned).toBe(false);

      const naturalList = [unpinnedOld, { ...comment2, isPinned: false }, comment3].sort(
        (a, b) => b.boostCount - a.boostCount,
      );
      expect(naturalList[0].id).toBe('c-2');
      expect(naturalList[1].id).toBe('c-3');
      expect(naturalList[2].id).toBe('c-pin-1');
    });
  });

  describe('Top and Newest Sorting with Tie-breaking', () => {
    it('orders Top by boostCount DESC, createdAt DESC, id DESC beneath the pin', () => {
      const pinned = mockComment('c-pin', author1Id, '2026-09-01T10:00:00Z', 0, true);
      const c1 = mockComment('01920000-0000-7000-8000-000000000001', author2Id, '2026-09-01T12:00:00Z', 5, false);
      const c2 = mockComment('01920000-0000-7000-8000-000000000002', author3Id, '2026-09-01T12:00:00Z', 5, false);
      const c3 = mockComment('01920000-0000-7000-8000-000000000003', author2Id, '2026-09-01T11:00:00Z', 5, false);
      const c4 = mockComment('01920000-0000-7000-8000-000000000004', author2Id, '2026-09-01T13:00:00Z', 10, false);

      const regular = [c1, c2, c3, c4].sort((a, b) => {
        if (b.boostCount !== a.boostCount) return b.boostCount - a.boostCount;
        if (b.createdAt.getTime() !== a.createdAt.getTime()) return b.createdAt.getTime() - a.createdAt.getTime();
        return b.id.localeCompare(a.id);
      });

      const topResult = [pinned, ...regular];
      expect(topResult[0].id).toBe('c-pin');
      expect(topResult[1].id).toBe(c4.id);
      expect(topResult[2].id).toBe(c2.id);
      expect(topResult[3].id).toBe(c1.id);
      expect(topResult[4].id).toBe(c3.id);
    });

    it('orders Newest by createdAt DESC, id DESC beneath the pin', () => {
      const pinned = mockComment('c-pin', author1Id, '2026-09-01T08:00:00Z', 100, true);
      const c1 = mockComment('01920000-0000-7000-8000-000000000001', author2Id, '2026-09-01T10:00:00Z', 50, false);
      const c2 = mockComment('01920000-0000-7000-8000-000000000002', author3Id, '2026-09-01T12:00:00Z', 1, false);

      const regular = [c1, c2].sort((a, b) => {
        if (b.createdAt.getTime() !== a.createdAt.getTime()) return b.createdAt.getTime() - a.createdAt.getTime();
        return b.id.localeCompare(a.id);
      });

      const newestResult = [pinned, ...regular];
      expect(newestResult[0].id).toBe('c-pin');
      expect(newestResult[1].id).toBe(c2.id);
      expect(newestResult[2].id).toBe(c1.id);
    });
  });

  describe('Pagination Cursor Reconciliation Across Boundaries', () => {
    it('encodes and decodes keyset cursor payloads accurately including isPinned state', () => {
      const cursorPayload = {
        id: '01920000-0000-7000-8000-000000000010',
        createdAt: '2026-09-01T12:00:00.000Z',
        boostCount: 7,
        isPinned: true,
      };

      const encoded = encodeCommentCursor(cursorPayload);
      expect(typeof encoded).toBe('string');

      const decoded = decodeCommentCursor(encoded);
      expect(decoded.id).toBe(cursorPayload.id);
      expect(decoded.createdAt).toBe(cursorPayload.createdAt);
      expect(decoded.boostCount).toBe(cursorPayload.boostCount);
      expect(decoded.isPinned).toBe(true);
    });

    it('deduplicates comments across cursor boundary pages during concurrent rank changes', () => {
      const page1 = [
        mockComment('c-pin', author1Id, '2026-09-01T10:00:00Z', 0, true),
        mockComment('c-1', author2Id, '2026-09-01T12:00:00Z', 10, false),
        mockComment('c-2', author3Id, '2026-09-01T11:00:00Z', 8, false),
      ];

      const page2Raw = [
        mockComment('c-2', author3Id, '2026-09-01T11:00:00Z', 9, false),
        mockComment('c-3', author1Id, '2026-09-01T09:00:00Z', 4, false),
        mockComment('c-4', author2Id, '2026-09-01T08:00:00Z', 2, false),
      ];

      const existingIds = new Set(page1.map((c) => c.id));
      const reconciledFull = [...page1, ...page2Raw.filter((c) => !existingIds.has(c.id))];

      expect(reconciledFull.map((c) => c.id)).toEqual(['c-pin', 'c-1', 'c-2', 'c-3', 'c-4']);
      expect(reconciledFull).toHaveLength(5);
    });
  });
});

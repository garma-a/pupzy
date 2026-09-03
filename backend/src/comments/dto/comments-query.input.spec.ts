import { validateCommentsQueryInput, encodeCommentCursor, decodeCommentCursor } from './comments-query.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateCommentsQueryInput & cursor utilities', () => {
  const validPostId = '01916327-0000-7000-8000-000000000001';

  describe('cursor encoding and decoding', () => {
    it('encodes and decodes comment cursor round-trip', () => {
      const now = new Date();
      const cursor = encodeCommentCursor({
        createdAt: now,
        id: validPostId,
      });

      expect(typeof cursor).toBe('string');
      const decoded = decodeCommentCursor(cursor);
      expect(decoded.id).toBe(validPostId);
      expect(new Date(decoded.createdAt).getTime()).toBe(now.getTime());
    });

    it('rejects invalid or corrupted cursor', () => {
      expect(() => decodeCommentCursor('not-valid-base64-json!')).toThrow(ValidationError);
      expect(() => decodeCommentCursor('bm90LWpzb24=')).toThrow(ValidationError); // 'not-json' in base64
      expect(() => decodeCommentCursor(Buffer.from('{}').toString('base64url'))).toThrow(ValidationError);
    });
  });

  describe('validateCommentsQueryInput', () => {
    it('applies defaults when sort and first are omitted', () => {
      const result = validateCommentsQueryInput({
        postId: validPostId,
      });

      expect(result).toEqual({
        postId: validPostId,
        sort: 'TOP',
        first: 20,
        after: undefined,
      });
    });

    it('accepts valid sort values TOP and NEWEST', () => {
      expect(validateCommentsQueryInput({ postId: validPostId, sort: 'TOP' }).sort).toBe('TOP');
      expect(validateCommentsQueryInput({ postId: validPostId, sort: 'NEWEST' }).sort).toBe('NEWEST');
    });

    it('rejects invalid sort values', () => {
      expect(() => validateCommentsQueryInput({ postId: validPostId, sort: 'OLDEST' })).toThrow(ValidationError);
    });

    it('accepts first within valid boundary [1..50]', () => {
      expect(validateCommentsQueryInput({ postId: validPostId, first: 1 }).first).toBe(1);
      expect(validateCommentsQueryInput({ postId: validPostId, first: 50 }).first).toBe(50);
    });

    it('rejects first > 50 or < 1', () => {
      expect(() => validateCommentsQueryInput({ postId: validPostId, first: 51 })).toThrow(ValidationError);

      expect(() => validateCommentsQueryInput({ postId: validPostId, first: 0 })).toThrow(ValidationError);

      expect(() => validateCommentsQueryInput({ postId: validPostId, first: -10 })).toThrow(ValidationError);
    });

    it('rejects non-integer first', () => {
      expect(() => validateCommentsQueryInput({ postId: validPostId, first: 25.5 })).toThrow(ValidationError);
    });

    it('validates and accepts valid after cursor', () => {
      const cursor = encodeCommentCursor({
        createdAt: new Date(),
        id: validPostId,
      });

      const result = validateCommentsQueryInput({
        postId: validPostId,
        after: cursor,
      });

      expect(result.after).toBe(cursor);
    });

    it('rejects malformed after cursor', () => {
      expect(() =>
        validateCommentsQueryInput({
          postId: validPostId,
          after: 'invalid-cursor-value',
        }),
      ).toThrow(ValidationError);
    });
  });
});

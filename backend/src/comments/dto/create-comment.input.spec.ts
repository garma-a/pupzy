import { validateCreateCommentInput, validateCommentText } from './create-comment.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateCreateCommentInput & validateCommentText', () => {
  const validPostId = '01916327-0000-7000-8000-000000000001';
  const validClientRequestId = 'req-12345';

  describe('validateCommentText', () => {
    it('trims leading and trailing whitespace', () => {
      expect(validateCommentText('   Hello Pupzy!   ')).toBe('Hello Pupzy!');
    });

    it('accepts text at 1 Unicode character boundary', () => {
      expect(validateCommentText('A')).toBe('A');
      expect(validateCommentText('🐕')).toBe('🐕');
    });

    it('accepts text at 1,000 Unicode character boundary', () => {
      const text1000 = '🐾'.repeat(1000);
      expect(validateCommentText(text1000)).toBe(text1000);
    });

    it('rejects text exceeding 1,000 Unicode characters', () => {
      const text1001 = 'a'.repeat(1001);
      expect(() => validateCommentText(text1001)).toThrow(ValidationError);
      expect(() => validateCommentText(text1001)).toThrow(/between 1 and 1,000 characters/);
    });

    it('rejects empty or whitespace-only text', () => {
      expect(() => validateCommentText('')).toThrow(ValidationError);
      expect(() => validateCommentText('   \n\t   ')).toThrow(ValidationError);
      expect(() => validateCommentText(null)).toThrow(ValidationError);
      expect(() => validateCommentText(undefined)).toThrow(ValidationError);
    });

    it('allows standard whitespace like newlines and tabs', () => {
      const multiline = 'Line 1\nLine 2\tIndented';
      expect(validateCommentText(multiline)).toBe(multiline);
    });

    it('rejects unsafe control characters (e.g. null byte, bell, etc.)', () => {
      expect(() => validateCommentText('Hello\x00World')).toThrow(ValidationError);
      expect(() => validateCommentText('Hello\x07World')).toThrow(ValidationError);
      expect(() => validateCommentText('Hello\x1BWorld')).toThrow(ValidationError);
    });

    it('rejects raw HTML tags', () => {
      expect(() => validateCommentText('Hello <script>alert(1)</script>')).toThrow(ValidationError);
      expect(() => validateCommentText('Hello <div>world</div>')).toThrow(ValidationError);
      expect(() => validateCommentText('Check this <a href="http://evil.com">link</a>')).toThrow(ValidationError);
      expect(() => validateCommentText('Break <br/> here')).toThrow(ValidationError);
      expect(() => validateCommentText('<img src="x" onerror="alert(1)"/>')).toThrow(ValidationError);
    });

    it('allows URLs as plain text', () => {
      const textWithUrl = 'Check out https://pupzy.net/rescue?id=123 for details';
      expect(validateCommentText(textWithUrl)).toBe(textWithUrl);
    });
  });

  describe('validateCreateCommentInput', () => {
    it('validates a correct payload', () => {
      const result = validateCreateCommentInput({
        clientRequestId: '  req-abc-123  ',
        postId: validPostId,
        text: '   Great dog!   ',
      });

      expect(result).toEqual({
        clientRequestId: 'req-abc-123',
        postId: validPostId,
        text: 'Great dog!',
        mediaIds: undefined,
      });
    });

    it('rejects missing or empty clientRequestId', () => {
      expect(() =>
        validateCreateCommentInput({
          clientRequestId: '',
          postId: validPostId,
          text: 'Hello',
        }),
      ).toThrow(ValidationError);

      expect(() =>
        validateCreateCommentInput({
          clientRequestId: '   ',
          postId: validPostId,
          text: 'Hello',
        }),
      ).toThrow(ValidationError);
    });

    it('rejects clientRequestId exceeding 255 characters', () => {
      expect(() =>
        validateCreateCommentInput({
          clientRequestId: 'x'.repeat(256),
          postId: validPostId,
          text: 'Hello',
        }),
      ).toThrow(ValidationError);
    });

    it('rejects invalid or missing postId', () => {
      expect(() =>
        validateCreateCommentInput({
          clientRequestId: validClientRequestId,
          postId: 'not-a-uuid',
          text: 'Hello',
        }),
      ).toThrow(ValidationError);

      expect(() =>
        validateCreateCommentInput({
          clientRequestId: validClientRequestId,
          postId: 123,
          text: 'Hello',
        }),
      ).toThrow(ValidationError);
    });

    it('accepts zero, one, or two distinct valid mediaIds', () => {
      const validMediaId1 = '01916327-0000-7000-8000-000000000002';
      const validMediaId2 = '01916327-0000-7000-8000-000000000003';
      const result1 = validateCreateCommentInput({
        clientRequestId: validClientRequestId,
        postId: validPostId,
        text: 'Hello',
        mediaIds: [validMediaId1],
      });
      expect(result1.mediaIds).toEqual([validMediaId1]);

      const result2 = validateCreateCommentInput({
        clientRequestId: validClientRequestId,
        postId: validPostId,
        text: 'Hello',
        mediaIds: [validMediaId1, validMediaId2],
      });
      expect(result2.mediaIds).toEqual([validMediaId1, validMediaId2]);
    });

    it('rejects duplicate media IDs', () => {
      const duplicateId = '01916327-0000-7000-8000-000000000002';
      expect(() =>
        validateCreateCommentInput({
          clientRequestId: validClientRequestId,
          postId: validPostId,
          text: 'Hello',
          mediaIds: [duplicateId, duplicateId],
        }),
      ).toThrow(ValidationError);
      expect(() =>
        validateCreateCommentInput({
          clientRequestId: validClientRequestId,
          postId: validPostId,
          text: 'Hello',
          mediaIds: [duplicateId, duplicateId],
        }),
      ).toThrow(/Duplicate media IDs/);
    });

    it('rejects mediaIds if more than 2 media IDs provided', () => {
      expect(() =>
        validateCreateCommentInput({
          clientRequestId: validClientRequestId,
          postId: validPostId,
          text: 'Hello',
          mediaIds: [
            '01916327-0000-7000-8000-000000000002',
            '01916327-0000-7000-8000-000000000003',
            '01916327-0000-7000-8000-000000000004',
          ],
        }),
      ).toThrow(ValidationError);
      expect(() =>
        validateCreateCommentInput({
          clientRequestId: validClientRequestId,
          postId: validPostId,
          text: 'Hello',
          mediaIds: [
            '01916327-0000-7000-8000-000000000002',
            '01916327-0000-7000-8000-000000000003',
            '01916327-0000-7000-8000-000000000004',
          ],
        }),
      ).toThrow(/Maximum 2 images allowed/);
    });

    it('rejects invalid UUID in mediaIds', () => {
      expect(() =>
        validateCreateCommentInput({
          clientRequestId: validClientRequestId,
          postId: validPostId,
          text: 'Hello',
          mediaIds: ['not-a-uuid'],
        }),
      ).toThrow(ValidationError);
    });
  });
});

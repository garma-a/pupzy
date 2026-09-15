import { validateCreateReplyInput, validateReplyText } from './create-reply.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateCreateReplyInput & validateReplyText', () => {
  const validCommentId = '01916327-0000-7000-8000-000000000001';
  const validClientRequestId = 'req-12345';

  describe('validateReplyText', () => {
    it('trims leading and trailing whitespace', () => {
      expect(validateReplyText('   Hello Reply!   ')).toBe('Hello Reply!');
    });

    it('accepts text at 1 Unicode character boundary', () => {
      expect(validateReplyText('A')).toBe('A');
      expect(validateReplyText('🐕')).toBe('🐕');
    });

    it('accepts text at 500 Unicode character boundary', () => {
      const text500 = '🐾'.repeat(500);
      expect(validateReplyText(text500)).toBe(text500);
    });

    it('rejects text exceeding 500 Unicode characters', () => {
      const text501 = 'a'.repeat(501);
      expect(() => validateReplyText(text501)).toThrow(ValidationError);
      expect(() => validateReplyText(text501)).toThrow(/between 1 and 500 characters/);
    });

    it('rejects empty or whitespace-only text', () => {
      expect(() => validateReplyText('')).toThrow(ValidationError);
      expect(() => validateReplyText('   \n\t   ')).toThrow(ValidationError);
      expect(() => validateReplyText(null)).toThrow(ValidationError);
      expect(() => validateReplyText(undefined)).toThrow(ValidationError);
    });

    it('allows standard whitespace like newlines and tabs', () => {
      const multiline = 'Line 1\nLine 2\tIndented';
      expect(validateReplyText(multiline)).toBe(multiline);
    });

    it('rejects unsafe control characters (e.g. null byte, bell, escape)', () => {
      expect(() => validateReplyText('Hello\x00World')).toThrow(ValidationError);
      expect(() => validateReplyText('Hello\x07World')).toThrow(ValidationError);
      expect(() => validateReplyText('Hello\x1BWorld')).toThrow(ValidationError);
    });

    it('rejects raw HTML tags', () => {
      expect(() => validateReplyText('Hello <script>alert(1)</script>')).toThrow(ValidationError);
      expect(() => validateReplyText('Hello <div>world</div>')).toThrow(ValidationError);
      expect(() => validateReplyText('Check this <a href="http://evil.com">link</a>')).toThrow(ValidationError);
      expect(() => validateReplyText('Break <br/> here')).toThrow(ValidationError);
      expect(() => validateReplyText('<img src="x" onerror="alert(1)"/>')).toThrow(ValidationError);
    });

    it('allows URLs as plain text', () => {
      const textWithUrl = 'Check out https://pupzy.net/rescue?id=123 for details';
      expect(validateReplyText(textWithUrl)).toBe(textWithUrl);
    });
  });

  describe('validateCreateReplyInput', () => {
    it('validates a correct payload', () => {
      const result = validateCreateReplyInput({
        clientRequestId: '  req-reply-123  ',
        commentId: validCommentId,
        text: '   I agree with you!   ',
      });

      expect(result).toEqual({
        clientRequestId: 'req-reply-123',
        commentId: validCommentId,
        text: 'I agree with you!',
      });
    });

    it('rejects missing or empty clientRequestId', () => {
      expect(() =>
        validateCreateReplyInput({
          clientRequestId: '',
          commentId: validCommentId,
          text: 'Hello',
        }),
      ).toThrow(ValidationError);

      expect(() =>
        validateCreateReplyInput({
          clientRequestId: '   ',
          commentId: validCommentId,
          text: 'Hello',
        }),
      ).toThrow(ValidationError);
    });

    it('rejects clientRequestId exceeding 255 characters', () => {
      expect(() =>
        validateCreateReplyInput({
          clientRequestId: 'x'.repeat(256),
          commentId: validCommentId,
          text: 'Hello',
        }),
      ).toThrow(ValidationError);
    });

    it('rejects invalid or missing commentId UUID', () => {
      expect(() =>
        validateCreateReplyInput({
          clientRequestId: validClientRequestId,
          commentId: 'not-a-uuid',
          text: 'Hello',
        }),
      ).toThrow(ValidationError);

      expect(() =>
        validateCreateReplyInput({
          clientRequestId: validClientRequestId,
          commentId: 12345,
          text: 'Hello',
        }),
      ).toThrow(ValidationError);
    });

    it('rejects mediaIds if provided (replies cannot contain media)', () => {
      expect(() =>
        validateCreateReplyInput({
          clientRequestId: validClientRequestId,
          commentId: validCommentId,
          text: 'Hello',
          mediaIds: ['01916327-0000-7000-8000-000000000099'],
        }),
      ).toThrow(ValidationError);
      expect(() =>
        validateCreateReplyInput({
          clientRequestId: validClientRequestId,
          commentId: validCommentId,
          text: 'Hello',
          mediaIds: [],
        }),
      ).toThrow(ValidationError);
    });

    it('rejects non-object or null input', () => {
      expect(() => validateCreateReplyInput(null)).toThrow(ValidationError);
      expect(() => validateCreateReplyInput('string')).toThrow(ValidationError);
      expect(() => validateCreateReplyInput(123)).toThrow(ValidationError);
    });
  });
});

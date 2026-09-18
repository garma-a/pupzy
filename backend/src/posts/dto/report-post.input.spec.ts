import { validateReportPostInput } from './report-post.input';
import { reportReasonValues } from '../../comments/dto/report-comment.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateReportPostInput', () => {
  const validPostId = '01916327-0000-7000-8000-000000000001';

  it('validates a correct payload with reason and trimmed details', () => {
    const result = validateReportPostInput({
      postId: validPostId,
      reason: 'SPAM',
      details: '  This is spam and self-promotion  ',
    });

    expect(result).toEqual({
      postId: validPostId,
      reason: 'SPAM',
      details: 'This is spam and self-promotion',
    });
  });

  it('validates a correct payload without details', () => {
    const result = validateReportPostInput({
      postId: validPostId,
      reason: 'INAPPROPRIATE_CONTENT',
    });

    expect(result).toEqual({
      postId: validPostId,
      reason: 'INAPPROPRIATE_CONTENT',
      details: undefined,
    });
  });

  it('accepts all defined report reasons', () => {
    for (const reason of reportReasonValues) {
      const result = validateReportPostInput({
        postId: validPostId,
        reason,
        ...(reason === 'OTHER' ? { details: 'uncategorized complaint' } : {}),
      });
      expect(result.reason).toBe(reason);
    }
  });

  it('rejects invalid reason', () => {
    expect(() =>
      validateReportPostInput({
        postId: validPostId,
        reason: 'INVALID_REASON',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects missing or invalid postId UUID', () => {
    expect(() =>
      validateReportPostInput({
        postId: 'not-a-uuid',
        reason: 'SPAM',
      }),
    ).toThrow(ValidationError);

    expect(() =>
      validateReportPostInput({
        reason: 'SPAM',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects details exceeding 500 characters after trimming', () => {
    const longDetails = 'a'.repeat(501);
    expect(() =>
      validateReportPostInput({
        postId: validPostId,
        reason: 'SPAM',
        details: longDetails,
      }),
    ).toThrow(ValidationError);

    expect(() =>
      validateReportPostInput({
        postId: validPostId,
        reason: 'SPAM',
        details: `  ${'a'.repeat(501)}  `,
      }),
    ).toThrow(ValidationError);
  });

  it('accepts details at 500 characters', () => {
    const details500 = 'a'.repeat(500);
    const result = validateReportPostInput({
      postId: validPostId,
      reason: 'OTHER',
      details: details500,
    });
    expect(result.details).toBe(details500);
  });

  it('treats blank and whitespace-only details as absent', () => {
    for (const details of ['', '   ', '\n\t ']) {
      const result = validateReportPostInput({
        postId: validPostId,
        reason: 'SCAM',
        details,
      });
      expect(result.details).toBeUndefined();
    }
  });

  it('handles null details as undefined', () => {
    const result = validateReportPostInput({
      postId: validPostId,
      reason: 'SCAM',
      details: null,
    });
    expect(result.details).toBeUndefined();
  });

  it('requires nonblank details when reason is OTHER', () => {
    for (const details of [undefined, null, '', '   ']) {
      expect(() =>
        validateReportPostInput({
          postId: validPostId,
          reason: 'OTHER',
          details,
        }),
      ).toThrow(ValidationError);
    }
  });

  it('rejects non-object or null raw input', () => {
    expect(() => validateReportPostInput(null)).toThrow(ValidationError);
    expect(() => validateReportPostInput('string')).toThrow(ValidationError);
    expect(() => validateReportPostInput(123)).toThrow(ValidationError);
  });
});

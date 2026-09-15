import { validateReportCommentInput, reportReasonValues } from './report-comment.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateReportCommentInput', () => {
  const validCommentId = '01916327-0000-7000-8000-000000000001';

  it('validates a correct payload with reason and optional details', () => {
    const result = validateReportCommentInput({
      commentId: validCommentId,
      reason: 'SPAM',
      details: '  This is spam and self-promotion  ',
    });

    expect(result).toEqual({
      commentId: validCommentId,
      reason: 'SPAM',
      details: 'This is spam and self-promotion',
    });
  });

  it('validates a correct payload without details', () => {
    const result = validateReportCommentInput({
      commentId: validCommentId,
      reason: 'INAPPROPRIATE_CONTENT',
    });

    expect(result).toEqual({
      commentId: validCommentId,
      reason: 'INAPPROPRIATE_CONTENT',
      details: undefined,
    });
  });

  it('accepts all defined report reasons', () => {
    for (const reason of reportReasonValues) {
      const result = validateReportCommentInput({
        commentId: validCommentId,
        reason,
      });
      expect(result.reason).toBe(reason);
    }
  });

  it('rejects invalid reason', () => {
    expect(() =>
      validateReportCommentInput({
        commentId: validCommentId,
        reason: 'INVALID_REASON',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects missing or invalid commentId UUID', () => {
    expect(() =>
      validateReportCommentInput({
        commentId: 'not-a-uuid',
        reason: 'SPAM',
      }),
    ).toThrow(ValidationError);

    expect(() =>
      validateReportCommentInput({
        reason: 'SPAM',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects details exceeding 500 characters', () => {
    const longDetails = 'a'.repeat(501);
    expect(() =>
      validateReportCommentInput({
        commentId: validCommentId,
        reason: 'SPAM',
        details: longDetails,
      }),
    ).toThrow(ValidationError);
  });

  it('accepts details at 500 characters', () => {
    const details500 = 'a'.repeat(500);
    const result = validateReportCommentInput({
      commentId: validCommentId,
      reason: 'OTHER',
      details: details500,
    });
    expect(result.details).toBe(details500);
  });

  it('handles null details as undefined', () => {
    const result = validateReportCommentInput({
      commentId: validCommentId,
      reason: 'SCAM',
      details: null,
    });
    expect(result.details).toBeUndefined();
  });

  it('rejects non-object or null raw input', () => {
    expect(() => validateReportCommentInput(null)).toThrow(ValidationError);
    expect(() => validateReportCommentInput('string')).toThrow(ValidationError);
    expect(() => validateReportCommentInput(123)).toThrow(ValidationError);
  });
});

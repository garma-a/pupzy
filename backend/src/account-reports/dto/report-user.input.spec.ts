import { validateReportUserInput, accountReportReasonValues, accountReportSourceTypeValues } from './report-user.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateReportUserInput', () => {
  const validUserId = '01916327-0000-7000-8000-000000000001';
  const validSourceId = '01916327-0000-7000-8000-000000000002';

  it('validates a payload with reason and optional trimmed details', () => {
    const result = validateReportUserInput({
      userId: validUserId,
      reason: 'HARASSMENT',
      details: '  They keep sending threatening messages  ',
    });

    expect(result).toEqual({
      userId: validUserId,
      reason: 'HARASSMENT',
      details: 'They keep sending threatening messages',
      sourceType: undefined,
      sourceId: undefined,
    });
  });

  it('validates a payload without details or source context', () => {
    const result = validateReportUserInput({
      userId: validUserId,
      reason: 'SPAM',
    });

    expect(result).toEqual({
      userId: validUserId,
      reason: 'SPAM',
      details: undefined,
      sourceType: undefined,
      sourceId: undefined,
    });
  });

  it('accepts every account report reason', () => {
    for (const reason of accountReportReasonValues) {
      const result = validateReportUserInput({
        userId: validUserId,
        reason,
        details: reason === 'OTHER' ? 'Something uncategorized' : undefined,
      });
      expect(result.reason).toBe(reason);
    }
  });

  it('rejects content-only report reasons', () => {
    expect(() =>
      validateReportUserInput({
        userId: validUserId,
        reason: 'DUPLICATE',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects missing or invalid userId', () => {
    expect(() => validateReportUserInput({ userId: 'not-a-uuid', reason: 'SPAM' })).toThrow(ValidationError);
    expect(() => validateReportUserInput({ reason: 'SPAM' })).toThrow(ValidationError);
  });

  it('requires nonblank details when the reason is OTHER', () => {
    expect(() => validateReportUserInput({ userId: validUserId, reason: 'OTHER' })).toThrow(ValidationError);
    expect(() => validateReportUserInput({ userId: validUserId, reason: 'OTHER', details: '   ' })).toThrow(
      ValidationError,
    );
    expect(() => validateReportUserInput({ userId: validUserId, reason: 'OTHER', details: null })).toThrow(
      ValidationError,
    );

    const result = validateReportUserInput({ userId: validUserId, reason: 'OTHER', details: '  Other issue  ' });
    expect(result.details).toBe('Other issue');
  });

  it('treats blank details for non-OTHER reasons as absent', () => {
    const result = validateReportUserInput({ userId: validUserId, reason: 'SAFETY_CONCERN', details: '   ' });
    expect(result.details).toBeUndefined();
  });

  it('rejects details exceeding 500 characters and accepts 500', () => {
    expect(() => validateReportUserInput({ userId: validUserId, reason: 'SPAM', details: 'a'.repeat(501) })).toThrow(
      ValidationError,
    );

    const details500 = 'a'.repeat(500);
    expect(validateReportUserInput({ userId: validUserId, reason: 'SPAM', details: details500 }).details).toBe(
      details500,
    );
  });

  it('accepts every source type when paired with a valid sourceId', () => {
    for (const sourceType of accountReportSourceTypeValues) {
      const result = validateReportUserInput({
        userId: validUserId,
        reason: 'INAPPROPRIATE_CONDUCT',
        sourceType,
        sourceId: validSourceId,
      });
      expect(result.sourceType).toBe(sourceType);
      expect(result.sourceId).toBe(validSourceId);
    }
  });

  it('rejects a source type or source id supplied alone', () => {
    expect(() => validateReportUserInput({ userId: validUserId, reason: 'SPAM', sourceType: 'POST' })).toThrow(
      ValidationError,
    );
    expect(() => validateReportUserInput({ userId: validUserId, reason: 'SPAM', sourceId: validSourceId })).toThrow(
      ValidationError,
    );
  });

  it('rejects an invalid source type or source id', () => {
    expect(() =>
      validateReportUserInput({ userId: validUserId, reason: 'SPAM', sourceType: 'MESSAGE', sourceId: validSourceId }),
    ).toThrow(ValidationError);
    expect(() =>
      validateReportUserInput({ userId: validUserId, reason: 'SPAM', sourceType: 'POST', sourceId: 'nope' }),
    ).toThrow(ValidationError);
  });

  it('rejects non-object raw input', () => {
    expect(() => validateReportUserInput(null)).toThrow(ValidationError);
    expect(() => validateReportUserInput('string')).toThrow(ValidationError);
    expect(() => validateReportUserInput(123)).toThrow(ValidationError);
  });
});

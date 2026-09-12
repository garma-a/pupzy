import { withDbRetry, isRetryableDbError } from './db-retry.util';

interface DbErrorWithCode extends Error {
  code: string;
}

function createDbError(message: string, code: string): DbErrorWithCode {
  const err = new Error(message) as DbErrorWithCode;
  err.code = code;
  return err;
}

describe('db-retry.util', () => {
  describe('isRetryableDbError', () => {
    it('identifies 40P01 deadlock error as retryable', () => {
      expect(isRetryableDbError({ code: '40P01' })).toBe(true);
      expect(isRetryableDbError({ originalError: { code: '40P01' } })).toBe(true);
      expect(isRetryableDbError({ cause: { code: '40P01' } })).toBe(true);
    });

    it('identifies 40001 serialization failure as retryable', () => {
      expect(isRetryableDbError({ code: '40001' })).toBe(true);
      expect(isRetryableDbError({ originalError: { code: '40001' } })).toBe(true);
      expect(isRetryableDbError({ driverError: { code: '40001' } })).toBe(true);
    });

    it('walks all supported error wrapper branches', () => {
      expect(isRetryableDbError({ cause: { code: '23505' }, driverError: { code: '40001' } })).toBe(true);
    });

    it('does not retry lock-timeout/busy errors', () => {
      expect(isRetryableDbError({ code: '55P03' })).toBe(false);
    });

    it('identifies non-retryable business errors as false', () => {
      expect(isRetryableDbError({ code: '23505' })).toBe(false); // unique_violation
      expect(isRetryableDbError({ code: '23503' })).toBe(false); // foreign_key_violation
      expect(isRetryableDbError(new Error('Record not found'))).toBe(false);
      expect(isRetryableDbError(new Error('deadlock detected'))).toBe(false);
      expect(isRetryableDbError(null)).toBe(false);
      expect(isRetryableDbError(undefined)).toBe(false);
    });
  });

  describe('withDbRetry', () => {
    it('returns result immediately on first successful attempt', async () => {
      const op = jest.fn().mockResolvedValue('success');
      const result = await withDbRetry(op);
      expect(result).toBe('success');
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('retries on retryable error and succeeds on subsequent attempt', async () => {
      let attempts = 0;
      const op = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(createDbError('deadlock detected', '40P01'));
        }
        return Promise.resolve('recovered');
      });

      const result = await withDbRetry(op, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 });
      expect(result).toBe('recovered');
      expect(op).toHaveBeenCalledTimes(3);
    });

    it('throws immediately on non-retryable error without retrying', async () => {
      const op = jest.fn().mockImplementation(() => Promise.reject(createDbError('Unique constraint failed', '23505')));

      await expect(withDbRetry(op, { maxRetries: 3 })).rejects.toThrow('Unique constraint failed');
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('exhausts maxRetries and throws last retryable error', async () => {
      const op = jest.fn().mockImplementation(() => Promise.reject(createDbError('deadlock detected', '40P01')));

      await expect(withDbRetry(op, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 })).rejects.toThrow(
        'deadlock detected',
      );
      expect(op).toHaveBeenCalledTimes(3); // Initial attempt + 2 retries
    });
  });
});

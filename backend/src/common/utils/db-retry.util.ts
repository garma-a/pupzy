/**
 * Database transaction retry utility for transient concurrency errors (Ticket 11).
 * Handles PostgreSQL:
 *  - 40P01: deadlock_detected
 *  - 40001: serialization_failure
 */

export interface DbRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export function isRetryableDbError(error: unknown): boolean {
  // Drizzle can wrap the pg error in `cause`, `driverError`, or
  // `originalError`. Only trust a PostgreSQL SQLSTATE: arbitrary error text
  // could otherwise replay a business error and its domain side effects.
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];

  // pg, Drizzle, and Nest may each wrap a driver error independently. Walk
  // every documented wrapper field, rather than picking the first one, while
  // keeping the traversal bounded if a malformed error graph is cyclic.
  while (pending.length > 0 && seen.size < 16) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;

    seen.add(current);
    const err = current as {
      code?: string;
      cause?: unknown;
      driverError?: unknown;
      originalError?: unknown;
    };

    // Only PostgreSQL transaction-abort SQLSTATEs are safe to replay here.
    // Do not retry lock-timeout/busy failures (55P03): callers must receive a
    // bounded, stable failure rather than silently repeating a busy request.
    if (err.code === '40P01' || err.code === '40001') {
      return true;
    }

    pending.push(err.cause, err.driverError, err.originalError);
  }

  return false;
}

/**
 * Executes an asynchronous database operation with jittered exponential backoff retry
 * on transaction-aborting PostgreSQL errors (deadlocks and serialization
 * failures). Callers must pass only a short database transaction: no storage,
 * HTTP, notification, cache, or other externally visible work is replayed.
 */
export async function withDbRetry<T>(operation: () => Promise<T>, options: DbRetryOptions = {}): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 10;
  const maxDelayMs = options.maxDelayMs ?? 100;

  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      if (attempt <= maxRetries && isRetryableDbError(error)) {
        // Jittered exponential backoff: base * 2^(attempt - 1) + uniform jitter [0, base)
        const expDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
        const jitter = Math.random() * baseDelayMs;
        const delay = Math.min(maxDelayMs, expDelay + jitter);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

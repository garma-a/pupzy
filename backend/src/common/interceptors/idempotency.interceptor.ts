import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Inject, Logger } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ConflictError } from '../errors/app.errors';

/**
 * IdempotencyInterceptor — prevents duplicate mutation processing
 * when clients retry requests with the same `X-Idempotency-Key` header.
 *
 * ## How it works
 * 1. Client sends `X-Idempotency-Key: <unique-uuid>` with mutations
 * 2. On first request: execute mutation, cache result for 24 hours
 * 3. On retry with same key: return cached result immediately (no DB write)
 * 4. If a key is being processed concurrently: throw ConflictError
 *
 * ## Cache key format
 * `idempotency:{userId}:{idempotencyKey}` — scoped per user to prevent
 * cross-user conflicts.
 *
 * ## TTL
 * 24 hours — long enough to cover any mobile retry scenario.
 * After TTL, the same key can be reused (acceptable trade-off).
 *
 * ## When it activates
 * - Only on **mutations** (operationType === 'mutation')
 * - Only when `X-Idempotency-Key` header is present
 * - Queries are always passed through unmodified
 */
const IDEMPOTENCY_TTL_MS = 900_000; // 15 minutes
const PROCESSING_SENTINEL = '__PROCESSING__';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const gqlCtx = GqlExecutionContext.create(context);
    const info = gqlCtx.getInfo<{
      operation: { operation: string };
      fieldName: string;
    }>();

    // Only apply to mutations
    const operationType = info?.operation?.operation;
    if (operationType !== 'mutation') {
      return next.handle();
    }

    // Only apply when header is present
    const ctx = gqlCtx.getContext<{ req: { headers: Record<string, string> }; user?: { id: string } }>();
    const idempotencyKey = ctx.req.headers['x-idempotency-key'];
    if (!idempotencyKey) {
      return next.handle();
    }

    const userId = ctx.user?.id ?? 'anonymous';
    const cacheKey = `idempotency:${userId}:${idempotencyKey}`;

    // Check for existing result or in-progress marker
    const cached = await this.cacheManager.get<string>(cacheKey);

    if (cached === PROCESSING_SENTINEL) {
      // Another request with the same key is currently being processed
      throw new ConflictError('This request is already being processed. Please wait.');
    }

    if (cached != null) {
      // Return the cached result from the previous execution
      this.logger.debug(`Idempotent replay for key=${idempotencyKey} mutation=${info.fieldName}`);
      return of(JSON.parse(cached));
    }

    // Mark as processing (short TTL to prevent deadlocks)
    await this.cacheManager.set(cacheKey, PROCESSING_SENTINEL, 60_000);

    return next.handle().pipe(
      tap({
        next: (result) => {
          try {
            // Cache the successful result for 24 hours
            void this.cacheManager.set(cacheKey, JSON.stringify(result), IDEMPOTENCY_TTL_MS);
          } catch (err) {
            this.logger.warn(
              `Failed to cache idempotency result for key=${idempotencyKey}`,
              err instanceof Error ? err.message : String(err),
            );
          }
        },
        error: () => {
          // Remove the processing sentinel on failure so the key can be retried
          try {
            void this.cacheManager.del(cacheKey);
          } catch {
            // Swallow — cache cleanup is best-effort
          }
        },
      }),
    );
  }
}

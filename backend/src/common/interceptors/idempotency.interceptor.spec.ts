import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { firstValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';

describe('IdempotencyInterceptor cache failures', () => {
  const context = {
    getArgs: () => [
      null,
      {},
      { req: { headers: { 'x-idempotency-key': 'retry-1' } }, user: { id: 'user-1' } },
      { operation: { operation: 'mutation' }, fieldName: 'createPost' },
    ],
    getClass: () => class {},
    getHandler: () => () => {},
    getType: () => 'graphql',
  } as unknown as ExecutionContext;

  function withRetryKey(key: unknown): ExecutionContext {
    const args = context.getArgs<unknown[]>();
    args[2] = { req: { headers: { 'x-idempotency-key': key } }, user: { id: 'user-1' } };
    return { ...context, getArgs: () => args } as unknown as ExecutionContext;
  }

  it.each([
    ['oversized', 'k'.repeat(129)],
    ['multiple', ['first', 'second']],
  ])('rejects %s retry keys before allocating cache entries or running a mutation', async (_, key) => {
    const cache = { get: jest.fn(), set: jest.fn() } as unknown as Cache;
    const handler = { handle: jest.fn(() => of(true)) };
    await expect(new IdempotencyInterceptor(cache).intercept(withRetryKey(key), handler)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(cache.get).not.toHaveBeenCalled();
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('accepts a retry key at the 128-character boundary', async () => {
    const cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as Cache;
    const result = await new IdempotencyInterceptor(cache).intercept(withRetryKey('k'.repeat(128)), {
      handle: () => of(true),
    });
    await expect(firstValueFrom(result)).resolves.toBe(true);
  });

  it('preserves a successful mutation when the asynchronous result-cache write fails', async () => {
    const cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('cache unavailable')),
    } as unknown as Cache;
    const interceptor = new IdempotencyInterceptor(cache);
    const result = await interceptor.intercept(context, { handle: () => of({ id: 'post-1' }) } as CallHandler);
    await expect(firstValueFrom(result)).resolves.toEqual({ id: 'post-1' });
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it('preserves the mutation error when asynchronous sentinel cleanup fails', async () => {
    const cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockRejectedValue(new Error('cache unavailable')),
    } as unknown as Cache;
    const error = new Error('mutation failed');
    const interceptor = new IdempotencyInterceptor(cache);
    const result = await interceptor.intercept(context, { handle: () => throwError(() => error) } as CallHandler);
    await expect(firstValueFrom(result)).rejects.toBe(error);
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it('admits only one of two simultaneous mutations with the same account and retry key', async () => {
    const values = new Map<string, unknown>();
    const cache = {
      get: jest.fn((key: string) => Promise.resolve(values.get(key))),
      set: jest.fn((key: string, value: unknown) => {
        values.set(key, value);
        return Promise.resolve();
      }),
    } as unknown as Cache;
    const interceptor = new IdempotencyInterceptor(cache);
    const handler = { handle: jest.fn(() => of({ id: 'post-1' })) };
    const results = await Promise.allSettled([
      interceptor.intercept(context, handler),
      interceptor.intercept(context, handler),
    ]);
    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    for (const result of results) if (result.status === 'fulfilled') await firstValueFrom(result.value);
  });
});

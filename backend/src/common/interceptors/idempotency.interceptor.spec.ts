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
});

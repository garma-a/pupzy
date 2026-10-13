import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { GqlIpThrottlerGuard, GqlThrottlerGuard } from './gql-throttler.guard';

describe('GraphQL rate limits', () => {
  const handler = () => {};
  class Resolver {}
  function context(ip: string, id?: string): ExecutionContext {
    return {
      getType: () => 'graphql',
      getHandler: () => handler,
      getClass: () => Resolver,
      getArgs: () => [
        null,
        {},
        { user: id ? { id } : undefined, req: { ip, headers: {}, res: { header: jest.fn() } } },
        {},
      ],
    } as unknown as ExecutionContext;
  }
  let storage: ThrottlerStorageService;
  let guard: GqlThrottlerGuard;
  beforeEach(async () => {
    storage = new ThrottlerStorageService();
    guard = new GqlThrottlerGuard([{ limit: 2, ttl: 60_000 }], storage, new Reflector());
    await guard.onModuleInit();
  });
  afterEach(() => storage.onApplicationShutdown());

  it('gives accounts sharing an IP independent quotas', async () => {
    await guard.canActivate(context('198.51.100.1', 'a'));
    await guard.canActivate(context('198.51.100.1', 'a'));
    await expect(guard.canActivate(context('198.51.100.1', 'a'))).rejects.toThrow('Too Many Requests');
    await expect(guard.canActivate(context('198.51.100.1', 'b'))).resolves.toBe(true);
  });
  it('keeps an account in the same quota when its IP changes', async () => {
    await guard.canActivate(context('198.51.100.1', 'a'));
    await guard.canActivate(context('198.51.100.2', 'a'));
    await expect(guard.canActivate(context('198.51.100.3', 'a'))).rejects.toThrow('Too Many Requests');
  });
  it('limits anonymous calls by IP', async () => {
    await guard.canActivate(context('198.51.100.1'));
    await guard.canActivate(context('198.51.100.1'));
    await expect(guard.canActivate(context('198.51.100.1'))).rejects.toThrow('Too Many Requests');
  });
  it('uses the generous IP ceiling before auth, independently of small business quotas', async () => {
    const ipGuard = new GqlIpThrottlerGuard([{ limit: 2, ttl: 3_600_000 }], storage, new Reflector());
    await ipGuard.onModuleInit();
    const increment = jest.spyOn(storage, 'increment');
    for (let i = 0; i < 3; i++) await expect(ipGuard.canActivate(context('198.51.100.1'))).resolves.toBe(true);
    expect(increment).toHaveBeenCalledWith('preauth:ip:198.51.100.1', 60_000, 10_000, 60_000, 'default');
  });
});

import { CACHE_MANAGER, CacheModule } from '@nestjs/cache-manager';
import { Test } from '@nestjs/testing';
import type { Cache } from 'cache-manager';
import { createBoundedCacheStore } from './bounded-cache.store';

describe('bounded application cache', () => {
  it('evicts the least recently used key when the shared store reaches its limit', async () => {
    const module = await Test.createTestingModule({
      imports: [CacheModule.register({ stores: [createBoundedCacheStore(2)] })],
    }).compile();
    const cache = module.get<Cache>(CACHE_MANAGER);
    try {
      await cache.set('auth:a', { id: 'a' }, 60_000);
      await cache.set('view:b', true, 60_000);
      await expect(cache.get('auth:a')).resolves.toEqual({ id: 'a' });
      await cache.set('idempotency:c', { id: 'c' }, 60_000);

      await expect(cache.get('view:b')).resolves.toBeUndefined();
      await expect(cache.get('auth:a')).resolves.toEqual({ id: 'a' });
      await expect(cache.get('idempotency:c')).resolves.toEqual({ id: 'c' });
    } finally {
      await module.close();
    }
  });

  it('honors each entry TTL in milliseconds', async () => {
    jest.useFakeTimers();
    const module = await Test.createTestingModule({
      imports: [CacheModule.register({ stores: [createBoundedCacheStore()] })],
    }).compile();
    const cache = module.get<Cache>(CACHE_MANAGER);
    try {
      await cache.set('short-lived', true, 60_000);
      jest.advanceTimersByTime(59_999);
      await expect(cache.get('short-lived')).resolves.toBe(true);
      jest.advanceTimersByTime(2);
      await expect(cache.get('short-lived')).resolves.toBeUndefined();
    } finally {
      await module.close();
      jest.useRealTimers();
    }
  });
});

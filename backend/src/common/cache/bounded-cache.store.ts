import { createKeyv } from '@cacheable/memory';

export function createBoundedCacheStore(lruSize = 50_000) {
  return createKeyv({ lruSize });
}

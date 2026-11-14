import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DashboardStatsCache, computeStats } from './dashboard-cache.js';

function createMockPool(rows = {}) {
  let queryCount = 0;
  let lastSql = '';
  const defaultRow = {
    total_users: '10',
    banned_users: '1',
    total_posts: '20',
    active_posts: '18',
    needs_review_posts: '3',
    flagged_posts: '1',
  };
  return {
    get queryCount() {
      return queryCount;
    },
    get lastSql() {
      return lastSql;
    },
    async query(sql) {
      queryCount += 1;
      lastSql = sql;
      return { rows: [{ ...defaultRow, ...rows }] };
    },
  };
}

describe('DashboardStatsCache', () => {
  it('computes all six counters in one query and caches on first call', async () => {
    let currentTime = 1_000_000;
    const cache = new DashboardStatsCache({
      ttlMs: 120_000,
      clock: () => currentTime,
    });
    const pool = createMockPool({ total_users: '42' });

    const stats = await cache.getStats(pool);
    assert.equal(pool.queryCount, 1);
    assert.equal(stats.total_users, '42');
    assert.equal(stats.computedAt, new Date(currentTime).toISOString());
    for (const fragment of [
      'count(*) FROM users',
      'is_banned = true',
      'count(*) FROM posts',
      "status = 'ACTIVE'",
      "IN ('PENDING_AUTO_REVIEW','FLAGGED')",
      "moderation_status = 'FLAGGED'",
    ]) {
      assert.ok(pool.lastSql.includes(fragment), `query contains ${fragment}`);
    }
  });

  it('reuses cached stats within 120 seconds without querying PostgreSQL', async () => {
    let currentTime = 1_000_000;
    const cache = new DashboardStatsCache({
      ttlMs: 120_000,
      clock: () => currentTime,
    });
    const pool = createMockPool({ total_users: '50' });

    const first = await cache.getStats(pool);
    assert.equal(pool.queryCount, 1);

    // Advance clock within TTL (e.g. 60 seconds)
    currentTime += 60_000;
    const second = await cache.getStats(pool);
    assert.equal(pool.queryCount, 1);
    assert.deepEqual(second, first);
  });

  it('recomputes from PostgreSQL and replaces cache when TTL expires', async () => {
    let currentTime = 1_000_000;
    const cache = new DashboardStatsCache({
      ttlMs: 120_000,
      clock: () => currentTime,
    });
    let counter = 10;
    const pool = {
      queryCount: 0,
      async query() {
        this.queryCount += 1;
        return {
          rows: [
            {
              total_users: String(counter++),
              banned_users: '0',
              total_posts: '0',
              active_posts: '0',
              needs_review_posts: '0',
              flagged_posts: '0',
            },
          ],
        };
      },
    };

    const first = await cache.getStats(pool);
    assert.equal(pool.queryCount, 1);
    assert.equal(first.total_users, '10');

    // Advance clock past 120 seconds TTL
    currentTime += 120_001;
    const second = await cache.getStats(pool);
    assert.equal(pool.queryCount, 2);
    assert.equal(second.total_users, '11');
    assert.equal(second.computedAt, new Date(currentTime).toISOString());
  });

  it('bypasses unexpired cache and replaces cached result when fresh=true', async () => {
    let currentTime = 1_000_000;
    const cache = new DashboardStatsCache({
      ttlMs: 120_000,
      clock: () => currentTime,
    });
    let counter = 100;
    const pool = {
      queryCount: 0,
      async query() {
        this.queryCount += 1;
        return {
          rows: [
            {
              total_users: String(counter++),
              banned_users: '0',
              total_posts: '0',
              active_posts: '0',
              needs_review_posts: '0',
              flagged_posts: '0',
            },
          ],
        };
      },
    };

    const first = await cache.getStats(pool);
    assert.equal(first.total_users, '100');
    assert.equal(pool.queryCount, 1);

    // Refresh now: fresh=true bypasses cache even within TTL
    currentTime += 10_000;
    const refreshed = await cache.getStats(pool, { fresh: true });
    assert.equal(refreshed.total_users, '101');
    assert.equal(pool.queryCount, 2);

    // Subsequent normal read reuses the newly cached refreshed result
    const third = await cache.getStats(pool);
    assert.equal(third.total_users, '101');
    assert.equal(pool.queryCount, 2);
  });

  it('invalidates cache immediately and recomputes on next getStats call', async () => {
    let currentTime = 1_000_000;
    const cache = new DashboardStatsCache({
      ttlMs: 120_000,
      clock: () => currentTime,
    });
    let counter = 200;
    const pool = {
      queryCount: 0,
      async query() {
        this.queryCount += 1;
        return {
          rows: [
            {
              total_users: String(counter++),
              banned_users: '0',
              total_posts: '0',
              active_posts: '0',
              needs_review_posts: '0',
              flagged_posts: '0',
            },
          ],
        };
      },
    };

    await cache.getStats(pool);
    assert.equal(pool.queryCount, 1);

    cache.invalidate();

    const afterInvalidate = await cache.getStats(pool);
    assert.equal(pool.queryCount, 2);
    assert.equal(afterInvalidate.total_users, '201');
  });

  it('recomputes before responding when invalidated during a statistics query', async () => {
    let currentTime = 1_000_000;
    const cache = new DashboardStatsCache({
      ttlMs: 120_000,
      clock: () => currentTime,
    });

    let resolveStaleQuery;
    const staleQueryPromise = new Promise((resolve) => {
      resolveStaleQuery = resolve;
    });

    let counter = 0;
    const pool = {
      queryCount: 0,
      async query() {
        this.queryCount += 1;
        if (this.queryCount === 1) {
          // First query started before mutation, takes time to finish
          await staleQueryPromise;
          return {
            rows: [
              {
                total_users: 'STALE_DATA',
                banned_users: '0',
                total_posts: '0',
                active_posts: '0',
                needs_review_posts: '0',
                flagged_posts: '0',
              },
            ],
          };
        }
        return {
          rows: [
            {
              total_users: 'FRESH_DATA',
              banned_users: '1',
              total_posts: '0',
              active_posts: '0',
              needs_review_posts: '0',
              flagged_posts: '0',
            },
          ],
        };
      },
    };

    // Start computation 1 (pre-mutation)
    const computePromise1 = cache.getStats(pool);

    // Mutation occurs while computation 1 is in-flight!
    cache.invalidate();

    // Now computation 1 completes
    resolveStaleQuery();
    const result1 = await computePromise1;
    assert.equal(result1.total_users, 'FRESH_DATA');
    assert.equal(pool.queryCount, 2);

    // Subsequent call reuses the FRESH_DATA cache
    const result2 = await cache.getStats(pool);
    assert.equal(result2.total_users, 'FRESH_DATA');
    assert.equal(pool.queryCount, 2);
  });

  it('coalesces concurrent cold reads into one PostgreSQL query', async () => {
    const cache = new DashboardStatsCache();
    let releaseQuery;
    const queryStarted = Promise.withResolvers();
    const pool = {
      queryCount: 0,
      async query() {
        this.queryCount += 1;
        queryStarted.resolve();
        await new Promise((resolve) => {
          releaseQuery = resolve;
        });
        return {
          rows: [
            {
              total_users: '12',
              banned_users: '0',
              total_posts: '0',
              active_posts: '0',
              needs_review_posts: '0',
              flagged_posts: '0',
            },
          ],
        };
      },
    };

    const first = cache.getStats(pool);
    const second = cache.getStats(pool);
    await queryStarted.promise;
    assert.equal(pool.queryCount, 1);

    releaseQuery();
    assert.deepEqual(await second, await first);
    assert.equal(pool.queryCount, 1);
  });

  it('starts the TTL when computation completes', async () => {
    let currentTime = 1_000;
    const cache = new DashboardStatsCache({
      ttlMs: 120_000,
      clock: () => currentTime,
    });
    const pool = createMockPool();

    const computation = cache.getStats({
      async query(sql) {
        currentTime = 61_000;
        return pool.query(sql);
      },
    });
    await computation;

    currentTime = 180_999;
    await cache.getStats(pool);
    assert.equal(pool.queryCount, 1);
  });
});

describe('Shared work-queue counts', () => {
  it('caches for 30 seconds and supports invalidation and an explicit refresh', async () => {
    let now = 0;
    let queries = 0;
    const cache = new DashboardStatsCache({ clock: () => now });
    const pool = { query: async () => ({ rows: [{ rescue: ++queries }] }) };
    assert.equal((await cache.getQueueCounts(pool)).rescue, 1);
    now = 29_999;
    assert.equal((await cache.getQueueCounts(pool)).rescue, 1);
    assert.equal(queries, 1);
    now = 30_000;
    assert.equal((await cache.getQueueCounts(pool)).rescue, 2);
    cache.invalidate();
    assert.equal((await cache.getQueueCounts(pool)).rescue, 3);
    assert.equal((await cache.getQueueCounts(pool, { fresh: true })).rescue, 4);
    assert.equal((await cache.getQueueCounts(pool)).rescue, 4);
    assert.equal(queries, 4);
  });

  it('coalesces reads, fences invalidated work, and serializes a forced refresh', async () => {
    const cache = new DashboardStatsCache();
    const pending = Promise.withResolvers();
    let queries = 0;
    const pool = {
      query: async () => {
        const rescue = ++queries;
        if (rescue === 1) await pending.promise;
        return { rows: [{ rescue }] };
      },
    };
    const first = cache.getQueueCounts(pool);
    const second = cache.getQueueCounts(pool);
    const forced = cache.getQueueCounts(pool, { fresh: true });
    assert.equal(queries, 1);
    cache.invalidate();
    pending.resolve();
    assert.equal((await first).rescue, 2);
    assert.equal((await second).rescue, 2);
    assert.equal((await forced).rescue, 3);
    assert.equal((await cache.getQueueCounts(pool)).rescue, 3);
    assert.equal(queries, 3);
  });
});

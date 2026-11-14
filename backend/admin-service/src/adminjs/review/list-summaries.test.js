import assert from 'node:assert/strict';
import { it } from 'node:test';
import { attachListSummaries } from './list-summaries.js';
import { DashboardStatsCache } from '../dashboard/dashboard-cache.js';
it('loads report counts for a Users page with one query and supplies zero for missing groups', async () => {
  const records = Array.from({ length: 25 }, (_, i) => ({ id: `u${i}`, params: { id: `u${i}`, is_banned: false } }));
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ id: 'u1', open_reports: 3 }] };
    },
  };
  await attachListSummaries(pool, 'users', { records });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[0].length, 25);
  assert.equal(records[0].params.open_reports, 0);
  assert.equal(records[1].params.open_reports, 3);
  assert.equal(records[1].params.is_banned, false);
});
it('loads Posts thumbnails, open counts and all nine queue counts with two queries', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return {
        rows: sql.includes('AS thumbnail') ? [{ id: 'p', thumbnail: 'photo.jpg', open_reports: 2 }] : [{ rescue: 5 }],
      };
    },
  };
  const result = await attachListSummaries(
    pool,
    'posts',
    { records: [{ id: 'p', params: { status: 'ACTIVE' } }] },
    new DashboardStatsCache(),
  );
  assert.equal(calls.length, 2);
  assert.equal(result.records[0].params.thumbnail, 'photo.jpg');
  assert.equal(result.records[0].params.open_reports, 2);
  assert.equal(result.postQueues.length, 9);
  assert.equal(result.postQueues.find((q) => q.id === 'rescue').count, 5);
});
it('skips summaries for other resources instead of accepting an interpolated identifier', async () => {
  const input = { records: [] };
  assert.equal(await attachListSummaries({ query: () => assert.fail() }, 'posts;drop table users', input), input);
});

it('shares counts between Posts and Inbox, invalidates after actions, and bypasses on Refresh now', async () => {
  const { buildDashboardHandler } = await import('../dashboard/dashboard-handler.js');
  const { buildWorkQueueCountSql } = await import('../dashboard/work-queues.js');
  const cache = new DashboardStatsCache();
  let countQueries = 0;
  const pool = {
    query: async (sql) => {
      if (sql === buildWorkQueueCountSql()) return { rows: [{ rescue: ++countQueries }] };
      if (sql.includes('WITH cases(')) return { rows: [] };
      return { rows: [] };
    },
  };
  const posts = () => attachListSummaries(pool, 'posts', { records: [] }, cache);
  const inbox = buildDashboardHandler(pool, cache);
  const postCount = (result) => result.postQueues.find((q) => q.id === 'rescue').count;
  const inboxCount = (result) => result.queues.find((q) => q.id === 'rescue').count;
  assert.equal(postCount(await posts()), 1);
  assert.equal(inboxCount(await inbox({ query: {} })), 1);
  assert.equal(countQueries, 1);
  cache.invalidate();
  assert.equal(inboxCount(await inbox({ query: {} })), 2);
  assert.equal(postCount(await posts()), 2);
  assert.equal(inboxCount(await inbox({ query: { fresh: 'true' } })), 3);
  assert.equal(postCount(await posts()), 3);
  assert.equal(countQueries, 3);
});

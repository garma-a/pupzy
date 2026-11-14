import assert from 'node:assert/strict';
import { it } from 'node:test';
import { attachListSummaries } from './list-summaries.js';
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
  const result = await attachListSummaries(pool, 'posts', { records: [{ id: 'p', params: { status: 'ACTIVE' } }] });
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

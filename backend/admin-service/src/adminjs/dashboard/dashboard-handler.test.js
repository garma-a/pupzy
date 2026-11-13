import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDashboardHandler } from './dashboard-handler.js';
import { WORK_QUEUES } from './work-queues.js';

function createPool() {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      if (sql.includes('WITH cases(')) return { rows: [] };
      return { rows: [{ flagged: '4', open_post_reports: '2' }] };
    },
  };
}

function createCache(stats) {
  return {
    getStats: async () => stats,
  };
}

describe('Admin dashboard handler work queues', () => {
  it('returns every queue with its live count and no cached statistics drift', async () => {
    const pool = createPool();
    const handler = buildDashboardHandler(pool, createCache({ total_posts: '10' }));

    const result = await handler({ query: {} });

    assert.equal(result.stats.total_posts, '10');
    assert.equal(result.queues.length, WORK_QUEUES.length);
    const flagged = result.queues.find((queue) => queue.id === 'flagged');
    assert.equal(flagged.count, 4);
    assert.deepEqual(flagged.filters, { moderation_status: 'FLAGGED', status: 'ACTIVE' });
    const openReports = result.queues.find((queue) => queue.id === 'open_post_reports');
    assert.equal(openReports.count, 2);
    assert.equal(openReports.groupLabel, 'Needs review');
    const unseeded = result.queues.find((queue) => queue.id === 'expired');
    assert.equal(unseeded.count, 0);
  });

  it('lists open cases from unreviewed Reports and Posts awaiting review, not the historical report counter', async () => {
    const pool = createPool();
    const handler = buildDashboardHandler(pool, createCache({}));

    const result = await handler({ query: { kind: 'post_report', order: 'newest', page: '2' } });

    const caseQuery = pool.queries.find((sql) => sql.includes('WITH cases('));
    assert.match(caseQuery, /reviewed_at IS NULL/);
    assert.match(caseQuery, /ORDER BY latest DESC/);
    assert.doesNotMatch(caseQuery, /report_count\b\s*(>|=|FROM)/);
    assert.doesNotMatch(caseQuery, /comment_reports|account_reports/, 'a filter queries only its own kinds');
    assert.equal(result.inbox.kind, 'post_report');
    assert.equal(result.inbox.order, 'newest');
    assert.deepEqual(result.inbox.items, []);
  });
});

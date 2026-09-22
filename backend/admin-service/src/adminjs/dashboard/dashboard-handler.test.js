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
      if (sql.includes('open_report_count')) {
        return {
          rows: [
            {
              id: 'post-1',
              title: 'Flagged Post',
              post_type: 'LOST',
              moderation_status: 'FLAGGED',
              created_at: new Date('2026-09-01T00:00:00Z'),
              open_report_count: 2,
            },
          ],
        };
      }
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

  it('counts outstanding work from unreviewed Reports, not the historical report counter', async () => {
    const pool = createPool();
    const handler = buildDashboardHandler(pool, createCache({}));

    const result = await handler({ query: {} });

    const reviewQuery = pool.queries.find((sql) => sql.includes('open_report_count'));
    assert.match(reviewQuery, /reviewed_at IS NULL/);
    assert.doesNotMatch(reviewQuery, /p\.report_count/);
    assert.equal(result.needsReview[0].open_report_count, 2);
  });
});

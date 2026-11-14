import { DashboardStatsCache } from './dashboard-cache.js';
import { loadInbox } from './inbox.js';
import { WORK_QUEUES } from './work-queues.js';

/**
 * Data for the Moderation Inbox: cached work-queue counts (the tiles), cached
 * community totals, and an uncached page of open cases. The page is chosen by the
 * request query: `kind`, `order` and `page` (see `parseInboxQuery`).
 */
export function buildDashboardHandler(pool, cache = new DashboardStatsCache()) {
  return async function dashboardHandler(request) {
    const fresh = request.query?.fresh === 'true';
    const [stats, queueCounts, inbox] = await Promise.all([
      cache.getStats(pool, { fresh }),
      cache.getQueueCounts(pool, { fresh }),
      loadInbox(pool, request.query ?? {}),
    ]);

    return {
      stats,
      queues: WORK_QUEUES.map(({ id, label, group, groupLabel, resource, filters }) => ({
        id,
        label,
        group,
        groupLabel,
        resource,
        filters,
        count: Number(queueCounts[id] ?? 0),
      })),
      inbox,
    };
  };
}

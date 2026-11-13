import { DashboardStatsCache } from './dashboard-cache.js';
import { loadInbox } from './inbox.js';
import { WORK_QUEUES, loadWorkQueueCounts } from './work-queues.js';

/**
 * Data for the Moderation Inbox: the work-queue counts (the tiles), the cached
 * community totals, and one page of open cases. The page is chosen by the
 * request query: `kind`, `order` and `page` (see `parseInboxQuery`).
 */
export function buildDashboardHandler(pool, cache = new DashboardStatsCache()) {
  return async function dashboardHandler(request) {
    const fresh = request.query?.fresh === 'true';
    const [stats, queueCounts, inbox] = await Promise.all([
      cache.getStats(pool, { fresh }),
      loadWorkQueueCounts(pool),
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

import { DashboardStatsCache } from './dashboard-cache.js';
import { WORK_QUEUES, loadWorkQueueCounts } from './work-queues.js';

export function buildDashboardHandler(pool, cache = new DashboardStatsCache()) {
  return async function dashboardHandler(request) {
    const fresh = request.query?.fresh === 'true';
    const [stats, queueCounts, { rows: needsReview }] = await Promise.all([
      cache.getStats(pool, { fresh }),
      loadWorkQueueCounts(pool),
      pool.query(`
        SELECT p.id, p.title, p.post_type, p.moderation_status, p.created_at,
               (SELECT count(*)::int
                FROM post_reports r
                WHERE r.post_id = p.id AND r.reviewed_at IS NULL) AS open_report_count
        FROM posts p
        WHERE p.moderation_status IN ('PENDING_AUTO_REVIEW', 'FLAGGED') AND p.status = 'ACTIVE'
        ORDER BY open_report_count DESC, p.created_at DESC
        LIMIT 25
      `),
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
      needsReview,
    };
  };
}

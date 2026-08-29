import { DashboardStatsCache } from './dashboard-cache.js';

export function buildDashboardHandler(pool, cache = new DashboardStatsCache()) {
  return async function dashboardHandler(request) {
    const fresh = request.query?.fresh === 'true';
    const stats = await cache.getStats(pool, { fresh });

    const { rows: needsReview } = await pool.query(`
      SELECT id, title, post_type, moderation_status, report_count, created_at
      FROM posts
      WHERE moderation_status IN ('PENDING_AUTO_REVIEW', 'FLAGGED') AND status = 'ACTIVE'
      ORDER BY report_count DESC, created_at DESC
      LIMIT 25
    `);
    return { stats, needsReview };
  };
}

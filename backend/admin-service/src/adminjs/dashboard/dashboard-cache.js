import { loadWorkQueueCounts } from './work-queues.js';

export async function computeStats(pool, clock = () => Date.now()) {
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*) FROM users) AS total_users,
      (SELECT count(*) FROM users WHERE is_banned = true) AS banned_users,
      (SELECT count(*) FROM posts) AS total_posts,
      (SELECT count(*) FROM posts WHERE status = 'ACTIVE') AS active_posts,
      (SELECT count(*) FROM posts
       WHERE moderation_status IN ('PENDING_AUTO_REVIEW','FLAGGED') AND status = 'ACTIVE') AS needs_review_posts,
      (SELECT count(*) FROM posts
       WHERE moderation_status = 'FLAGGED' AND status = 'ACTIVE') AS flagged_posts
  `);
  return { ...rows[0], computedAt: new Date(clock()).toISOString() };
}

/** Shared TTL, coalescing and invalidation fencing for dashboard queries. */
class DashboardQueryCache {
  /**
   * @param {Object} [options]
   * @param {number} [options.ttlMs=120000]
   * @param {() => number} [options.clock=Date.now]
   * @param {(pool: import('pg').Pool, clock: () => number) => Promise<Object>} options.compute
   */
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? 120_000;
    this.clock = options.clock ?? (() => Date.now());
    this.compute = options.compute;
    this.cached = null;
    this.invalidationVersion = 0;
    this.normalRefresh = null;
    this.forcedRefresh = null;
  }

  /**
   * Get cached dashboard statistics or compute them lazily from PostgreSQL.
   *
   * @param {import('pg').Pool} pool
   * @param {Object} [options]
   * @param {boolean} [options.fresh=false]
   * @returns {Promise<Object>}
   */
  async get(pool, options = {}) {
    const fresh = options.fresh === true || options.fresh === 'true';
    const now = this.clock();

    if (!fresh && this.cached && now < this.cached.expiresAt) {
      return this.cached.stats;
    }

    if (fresh) {
      if (!this.forcedRefresh) {
        const precedingRefresh = this.normalRefresh;
        this.forcedRefresh = (async () => {
          if (precedingRefresh) await precedingRefresh;
          return this.#computeCurrentStats(pool);
        })().finally(() => {
          this.forcedRefresh = null;
        });
      }
      return this.forcedRefresh;
    }

    if (this.forcedRefresh) return this.forcedRefresh;
    if (!this.normalRefresh) {
      this.normalRefresh = this.#computeCurrentStats(pool).finally(() => {
        this.normalRefresh = null;
      });
    }
    return this.normalRefresh;
  }

  async #computeCurrentStats(pool) {
    const maximumAttempts = 3;
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      const startVersion = this.invalidationVersion;
      const stats = await this.compute(pool, this.clock);
      const completedAt = this.clock();

      if (this.invalidationVersion === startVersion) {
        this.cached = {
          stats,
          expiresAt: completedAt + this.ttlMs,
          version: startVersion,
        };
        return stats;
      }
    }

    throw new Error('Dashboard statistics changed repeatedly while being computed; retry the request.');
  }

  /**
   * Invalidate the current cached statistics immediately and increment the version counter.
   */
  invalidate() {
    this.cached = null;
    this.invalidationVersion += 1;
  }
}

/** Community totals retain their TTL; both consumers share 30-second queue counts. */
export class DashboardStatsCache extends DashboardQueryCache {
  constructor(options = {}) {
    super({ ...options, compute: computeStats });
    this.queueCountsCache = new DashboardQueryCache({
      ttlMs: 30_000,
      clock: this.clock,
      compute: loadWorkQueueCounts,
    });
  }

  getStats(pool, options = {}) {
    return this.get(pool, options);
  }

  getQueueCounts(pool, options = {}) {
    return this.queueCountsCache.get(pool, options);
  }

  invalidate() {
    super.invalidate();
    this.queueCountsCache.invalidate();
  }
}

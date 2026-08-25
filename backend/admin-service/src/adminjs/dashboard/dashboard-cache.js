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

export class DashboardStatsCache {
  /**
   * @param {Object} [options]
   * @param {number} [options.ttlMs=120000]
   * @param {() => number} [options.clock=Date.now]
   */
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? 120_000;
    this.clock = options.clock ?? (() => Date.now());
    this.cached = null;
    this.invalidationVersion = 0;
  }

  /**
   * Get cached dashboard statistics or compute them lazily from PostgreSQL.
   *
   * @param {import('pg').Pool} pool
   * @param {Object} [options]
   * @param {boolean} [options.fresh=false]
   * @returns {Promise<Object>}
   */
  async getStats(pool, options = {}) {
    const fresh = options.fresh === true || options.fresh === "true";
    const now = this.clock();

    if (!fresh && this.cached && now < this.cached.expiresAt) {
      return this.cached.stats;
    }

    const startVersion = this.invalidationVersion;
    const stats = await computeStats(pool, this.clock);

    // If an invalidation or mutation occurred while computing, do NOT populate the cache.
    if (this.invalidationVersion === startVersion) {
      this.cached = {
        stats,
        computedAt: now,
        expiresAt: now + this.ttlMs,
        version: startVersion,
      };
    }

    return stats;
  }

  /**
   * Invalidate the current cached statistics immediately and increment the version counter.
   */
  invalidate() {
    this.cached = null;
    this.invalidationVersion += 1;
  }
}

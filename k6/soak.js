/**
 * k6/soak.js — Soak test
 *
 * 30 VUs · 30 minutes
 *
 * Goals:
 *  1. Verify p99 is STABLE over 30 min (no upward drift = no memory leak).
 *  2. Observe ViewFlushCron effect — periodic p99 spikes at t+3m, t+6m, ...
 *     If spikes exceed 500 ms, consider increasing the cron interval or
 *     batching the flush during low-traffic windows.
 *  3. Confirm the in-memory viewBuffer doesn't grow unbounded.
 *  4. Verify the DB connection pool doesn't leak
 *     (watch Railway metrics: connections in use should stay ≤ DB_POOL_MAX=20).
 *
 * For time-series visualization, export to InfluxDB + Grafana:
 *   k6 run --env BASE_URL=https://your-test.railway.app \
 *          --out influxdb=http://localhost:8086/k6 \
 *          k6/soak.js
 *
 * Then import Grafana dashboard ID 2587 (official k6 dashboard).
 * Graph `p99` over time — a flat line is healthy; a rising line means a leak.
 *
 * Duration must be > 2× ViewFlushCron interval (>6 min) to catch at least
 * two cron spikes. 30 minutes gives you 10 cron cycles to examine.
 */

import { sleep } from 'k6';

import { getToken } from './lib/auth.js';
import { randomGovernorate, randomRescuePostId } from './lib/fixtures.js';
import { helpFeedNoGeo, adoptFeedHot } from './queries/feeds.js';
import { recordView, getMe } from './queries/mutations.js';

export const options = {
  vus:      30,
  duration: '30m',
  thresholds: {
    http_req_failed:   ['rate<0.01'],   // error rate must stay below 1 %
    http_req_duration: ['p(95)<1000'],  // p95 must stay below 1 s throughout
    // NOTE: p99 drift is NOT enforced here as a threshold — you must
    // observe it visually in Grafana over time. A threshold only checks
    // the final aggregate value, not the trend.
  },
};

export default function () {
  const token = getToken();
  const gov   = randomGovernorate();

  // Traffic mix mirrors production (read-heavy, some engagement, some auth)
  const r = Math.random();

  if (r < 0.50) {
    // 50 % — helpFeed (most common screen in the app)
    helpFeedNoGeo(token, gov);
  } else if (r < 0.75) {
    // 25 % — adoptFeed
    adoptFeedHot(token, gov);
  } else if (r < 0.90) {
    // 15 % — recordView (feeds the ViewFlushCron buffer; critical for cron spike visibility)
    recordView(token, randomRescuePostId());
  } else {
    // 10 % — me
    getMe(token);
  }

  // Think time: 1–2 s (realistic user pacing; avoids hammering at full rate)
  sleep(1 + Math.random());
}

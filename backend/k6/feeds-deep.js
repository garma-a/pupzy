/**
 * k6/feeds-deep.js — PostGIS isolation test
 *
 * Measures helpFeed latency WITH and WITHOUT viewer location in isolation,
 * so you can quantify the exact ST_DWithin / ST_Distance overhead.
 *
 * Custom metrics `feed_geo_latency` and `feed_no_geo_latency` report
 * p50 / p95 / p99 separately for the two code paths.
 *
 * Run:
 *   k6 run --env BASE_URL=https://your-test.railway.app k6/feeds-deep.js
 *
 * Interpretation:
 *   • If `feed_geo_latency p95` > 1200 ms: the GIST index on `coordinates`
 *     may not be used → run EXPLAIN ANALYZE on the query in psql.
 *   • The ratio feed_geo_latency / feed_no_geo_latency is the raw ST_DWithin
 *     multiplier. Expect 2–3×. More than 4× suggests a missing index.
 */

import { sleep, group } from 'k6';
import { Trend } from 'k6/metrics';

import { getToken } from './lib/auth.js';
import { fixtures } from './lib/fixtures.js';
import { helpFeedNoGeo, helpFeedWithGeo } from './queries/feeds.js';

// Custom Trend metrics for the two code paths
const geoLatency   = new Trend('feed_geo_latency',    true); // `true` = emit percentiles
const noGeoLatency = new Trend('feed_no_geo_latency', true);

export const options = {
  stages: [
    { duration: '2m', target: 20 }, // ramp up
    { duration: '5m', target: 20 }, // steady state
    { duration: '1m', target: 0  }, // ramp down
  ],
  thresholds: {
    // Custom metric thresholds
    feed_geo_latency:    ['p(95)<1200', 'p(99)<2000'],
    feed_no_geo_latency: ['p(95)<600',  'p(99)<1000'],
    // Standard safety nets
    http_req_failed:   ['rate<0.01'],
  },
};

export default function () {
  const token = getToken();

  // ── Path A: no geo (governorate filter only) ──────────────────────────────
  group('Without viewer location (no ST_DWithin)', () => {
    const start = Date.now();
    helpFeedNoGeo(token, 'Cairo');
    noGeoLatency.add(Date.now() - start);
  });

  sleep(0.5);

  // ── Path B: with geo (triggers ST_DWithin + ST_Distance on PostGIS) ───────
  group('With viewer location (ST_DWithin + ST_Distance)', () => {
    const start = Date.now();
    helpFeedWithGeo(token, 'Cairo', fixtures.cairoCenter, 25);
    geoLatency.add(Date.now() - start);
  });

  sleep(0.5);
}

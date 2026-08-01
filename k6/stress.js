/**
 * k6/stress.js — Stress test (find the breaking point)
 *
 * Stepped ramp: 20 → 50 → 100 → 150 → 200 → 250 VUs, then recovery.
 * Focuses exclusively on the two most expensive code paths:
 *   • helpFeedWithGeo  — heaviest read  (PostGIS ST_DWithin + ST_Distance)
 *   • toggleUpvote     — heaviest write (5-query DB transaction)
 *
 * The point where http_req_failed breaches 5 % or p99 > 5 s is your
 * system's breaking point under current hardware + pool settings.
 *
 * Run:
 *   k6 run --env BASE_URL=https://your-test.railway.app \
 *          --out json=results/stress.json \
 *          k6/stress.js
 *
 * Expected findings:
 *   • DB pool exhaustion (DB_POOL_MAX=20) visible around 80–100 concurrent VUs
 *   • p99 jumps from ~500 ms to 3–5 s when pool queue builds up
 *   • Recovery: p99 should return to baseline within ~30 s after ramp-down
 */

import { sleep } from 'k6';

import { getToken } from './lib/auth.js';
import { fixtures, randomGovernorate, randomAdoptionPostId } from './lib/fixtures.js';
import { helpFeedWithGeo } from './queries/feeds.js';
import { toggleUpvote } from './queries/mutations.js';

export const options = {
  stages: [
    { duration: '3m', target: 20  },  // baseline — confirm system is healthy
    { duration: '3m', target: 50  },  // expected peak load
    { duration: '3m', target: 100 },  // 2× peak — first signs of stress
    { duration: '3m', target: 150 },  // stress zone — pool near saturation
    { duration: '3m', target: 200 },  // approaching limit
    { duration: '3m', target: 250 },  // beyond limit — expect escalating errors
    { duration: '5m', target: 0   },  // recovery — watch p99 return to baseline
  ],
  thresholds: {
    // Relaxed for stress — we expect some degradation; we're looking for collapse
    http_req_failed:   ['rate<0.05'],   // 5 % errors tolerated
    http_req_duration: ['p(99)<5000'],  // system "still alive" if p99 < 5 s
  },
};

export default function () {
  const token = getToken();
  const gov   = randomGovernorate();

  // 70 % geo feed (heaviest read) / 30 % toggleUpvote (heaviest write)
  if (Math.random() < 0.7) {
    helpFeedWithGeo(token, gov, fixtures.cairoCenter, 25);
  } else {
    toggleUpvote(token, randomAdoptionPostId());
  }

  // Minimal think time — maximise concurrency pressure
  sleep(0.2);
}

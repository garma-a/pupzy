/**
 * k6/spike.js — Spike test
 *
 * Simulates: app goes viral / featured on a website → every user opens it at once.
 * Pattern: 0 VUs → 300 VUs in 10 s → hold 1 min → drop → 3 min recovery observation.
 *
 * Goal: verify the server handles a sudden burst without crashing and
 * returns to normal within 2 minutes of the spike subsiding.
 *
 * Spike uses homeFeed (the "just opened the app" request) because that is
 * the first query every new user fires on app launch.
 *
 * Run:
 *   k6 run --env BASE_URL=https://your-test.railway.app k6/spike.js
 *
 * Pass criteria:
 *   • error rate < 10 % during spike peak (some shedding is acceptable)
 *   • p95 < 3 s at peak
 *   • Full recovery (errors drop back to 0, p95 < 800 ms) within 2 min of ramp-down
 */

import { sleep } from 'k6';

import { getToken } from './lib/auth.js';
import { randomGovernorate } from './lib/fixtures.js';
import { homeFeed } from './queries/feeds.js';

export const options = {
  stages: [
    { duration: '30s', target: 0   },  // idle pre-spike (establishes baseline)
    { duration: '10s', target: 300 },  // spike: 0 → 300 VUs in 10 seconds
    { duration: '1m',  target: 300 },  // hold the spike
    { duration: '10s', target: 0   },  // instant drop
    { duration: '3m',  target: 0   },  // recovery observation window
  ],
  thresholds: {
    http_req_failed:   ['rate<0.10'],  // 10 % errors acceptable at spike peak
    http_req_duration: ['p(95)<3000'], // p95 < 3 s is "tolerable" under spike
  },
};

export default function () {
  const token = getToken();
  const gov   = randomGovernorate();

  homeFeed(token, gov);

  sleep(1); // simulate the user staring at the feed for 1 s before scrolling
}

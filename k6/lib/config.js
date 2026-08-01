// k6/lib/config.js
// Shared configuration: base URL, SLA thresholds, and environment helpers.
// Import this in every test orchestrator.

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

/**
 * SLA thresholds — a test run FAILS if any threshold is breached.
 *
 * Tags used for per-endpoint breakdown:
 *   { endpoint: 'health' | 'cities' | 'me' | 'helpFeed' | 'helpFeed_geo'
 *               | 'adoptFeed' | 'marketFeed' | 'homeFeed'
 *               | 'post' | 'postDetail'
 *               | 'recordView' | 'toggleUpvote' | 'toggleSave' | 'createPost' }
 */
export const thresholds = {
  // ── HTTP baseline ─────────────────────────────────────────────────────────
  http_req_failed:   ['rate<0.01'],   // <1 % error rate overall
  http_req_duration: ['p(95)<2000'],  // p95 <2 s (broad safety net)

  // ── Public endpoints (should be trivially fast) ───────────────────────────
  'http_req_duration{endpoint:health}': ['p(99)<50'],    // Health: p99 <50 ms
  'http_req_duration{endpoint:cities}': ['p(99)<200'],   // Cities: p99 <200 ms (cached)

  // ── Me query ──────────────────────────────────────────────────────────────
  'http_req_duration{endpoint:me}': ['p(95)<150', 'p(99)<300'],

  // ── Feed queries (PostGIS) ────────────────────────────────────────────────
  'http_req_duration{endpoint:helpFeed}':     ['p(50)<400', 'p(95)<800',  'p(99)<1500'],
  'http_req_duration{endpoint:adoptFeed}':    ['p(50)<350', 'p(95)<700',  'p(99)<1200'],
  'http_req_duration{endpoint:marketFeed}':   ['p(50)<350', 'p(95)<700',  'p(99)<1200'],
  'http_req_duration{endpoint:homeFeed}':     ['p(50)<400', 'p(95)<800',  'p(99)<1500'],
  'http_req_duration{endpoint:helpFeed_geo}': ['p(50)<600', 'p(95)<1200', 'p(99)<2000'], // with ST_DWithin

  // ── Post detail queries ───────────────────────────────────────────────────
  'http_req_duration{endpoint:post}':       ['p(95)<200', 'p(99)<400'],
  'http_req_duration{endpoint:postDetail}': ['p(95)<150', 'p(99)<300'],

  // ── Mutations ─────────────────────────────────────────────────────────────
  'http_req_duration{endpoint:recordView}':   ['p(95)<100'],            // fire-and-forget
  'http_req_duration{endpoint:toggleUpvote}': ['p(95)<400', 'p(99)<800'],
  'http_req_duration{endpoint:toggleSave}':   ['p(95)<400', 'p(99)<800'],
  'http_req_duration{endpoint:createPost}':   ['p(95)<800', 'p(99)<1500'],
};

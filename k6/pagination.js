/**
 * k6/pagination.js — Cursor-based pagination correctness & latency test
 *
 * 20 VUs · 5 minutes
 *
 * Each VU simulates a user scrolling through 3 pages of adoptFeed:
 *   page 1 → (endCursor) → page 2 → (endCursor) → page 3
 *
 * Validates:
 *  1. Each page returns edges (non-empty result set)
 *  2. No post ID appears on more than one page (cursor correctness)
 *  3. p95 per page < 1 s
 *
 * Run:
 *   k6 run --env BASE_URL=https://your-test.railway.app k6/pagination.js
 */

import { sleep, check } from 'k6';
import { gql } from './lib/gql.js';
import { getToken } from './lib/auth.js';
import { randomGovernorate } from './lib/fixtures.js';

export const options = {
  vus:      20,
  duration: '5m',
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed:   ['rate<0.01'],
    // check failures (e.g. duplicate IDs) also show up in the summary
    checks:            ['rate>0.99'],
  },
};

// Raw query — no gql tag (k6 has no GraphQL client)
const ADOPT_FEED = `
  query AdoptFeed($governorate: String!, $sort: AdoptFeedSort, $first: Int, $after: String) {
    adoptFeed(
      governorate: $governorate
      sort: $sort
      first: $first
      after: $after
    ) {
      edges {
        node { id }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export default function () {
  const token   = getToken();
  const gov     = randomGovernorate();
  const seenIds = new Set();     // tracks IDs across all pages in this iteration
  let   cursor  = null;          // start at page 1 (no cursor)

  for (let page = 1; page <= 3; page++) {
    const res  = gql(ADOPT_FEED, { governorate: gov, sort: 'HOT', first: 20, after: cursor }, token, 'adoptFeed');
    const conn = (res.data && res.data.adoptFeed) ? res.data.adoptFeed : null;

    // ── Basic response checks ─────────────────────────────────────────────
    check(res, {
      [`page ${page}: no GQL errors`]: () => res.ok,
      [`page ${page}: has edges`]:     () => (conn && conn.edges ? conn.edges.length : 0) > 0,
    });

    // ── Pagination correctness: no duplicate IDs across pages ─────────────
    const edges = (conn && conn.edges) ? conn.edges : [];
    const pageIds = edges.map((e) => e.node.id);
    const hasDuplicates = pageIds.some((id) => seenIds.has(id));

    check(
      { hasDuplicates },
      { [`page ${page}: no duplicate post IDs`]: ({ hasDuplicates }) => !hasDuplicates },
    );

    pageIds.forEach((id) => seenIds.add(id));

    // ── Advance cursor or stop if no more pages ───────────────────────────
    if (!conn || !conn.pageInfo || !conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;

    // Simulate the user's scroll delay before loading the next page
    sleep(0.3);
  }

  // Pause between full scroll sessions
  sleep(1);
}

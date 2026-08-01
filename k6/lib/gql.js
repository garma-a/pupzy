// k6/lib/gql.js
// GraphQL POST helper.
// k6 has no GraphQL client library — every operation is a plain HTTP POST with
// Content-Type: application/json and a { query, variables } body.

import http from 'k6/http';
import { check } from 'k6';

const GQL_URL = `${__ENV.BASE_URL || 'http://localhost:3000'}/graphql`;

/**
 * Execute a GraphQL operation (query or mutation).
 *
 * @param {string}      query       - Raw GraphQL document string (NO gql tag)
 * @param {object}      variables   - Variables map (default: empty object)
 * @param {string|null} token       - Firebase ID token; null for public queries
 * @param {string}      endpointTag - Tag value for `{ endpoint: ... }` metric breakdown
 * @returns {{ data: any, errors: any[], ok: boolean, status: number }}
 */
export function gql(query, variables = {}, token = null, endpointTag = 'unknown') {
  const headers = {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = http.post(
    GQL_URL,
    JSON.stringify({ query, variables }),
    {
      headers,
      tags: { endpoint: endpointTag },
    },
  );

  // Guard against completely empty or non-JSON bodies (e.g. 502 from proxy)
  let body = {};
  try {
    body = JSON.parse(res.body || '{}');
  } catch {
    // body stays {}
  }

  const errors = body.errors ?? [];
  const ok     = res.status === 200 && errors.length === 0;

  check(res, {
    [`${endpointTag} status 200`]:    (r) => r.status === 200,
    [`${endpointTag} no GQL errors`]: ()  => errors.length === 0,
  });

  // Only log errors at init/setup level to avoid per-VU console noise.
  // In VU context we keep this silent — check failures are surfaced by k6 summary.

  return { data: body.data, errors, ok, status: res.status };
}

/**
 * Convenience wrapper for unauthenticated (public) queries.
 *
 * @param {string} query
 * @param {object} variables
 * @param {string} tag
 */
export const gqlPublic = (query, variables = {}, tag = 'unknown') =>
  gql(query, variables, null, tag);

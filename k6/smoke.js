/**
 * k6/smoke.js — Smoke test
 *
 * 1 VU · 2 minutes
 *
 * Goal: Verify that every endpoint responds correctly with zero errors.
 * Run this FIRST after deploying to the test environment.
 * A failing smoke test means something is fundamentally broken — don't
 * proceed to load / stress tests until smoke passes.
 *
 * Run:
 *   k6 run --env BASE_URL=https://your-test.railway.app k6/smoke.js
 */

import { sleep } from 'k6';
import http from 'k6/http';
import { check } from 'k6';

import { BASE_URL, thresholds } from './lib/config.js';
import { getToken } from './lib/auth.js';
import {
  fixtures,
  randomGovernorate,
  randomRescuePostId,
  randomAdoptionPostId,
  randomProductPostId,
} from './lib/fixtures.js';

import { helpFeedNoGeo, adoptFeedHot, marketFeedHot, homeFeed } from './queries/feeds.js';
import { getPost, getRescueDetail, getAdoptionDetail, getProductDetail } from './queries/post-detail.js';
import { recordView, toggleUpvote, toggleSave, getMe, getCities } from './queries/mutations.js';

export const options = {
  vus:        1,
  duration:   '2m',
  thresholds,
};

export default function () {
  const token = getToken();
  const gov   = randomGovernorate();

  // ── 1. Health endpoint (REST GET) ─────────────────────────────────────────
  const health = http.get(`${BASE_URL}/health`, { tags: { endpoint: 'health' } });
  check(health, { 'health 200': (r) => r.status === 200 });

  // ── 2. Public cities query (cached after first call) ──────────────────────
  getCities();

  // ── 3. Authenticated: me ──────────────────────────────────────────────────
  getMe(token);

  // ── 4. All four feed variants ─────────────────────────────────────────────
  helpFeedNoGeo(token, gov);
  adoptFeedHot(token, gov);
  marketFeedHot(token, gov);
  homeFeed(token, gov);

  // ── 5. Post detail — one of each type ────────────────────────────────────
  const rescueId    = randomRescuePostId();
  const adoptionId  = randomAdoptionPostId();
  const productId   = randomProductPostId();

  getPost(token, rescueId);
  getRescueDetail(token, rescueId);

  getPost(token, adoptionId);
  getAdoptionDetail(token, adoptionId);

  getPost(token, productId);
  getProductDetail(token, productId);

  // ── 6. Engagement mutations ────────────────────────────────────────────────
  // recordView is fire-and-forget (in-memory buffer only)
  recordView(token, rescueId);

  // toggleUpvote / toggleSave on an adoption post (not the user's own post)
  toggleUpvote(token, adoptionId);
  toggleSave(token, adoptionId);

  // ── Think time ─────────────────────────────────────────────────────────────
  sleep(1);
}

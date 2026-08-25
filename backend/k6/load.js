/**
 * k6/load.js — Realistic load test
 *
 * Ramp: 0 → 10 → 30 → 50 VUs over 12 minutes, then ramp down.
 * Traffic distribution mirrors observed production patterns.
 *
 * Run:
 *   k6 run --env BASE_URL=https://your-test.railway.app \
 *          --out json=results/load.json \
 *          k6/load.js
 *
 * Pass criteria (enforced via thresholds in config.js):
 *   • p95 < 800 ms on feed queries
 *   • p95 < 400 ms on post detail
 *   • error rate < 1 %
 */

import { sleep } from 'k6';

import { thresholds } from './lib/config.js';
import { getToken } from './lib/auth.js';
import {
  fixtures,
  randomGovernorate,
  randomRescuePostId,
  randomAdoptionPostId,
  randomProductPostId,
} from './lib/fixtures.js';

import {
  helpFeedNoGeo,
  helpFeedWithGeo,
  adoptFeedHot,
  adoptFeedNewest,
  marketFeedHot,
  homeFeed,
} from './queries/feeds.js';
import {
  getPost,
  getRescueDetail,
  getAdoptionDetail,
  getProductDetail,
} from './queries/post-detail.js';
import { recordView, toggleUpvote, toggleSave, getMe } from './queries/mutations.js';

export const options = {
  stages: [
    { duration: '2m', target: 10 },  // gentle ramp-up
    { duration: '3m', target: 30 },  // ramp to medium load
    { duration: '5m', target: 50 },  // hold at production target
    { duration: '2m', target: 0  },  // ramp down
  ],
  thresholds,
};

/**
 * Weighted scenario selection.
 * Weights (must sum to 100):
 *   40 % → feed queries      (the dominant real-world action)
 *   20 % → post detail view  (tap into a post from the feed)
 *   15 % → me                (profile page / session refresh)
 *   15 % → engagement        (recordView, toggleUpvote, toggleSave)
 *   10 % → other             (pagination, newer sort)
 */
function pickScenario() {
  const r = Math.random() * 100;
  if (r < 40)  return 'feeds';
  if (r < 60)  return 'detail';
  if (r < 75)  return 'me';
  if (r < 90)  return 'engagement';
  return 'other';
}

export default function () {
  const token    = getToken();
  const gov      = randomGovernorate();
  const scenario = pickScenario();

  switch (scenario) {

    // ── Feed queries (40 %) ──────────────────────────────────────────────────
    case 'feeds': {
      const r = Math.random();
      if (r < 0.35) {
        // helpFeed: 50 % no-geo / 50 % with-geo — exercises both code paths
        if (Math.random() < 0.5) {
          helpFeedNoGeo(token, gov);
        } else {
          helpFeedWithGeo(token, gov, fixtures.cairoCenter, 25);
        }
      } else if (r < 0.60) {
        adoptFeedHot(token, gov);
      } else if (r < 0.80) {
        marketFeedHot(token, gov);
      } else {
        homeFeed(token, gov);
      }
      break;
    }

    // ── Post detail (20 %) ───────────────────────────────────────────────────
    case 'detail': {
      const r = Math.random();
      if (r < 0.50) {
        const id = randomRescuePostId();
        getPost(token, id);
        getRescueDetail(token, id);
      } else if (r < 0.80) {
        const id = randomAdoptionPostId();
        getPost(token, id);
        getAdoptionDetail(token, id);
      } else {
        const id = randomProductPostId();
        getPost(token, id);
        getProductDetail(token, id);
      }
      break;
    }

    // ── Me (15 %) ────────────────────────────────────────────────────────────
    case 'me':
      getMe(token);
      break;

    // ── Engagement (15 %) ────────────────────────────────────────────────────
    case 'engagement': {
      const r = Math.random();
      if (r < 0.60) {
        recordView(token, randomRescuePostId());
      } else if (r < 0.80) {
        toggleUpvote(token, randomAdoptionPostId());
      } else {
        toggleSave(token, randomAdoptionPostId());
      }
      break;
    }

    // ── Other (10 %) — pagination / alternate sorts ───────────────────────────
    case 'other':
      adoptFeedNewest(token, gov);
      break;
  }

  // Think time: 0.5–2 s per iteration (mirrors realistic user pacing)
  sleep(0.5 + Math.random() * 1.5);
}

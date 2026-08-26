import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import AdminJSExpress from '@adminjs/express';
import bcrypt from 'bcryptjs';
import connectPgSimple from 'connect-pg-simple';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';

import { buildAdminJs } from '../src/adminjs/index.js';
import { buildAuthenticate } from '../src/auth/authenticate.js';
import { buildCsrfProtection } from '../src/middleware/csrf.js';
import { requireSameOrigin } from '../src/middleware/same-origin.js';
import { buildRequestTriggeredSessionPruning } from '../src/middleware/session-pruning.js';
import { TestDatabaseHelper, insertPost, seedPrincipals } from './test-database.helper.js';

const database = new TestDatabaseHelper();
let server;
let baseUrl;
let sqlAdapterPool;
let principals;
let superCookie;
let staffCookie;
let superCsrf;
let staffCsrf;
let mockTime = 1_700_000_000_000;
let adminApp;

async function login(email, password) {
  const loginPage = await fetch(`${baseUrl}/admin/login`);
  const csrfCookie = loginPage.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('XSRF-TOKEN='))
    ?.split(';', 1)[0];
  const csrfToken = decodeURIComponent(csrfCookie?.split('=', 2)[1] ?? '');
  const response = await fetch(`${baseUrl}/admin/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: baseUrl,
      cookie: csrfCookie,
    },
    body: new URLSearchParams({ email, password }),
  });
  return {
    response,
    cookie: response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('pupzy_admin_test='))
      ?.split(';', 1)[0],
    csrf: { cookie: csrfCookie, token: csrfToken },
  };
}

async function getDashboard(params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = `${baseUrl}/admin/api/dashboard${query ? `?${query}` : ''}`;
  const response = await fetch(url, {
    headers: { cookie: superCookie },
  });
  assert.equal(response.status, 200, `GET ${url} failed`);
  return response.json();
}

async function postAction(url, payload = {}, cookie = superCookie) {
  const csrf = cookie === staffCookie ? staffCsrf : superCsrf;
  const response = await fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers: {
      cookie: `${cookie}; ${csrf.cookie}`,
      origin: baseUrl,
      'x-xsrf-token': csrf.token,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  return {
    status: response.status,
    data,
  };
}

before(async () => {
  const connectionString = await database.start();
  principals = await seedPrincipals(database.pool);
  const superHash = await bcrypt.hash('super secure password', 4);
  const staffHash = await bcrypt.hash('staff secure password', 4);
  await database.pool.query(`UPDATE admin_users SET password_hash = $2 WHERE id = $1`, [principals.adminId, superHash]);
  await database.pool.query(
    `INSERT INTO admin_users (email, password_hash, full_name, role)
     VALUES ('staff@example.com', $1, 'Staff Admin', 'ADMIN')`,
    [staffHash],
  );

  const databaseName = new URL(connectionString).pathname.replace(/^\//, '');
  const built = await buildAdminJs(connectionString, databaseName, database.pool, {
    ttlMs: 120_000,
    clock: () => mockTime,
  });
  sqlAdapterPool = built.sqlAdapterPool;
  adminApp = built;

  const app = express();
  app.set('trust proxy', 1);
  app.use('/admin', requireSameOrigin);
  app.use('/admin', buildCsrfProtection('a test CSRF signing secret at least 32 chars'));
  app.use(
    '/admin/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (request) => request.method !== 'POST',
      skipSuccessfulRequests: true,
    }),
  );
  app.use(
    '/admin/api/dashboard',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 30,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(
    '/admin/api/resources',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 60,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (request) => ['GET', 'HEAD', 'OPTIONS'].includes(request.method),
    }),
  );
  const PgSession = connectPgSimple(session);
  const sessionStore = new PgSession({
    pool: database.pool,
    createTableIfMissing: false,
    pruneSessionInterval: false,
    tableName: 'admin_sessions',
  });
  app.use('/admin', buildRequestTriggeredSessionPruning(sessionStore));
  app.use(
    '/admin',
    AdminJSExpress.buildAuthenticatedRouter(
      built.admin,
      {
        authenticate: buildAuthenticate(database.pool),
        cookiePassword: 'a test cookie password at least 32 chars',
        cookieName: 'pupzy_admin_test',
      },
      null,
      {
        store: sessionStore,
        resave: false,
        saveUninitialized: false,
        secret: 'a test session secret at least 32 chars',
        cookie: { httpOnly: true, sameSite: 'lax' },
      },
      {
        maxFileSize: 1024 * 1024,
        maxFieldsSize: 64 * 1024,
        maxFields: 100,
      },
    ),
  );
  app.get('/health', (_req, res) => res.json({ ok: true }));

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const superLogin = await login('admin@example.com', 'super secure password');
  superCookie = superLogin.cookie;
  superCsrf = superLogin.csrf;
  const staffLogin = await login('staff@example.com', 'staff secure password');
  staffCookie = staffLogin.cookie;
  staffCsrf = staffLogin.csrf;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await sqlAdapterPool?.destroy();
  await database.stop();
});

describe('AdminJS Redis-free dashboard and cache invalidation HTTP behavior', () => {
  it('serves health and authenticated dashboard without Redis', async () => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });

    const dashboard = await getDashboard();
    assert.ok(dashboard.stats);
    assert.ok(dashboard.stats.computedAt);
    assert.ok(Array.isArray(dashboard.needsReview));
  });

  it('reuses cached stats within 120 seconds and recomputes after TTL expiry', async () => {
    mockTime = 1_700_000_000_000;
    const first = await getDashboard();
    const firstComputedAt = first.stats.computedAt;
    assert.equal(firstComputedAt, new Date(mockTime).toISOString());

    // Request within TTL (e.g. 60 seconds later)
    mockTime += 60_000;
    const second = await getDashboard();
    assert.equal(second.stats.computedAt, firstComputedAt, 'must reuse cached stats within TTL');

    // Request after TTL expiry (e.g. 121 seconds from initial)
    mockTime += 61_000; // Total 121 seconds elapsed
    const third = await getDashboard();
    assert.notEqual(third.stats.computedAt, firstComputedAt, 'must recompute after TTL expiry');
    assert.equal(third.stats.computedAt, new Date(mockTime).toISOString());
  });

  it('Refresh now (?fresh=true) bypasses unexpired cache and replaces it', async () => {
    mockTime = 1_700_000_500_000;
    const initial = await getDashboard();
    const initialComputedAt = initial.stats.computedAt;

    // Advance 5 seconds (well within TTL)
    mockTime += 5_000;
    const refreshed = await getDashboard({ fresh: 'true' });
    assert.notEqual(refreshed.stats.computedAt, initialComputedAt);
    assert.equal(refreshed.stats.computedAt, new Date(mockTime).toISOString());

    // Subsequent normal read reuses the newly cached timestamp
    mockTime += 2_000;
    const subsequent = await getDashboard();
    assert.equal(subsequent.stats.computedAt, refreshed.stats.computedAt);
  });

  it('successful banUser invalidates cache immediately and updates dashboard statistics', async () => {
    // Create an unbanned user
    const userRes = await database.pool.query(
      `INSERT INTO users (firebase_user_id, email, full_name) VALUES ('firebase-to-ban', 'to-ban@example.com', 'To Ban') RETURNING id`,
    );
    const targetUserId = userRes.rows[0].id;

    // Warm cache
    const beforeBan = await getDashboard();
    const bannedBefore = Number(beforeBan.stats.banned_users);

    // Ban user via record action route: /admin/api/resources/users/records/:id/banUser
    const actionRes = await postAction(`/admin/api/resources/users/records/${targetUserId}/banUser`, {
      reason: 'Violated terms of service',
    });
    assert.equal(actionRes.status, 200);
    assert.equal(actionRes.data?.notice?.type, 'success');

    // Next dashboard view immediately reflects the ban without waiting for TTL
    const afterBan = await getDashboard();
    assert.notEqual(afterBan.stats.computedAt, beforeBan.stats.computedAt);
    assert.equal(Number(afterBan.stats.banned_users), bannedBefore + 1);
  });

  it('successful unbanUser invalidates cache immediately and updates dashboard statistics', async () => {
    // Ensure we have a banned user
    const userRes = await database.pool.query(`SELECT id FROM users WHERE is_banned = true LIMIT 1`);
    const targetUserId = userRes.rows[0].id;

    // Warm cache
    const beforeUnban = await getDashboard();
    const bannedBefore = Number(beforeUnban.stats.banned_users);

    // Unban user via record action route: /admin/api/resources/users/records/:id/unbanUser
    const actionRes = await postAction(`/admin/api/resources/users/records/${targetUserId}/unbanUser`, {});
    assert.equal(actionRes.status, 200);
    assert.equal(actionRes.data?.notice?.type, 'success');

    // Advance clock so computedAt changes
    mockTime += 1_000;

    // Next dashboard view reflects unbanned count
    const afterUnban = await getDashboard();
    assert.notEqual(afterUnban.stats.computedAt, beforeUnban.stats.computedAt);
    assert.equal(Number(afterUnban.stats.banned_users), bannedBefore - 1);
  });

  it('custom moderation post actions (approve, flag, remove, restore) invalidate cache immediately', async () => {
    const postId = await insertPost(database.pool, {
      ...principals,
      moderationStatus: 'PENDING_AUTO_REVIEW',
      status: 'ACTIVE',
    });

    // 1. Approve post: /admin/api/resources/posts/records/:id/approvePost
    mockTime += 1_000;
    let dash = await getDashboard({ fresh: 'true' });
    let needsReviewBefore = Number(dash.stats.needs_review_posts);

    let res = await postAction(`/admin/api/resources/posts/records/${postId}/approvePost`);
    assert.equal(res.status, 200);
    assert.equal(res.data?.notice?.type, 'success');

    mockTime += 1_000;
    dash = await getDashboard();
    assert.equal(Number(dash.stats.needs_review_posts), needsReviewBefore - 1);

    // 2. Flag post: /admin/api/resources/posts/records/:id/flagPost
    let flaggedBefore = Number(dash.stats.flagged_posts);
    res = await postAction(`/admin/api/resources/posts/records/${postId}/flagPost`, {
      reason: 'Suspicious listing',
    });
    assert.equal(res.status, 200);
    assert.equal(res.data?.notice?.type, 'success');

    mockTime += 1_000;
    dash = await getDashboard();
    assert.equal(Number(dash.stats.flagged_posts), flaggedBefore + 1);

    // 3. Remove post: /admin/api/resources/posts/records/:id/removePost
    let activeBefore = Number(dash.stats.active_posts);
    res = await postAction(`/admin/api/resources/posts/records/${postId}/removePost`, {
      reason: 'Policy violation',
    });
    assert.equal(res.status, 200);
    assert.equal(res.data?.notice?.type, 'success');

    mockTime += 1_000;
    dash = await getDashboard();
    assert.equal(Number(dash.stats.active_posts), activeBefore - 1);

    // 4. Restore post: /admin/api/resources/posts/records/:id/restorePost
    res = await postAction(`/admin/api/resources/posts/records/${postId}/restorePost`);
    assert.equal(res.status, 200);
    assert.equal(res.data?.notice?.type, 'success');

    mockTime += 1_000;
    dash = await getDashboard();
    assert.equal(Number(dash.stats.active_posts), activeBefore);
  });

  it('built-in AdminJS mutations invalidate cache immediately', async () => {
    // Warm cache
    const beforeEdit = await getDashboard();

    // Edit an admin user via built-in edit action route: /admin/api/resources/admin_users/records/:id/edit
    const editRes = await postAction(`/admin/api/resources/admin_users/records/${principals.adminId}/edit`, {
      full_name: 'Updated Super Admin Name',
    });
    assert.equal(editRes.status, 200);
    assert.equal(editRes.data?.notice?.type, 'success');

    // Dashboard cache was invalidated
    mockTime += 1_000;
    const afterEdit = await getDashboard();
    assert.notEqual(afterEdit.stats.computedAt, beforeEdit.stats.computedAt);
  });

  it('failed, rejected, and unauthorized mutations do not invalidate cache', async () => {
    // Warm cache
    mockTime = 1_700_001_000_000;
    const dash1 = await getDashboard();
    const timestamp1 = dash1.stats.computedAt;

    // 1. Validation failure (empty ban reason)
    mockTime += 1_000;
    const failRes = await postAction(`/admin/api/resources/users/records/${principals.userId}/banUser`, {
      reason: '   ',
    });
    assert.equal(failRes.data?.notice?.type, 'error');

    const dash2 = await getDashboard();
    assert.equal(dash2.stats.computedAt, timestamp1, 'validation failure must not invalidate cache');

    // 2. Unauthorized action (staff trying to edit admin_users without permission)
    mockTime += 1_000;
    const unauthRes = await postAction(
      `/admin/api/resources/admin_users/records/${principals.adminId}/edit`,
      { full_name: 'Hacked' },
      staffCookie,
    );
    assert.equal(unauthRes.data?.notice?.type, 'error');

    const dash3 = await getDashboard();
    assert.equal(dash3.stats.computedAt, timestamp1, 'unauthorized mutation must not invalidate cache');
  });

  it('read-only actions do not invalidate cache', async () => {
    mockTime = 1_700_002_000_000;
    const initial = await getDashboard();
    const initialTimestamp = initial.stats.computedAt;

    // Read list
    mockTime += 1_000;
    const listRes = await fetch(`${baseUrl}/admin/api/resources/users/actions/list`, {
      headers: { cookie: superCookie },
    });
    assert.equal(listRes.status, 200);

    // Read show
    mockTime += 1_000;
    const showRes = await fetch(`${baseUrl}/admin/api/resources/users/records/${principals.userId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(showRes.status, 200);

    const afterReads = await getDashboard();
    assert.equal(afterReads.stats.computedAt, initialTimestamp, 'read-only actions must not invalidate cache');
  });

  it('posts needing review queue remains uncached and reflects changes on next dashboard request', async () => {
    const postId = await insertPost(database.pool, {
      ...principals,
      title: 'Immediate Review Post',
      moderationStatus: 'PENDING_AUTO_REVIEW',
      status: 'ACTIVE',
    });

    // Verify it appears in needsReview
    let dash = await getDashboard();
    assert.ok(dash.needsReview.some((p) => p.id === postId));

    // Approve the post
    const actionRes = await postAction(`/admin/api/resources/posts/records/${postId}/approvePost`);
    assert.equal(actionRes.status, 200);
    assert.equal(actionRes.data?.notice?.type, 'success');

    // Next dashboard request immediately excludes the approved post from needsReview
    dash = await getDashboard();
    assert.equal(
      dash.needsReview.some((p) => p.id === postId),
      false,
      'approved post must be immediately excluded from review queue',
    );
  });

  it('deterministic mutation/computation race test verifies pre-mutation computation does not repopulate cache', async () => {
    let resolveStaleQuery;
    const staleQueryPromise = new Promise((resolve) => {
      resolveStaleQuery = resolve;
    });

    let queryCount = 0;
    const customPool = {
      async query(sql, params) {
        if (sql.includes('count(*) FROM users')) {
          queryCount += 1;
          if (queryCount === 1) {
            await staleQueryPromise;
            return {
              rows: [
                {
                  total_users: '999',
                  banned_users: '0',
                  total_posts: '0',
                  active_posts: '0',
                  needs_review_posts: '0',
                  flagged_posts: '0',
                },
              ],
            };
          }
        }
        return database.pool.query(sql, params);
      },
    };

    const raceBuilt = await buildAdminJs(
      database.connectionString,
      new URL(database.connectionString).pathname.replace(/^\//, ''),
      database.pool,
      { clock: () => mockTime },
    );

    // Start computation before invalidation
    const computationPromise = raceBuilt.cache.getStats(customPool);

    // Mutation occurs (invalidates cache)
    raceBuilt.cache.invalidate();

    // Stale query finishes
    resolveStaleQuery();
    const result = await computationPromise;

    assert.equal(queryCount, 2, 'invalidation must force a post-mutation recomputation');
    assert.notEqual(result.total_users, '999', 'callers must never receive the stale result');

    await raceBuilt.sqlAdapterPool.destroy();
  });

  it('a fresh AdminJS process begins with an empty cache and computes stats from PostgreSQL', async () => {
    const connectionString = database.connectionString;
    const databaseName = new URL(connectionString).pathname.replace(/^\//, '');
    const newProcessMockTime = 1_800_000_000_000;

    const freshBuilt = await buildAdminJs(connectionString, databaseName, database.pool, {
      ttlMs: 120_000,
      clock: () => newProcessMockTime,
    });

    assert.equal(freshBuilt.cache.cached, null, 'new process starts with empty cache');

    const freshHandler = freshBuilt.admin.options.dashboard.handler;
    const result = await freshHandler({ query: {} });

    assert.ok(result.stats);
    assert.equal(result.stats.computedAt, new Date(newProcessMockTime).toISOString());
    assert.ok(freshBuilt.cache.cached, 'populates cache lazily after first request');

    await freshBuilt.sqlAdapterPool.destroy();
  });

  it('rate-limits expensive dashboard requests and resource mutations', async () => {
    let dashboardStatus = 200;
    for (let requestNumber = 1; requestNumber <= 31 && dashboardStatus !== 429; requestNumber += 1) {
      const response = await fetch(`${baseUrl}/admin/api/dashboard`, {
        headers: { cookie: superCookie },
      });
      dashboardStatus = response.status;
    }
    assert.equal(dashboardStatus, 429, 'the dashboard limiter must reject within 31 requests');

    let mutationStatus = 200;
    for (let requestNumber = 1; requestNumber <= 61 && mutationStatus !== 429; requestNumber += 1) {
      const response = await postAction(
        `/admin/api/resources/admin_users/records/${principals.adminId}/edit`,
        { full_name: 'Unauthorized' },
        staffCookie,
      );
      mutationStatus = response.status;
    }
    assert.equal(mutationStatus, 429, 'the mutation limiter must reject within 61 requests');
  });
});

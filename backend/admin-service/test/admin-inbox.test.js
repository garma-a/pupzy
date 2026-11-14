import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import AdminJSExpress from '@adminjs/express';
import bcrypt from 'bcryptjs';
import connectPgSimple from 'connect-pg-simple';
import express from 'express';
import session from 'express-session';

import { buildAdminJs } from '../src/adminjs/index.js';
import { buildAuthenticate } from '../src/auth/authenticate.js';
import { buildCsrfProtection } from '../src/middleware/csrf.js';
import { requireSameOrigin } from '../src/middleware/same-origin.js';
import { TestDatabaseHelper, insertPost, seedPrincipals } from './test-database.helper.js';

const database = new TestDatabaseHelper();
const BUSINESS_TABLES = `
  post_media, post_reports, comment_reports, account_reports, comment_media, comments,
  moderation_actions, posts, users
`;
const originalMediaBase = process.env.COMMENT_MEDIA_CDN_BASE;

let server;
let baseUrl;
let sqlAdapterPool;
let dashboardCache;
let principals;
let staffCookie;
let superCookie;
let userIds;

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
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: baseUrl, cookie: csrfCookie },
    body: new URLSearchParams({ email, password }),
  });
  assert.equal(response.status, 302, `login as ${email}`);
  void csrfToken;
  return response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('pupzy_admin_test='))
    ?.split(';', 1)[0];
}

async function getInbox(params = {}, cookie = superCookie) {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${baseUrl}/admin/api/dashboard${query ? `?${query}` : ''}`, { headers: { cookie } });
  assert.equal(response.status, 200);
  return response.json();
}

const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000);

async function insertUser(label, extra = {}) {
  const { rows } = await database.pool.query(
    `INSERT INTO users (firebase_user_id, email, full_name, profile_picture_url)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [`inbox-${label}`, `${label}@example.com`, extra.name ?? `User ${label}`, extra.picture ?? null],
  );
  return rows[0].id;
}

const post = (title, extra = {}) =>
  insertPost(database.pool, {
    userId: userIds.owner,
    cityId: principals.cityId,
    postType: 'ADOPTION',
    title,
    status: 'ACTIVE',
    moderationStatus: 'CLEAN',
    ...extra,
  });

async function postReport(postId, reporterId, createdAt, extra = {}) {
  const { rows } = await database.pool.query(
    `INSERT INTO post_reports (post_id, reporter_id, reason, created_at, reviewed_at, review_outcome)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [postId, reporterId, extra.reason ?? 'SPAM', createdAt, extra.reviewedAt ?? null, extra.outcome ?? null],
  );
  return rows[0].id;
}

before(async () => {
  process.env.COMMENT_MEDIA_CDN_BASE = 'https://cdn.inbox.test';
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
  const built = await buildAdminJs(connectionString, databaseName, database.pool);
  sqlAdapterPool = built.sqlAdapterPool;
  dashboardCache = built.cache;

  const app = express();
  app.set('trust proxy', 1);
  app.use('/admin/assets', express.static(path.join(import.meta.dirname, '../src/adminjs/public')));
  app.use('/admin', requireSameOrigin);
  app.use('/admin', buildCsrfProtection('a test CSRF signing secret at least 32 chars'));
  const PgSession = connectPgSimple(session);
  const sessionStore = new PgSession({
    pool: database.pool,
    createTableIfMissing: false,
    pruneSessionInterval: false,
    tableName: 'admin_sessions',
  });
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
    ),
  );
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  superCookie = await login('admin@example.com', 'super secure password');
  staffCookie = await login('staff@example.com', 'staff secure password');
});

beforeEach(async () => {
  await database.pool.query(`TRUNCATE TABLE ${BUSINESS_TABLES} CASCADE`);
  userIds = {
    owner: await insertUser('owner', { name: 'Olivia Owner' }),
    r1: await insertUser('r1', { name: 'Reporter One' }),
    r2: await insertUser('r2', { name: 'Reporter Two' }),
    r3: await insertUser('r3', { name: 'Reporter Three' }),
  };
  dashboardCache.invalidate();
});

after(async () => {
  if (originalMediaBase === undefined) delete process.env.COMMENT_MEDIA_CDN_BASE;
  else process.env.COMMENT_MEDIA_CDN_BASE = originalMediaBase;
  if (server) await new Promise((resolve) => server.close(resolve));
  await sqlAdapterPool?.destroy();
  await database.stop();
});

describe('Moderation Inbox endpoint', () => {
  it('requires a signed-in admin and is open to a plain admin', async () => {
    const anonymous = await fetch(`${baseUrl}/admin/api/dashboard`, { redirect: 'manual' });
    assert.notEqual(anonymous.status, 200);
    const asStaff = await getInbox({}, staffCookie);
    assert.deepEqual(asStaff.inbox.items, []);
  });

  it('groups open reports on the same target into one row, oldest report first', async () => {
    const kitten = await post('Kitten under car');
    const other = await post('Other post');
    const oldest = await postReport(kitten, userIds.r1, hoursAgo(30), { reason: 'SCAM' });
    await postReport(kitten, userIds.r2, hoursAgo(5), { reason: 'SPAM' });
    await postReport(kitten, userIds.r3, hoursAgo(2), { reason: 'DUPLICATE' });
    await postReport(other, userIds.r1, hoursAgo(10));

    const { inbox } = await getInbox();
    assert.equal(inbox.total, 2, 'three reports on one Post are one case');
    assert.deepEqual(
      inbox.items.map((item) => item.title),
      ['Kitten under car', 'Other post'],
      'oldest case first',
    );
    const [grouped, single] = inbox.items;
    assert.equal(grouped.reportCount, 3);
    assert.equal(single.reportCount, 1);
    assert.equal(grouped.kind, 'post_report');
    assert.deepEqual(grouped.target, { resource: 'post_reports', id: oldest }, 'the case opens the oldest open report');
    assert.equal(grouped.reasonLabel, 'Scam');
    assert.equal(grouped.reporter.name, 'Reporter One');
    assert.equal(new Date(grouped.since).getTime() < new Date(single.since).getTime(), true);
  });

  it('leaves out closed reports and reads the case from the remaining open ones', async () => {
    const target = await post('Half-handled post');
    await postReport(target, userIds.r1, hoursAgo(20), { reviewedAt: hoursAgo(1), outcome: 'NO_ACTION' });
    const open = await postReport(target, userIds.r2, hoursAgo(3));
    const closedOnly = await post('Fully handled post');
    await postReport(closedOnly, userIds.r1, hoursAgo(9), { reviewedAt: hoursAgo(1), outcome: 'ACTION_TAKEN' });

    const { inbox } = await getInbox();
    assert.equal(inbox.total, 1);
    assert.equal(inbox.items[0].reportCount, 1);
    assert.equal(inbox.items[0].target.id, open);
  });

  it('puts every kind in the list and filters by kind', async () => {
    const reported = await post('Reported post', { createdAt: hoursAgo(50) });
    const flagged = await post('Flagged post', { moderationStatus: 'FLAGGED', createdAt: hoursAgo(40) });
    const pending = await post('Pending post', { moderationStatus: 'PENDING_AUTO_REVIEW', createdAt: hoursAgo(30) });
    await post('Removed flagged post', { moderationStatus: 'FLAGGED', status: 'REMOVED' });
    await post('Clean post');
    await database.pool.query(
      `INSERT INTO post_media (post_id, public_url, cloudflare_storage_key, display_order, width, height, file_content_type, file_size_bytes)
       VALUES ($1, 'https://img.test/flagged.jpg', 'posts/flagged.jpg', 0, 10, 10, 'image/jpeg', 100)`,
      [flagged],
    );
    await postReport(reported, userIds.r1, hoursAgo(20));
    await postReport(flagged, userIds.r2, hoursAgo(19));

    const commentAuthor = await insertUser('author', { name: 'Chatty Author', picture: 'https://img.test/a.jpg' });
    const comment = await database.pool.query(
      `INSERT INTO comments (post_id, author_id, text, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
      [reported, commentAuthor, 'تعليق مسيء'],
    );
    await database.pool.query(
      `INSERT INTO comment_media (comment_id, storage_key, sha256, width, height, file_size_bytes, file_content_type, display_order)
       VALUES ($1, 'comments/x/photo.webp', repeat('a', 64), 10, 10, 100, 'image/webp', 0)`,
      [comment.rows[0].id],
    );
    await database.pool.query(
      `INSERT INTO comment_reports (comment_id, reporter_id, reason, created_at) VALUES ($1, $2, 'INAPPROPRIATE_CONTENT', $3)`,
      [comment.rows[0].id, userIds.r2, hoursAgo(15)],
    );
    await database.pool.query(
      `INSERT INTO account_reports (reporter_id, reported_user_id, reason, created_at) VALUES ($1, $2, 'HARASSMENT', $3)`,
      [userIds.r1, commentAuthor, hoursAgo(10)],
    );

    const all = await getInbox();
    assert.equal(all.inbox.total, 5, 'the flagged Post and its report are one row');
    assert.deepEqual(
      all.inbox.items.map((item) => item.kind),
      ['flagged', 'pending', 'post_report', 'comment_report', 'account_report'],
      'all kinds in one list, oldest first',
    );

    const byKind = Object.fromEntries(all.inbox.items.map((item) => [item.kind, item]));
    assert.equal(byKind.comment_report.thumbnailUrl, 'https://cdn.inbox.test/comments/x/photo.webp');
    assert.equal(byKind.comment_report.title, 'تعليق مسيء');
    assert.equal(byKind.account_report.avatar.name, 'Chatty Author');
    assert.equal(byKind.account_report.avatar.pictureUrl, 'https://img.test/a.jpg');
    assert.equal(byKind.flagged.thumbnailUrl, 'https://img.test/flagged.jpg');
    assert.equal(byKind.flagged.reportCount, 1, 'a flagged Post shows its open reports');
    assert.equal(byKind.flagged.reporter.name, 'Reporter Two');
    assert.equal(byKind.pending.reportCount, 0);
    assert.equal(byKind.pending.reporter, null);
    assert.equal(byKind.pending.kindLabel, 'Pending review');
    assert.deepEqual(byKind.flagged.target, { resource: 'posts', id: flagged });
    assert.equal(byKind.pending.targetId, pending);

    for (const [kind, expected] of [
      ['post_report', 2],
      ['comment_report', 1],
      ['account_report', 1],
      ['flagged', 1],
      ['pending', 1],
    ]) {
      const filtered = await getInbox({ kind });
      assert.equal(filtered.inbox.total, expected, kind);
      assert.ok(
        filtered.inbox.items.every((item) => (kind === 'post_report' ? item.reportCount > 0 : item.kind === kind)),
        `${kind}: every row matches the filter`,
      );
    }
    const unknown = await getInbox({ kind: 'everything' });
    assert.equal(unknown.inbox.total, 5, 'an unknown kind shows everything');
  });

  it('shows a flagged Post with open reports as one row that matches several filters', async () => {
    const flagged = await post('Flagged and reported', {
      moderationStatus: 'FLAGGED',
      createdAt: hoursAgo(50),
    });
    await database.pool.query(`UPDATE posts SET moderated_at = $2, moderation_reason = 'Possible scam' WHERE id = $1`, [
      flagged,
      hoursAgo(40),
    ]);
    const oldest = await postReport(flagged, userIds.r1, hoursAgo(30), { reason: 'SCAM' });
    await postReport(flagged, userIds.r2, hoursAgo(5));

    const all = await getInbox();
    assert.equal(all.inbox.total, 1, 'exactly one row for the Post');
    const [row] = all.inbox.items;
    assert.equal(row.kind, 'flagged');
    assert.equal(row.reportCount, 2);
    assert.equal(row.reasonLabel, 'Scam');
    assert.equal(row.reporter.name, 'Reporter One', 'the oldest report');
    assert.deepEqual(row.target, { resource: 'posts', id: flagged }, 'opens the review workspace');
    assert.equal(
      Math.abs(new Date(row.since).getTime() - hoursAgo(40).getTime()) < 5_000,
      true,
      'sorted by the earlier of the flag time (moderated_at) and the oldest report',
    );
    void oldest;

    for (const kind of ['flagged', 'post_report']) {
      const filtered = await getInbox({ kind });
      assert.equal(filtered.inbox.total, 1, kind);
      assert.equal(filtered.inbox.items[0].targetId, flagged);
      assert.equal(filtered.inbox.items[0].reportCount, 2);
    }
    assert.equal((await getInbox({ kind: 'pending' })).inbox.total, 0);
  });

  it('counts the same open work in the tiles as the lists show', async () => {
    const first = await post('First');
    const second = await post('Second', { moderationStatus: 'FLAGGED' });
    await postReport(first, userIds.r1, hoursAgo(3));
    await postReport(first, userIds.r2, hoursAgo(2));
    await postReport(second, userIds.r1, hoursAgo(1));
    const { queues } = await getInbox();
    const count = (id) => queues.find((queue) => queue.id === id).count;
    assert.equal(count('open_post_reports'), 3, 'the tile counts reports');
    assert.equal(count('flagged'), 1);
    assert.equal(count('pending_moderation'), 0);
  });

  it('orders newest first by the latest open report', async () => {
    const a = await post('Report A');
    const b = await post('Report B');
    await postReport(a, userIds.r1, hoursAgo(40));
    await postReport(a, userIds.r2, hoursAgo(1));
    await postReport(b, userIds.r1, hoursAgo(10));
    assert.deepEqual(
      (await getInbox({ order: 'oldest' })).inbox.items.map((item) => item.title),
      ['Report A', 'Report B'],
    );
    assert.deepEqual(
      (await getInbox({ order: 'newest' })).inbox.items.map((item) => item.title),
      ['Report A', 'Report B'],
      'A has the newest report, so it is first when newest first',
    );
    await postReport(b, userIds.r3, hoursAgo(0.1));
    assert.deepEqual(
      (await getInbox({ order: 'newest' })).inbox.items.map((item) => item.title),
      ['Report B', 'Report A'],
    );
  });

  it('pages 25 cases at a time without repeating or dropping one', async () => {
    for (let index = 0; index < 30; index += 1) {
      const target = await post(`Case ${String(index).padStart(2, '0')}`);
      await postReport(target, userIds.r1, hoursAgo(100 - index));
      if (index % 7 === 0) await postReport(target, userIds.r2, hoursAgo(1));
    }
    const first = await getInbox({ page: '1' });
    const second = await getInbox({ page: '2' });
    assert.equal(first.inbox.items.length, 25);
    assert.equal(second.inbox.items.length, 5);
    assert.equal(first.inbox.total, 30);
    assert.equal(first.inbox.totalPages, 2);
    const titles = [...first.inbox.items, ...second.inbox.items].map((item) => item.title);
    assert.equal(new Set(titles).size, 30);
    assert.deepEqual(titles, [...titles].sort(), 'oldest first across the page boundary');

    const stale = await getInbox({ page: '9' });
    assert.equal(stale.inbox.page, 2, 'a page past the end shows the last page');
    assert.equal(stale.inbox.items.length, 5);
    assert.equal((await getInbox({ page: 'abc' })).inbox.page, 1);
  });

  it('shows an empty inbox when nothing is open', async () => {
    const { inbox } = await getInbox();
    assert.deepEqual(
      { total: inbox.total, items: inbox.items, totalPages: inbox.totalPages },
      {
        total: 0,
        items: [],
        totalPages: 1,
      },
    );
  });
});

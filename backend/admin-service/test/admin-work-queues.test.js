import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import AdminJSExpress from '@adminjs/express';
import bcrypt from 'bcryptjs';
import connectPgSimple from 'connect-pg-simple';
import express from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';

import { buildAdminJs } from '../src/adminjs/index.js';
import { WORK_QUEUES } from '../src/adminjs/dashboard/work-queues.js';
import { buildAuthenticate } from '../src/auth/authenticate.js';
import { buildCsrfProtection } from '../src/middleware/csrf.js';
import { requireSameOrigin } from '../src/middleware/same-origin.js';
import { TestDatabaseHelper, insertPost, seedPrincipals } from './test-database.helper.js';

const database = new TestDatabaseHelper();
let server;
let baseUrl;
let sqlAdapterPool;
let principals;
let superCookie;
let staffCookie;
let fixture;

const BUSINESS_TABLES = `
  post_media, rescue_posts, lost_posts, adoption_posts, product_posts, mating_posts,
  post_upvotes, post_saves, contact_requests, adoption_applications, post_reports, comment_reports, account_reports,
  notifications, moderation_actions, posts, users,
  comments, comment_media, post_pins, comment_boosts, comment_idempotency,
  media_deletion_work, blocked_media_hashes, blocks, account_deletions
`;

async function login(email, password) {
  const loginPage = await fetch(`${baseUrl}/admin/login`);
  const csrfCookie = loginPage.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('XSRF-TOKEN='))
    ?.split(';', 1)[0];
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
  return response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('pupzy_admin_test='))
    ?.split(';', 1)[0];
}

async function insertUser(label) {
  const { rows } = await database.pool.query(
    `INSERT INTO users (firebase_user_id, email, full_name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [`bwg05-${label}`, `${label}@example.com`, `User ${label}`],
  );
  return rows[0].id;
}

async function insertTypedPost({ ownerId, postType, title, reportType = null, status = 'ACTIVE', moderationStatus }) {
  const postId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType,
    title,
    status,
    moderationStatus,
  });
  if (postType === 'LOST' && reportType) {
    if (reportType === 'LOST_PET') {
      await database.pool.query(
        `INSERT INTO lost_posts (post_id, report_type, species, pet_name, date_last_seen)
         VALUES ($1, 'LOST_PET', 'DOG', 'Rex', '2026-08-20')`,
        [postId],
      );
    } else {
      await database.pool.query(
        `INSERT INTO lost_posts
           (post_id, report_type, species, current_condition, is_currently_safe_with_reporter, date_found)
         VALUES ($1, 'FOUND_STRAY', 'DOG', 'HEALTHY', true, '2026-08-20')`,
        [postId],
      );
    }
  }
  return postId;
}

async function insertPostReport({ postId, reporterId, reviewed = false }) {
  const { rows } = await database.pool.query(
    `INSERT INTO post_reports (post_id, reporter_id, reason, details, reviewed_at, reviewed_by_admin_id, review_outcome)
     VALUES ($1, $2, 'SPAM', 'Queue test report',
             CASE WHEN $3::boolean THEN now() ELSE NULL END,
             CASE WHEN $3::boolean THEN $4::uuid ELSE NULL END,
             CASE WHEN $3::boolean THEN 'NO_ACTION'::post_report_review_outcome ELSE NULL END)
     RETURNING id`,
    [postId, reporterId, reviewed, principals.adminId],
  );
  return rows[0].id;
}

async function insertComment({ postId, authorId, text }) {
  const { rows } = await database.pool.query(
    `INSERT INTO comments (post_id, author_id, text) VALUES ($1, $2, $3) RETURNING id`,
    [postId, authorId, text],
  );
  return rows[0].id;
}

async function insertCommentReport({ commentId, reporterId, reviewed = false }) {
  const { rows } = await database.pool.query(
    `INSERT INTO comment_reports (comment_id, reporter_id, reason, reviewed_at)
     VALUES ($1, $2, 'SPAM', CASE WHEN $3::boolean THEN now() ELSE NULL END)
     RETURNING id`,
    [commentId, reporterId, reviewed],
  );
  return rows[0].id;
}

async function insertAccountReport({ reporterId, reportedUserId, sourceId, reviewed = false }) {
  const { rows } = await database.pool.query(
    `INSERT INTO account_reports (reporter_id, reported_user_id, reason, source_type, source_id, reviewed_at)
     VALUES ($1, $2, 'HARASSMENT', 'POST', $3, CASE WHEN $4::boolean THEN now() ELSE NULL END)
     RETURNING id`,
    [reporterId, reportedUserId, sourceId, reviewed],
  );
  return rows[0].id;
}

async function fetchDashboard(cookie = superCookie) {
  const response = await fetch(`${baseUrl}/admin/api/dashboard`, { headers: { cookie } });
  assert.equal(response.status, 200, 'the dashboard must load for an authenticated administrator');
  return response.json();
}

async function fetchList(resource, filters = {}, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) query.set(`filters.${key}`, value);
  for (const [key, value] of Object.entries(params)) query.set(key, value);
  const response = await fetch(`${baseUrl}/admin/api/resources/${resource}/actions/list?${query.toString()}`, {
    headers: { cookie: superCookie },
  });
  const body = await response.text();
  assert.equal(response.status, 200, body);
  const data = JSON.parse(body);
  assert.notEqual(data.notice?.type, 'error', body);
  return data;
}

function recordIds(listData) {
  return listData.records.map((record) => record.id ?? record.params.id);
}

async function seedFixture() {
  const ownerId = await insertUser('owner');
  const reporterId = await insertUser('reporter');
  const secondReporterId = await insertUser('reporter-two');

  const posts = {};
  posts.flaggedPost = await insertTypedPost({
    ownerId,
    postType: 'LOST',
    reportType: 'FOUND_STRAY',
    title: 'Flagged found stray',
    moderationStatus: 'FLAGGED',
  });
  posts.flaggedNoReports = await insertTypedPost({
    ownerId,
    postType: 'ADOPTION',
    title: 'Flagged listing without reports',
    moderationStatus: 'FLAGGED',
  });
  posts.flaggedResolved = await insertTypedPost({
    ownerId,
    postType: 'ADOPTION',
    title: 'Flagged but already resolved',
    status: 'RESOLVED',
    moderationStatus: 'FLAGGED',
  });
  posts.pendingPost = await insertTypedPost({
    ownerId,
    postType: 'RESCUE',
    title: 'Pending moderation post',
    moderationStatus: 'PENDING_AUTO_REVIEW',
  });
  posts.approvedWithOpenReport = await insertTypedPost({
    ownerId,
    postType: 'PRODUCT',
    title: 'Approved post with an open report',
    moderationStatus: 'CLEAN',
  });
  posts.approvedNoReport = await insertTypedPost({
    ownerId,
    postType: 'PRODUCT',
    title: 'Approved post with no reports',
    moderationStatus: 'CLEAN',
  });
  posts.rescuePost = await insertTypedPost({
    ownerId,
    postType: 'RESCUE',
    title: 'Active rescue case',
    moderationStatus: 'CLEAN',
  });
  posts.lostPetPost = await insertTypedPost({
    ownerId,
    postType: 'LOST',
    reportType: 'LOST_PET',
    title: 'Lost pet case',
    moderationStatus: 'CLEAN',
  });
  posts.foundStrayPost = await insertTypedPost({
    ownerId,
    postType: 'LOST',
    reportType: 'FOUND_STRAY',
    title: 'Found stray case',
    moderationStatus: 'CLEAN',
  });
  posts.adoptionPost = await insertTypedPost({
    ownerId,
    postType: 'ADOPTION',
    title: 'Active adoption listing',
    moderationStatus: 'CLEAN',
  });
  posts.productPost = await insertTypedPost({
    ownerId,
    postType: 'PRODUCT',
    title: 'Active product listing',
    moderationStatus: 'CLEAN',
  });
  posts.matingPost = await insertTypedPost({
    ownerId,
    postType: 'MATING',
    title: 'Active mating listing',
    moderationStatus: 'CLEAN',
  });
  posts.completedPost = await insertTypedPost({
    ownerId,
    postType: 'RESCUE',
    title: 'Completed rescue',
    status: 'RESOLVED',
    moderationStatus: 'CLEAN',
  });
  posts.adoptedPost = await insertTypedPost({
    ownerId,
    postType: 'ADOPTION',
    title: 'Adopted listing',
    status: 'ADOPTED',
    moderationStatus: 'CLEAN',
  });
  posts.expiredPost = await insertTypedPost({
    ownerId,
    postType: 'PRODUCT',
    title: 'Expired listing',
    status: 'EXPIRED',
    moderationStatus: 'CLEAN',
  });
  posts.removedPost = await insertTypedPost({
    ownerId,
    postType: 'ADOPTION',
    title: 'Removed listing',
    status: 'REMOVED',
    moderationStatus: 'CLEAN',
  });

  const openPostReportId = await insertPostReport({ postId: posts.flaggedPost, reporterId });
  const approvedOpenReportId = await insertPostReport({
    postId: posts.approvedWithOpenReport,
    reporterId: secondReporterId,
  });
  const reviewedPostReportId = await insertPostReport({
    postId: posts.approvedNoReport,
    reporterId,
    reviewed: true,
  });

  const openCommentId = await insertComment({
    postId: posts.approvedWithOpenReport,
    authorId: ownerId,
    text: 'Comment with an open report',
  });
  const reviewedCommentId = await insertComment({
    postId: posts.approvedNoReport,
    authorId: ownerId,
    text: 'Comment with a reviewed report',
  });
  const openCommentReportId = await insertCommentReport({ commentId: openCommentId, reporterId });
  const reviewedCommentReportId = await insertCommentReport({
    commentId: reviewedCommentId,
    reporterId,
    reviewed: true,
  });

  const openAccountReportId = await insertAccountReport({
    reporterId,
    reportedUserId: ownerId,
    sourceId: posts.approvedWithOpenReport,
  });
  const reviewedAccountReportId = await insertAccountReport({
    reporterId: secondReporterId,
    reportedUserId: ownerId,
    sourceId: posts.approvedNoReport,
    reviewed: true,
  });

  fixture = {
    ownerId,
    ...posts,
    openPostReportId,
    approvedOpenReportId,
    reviewedPostReportId,
    openCommentReportId,
    reviewedCommentReportId,
    openAccountReportId,
    reviewedAccountReportId,
  };
}

const EXPECTED_QUEUE_COUNTS = {
  flagged: 2,
  pending_moderation: 1,
  open_post_reports: 2,
  open_comment_reports: 1,
  open_account_reports: 1,
  rescue: 2,
  lost_found: 3,
  lost_pet: 1,
  found_stray: 2,
  adoption: 2,
  products: 3,
  mating: 1,
  completed: 3,
  expired: 1,
  removed: 1,
};

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
  const built = await buildAdminJs(connectionString, databaseName, database.pool);
  sqlAdapterPool = built.sqlAdapterPool;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use('/admin/assets', express.static(path.join(import.meta.dirname, '../src/adminjs/public')));
  app.use('/admin', requireSameOrigin);
  app.use('/admin', buildCsrfProtection('a test CSRF signing secret at least 32 chars'));
  const PgSession = connectPgSimple(session);
  app.use(
    '/admin/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (request) => request.method !== 'POST',
    }),
  );
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
        store: new PgSession({
          pool: database.pool,
          createTableIfMissing: false,
          pruneSessionInterval: false,
          tableName: 'admin_sessions',
        }),
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
  assert.ok(superCookie);
  assert.ok(staffCookie);
});

beforeEach(async () => {
  await database.pool.query(`TRUNCATE TABLE ${BUSINESS_TABLES} CASCADE`);
  await seedFixture();
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await sqlAdapterPool?.destroy();
  await database.stop();
});

describe('Admin work-queue navigation over authenticated AdminJS HTTP', () => {
  it('counts every queue with the same predicates as its filtered list page', async () => {
    const dashboard = await fetchDashboard();
    assert.ok(Array.isArray(dashboard.queues), 'the dashboard must expose its work queues');

    for (const queue of WORK_QUEUES) {
      const published = dashboard.queues.find((candidate) => candidate.id === queue.id);
      assert.ok(published, `queue ${queue.id} must be published on the dashboard`);
      assert.deepEqual(published.filters, queue.filters);
      assert.equal(published.count, EXPECTED_QUEUE_COUNTS[queue.id], `queue ${queue.id} must count the seeded work`);

      const list = await fetchList(queue.resource, queue.filters, { perPage: '100' });
      assert.equal(
        Number(list.meta.total),
        published.count,
        `queue ${queue.id} count must equal its filtered list total`,
      );
    }
  });

  it('reaches flagged Posts and keeps them distinct from approved Posts with open Reports', async () => {
    const dashboard = await fetchDashboard();
    const flaggedCount = dashboard.queues.find((queue) => queue.id === 'flagged').count;
    assert.equal(flaggedCount, 2);

    const flagged = await fetchList('posts', { moderation_status: 'FLAGGED', status: 'ACTIVE' });
    assert.deepEqual(new Set(recordIds(flagged)), new Set([fixture.flaggedPost, fixture.flaggedNoReports]));
    assert.equal(
      recordIds(flagged).includes(fixture.approvedWithOpenReport),
      false,
      'an approved Post with an open Report is not a flagged Post',
    );
    assert.equal(
      recordIds(flagged).includes(fixture.flaggedResolved),
      false,
      'a flagged Post that already reached an outcome is not outstanding review work',
    );

    const openPostReports = await fetchList('post_reports', { review_state: 'OPEN' }, { perPage: '100' });
    assert.deepEqual(
      new Set(recordIds(openPostReports)),
      new Set([fixture.openPostReportId, fixture.approvedOpenReportId]),
    );
    assert.equal(recordIds(openPostReports).includes(fixture.reviewedPostReportId), false);

    const flaggedNoReportsRow = dashboard.needsReview.find((post) => post.id === fixture.flaggedNoReports);
    const flaggedWithReportRow = dashboard.needsReview.find((post) => post.id === fixture.flaggedPost);
    assert.equal(Number(flaggedNoReportsRow.open_report_count), 0, 'a flagged Post without Reports shows zero');
    assert.equal(Number(flaggedWithReportRow.open_report_count), 1);

    const approvedRow = dashboard.needsReview.find((post) => post.id === fixture.approvedWithOpenReport);
    assert.equal(approvedRow, undefined, 'approved Posts stay out of the review table');
  });

  it('paginates a large flagged queue with a total that matches the dashboard count', async () => {
    for (let index = 0; index < 12; index += 1) {
      await insertTypedPost({
        ownerId: fixture.ownerId,
        postType: 'RESCUE',
        title: `Extra flagged rescue ${index}`,
        moderationStatus: 'FLAGGED',
      });
    }

    const dashboard = await fetchDashboard();
    const flagged = dashboard.queues.find((queue) => queue.id === 'flagged');
    assert.equal(flagged.count, 14);

    const firstPage = await fetchList('posts', { moderation_status: 'FLAGGED', status: 'ACTIVE' }, { perPage: '10' });
    assert.equal(Number(firstPage.meta.total), 14);
    assert.equal(firstPage.records.length, 10);
    assert.equal(firstPage.meta.page, 1);

    const secondPage = await fetchList(
      'posts',
      { moderation_status: 'FLAGGED', status: 'ACTIVE' },
      { perPage: '10', page: '2' },
    );
    assert.equal(Number(secondPage.meta.total), 14);
    assert.equal(secondPage.records.length, 4);
    assert.equal(secondPage.meta.page, 2);
    const allIds = [...recordIds(firstPage), ...recordIds(secondPage)];
    assert.equal(new Set(allIds).size, 14, 'pagination must not repeat or drop records');
  });

  it('filters Lost & found by the lost-pet and found-stray subtype', async () => {
    const allLost = await fetchList('posts', { post_type: 'LOST', status: 'ACTIVE' }, { perPage: '100' });
    assert.deepEqual(
      new Set(recordIds(allLost)),
      new Set([fixture.lostPetPost, fixture.foundStrayPost, fixture.flaggedPost]),
    );

    const lostPet = await fetchList(
      'posts',
      { post_type: 'LOST', status: 'ACTIVE', report_type: 'LOST_PET' },
      { perPage: '100' },
    );
    assert.deepEqual(recordIds(lostPet), [fixture.lostPetPost]);

    const foundStray = await fetchList(
      'posts',
      { post_type: 'LOST', status: 'ACTIVE', report_type: 'FOUND_STRAY' },
      { perPage: '100' },
    );
    assert.deepEqual(new Set(recordIds(foundStray)), new Set([fixture.foundStrayPost, fixture.flaggedPost]));

    const dashboard = await fetchDashboard();
    assert.equal(dashboard.queues.find((queue) => queue.id === 'lost_pet').count, 1);
    assert.equal(dashboard.queues.find((queue) => queue.id === 'found_stray').count, 2);
  });

  it('keeps completed, expired and removed history views distinct', async () => {
    const completed = await fetchList('posts', { queue: 'completed' }, { perPage: '100' });
    assert.deepEqual(
      new Set(recordIds(completed)),
      new Set([fixture.completedPost, fixture.adoptedPost, fixture.flaggedResolved]),
    );

    const expired = await fetchList('posts', { status: 'EXPIRED' }, { perPage: '100' });
    assert.deepEqual(recordIds(expired), [fixture.expiredPost]);

    const removed = await fetchList('posts', { status: 'REMOVED' }, { perPage: '100' });
    assert.deepEqual(recordIds(removed), [fixture.removedPost]);
  });

  it('filters open Comment and Account Reports by unreviewed records', async () => {
    const commentReports = await fetchList('comment_reports', { review_state: 'OPEN' }, { perPage: '100' });
    assert.deepEqual(recordIds(commentReports), [fixture.openCommentReportId]);

    const reviewedCommentReports = await fetchList('comment_reports', { review_state: 'REVIEWED' }, { perPage: '100' });
    assert.deepEqual(recordIds(reviewedCommentReports), [fixture.reviewedCommentReportId]);

    const accountReports = await fetchList('account_reports', { review_state: 'OPEN' }, { perPage: '100' });
    assert.deepEqual(recordIds(accountReports), [fixture.openAccountReportId]);

    const reviewedAccountReports = await fetchList('account_reports', { review_state: 'REVIEWED' }, { perPage: '100' });
    assert.deepEqual(recordIds(reviewedAccountReports), [fixture.reviewedAccountReportId]);
  });

  it('keeps the existing type, status, urgency, City and date filters working with the queues', async () => {
    const rescue = await fetchList(
      'posts',
      { post_type: 'RESCUE', status: 'ACTIVE', city_id: principals.cityId },
      { perPage: '100' },
    );
    assert.deepEqual(new Set(recordIds(rescue)), new Set([fixture.rescuePost, fixture.pendingPost]));

    const criticalRescue = await fetchList(
      'posts',
      { post_type: 'RESCUE', status: 'ACTIVE', urgency: 'CRITICAL' },
      { perPage: '100' },
    );
    assert.equal(Number(criticalRescue.meta.total), 2, 'the urgency filter still narrows the queue');

    const createdBefore = await fetchList(
      'posts',
      { status: 'ACTIVE', 'created_at~~from': '2000-01-01', 'created_at~~to': '2100-01-01' },
      { perPage: '100' },
    );
    assert.ok(Number(createdBefore.meta.total) >= 1, 'the date range filter still works');
  });

  it('allows a plain ADMIN session to load the dashboard and every queue', async () => {
    const dashboardResponse = await fetch(`${baseUrl}/admin/api/dashboard`, { headers: { cookie: staffCookie } });
    assert.equal(dashboardResponse.status, 200);
    const dashboard = await dashboardResponse.json();
    assert.equal(dashboard.queues.find((queue) => queue.id === 'flagged').count, 2);

    for (const queue of WORK_QUEUES) {
      const response = await fetch(
        `${baseUrl}/admin/api/resources/${queue.resource}/actions/list?filters.${
          Object.keys(queue.filters)[0]
        }=${Object.values(queue.filters)[0]}`,
        { headers: { cookie: staffCookie } },
      );
      assert.equal(response.status, 200, `${queue.id} must load for a plain ADMIN`);
    }
  });

  it('ignores unknown queue filter values instead of failing or emitting column predicates', async () => {
    const response = await fetch(
      `${baseUrl}/admin/api/resources/post_reports/actions/list?filters.review_state=NOT_A_STATE`,
      { headers: { cookie: superCookie } },
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.notEqual(data.notice?.type, 'error');
    assert.equal(Number(data.meta.total), 3, 'the unknown value adds no filter');
  });
});

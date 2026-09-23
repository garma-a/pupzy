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
let superCsrf;
let staffCsrf;
let staffId;

const BUSINESS_TABLES = `
  post_media, rescue_posts, lost_posts, adoption_posts, product_posts, mating_posts,
  post_upvotes, post_saves, contact_requests, adoption_applications, post_reports, comment_reports, account_reports,
  notifications, post_completion_recipients, post_completion_notification_events,
  moderation_actions, posts, users,
  comments, comment_media, post_pins, comment_boosts, comment_idempotency,
  media_deletion_work, blocked_media_hashes, blocks, account_deletions
`;

const RESOLUTION_ACTION_NAMES = ['markRescued', 'markReunited', 'markResolved', 'markAdopted', 'markSold'];
const REOPEN_ACTION_NAME = 'reopenPost';

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
    cookie: response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('pupzy_admin_test='))
      ?.split(';', 1)[0],
    csrf: { cookie: csrfCookie, token: csrfToken },
  };
}

async function insertUser(label) {
  const { rows } = await database.pool.query(
    `INSERT INTO users (firebase_user_id, email, full_name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [`bwg08-${label}`, `${label}@example.com`, `User ${label}`],
  );
  return rows[0].id;
}

async function insertTypedPost({ ownerId, postType, title, reportType = null, status = 'ACTIVE' }) {
  const postId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType,
    title,
    status,
  });
  if (postType === 'LOST') {
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

async function insertContactRequest({ postId, requesterId, status = 'PENDING' }) {
  const { rows } = await database.pool.query(
    `INSERT INTO contact_requests (post_id, requester_id, message, status, responded_at)
     VALUES ($1, $2, 'Please share the owner contact', $3::request_status,
             CASE WHEN $3::text = 'PENDING' THEN NULL ELSE now() END)
     RETURNING id`,
    [postId, requesterId, status],
  );
  return rows[0].id;
}

async function insertAdoptionApplication({ postId, applicantId, status = 'PENDING' }) {
  const { rows } = await database.pool.query(
    `INSERT INTO adoption_applications
       (target_post_id, applicant_id, living_situation, has_outdoor_access, has_other_pets_at_home,
        has_children_at_home, why_adopt, status, responded_at)
     VALUES ($1, $2, 'APARTMENT', true, false, false, 'A loving home for the animal', $3::request_status,
             CASE WHEN $3::text = 'PENDING' THEN NULL ELSE now() END)
     RETURNING id`,
    [postId, applicantId, status],
  );
  return rows[0].id;
}

function postAction(actionName, postId, payload, cookie = superCookie, csrf = superCsrf) {
  return fetch(`${baseUrl}/admin/api/resources/posts/records/${postId}/${actionName}`, {
    method: 'POST',
    headers: {
      cookie: `${cookie}; ${csrf.cookie}`,
      origin: baseUrl,
      'x-xsrf-token': csrf.token,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

async function fetchRecordActions(postId, cookie = superCookie) {
  const response = await fetch(`${baseUrl}/admin/api/resources/posts/records/${postId}/show`, {
    headers: { cookie },
  });
  assert.equal(response.status, 200, 'the authenticated record page must load');
  const data = await response.json();
  return { data, names: data.record.recordActions.map((action) => action.name) };
}

before(async () => {
  const connectionString = await database.start();
  principals = await seedPrincipals(database.pool);
  const superHash = await bcrypt.hash('super secure password', 4);
  const staffHash = await bcrypt.hash('staff secure password', 4);
  await database.pool.query(`UPDATE admin_users SET password_hash = $2 WHERE id = $1`, [principals.adminId, superHash]);
  const staff = await database.pool.query(
    `INSERT INTO admin_users (email, password_hash, full_name, role)
     VALUES ('staff@example.com', $1, 'Staff Admin', 'ADMIN')
     RETURNING id`,
    [staffHash],
  );
  staffId = staff.rows[0].id;

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

  const superLogin = await login('admin@example.com', 'super secure password');
  superCookie = superLogin.cookie;
  superCsrf = superLogin.csrf;
  const staffLogin = await login('staff@example.com', 'staff secure password');
  staffCookie = staffLogin.cookie;
  staffCsrf = staffLogin.csrf;
  assert.ok(superCookie);
  assert.ok(staffCookie);
});

beforeEach(async () => {
  await database.pool.query(`TRUNCATE TABLE ${BUSINESS_TABLES} CASCADE`);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await sqlAdapterPool?.destroy();
  await database.stop();
});

describe('Administrator case resolution HTTP boundary', () => {
  it('exposes only the valid type-specific resolution actions and leaves uncertain cases active', async () => {
    const ownerId = await insertUser('resolution-owner');
    const cases = [
      { postType: 'RESCUE', reportType: null, expected: ['markRescued'] },
      { postType: 'LOST', reportType: 'LOST_PET', expected: ['markReunited'] },
      { postType: 'LOST', reportType: 'FOUND_STRAY', expected: ['markReunited', 'markResolved'] },
      { postType: 'ADOPTION', reportType: null, expected: ['markAdopted'] },
      { postType: 'PRODUCT', reportType: null, expected: ['markSold'] },
      { postType: 'MATING', reportType: null, expected: ['markResolved'] },
    ];

    for (const testCase of cases) {
      const postId = await insertTypedPost({
        ownerId,
        postType: testCase.postType,
        reportType: testCase.reportType,
        title: `${testCase.postType} ${testCase.reportType ?? ''} resolution`,
      });

      const staffView = await fetchRecordActions(postId, staffCookie);
      const staffResolutionActions = RESOLUTION_ACTION_NAMES.filter((name) => staffView.names.includes(name));
      assert.deepEqual(
        staffResolutionActions,
        testCase.expected,
        `${testCase.postType}/${testCase.reportType ?? '-'} must expose exactly its valid outcomes`,
      );
      assert.ok(staffView.names.includes('removePost'), 'removal stays available and distinct from resolution');

      const superView = await fetchRecordActions(postId, superCookie);
      const superResolutionActions = RESOLUTION_ACTION_NAMES.filter((name) => superView.names.includes(name));
      assert.deepEqual(superResolutionActions, testCase.expected, 'SUPER_ADMIN sees the same valid outcomes');
    }

    const resolvedId = await insertTypedPost({
      ownerId,
      postType: 'RESCUE',
      title: 'Already resolved',
      status: 'RESOLVED',
    });
    const removedId = await insertTypedPost({
      ownerId,
      postType: 'ADOPTION',
      title: 'Already removed',
      status: 'REMOVED',
    });
    const expiredId = await insertTypedPost({
      ownerId,
      postType: 'PRODUCT',
      title: 'Already expired',
      status: 'EXPIRED',
    });
    for (const postId of [resolvedId, removedId, expiredId]) {
      const view = await fetchRecordActions(postId);
      const resolutionActions = RESOLUTION_ACTION_NAMES.filter((name) => view.names.includes(name));
      assert.deepEqual(resolutionActions, [], 'recorded, removed and expired Posts expose no resolution action');
    }

    const audits = await database.pool.query(`SELECT count(*)::int AS count FROM moderation_actions`);
    assert.equal(audits.rows[0].count, 0, 'opening the workspace never records an outcome');
    const notifications = await database.pool.query(`SELECT count(*)::int AS count FROM notifications`);
    assert.equal(notifications.rows[0].count, 0);
    const active = await database.pool.query(`SELECT count(*)::int AS count FROM posts WHERE status = 'ACTIVE'`);
    assert.equal(active.rows[0].count, cases.length, 'uncertain cases remain active');
  });

  it('records an audited resolution with a localized owner notification and pending-interaction cleanup', async () => {
    const ownerId = await insertUser('adoption-owner');
    const pendingRequesterId = await insertUser('adoption-pending-requester');
    const approvedRequesterId = await insertUser('adoption-approved-requester');
    const pendingApplicantId = await insertUser('adoption-pending-applicant');
    const approvedApplicantId = await insertUser('adoption-approved-applicant');
    const reporterId = await insertUser('adoption-reporter');
    const postId = await insertTypedPost({ ownerId, postType: 'ADOPTION', title: 'Adoption resolution case' });

    const pendingContact = await insertContactRequest({ postId, requesterId: pendingRequesterId });
    const approvedContact = await insertContactRequest({
      postId,
      requesterId: approvedRequesterId,
      status: 'APPROVED',
    });
    const pendingApplication = await insertAdoptionApplication({ postId, applicantId: pendingApplicantId });
    const approvedApplication = await insertAdoptionApplication({
      postId,
      applicantId: approvedApplicantId,
      status: 'APPROVED',
    });
    const reportId = (
      await database.pool.query(
        `INSERT INTO post_reports (post_id, reporter_id, reason, details)
         VALUES ($1, $2, 'SPAM', 'Open report must stay open')
         RETURNING id`,
        [postId, reporterId],
      )
    ).rows[0].id;

    const response = await postAction('markAdopted', postId, { reason: 'Adoption completed' }, staffCookie, staffCsrf);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.notice?.type, 'success');
    assert.equal(result.notice?.message, 'Post resolution recorded.');

    const post = (
      await database.pool.query(
        `SELECT status, moderation_status, moderation_reason, moderated_by_admin_id FROM posts WHERE id = $1`,
        [postId],
      )
    ).rows[0];
    assert.equal(post.status, 'ADOPTED');
    assert.equal(post.moderation_status, 'PENDING_AUTO_REVIEW');
    assert.equal(post.moderation_reason, null);
    assert.equal(post.moderated_by_admin_id, null);

    const audit = (
      await database.pool.query(
        `SELECT admin_user_id, action_type, target_type, reason, metadata
         FROM moderation_actions WHERE target_id = $1`,
        [postId],
      )
    ).rows[0];
    assert.equal(audit.admin_user_id, staffId);
    assert.equal(audit.action_type, 'POST_RESOLVED');
    assert.equal(audit.target_type, 'POST');
    assert.equal(audit.reason, 'Adoption completed');
    assert.equal(audit.metadata.outcome, 'ADOPTED');
    assert.equal(audit.metadata.terminatedContactRequestCount, 1);
    assert.equal(audit.metadata.terminatedAdoptionApplicationCount, 1);

    const notifications = (
      await database.pool.query(
        `SELECT type, recipient_id, related_post_id, title, body, title_arabic, body_arabic, is_read
         FROM notifications WHERE related_post_id = $1`,
        [postId],
      )
    ).rows;
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].type, 'POST_RESOLVED_BY_ADMIN');
    assert.equal(notifications[0].recipient_id, ownerId);
    assert.equal(notifications[0].is_read, false);
    assert.equal(notifications[0].title, 'Post outcome recorded');
    assert.equal(notifications[0].body, 'An administrator marked your post "Adoption resolution case" as adopted.');
    assert.equal(notifications[0].title_arabic, 'تم تسجيل نتيجة المنشور');
    assert.equal(
      notifications[0].body_arabic,
      'قام أحد المشرفين بتسجيل نتيجة منشورك "Adoption resolution case": تم التبني.',
    );

    const pendingContactRow = (
      await database.pool.query(`SELECT status, responded_at FROM contact_requests WHERE id = $1`, [pendingContact])
    ).rows[0];
    assert.equal(pendingContactRow.status, 'REJECTED');
    assert.ok(pendingContactRow.responded_at);
    const pendingApplicationRow = (
      await database.pool.query(`SELECT status, responded_at FROM adoption_applications WHERE id = $1`, [
        pendingApplication,
      ])
    ).rows[0];
    assert.equal(pendingApplicationRow.status, 'REJECTED');
    assert.ok(pendingApplicationRow.responded_at);

    const approvedContactRow = (
      await database.pool.query(`SELECT status FROM contact_requests WHERE id = $1`, [approvedContact])
    ).rows[0];
    assert.equal(approvedContactRow.status, 'APPROVED', 'approved contact access is retained');
    const approvedApplicationRow = (
      await database.pool.query(`SELECT status FROM adoption_applications WHERE id = $1`, [approvedApplication])
    ).rows[0];
    assert.equal(approvedApplicationRow.status, 'APPROVED', 'approved applications are retained');

    const report = (
      await database.pool.query(`SELECT reviewed_at, review_outcome FROM post_reports WHERE id = $1`, [reportId])
    ).rows[0];
    assert.equal(report.reviewed_at, null, 'resolution is not a moderation takedown: open reports stay open');
    assert.equal(report.review_outcome, null);

    const removalNotifications = await database.pool.query(
      `SELECT count(*)::int AS count FROM notifications WHERE type = 'POST_REMOVED_BY_ADMIN'`,
    );
    assert.equal(removalNotifications.rows[0].count, 0, 'resolution never emits a removal notification');

    const actionsAfter = await fetchRecordActions(postId);
    const resolutionActions = RESOLUTION_ACTION_NAMES.filter((name) => actionsAfter.names.includes(name));
    assert.deepEqual(resolutionActions, [], 'a recorded outcome cannot be resolved twice');
    assert.equal(actionsAfter.names.includes('removePost'), false, 'removal is hidden once an outcome is recorded');
  });

  it('captures and localizes the participant completion event for a non-rescue outcome, and never on removal', async () => {
    const ownerId = await insertUser('sold-owner');
    const buyerId = await insertUser('sold-buyer');
    const otherBuyerId = await insertUser('sold-other-buyer');
    const productId = await insertTypedPost({ ownerId, postType: 'PRODUCT', title: 'Sold product case' });

    await database.pool.query(`INSERT INTO post_saves (post_id, user_id) VALUES ($1, $2), ($1, $3)`, [
      productId,
      buyerId,
      otherBuyerId,
    ]);

    const response = await postAction('markSold', productId, { reason: 'Sold in person' }, staffCookie, staffCsrf);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.notice?.type, 'success');

    const event = (
      await database.pool.query(
        `SELECT type, outcome, post_type, closing_actor_id, title, body, title_arabic, body_arabic, status, total_recipients
         FROM post_completion_notification_events WHERE post_id = $1`,
        [productId],
      )
    ).rows[0];
    assert.equal(event.type, 'POST_COMPLETED');
    assert.equal(event.post_type, 'PRODUCT');
    assert.equal(event.outcome, 'SOLD');
    assert.equal(
      event.closing_actor_id,
      null,
      'AdminJS actors are not app users, so the event stores no closing user; the audit row names the admin',
    );
    assert.equal(event.title, 'Item sold');
    assert.equal(event.body, 'The post "Sold product case" was marked as sold.');
    assert.equal(event.title_arabic, 'تم البيع');
    assert.ok(event.body_arabic.includes('Sold product case'));
    assert.ok(event.body_arabic.includes('تم البيع'));
    assert.equal(event.total_recipients, 2);
    assert.equal(event.status, 'PENDING');

    const recipients = (
      await database.pool.query(`SELECT recipient_id FROM post_completion_recipients WHERE post_id = $1`, [productId])
    ).rows.map((row) => row.recipient_id);
    assert.deepEqual(recipients.sort(), [buyerId, otherBuyerId].sort());
    assert.equal(recipients.includes(ownerId), false, 'the creator is never a completion audience member');

    // Administrator removal is a moderation takedown, not a completion.
    const removedId = await insertTypedPost({ ownerId, postType: 'PRODUCT', title: 'Removed product case' });
    await database.pool.query(`INSERT INTO post_saves (post_id, user_id) VALUES ($1, $2)`, [removedId, buyerId]);
    const removal = await postAction('removePost', removedId, { reason: 'Policy violation' }, staffCookie, staffCsrf);
    assert.equal((await removal.json()).notice?.type, 'success');
    const removalEvents = await database.pool.query(
      `SELECT count(*)::int AS count FROM post_completion_notification_events WHERE post_id = $1`,
      [removedId],
    );
    assert.equal(removalEvents.rows[0].count, 0, 'removal never emits a completion event');
  });

  it('requires an internal reason and rejects invalid, repeated or removed-state resolutions without writes', async () => {
    const ownerId = await insertUser('guard-owner');
    const adoptionId = await insertTypedPost({ ownerId, postType: 'ADOPTION', title: 'Guard adoption' });
    const lostPetId = await insertTypedPost({
      ownerId,
      postType: 'LOST',
      reportType: 'LOST_PET',
      title: 'Guard lost pet',
    });
    const resolvedId = await insertTypedPost({
      ownerId,
      postType: 'MATING',
      title: 'Guard resolved',
      status: 'RESOLVED',
    });
    const removedId = await insertTypedPost({
      ownerId,
      postType: 'PRODUCT',
      title: 'Guard removed',
      status: 'REMOVED',
    });

    const attempts = [
      ['markAdopted', adoptionId, {}, /reason is required/i],
      ['markAdopted', adoptionId, { reason: '   ' }, /reason is required/i],
      ['markRescued', adoptionId, { reason: 'Wrong type' }, /cannot be resolved/i],
      ['markResolved', lostPetId, { reason: 'Wrong target' }, /cannot be resolved/i],
      ['markAdopted', resolvedId, { reason: 'Second outcome' }, /only active/i],
      ['markSold', removedId, { reason: 'Resolve removed' }, /only active/i],
    ];

    for (const [actionName, postId, payload, expectedMessage] of attempts) {
      const response = await postAction(actionName, postId, payload);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.notice?.type, 'error', `${actionName} on ${postId} must be rejected`);
      assert.match(result.notice?.message ?? '', expectedMessage);
    }

    const audits = await database.pool.query(`SELECT count(*)::int AS count FROM moderation_actions`);
    assert.equal(audits.rows[0].count, 0);
    const notifications = await database.pool.query(`SELECT count(*)::int AS count FROM notifications`);
    assert.equal(notifications.rows[0].count, 0);
    const adoption = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [adoptionId])).rows[0];
    assert.equal(adoption.status, 'ACTIVE');
    const lostPet = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [lostPetId])).rows[0];
    assert.equal(lostPet.status, 'ACTIVE');
    const resolved = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [resolvedId])).rows[0];
    assert.equal(resolved.status, 'RESOLVED');
    const removed = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [removedId])).rows[0];
    assert.equal(removed.status, 'REMOVED');
  });

  it('serializes concurrent resolutions into exactly one audited outcome and notification', async () => {
    const ownerId = await insertUser('race-owner');
    const requesterId = await insertUser('race-requester');
    const postId = await insertTypedPost({ ownerId, postType: 'RESCUE', title: 'Concurrent resolution' });
    const contactRequestId = await insertContactRequest({ postId, requesterId });

    const responses = await Promise.all([
      postAction('markRescued', postId, { reason: 'First reviewer' }, staffCookie, staffCsrf),
      postAction('markRescued', postId, { reason: 'Second reviewer' }, superCookie, superCsrf),
    ]);
    const results = await Promise.all(responses.map((response) => response.json()));
    assert.deepEqual(results.map((result) => result.notice?.type).sort(), ['error', 'success']);

    const audits = await database.pool.query(
      `SELECT count(*)::int AS count FROM moderation_actions
       WHERE target_id = $1 AND action_type = 'POST_RESOLVED'`,
      [postId],
    );
    assert.equal(audits.rows[0].count, 1);
    const notifications = await database.pool.query(
      `SELECT count(*)::int AS count FROM notifications WHERE related_post_id = $1`,
      [postId],
    );
    assert.equal(notifications.rows[0].count, 1);
    const contactRequest = (
      await database.pool.query(`SELECT status FROM contact_requests WHERE id = $1`, [contactRequestId])
    ).rows[0];
    assert.equal(contactRequest.status, 'REJECTED');
    const post = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [postId])).rows[0];
    assert.equal(post.status, 'RESOLVED');
  });

  it('keeps unauthenticated, forged-session and CSRF-less resolution requests away from the action', async () => {
    const ownerId = await insertUser('security-owner');
    const postId = await insertTypedPost({ ownerId, postType: 'RESCUE', title: 'Security resolution' });

    const csrfOnlyPage = await fetch(`${baseUrl}/admin/login`);
    const csrfOnlyCookie = csrfOnlyPage.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('XSRF-TOKEN='))
      ?.split(';', 1)[0];
    const csrfOnlyToken = decodeURIComponent(csrfOnlyCookie?.split('=', 2)[1] ?? '');

    const anonymous = await fetch(`${baseUrl}/admin/api/resources/posts/records/${postId}/markRescued`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: csrfOnlyCookie,
        origin: baseUrl,
        'x-xsrf-token': csrfOnlyToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Anonymous attempt' }),
    });
    assert.equal(anonymous.status, 302);
    assert.match(anonymous.headers.get('location'), /\/admin\/login/);

    const forgedPage = await fetch(`${baseUrl}/admin/login`);
    const forgedCsrfCookie = forgedPage.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('XSRF-TOKEN='))
      ?.split(';', 1)[0];
    const forgedCsrfToken = decodeURIComponent(forgedCsrfCookie?.split('=', 2)[1] ?? '');
    const forged = await fetch(`${baseUrl}/admin/api/resources/posts/records/${postId}/markRescued`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: `pupzy_admin_test=forged-session-value; ${forgedCsrfCookie}`,
        origin: baseUrl,
        'x-xsrf-token': forgedCsrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Forged attempt' }),
    });
    assert.equal(forged.status, 302);

    const csrfMissing = await fetch(`${baseUrl}/admin/api/resources/posts/records/${postId}/markRescued`, {
      method: 'POST',
      headers: {
        cookie: staffCookie,
        origin: baseUrl,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'CSRF attempt' }),
    });
    assert.equal(csrfMissing.status, 403);

    const crossOrigin = await fetch(`${baseUrl}/admin/api/resources/posts/records/${postId}/markRescued`, {
      method: 'POST',
      headers: {
        cookie: `${staffCookie}; ${staffCsrf.cookie}`,
        origin: 'https://attacker.example',
        'x-xsrf-token': staffCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Cross-origin attempt' }),
    });
    assert.equal(crossOrigin.status, 403);

    const post = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [postId])).rows[0];
    assert.equal(post.status, 'ACTIVE');
    const audits = await database.pool.query(`SELECT count(*)::int AS count FROM moderation_actions`);
    assert.equal(audits.rows[0].count, 0);
    const notifications = await database.pool.query(`SELECT count(*)::int AS count FROM notifications`);
    assert.equal(notifications.rows[0].count, 0);
  });
});

describe('Administrator case reopening HTTP boundary', () => {
  async function insertCompletedPost({ ownerId, postType, title, reportType = null, status }) {
    return insertTypedPost({ ownerId, postType, title, reportType, status });
  }

  it('exposes Reopen only to correct a completed outcome and never for active, removed, expired or banned-owner cases', async () => {
    const ownerId = await insertUser('reopen-visibility-owner');
    const completedCases = [
      { postType: 'RESCUE', reportType: null, status: 'RESOLVED', title: 'Reopen rescue' },
      { postType: 'LOST', reportType: 'LOST_PET', status: 'REUNITED', title: 'Reopen lost pet' },
      { postType: 'LOST', reportType: 'FOUND_STRAY', status: 'RESOLVED', title: 'Reopen found stray' },
      { postType: 'ADOPTION', reportType: null, status: 'ADOPTED', title: 'Reopen adoption' },
      { postType: 'PRODUCT', reportType: null, status: 'SOLD', title: 'Reopen product' },
      { postType: 'MATING', reportType: null, status: 'RESOLVED', title: 'Reopen mating' },
    ];

    for (const testCase of completedCases) {
      const postId = await insertCompletedPost({ ownerId, ...testCase });
      const staffView = await fetchRecordActions(postId, staffCookie);
      assert.ok(staffView.names.includes(REOPEN_ACTION_NAME), `${testCase.title} must offer the Reopen correction`);
      const resolutionActions = RESOLUTION_ACTION_NAMES.filter((name) => staffView.names.includes(name));
      assert.deepEqual(resolutionActions, [], 'a completed outcome is corrected, never resolved twice');
      assert.equal(staffView.names.includes('removePost'), false, 'removal is hidden once an outcome is recorded');
      assert.equal(staffView.names.includes('restorePost'), false, 'restoration stays reserved for removed content');

      const superView = await fetchRecordActions(postId, superCookie);
      assert.ok(superView.names.includes(REOPEN_ACTION_NAME), 'SUPER_ADMIN sees the same correction action');
    }

    const activeId = await insertTypedPost({ ownerId, postType: 'RESCUE', title: 'Active case stays active' });
    const removedId = await insertTypedPost({
      ownerId,
      postType: 'ADOPTION',
      title: 'Removed case',
      status: 'REMOVED',
    });
    const expiredId = await insertTypedPost({ ownerId, postType: 'PRODUCT', title: 'Expired case', status: 'EXPIRED' });
    for (const [postId, expectedAction] of [
      [activeId, 'markRescued'],
      [removedId, 'restorePost'],
      [expiredId, null],
    ]) {
      const view = await fetchRecordActions(postId);
      assert.equal(view.names.includes(REOPEN_ACTION_NAME), false, `Reopen must be hidden for ${postId}`);
      if (expectedAction) {
        assert.ok(view.names.includes(expectedAction), `${postId} keeps its dedicated lifecycle action`);
      }
    }

    const bannedOwnerId = await insertUser('reopen-banned-owner');
    await database.pool.query(`UPDATE users SET is_banned = true WHERE id = $1`, [bannedOwnerId]);
    const bannedOwnerPostId = await insertCompletedPost({
      ownerId: bannedOwnerId,
      postType: 'RESCUE',
      title: 'Banned owner correction',
      status: 'RESOLVED',
    });
    const bannedView = await fetchRecordActions(bannedOwnerPostId);
    assert.equal(bannedView.names.includes(REOPEN_ACTION_NAME), false, 'a banned owner is not offered reopening');
    const bannedAttempt = await postAction(
      REOPEN_ACTION_NAME,
      bannedOwnerPostId,
      { reason: 'Direct banned-owner attempt' },
      staffCookie,
      staffCsrf,
    );
    assert.equal(bannedAttempt.status, 200);
    const bannedResult = await bannedAttempt.json();
    assert.equal(bannedResult.notice?.type, 'error');
    assert.match(bannedResult.notice?.message ?? '', /banned account/i);
    const bannedPost = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [bannedOwnerPostId]))
      .rows[0];
    assert.equal(bannedPost.status, 'RESOLVED', 'a banned owner post never reaches Active through reopening');

    const removedAttempt = await postAction(
      REOPEN_ACTION_NAME,
      removedId,
      { reason: 'Bypass removal attempt' },
      staffCookie,
      staffCsrf,
    );
    const removedResult = await removedAttempt.json();
    assert.equal(removedResult.notice?.type, 'error');
    assert.match(removedResult.notice?.message ?? '', /only a completed post/i);
    const removedPost = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [removedId])).rows[0];
    assert.equal(removedPost.status, 'REMOVED', 'restoration rules are not bypassed by reopening');

    const audits = await database.pool.query(`SELECT count(*)::int AS count FROM moderation_actions`);
    assert.equal(audits.rows[0].count, 0, 'opening or rejecting never records an outcome');
    const notifications = await database.pool.query(`SELECT count(*)::int AS count FROM notifications`);
    assert.equal(notifications.rows[0].count, 0);
  });

  it('corrects a mistaken resolution over authenticated HTTP while closed interactions stay closed', async () => {
    const ownerId = await insertUser('reopen-flow-owner');
    const requesterId = await insertUser('reopen-flow-requester');
    const reporterId = await insertUser('reopen-flow-reporter');
    await database.pool.query(
      `INSERT INTO device_registrations (user_id, token, platform)
       VALUES ($1, 'ticket20-resolution-owner-token', 'ANDROID')`,
      [ownerId],
    );
    const postId = await insertTypedPost({ ownerId, postType: 'ADOPTION', title: 'Correction journey case' });
    const contactRequestId = await insertContactRequest({ postId, requesterId });
    const reportId = (
      await database.pool.query(
        `INSERT INTO post_reports (post_id, reporter_id, reason)
         VALUES ($1, $2, 'SPAM')
         RETURNING id`,
        [postId, reporterId],
      )
    ).rows[0].id;

    const resolution = await postAction(
      'markAdopted',
      postId,
      { reason: 'Adoption completed' },
      staffCookie,
      staffCsrf,
    );
    assert.equal((await resolution.json()).notice?.type, 'success');
    const afterResolution = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [postId])).rows[0];
    assert.equal(afterResolution.status, 'ADOPTED');
    const closedRequest = (
      await database.pool.query(`SELECT status, responded_at FROM contact_requests WHERE id = $1`, [contactRequestId])
    ).rows[0];
    assert.equal(closedRequest.status, 'REJECTED');

    const reopened = await postAction(
      REOPEN_ACTION_NAME,
      postId,
      { reason: 'The adoption outcome was recorded by mistake' },
      staffCookie,
      staffCsrf,
    );
    assert.equal(reopened.status, 200);
    const reopenResult = await reopened.json();
    assert.equal(reopenResult.notice?.type, 'success');
    assert.equal(reopenResult.notice?.message, 'Post reopened.');

    const post = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [postId])).rows[0];
    assert.equal(post.status, 'ACTIVE', 'discovery state is restored consistently');

    const audits = (
      await database.pool.query(
        `SELECT action_type, admin_user_id, reason, metadata FROM moderation_actions
         WHERE target_id = $1 ORDER BY created_at, action_type`,
        [postId],
      )
    ).rows;
    assert.deepEqual(audits.map((row) => row.action_type).sort(), ['POST_REOPENED', 'POST_RESOLVED']);
    const reopenAudit = audits.find((row) => row.action_type === 'POST_REOPENED');
    assert.equal(reopenAudit.admin_user_id, staffId);
    assert.equal(reopenAudit.reason, 'The adoption outcome was recorded by mistake');
    assert.equal(reopenAudit.metadata.previousOutcome, 'ADOPTED');
    const resolveAudit = audits.find((row) => row.action_type === 'POST_RESOLVED');
    assert.equal(resolveAudit.reason, 'Adoption completed');
    assert.equal(resolveAudit.metadata.outcome, 'ADOPTED');

    const notifications = (
      await database.pool.query(
        `SELECT type, recipient_id, related_post_id, title, body, title_arabic, body_arabic
         FROM notifications WHERE related_post_id = $1 ORDER BY created_at, type`,
        [postId],
      )
    ).rows;
    assert.deepEqual(notifications.map((row) => row.type).sort(), ['POST_REOPENED_BY_ADMIN', 'POST_RESOLVED_BY_ADMIN']);
    const reopenNotification = notifications.find((row) => row.type === 'POST_REOPENED_BY_ADMIN');
    assert.equal(reopenNotification.recipient_id, ownerId);
    assert.equal(reopenNotification.title, 'Post reopened');
    assert.equal(reopenNotification.body, 'An administrator reopened your post "Correction journey case".');
    assert.equal(reopenNotification.title_arabic, 'تمت إعادة فتح المنشور');
    assert.ok(reopenNotification.body_arabic.includes('Correction journey case'));
    assert.equal(reopenNotification.body.includes('recorded by mistake'), false);

    const deliveries = (
      await database.pool.query(
        `SELECT pd.status, pd.recipient_id, pd.actor_id, n.type
         FROM push_deliveries pd
         JOIN notifications n ON n.id = pd.notification_id
         ORDER BY n.created_at, n.type`,
      )
    ).rows;
    assert.deepEqual(
      deliveries.map((row) => row.type).sort(),
      ['POST_REOPENED_BY_ADMIN', 'POST_RESOLVED_BY_ADMIN'],
      'resolution and reopening each write one durable push intent',
    );
    assert.ok(
      deliveries.every((row) => row.status === 'PENDING' && row.recipient_id === ownerId && row.actor_id === null),
    );

    const stillClosed = (
      await database.pool.query(`SELECT status, responded_at FROM contact_requests WHERE id = $1`, [contactRequestId])
    ).rows[0];
    assert.equal(stillClosed.status, 'REJECTED', 'reopening never revives a closed request');
    assert.ok(stillClosed.responded_at);

    const report = (
      await database.pool.query(`SELECT reviewed_at, review_outcome FROM post_reports WHERE id = $1`, [reportId])
    ).rows[0];
    assert.equal(report.reviewed_at, null, 'a correction is not a moderation review');

    const view = await fetchRecordActions(postId);
    assert.ok(view.names.includes('markAdopted'), 'the corrected case can be resolved again if justified');
    assert.equal(view.names.includes(REOPEN_ACTION_NAME), false, 'an active case offers no reopening');
  });

  it('corrects a delivered non-rescue participant, suppresses pending ones, and leaves the owner notification unchanged', async () => {
    const ownerId = await insertUser('participant-owner');
    const deliveredParticipantId = await insertUser('participant-delivered');
    const pendingParticipantId = await insertUser('participant-pending');
    const productId = await insertTypedPost({ ownerId, postType: 'PRODUCT', title: 'Participant correction case' });

    // Record the SOLD outcome through the authenticated boundary first.
    const resolution = await postAction('markSold', productId, { reason: 'Sold offline' }, staffCookie, staffCsrf);
    assert.equal(resolution.status, 200);
    assert.equal((await resolution.json()).notice?.type, 'success');

    const event = (
      await database.pool.query(`SELECT id, type FROM post_completion_notification_events WHERE post_id = $1`, [
        productId,
      ])
    ).rows[0];
    assert.equal(event.type, 'POST_COMPLETED');

    // Seed the participant audience the API worker would normally consume: one
    // participant already delivered a committed closure inbox row, one still
    // pending.
    const deliveredNotification = (
      await database.pool.query(
        `INSERT INTO notifications
           (recipient_id, type, title, body, title_arabic, body_arabic, related_post_id, is_read)
         VALUES ($1, 'POST_COMPLETED', 'Item sold',
                 'The post "Participant correction case" was marked as sold.',
                 'تم البيع', 'تم تسجيل نتيجة المنشور "Participant correction case": تم البيع.', $2, false)
         RETURNING id`,
        [deliveredParticipantId, productId],
      )
    ).rows[0];
    const deliveredRecipient = (
      await database.pool.query(
        `INSERT INTO post_completion_recipients
           (event_id, post_id, recipient_id, status, notification_id, delivered_at, attempts)
         VALUES ($1, $2, $3, 'DELIVERED', $4, now(), 1)
         RETURNING id`,
        [event.id, productId, deliveredParticipantId, deliveredNotification.id],
      )
    ).rows[0];
    const pendingRecipient = (
      await database.pool.query(
        `INSERT INTO post_completion_recipients (event_id, post_id, recipient_id, status)
         VALUES ($1, $2, $3, 'PENDING')
         RETURNING id`,
        [event.id, productId, pendingParticipantId],
      )
    ).rows[0];
    await database.pool.query(
      `UPDATE post_completion_notification_events SET total_recipients = 2, status = 'PENDING' WHERE id = $1`,
      [event.id],
    );

    const response = await postAction(
      REOPEN_ACTION_NAME,
      productId,
      { reason: 'The sale was recorded by mistake' },
      staffCookie,
      staffCsrf,
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).notice?.type, 'success');

    // (a) The delivered participant is corrected with localized copy and routing.
    const correctedRecipient = (
      await database.pool.query(`SELECT status, notification_id FROM post_completion_recipients WHERE id = $1`, [
        deliveredRecipient.id,
      ])
    ).rows[0];
    assert.equal(correctedRecipient.status, 'CORRECTED');
    assert.equal(correctedRecipient.notification_id, deliveredNotification.id, 'the original inbox row is kept');
    const corrections = (
      await database.pool.query(
        `SELECT type, related_post_id, title, body, title_arabic, body_arabic
         FROM notifications WHERE recipient_id = $1 AND type = 'POST_REOPENED'`,
        [deliveredParticipantId],
      )
    ).rows;
    assert.equal(corrections.length, 1);
    assert.equal(corrections[0].related_post_id, productId);
    assert.equal(corrections[0].title, 'Post reopened');
    assert.equal(corrections[0].body, 'The post "Participant correction case" was reopened.');
    assert.equal(corrections[0].title_arabic, 'تمت إعادة فتح المنشور');
    assert.ok(corrections[0].body_arabic.includes('Participant correction case'));

    // (b) Still-pending recipients are suppressed and never delivered.
    const pendingRow = (
      await database.pool.query(`SELECT status FROM post_completion_recipients WHERE id = $1`, [pendingRecipient.id])
    ).rows[0];
    assert.equal(pendingRow.status, 'SUPPRESSED');
    const eventRow = (
      await database.pool.query(`SELECT status FROM post_completion_notification_events WHERE id = $1`, [event.id])
    ).rows[0];
    assert.equal(eventRow.status, 'SUPERSEDED');
    const pendingNotifications = await database.pool.query(
      `SELECT count(*)::int AS count FROM notifications WHERE recipient_id = $1`,
      [pendingParticipantId],
    );
    assert.equal(pendingNotifications.rows[0].count, 0, 'a suppressed closure recipient never receives a notification');

    // (c) The owner's POST_REOPENED_BY_ADMIN behavior is unchanged.
    const ownerCorrections = (
      await database.pool.query(
        `SELECT type, related_post_id, title, body, title_arabic, body_arabic
         FROM notifications WHERE recipient_id = $1 AND type = 'POST_REOPENED_BY_ADMIN'`,
        [ownerId],
      )
    ).rows;
    assert.equal(ownerCorrections.length, 1);
    assert.equal(ownerCorrections[0].related_post_id, productId);
    assert.equal(ownerCorrections[0].title, 'Post reopened');
    assert.equal(ownerCorrections[0].body, 'An administrator reopened your post "Participant correction case".');
    assert.equal(ownerCorrections[0].title_arabic, 'تمت إعادة فتح المنشور');
    assert.ok(ownerCorrections[0].body_arabic.includes('Participant correction case'));
  });

  it('requires an internal reason and rejects repeated, removed or expired reopening without writes', async () => {
    const ownerId = await insertUser('reopen-guard-owner');
    const completedId = await insertCompletedPost({
      ownerId,
      postType: 'MATING',
      title: 'Reopen guard',
      status: 'RESOLVED',
    });
    const activeId = await insertTypedPost({ ownerId, postType: 'RESCUE', title: 'Active guard' });
    const removedId = await insertTypedPost({
      ownerId,
      postType: 'PRODUCT',
      title: 'Removed guard',
      status: 'REMOVED',
    });
    const expiredId = await insertTypedPost({
      ownerId,
      postType: 'PRODUCT',
      title: 'Expired guard',
      status: 'EXPIRED',
    });

    const attempts = [
      [completedId, {}, /reason is required/i],
      [completedId, { reason: '   ' }, /reason is required/i],
      [activeId, { reason: 'Not completed' }, /only a completed post/i],
      [removedId, { reason: 'Not completed' }, /only a completed post/i],
      [expiredId, { reason: 'Not completed' }, /only a completed post/i],
    ];

    for (const [postId, payload, expectedMessage] of attempts) {
      const response = await postAction(REOPEN_ACTION_NAME, postId, payload);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.notice?.type, 'error', `reopening ${postId} must be rejected`);
      assert.match(result.notice?.message ?? '', expectedMessage);
    }

    const first = await postAction(REOPEN_ACTION_NAME, completedId, { reason: 'First correction' });
    assert.equal((await first.json()).notice?.type, 'success');
    const repeated = await postAction(REOPEN_ACTION_NAME, completedId, { reason: 'Second correction' });
    const repeatedResult = await repeated.json();
    assert.equal(repeatedResult.notice?.type, 'error');
    assert.match(repeatedResult.notice?.message ?? '', /only a completed post/i);

    const audits = await database.pool.query(
      `SELECT count(*)::int AS count FROM moderation_actions WHERE action_type = 'POST_REOPENED'`,
    );
    assert.equal(audits.rows[0].count, 1, 'exactly one successful reopening is audited');
    const notifications = await database.pool.query(
      `SELECT count(*)::int AS count FROM notifications WHERE type = 'POST_REOPENED_BY_ADMIN'`,
    );
    assert.equal(notifications.rows[0].count, 1);
    const statuses = await database.pool.query(`SELECT status FROM posts WHERE id = ANY($1::uuid[]) ORDER BY status`, [
      [completedId, activeId, removedId, expiredId],
    ]);
    assert.deepEqual(
      statuses.rows.map((row) => row.status),
      ['ACTIVE', 'ACTIVE', 'REMOVED', 'EXPIRED'],
    );
  });

  it('serializes concurrent reopening requests into exactly one audited correction', async () => {
    const ownerId = await insertUser('reopen-race-owner');
    const postId = await insertCompletedPost({
      ownerId,
      postType: 'RESCUE',
      title: 'Concurrent correction',
      status: 'RESOLVED',
    });

    const responses = await Promise.all([
      postAction(REOPEN_ACTION_NAME, postId, { reason: 'First reviewer' }, staffCookie, staffCsrf),
      postAction(REOPEN_ACTION_NAME, postId, { reason: 'Second reviewer' }, superCookie, superCsrf),
    ]);
    const results = await Promise.all(responses.map((response) => response.json()));
    assert.deepEqual(results.map((result) => result.notice?.type).sort(), ['error', 'success']);

    const audits = await database.pool.query(
      `SELECT count(*)::int AS count FROM moderation_actions WHERE target_id = $1 AND action_type = 'POST_REOPENED'`,
      [postId],
    );
    assert.equal(audits.rows[0].count, 1);
    const notifications = await database.pool.query(
      `SELECT count(*)::int AS count FROM notifications WHERE related_post_id = $1`,
      [postId],
    );
    assert.equal(notifications.rows[0].count, 1);
    const post = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [postId])).rows[0];
    assert.equal(post.status, 'ACTIVE');
  });

  it('keeps unauthenticated, forged-session and CSRF-less reopening requests away from the action', async () => {
    const ownerId = await insertUser('reopen-security-owner');
    const postId = await insertCompletedPost({
      ownerId,
      postType: 'RESCUE',
      title: 'Security correction',
      status: 'RESOLVED',
    });

    const csrfOnlyPage = await fetch(`${baseUrl}/admin/login`);
    const csrfOnlyCookie = csrfOnlyPage.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('XSRF-TOKEN='))
      ?.split(';', 1)[0];
    const csrfOnlyToken = decodeURIComponent(csrfOnlyCookie?.split('=', 2)[1] ?? '');

    const anonymous = await fetch(`${baseUrl}/admin/api/resources/posts/records/${postId}/${REOPEN_ACTION_NAME}`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: csrfOnlyCookie,
        origin: baseUrl,
        'x-xsrf-token': csrfOnlyToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Anonymous attempt' }),
    });
    assert.equal(anonymous.status, 302);
    assert.match(anonymous.headers.get('location'), /\/admin\/login/);

    const forgedPage = await fetch(`${baseUrl}/admin/login`);
    const forgedCsrfCookie = forgedPage.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('XSRF-TOKEN='))
      ?.split(';', 1)[0];
    const forgedCsrfToken = decodeURIComponent(forgedCsrfCookie?.split('=', 2)[1] ?? '');
    const forged = await fetch(`${baseUrl}/admin/api/resources/posts/records/${postId}/${REOPEN_ACTION_NAME}`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie: `pupzy_admin_test=forged-session-value; ${forgedCsrfCookie}`,
        origin: baseUrl,
        'x-xsrf-token': forgedCsrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Forged attempt' }),
    });
    assert.equal(forged.status, 302);

    const csrfMissing = await fetch(`${baseUrl}/admin/api/resources/posts/records/${postId}/${REOPEN_ACTION_NAME}`, {
      method: 'POST',
      headers: {
        cookie: staffCookie,
        origin: baseUrl,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'CSRF attempt' }),
    });
    assert.equal(csrfMissing.status, 403);

    const crossOrigin = await fetch(`${baseUrl}/admin/api/resources/posts/records/${postId}/${REOPEN_ACTION_NAME}`, {
      method: 'POST',
      headers: {
        cookie: `${staffCookie}; ${staffCsrf.cookie}`,
        origin: 'https://attacker.example',
        'x-xsrf-token': staffCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Cross-origin attempt' }),
    });
    assert.equal(crossOrigin.status, 403);

    const post = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [postId])).rows[0];
    assert.equal(post.status, 'RESOLVED');
    const audits = await database.pool.query(`SELECT count(*)::int AS count FROM moderation_actions`);
    assert.equal(audits.rows[0].count, 0);
    const notifications = await database.pool.query(`SELECT count(*)::int AS count FROM notifications`);
    assert.equal(notifications.rows[0].count, 0);
  });
});

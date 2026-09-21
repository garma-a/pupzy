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

const BUSINESS_TABLES = `
  post_media, rescue_posts, lost_posts, adoption_posts, product_posts, mating_posts,
  post_upvotes, post_saves, contact_requests, adoption_applications, post_reports, comment_reports, account_reports,
  notifications, saved_searches, moderation_actions, posts, users,
  comments, comment_media, post_pins, comment_boosts, comment_idempotency,
  media_deletion_work, blocked_media_hashes, blocks, account_deletions
`;

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
    [`bwg06-${label}`, `${label}@example.com`, `User ${label}`],
  );
  return rows[0].id;
}

async function insertLostPost({
  ownerId,
  title,
  status = 'ACTIVE',
  moderationStatus = 'FLAGGED',
  reportType = 'FOUND_STRAY',
  areaName = 'Maadi',
  createdAt = null,
}) {
  const postId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    title,
    status,
    moderationStatus,
    postType: 'LOST',
    createdAt,
  });
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
  await database.pool.query(`UPDATE posts SET area_name = $2 WHERE id = $1`, [postId, areaName]);
  return postId;
}

async function insertComment({ postId, authorId, text, status = 'ACTIVE', parentId = null, createdAt = null }) {
  const { rows } = await database.pool.query(
    `INSERT INTO comments (post_id, author_id, text, status, parent_id, created_at)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()))
     RETURNING id`,
    [postId, authorId, text, status, parentId, createdAt],
  );
  return rows[0].id;
}

async function insertCommentMedia({ commentId, storageKey, displayOrder = 0, width = 480, height = 320 }) {
  const { rows } = await database.pool.query(
    `INSERT INTO comment_media
       (comment_id, storage_key, sha256, width, height, file_size_bytes, file_content_type, display_order)
     VALUES ($1, $2, repeat('a', 64), $3, $4, 50_000, 'image/webp', $5)
     RETURNING id`,
    [commentId, storageKey, width, height, displayOrder],
  );
  return rows[0].id;
}

async function insertPostMedia({ postId, publicUrl, displayOrder = 0, width = 800, height = 600 }) {
  const { rows } = await database.pool.query(
    `INSERT INTO post_media
       (post_id, public_url, cloudflare_storage_key, display_order, width, height, file_content_type, file_size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6, 'image/webp', 90_000)
     RETURNING id`,
    [postId, publicUrl, `posts/${postId}/media-${displayOrder}.webp`, displayOrder, width, height],
  );
  return rows[0].id;
}

async function insertPostReport({ postId, reporterId, reason = 'SPAM', details = null, reviewed = false }) {
  const { rows } = await database.pool.query(
    `INSERT INTO post_reports (post_id, reporter_id, reason, details)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [postId, reporterId, reason, details],
  );
  if (reviewed) {
    await database.pool.query(
      `UPDATE post_reports
       SET reviewed_at = now(), reviewed_by_admin_id = $2, review_outcome = 'NO_ACTION'
       WHERE id = $1`,
      [rows[0].id, principals.adminId],
    );
  }
  return rows[0].id;
}

async function insertCommentReport({ commentId, reporterId, reason = 'SPAM', details = null, reviewed = false }) {
  const { rows } = await database.pool.query(
    `INSERT INTO comment_reports (comment_id, reporter_id, reason, details)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [commentId, reporterId, reason, details],
  );
  if (reviewed) {
    await database.pool.query(`UPDATE comment_reports SET reviewed_at = now() WHERE id = $1`, [rows[0].id]);
  }
  return rows[0].id;
}

async function insertModerationAction({ actionType, targetType, targetId, reason = null, metadata = null }) {
  const { rows } = await database.pool.query(
    `INSERT INTO moderation_actions (admin_user_id, action_type, target_type, target_id, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [principals.adminId, actionType, targetType, targetId, reason, metadata ? JSON.stringify(metadata) : null],
  );
  return rows[0].id;
}

async function fetchWorkspace(postId, cookie = superCookie) {
  const response = await fetch(`${baseUrl}/admin/api/resources/posts/records/${postId}/show`, {
    headers: { cookie },
  });
  assert.equal(response.status, 200, 'the authenticated record page must load');
  const data = await response.json();
  return { data, payload: JSON.parse(data.record.params.post_review_workspace) };
}

async function fetchDiscussionPage(postId, query, cookie = superCookie) {
  const response = await fetch(
    `${baseUrl}/admin/api/resources/posts/records/${postId}/postReviewDiscussion${query ? `?${query}` : ''}`,
    { headers: cookie ? { cookie } : {}, redirect: 'manual' },
  );
  return response;
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

describe('Post review workspace HTTP boundary', () => {
  it('shows original photos, paginated Community Evidence, Reports and action history in one authenticated page', async () => {
    const ownerId = await insertUser('workspace-owner');
    const otherUserId = await insertUser('workspace-commenter');
    const postId = await insertLostPost({ ownerId, title: 'Found stray near the market' });
    await insertPostMedia({ postId, publicUrl: 'https://cdn.pupzy.net/posts/one.webp', displayOrder: 0 });
    await insertPostMedia({ postId, publicUrl: '', displayOrder: 1, width: null, height: null });

    const comments = [];
    for (let index = 1; index <= 8; index += 1) {
      comments.push(
        await insertComment({
          postId,
          authorId: otherUserId,
          text: `Evidence comment number ${index}`,
          createdAt: new Date(Date.UTC(2026, 8, 1, index, 0, 0)),
        }),
      );
    }
    const hiddenCommentId = await insertComment({
      postId,
      authorId: otherUserId,
      text: 'Hidden evidence',
      status: 'HIDDEN',
      createdAt: new Date('2026-08-01T10:00:00Z'),
    });
    const removedCommentId = await insertComment({
      postId,
      authorId: otherUserId,
      text: 'Removed evidence',
      status: 'REMOVED',
      createdAt: new Date('2026-08-02T10:00:00Z'),
    });
    const replyId = await insertComment({
      postId,
      authorId: ownerId,
      text: 'Thanks for the photo',
      parentId: comments[0],
      status: 'DELETED',
    });
    await insertCommentMedia({ commentId: comments[0], storageKey: 'comments/c1/evidence.webp' });
    await insertCommentMedia({ commentId: hiddenCommentId, storageKey: '', displayOrder: 0 });
    await insertCommentMedia({ commentId: removedCommentId, storageKey: 'comments/c3/removed.webp' });

    const openPostReportId = await insertPostReport({
      postId,
      reporterId: otherUserId,
      reason: 'INAPPROPRIATE_CONTENT',
      details: 'Looks staged',
    });
    const reviewedPostReportId = await insertPostReport({
      postId,
      reporterId: ownerId,
      reason: 'SPAM',
      reviewed: true,
    });
    await insertCommentReport({ commentId: comments[0], reporterId: ownerId, details: 'Harassment in discussion' });
    const postFlagActionId = await insertModerationAction({
      actionType: 'POST_FLAGGED',
      targetType: 'POST',
      targetId: postId,
      reason: 'Needs a second look',
    });
    const commentRemoveActionId = await insertModerationAction({
      actionType: 'COMMENT_REMOVED',
      targetType: 'COMMENT',
      targetId: removedCommentId,
      reason: 'Abusive language',
    });

    const { data, payload } = await fetchWorkspace(postId, staffCookie);

    assert.equal(payload.error, false);
    assert.equal(payload.post.title, 'Found stray near the market');
    assert.equal(payload.post.typeLabel, 'Lost & found');
    assert.equal(payload.post.subtypeLabel, 'Found stray');
    assert.equal(payload.post.statusLabel, 'Active');
    assert.equal(payload.post.moderationStatusLabel, 'Flagged');
    assert.equal(payload.post.cityName, 'Cairo');
    assert.equal(payload.post.areaName, 'Maadi');
    assert.equal(payload.post.owner.id, ownerId);
    assert.equal(payload.post.owner.name, 'User workspace-owner');
    assert.equal(payload.post.owner.email, 'workspace-owner@example.com');

    assert.equal(payload.photos.length, 2);
    assert.equal(payload.photos[0].available, true);
    assert.equal(payload.photos[0].url, 'https://cdn.pupzy.net/posts/one.webp');
    assert.equal(payload.photos[1].available, false);
    assert.equal(payload.photos[1].url, null);

    assert.equal(payload.discussion.page, 1);
    assert.equal(payload.discussion.pageSize, 10);
    assert.equal(payload.discussion.total, 10);
    assert.equal(payload.discussion.totalPages, 1);
    assert.equal(payload.discussion.itemCount, 10);
    const itemIds = payload.discussion.items.map((item) => item.id);
    assert.equal(itemIds[0], comments[7], 'the newest top-level Comment must appear first');
    assert.ok(itemIds.includes(hiddenCommentId));
    assert.ok(itemIds.includes(removedCommentId));
    const hiddenItem = payload.discussion.items.find((item) => item.id === hiddenCommentId);
    assert.equal(hiddenItem.statusLabel, 'Hidden');
    assert.equal(hiddenItem.attachments[0].available, false);
    const removedItem = payload.discussion.items.find((item) => item.id === removedCommentId);
    assert.equal(removedItem.statusLabel, 'Removed');
    assert.equal(removedItem.attachments[0].available, true);
    assert.match(removedItem.attachments[0].url, /comments\/c3\/removed\.webp$/);
    const firstItem = payload.discussion.items.find((item) => item.id === comments[0]);
    assert.equal(firstItem.attachments[0].available, true);
    assert.equal(firstItem.replies.length, 1);
    assert.equal(firstItem.replies[0].id, replyId);
    assert.equal(firstItem.replies[0].statusLabel, 'Deleted');

    assert.equal(payload.reports.postReports.length, 2);
    assert.equal(payload.reports.postReports[0].id, openPostReportId);
    assert.equal(payload.reports.postReports[0].isOpen, true);
    assert.equal(payload.reports.postReports[0].statusLabel, 'Open');
    assert.equal(payload.reports.postReports[0].reasonLabel, 'Inappropriate content');
    assert.equal(payload.reports.postReports[1].id, reviewedPostReportId);
    assert.equal(payload.reports.postReports[1].isOpen, false);
    assert.equal(payload.reports.postReports[1].statusLabel, 'Reviewed');
    assert.equal(payload.reports.postReports[1].reviewOutcomeLabel, 'No action');
    assert.equal(payload.reports.commentReports.length, 1);
    assert.equal(payload.reports.commentReports[0].commentId, comments[0]);
    assert.equal(payload.reports.commentReports[0].isOpen, true);

    assert.deepEqual(
      payload.history.map((entry) => entry.id),
      [commentRemoveActionId, postFlagActionId],
      'administrator history is chronological with the newest action first',
    );
    const flagEntry = payload.history.find((entry) => entry.id === postFlagActionId);
    assert.equal(flagEntry.actionLabel, 'Post flagged');
    assert.equal(flagEntry.reason, 'Needs a second look');
    assert.equal(flagEntry.adminName, 'Test Admin');
    const commentEntry = payload.history.find((entry) => entry.id === commentRemoveActionId);
    assert.equal(commentEntry.actionLabel, 'Comment removed');
    assert.equal(commentEntry.targetType, 'COMMENT');

    const serialized = data.record.params.post_review_workspace;
    assert.equal(serialized.includes('password_hash'), false, 'the workspace must not leak password hashes');
    assert.equal(serialized.includes('phone_number'), false, 'the workspace must not leak phone numbers');

    const actionNames = data.record.recordActions.map((action) => action.name);
    assert.ok(actionNames.includes('removePost'), 'existing moderation actions stay available');
    assert.ok(actionNames.includes('show'));
    assert.equal(
      actionNames.includes('postReviewDiscussion'),
      false,
      'the pagination API action stays hidden from the action bar',
    );
  });

  it('serves additional discussion pages to authenticated administrators and clamps invalid requests', async () => {
    const ownerId = await insertUser('pagination-owner');
    const commenterId = await insertUser('pagination-commenter');
    const postId = await insertLostPost({ ownerId, title: 'Pagination post' });
    const comments = [];
    for (let index = 1; index <= 12; index += 1) {
      comments.push(
        await insertComment({
          postId,
          authorId: commenterId,
          text: `Page comment ${index}`,
          createdAt: new Date(Date.UTC(2026, 8, 2, index, 0, 0)),
        }),
      );
    }

    const secondPage = await fetchDiscussionPage(postId, 'page=2', staffCookie);
    assert.equal(secondPage.status, 200);
    const secondPayload = JSON.parse((await secondPage.json()).record.params.post_review_discussion);
    assert.equal(secondPayload.page, 2);
    assert.equal(secondPayload.totalPages, 2);
    assert.equal(secondPayload.itemCount, 2);
    assert.deepEqual(
      secondPayload.items.map((item) => item.id),
      [comments[1], comments[0]],
      'the oldest Comments appear on the final page',
    );

    const clamped = await fetchDiscussionPage(postId, 'page=99', staffCookie);
    const clampedPayload = JSON.parse((await clamped.json()).record.params.post_review_discussion);
    assert.equal(clampedPayload.page, 2);

    const invalid = await fetchDiscussionPage(postId, 'page=not-a-number', staffCookie);
    const invalidPayload = JSON.parse((await invalid.json()).record.params.post_review_discussion);
    assert.equal(invalidPayload.page, 1);

    const unauthenticated = await fetchDiscussionPage(postId, 'page=2', null);
    assert.equal(unauthenticated.status, 302);
    assert.match(unauthenticated.headers.get('location'), /\/admin\/login/);
  });

  it('keeps the record page readable when original or Comment images are missing, deleted or blank', async () => {
    const ownerId = await insertUser('broken-media-owner');
    const commenterId = await insertUser('broken-media-commenter');
    const postId = await insertLostPost({ ownerId, title: 'Broken media post' });
    const noPhotoPostId = await insertLostPost({ ownerId, title: 'No photo post' });

    const blankPostMediaPostId = await insertLostPost({ ownerId, title: 'Blank original photo post' });
    await insertPostMedia({ postId: blankPostMediaPostId, publicUrl: '' });

    const commentId = await insertComment({ postId, authorId: commenterId, text: 'Evidence with missing bytes' });
    await insertCommentMedia({ commentId, storageKey: 'comments/gone/removed.webp' });
    const deletedMediaCommentId = await insertComment({
      postId,
      authorId: commenterId,
      text: 'Evidence whose media row was deleted',
    });

    await database.pool.query(`DELETE FROM comment_media WHERE comment_id = $1`, [deletedMediaCommentId]);

    const noPhoto = await fetchWorkspace(noPhotoPostId);
    assert.deepEqual(noPhoto.payload.photos, []);
    assert.deepEqual(noPhoto.payload.discussion.items, []);

    const blankPhoto = await fetchWorkspace(blankPostMediaPostId);
    assert.equal(blankPhoto.payload.photos.length, 1);
    assert.equal(blankPhoto.payload.photos[0].available, false);
    assert.equal(blankPhoto.payload.photos[0].url, null);

    const broken = await fetchWorkspace(postId);
    assert.equal(broken.payload.photos.length, 0);
    const [deletedMediaComment, missingBytesComment] = broken.payload.discussion.items;
    assert.equal(missingBytesComment.attachments.length, 1);
    assert.equal(missingBytesComment.attachments[0].available, true);
    assert.match(missingBytesComment.attachments[0].url, /comments\/gone\/removed\.webp$/);
    assert.equal(deletedMediaComment.attachments.length, 0);
  });

  it('does not mix another Post discussion, Reports or history into the workspace', async () => {
    const ownerId = await insertUser('isolation-owner');
    const otherOwnerId = await insertUser('isolation-other-owner');
    const commenterId = await insertUser('isolation-commenter');
    const postId = await insertLostPost({ ownerId, title: 'Isolated workspace post' });
    const otherPostId = await insertLostPost({ ownerId: otherOwnerId, title: 'Unrelated post' });

    const ownCommentId = await insertComment({ postId, authorId: commenterId, text: 'Only this Post discussion' });
    const otherCommentId = await insertComment({
      postId: otherPostId,
      authorId: commenterId,
      text: 'Another Post discussion',
    });
    const ownReportId = await insertPostReport({ postId, reporterId: commenterId });
    await insertPostReport({ postId: otherPostId, reporterId: commenterId });
    await insertCommentReport({ commentId: ownCommentId, reporterId: commenterId });
    await insertCommentReport({ commentId: otherCommentId, reporterId: commenterId });
    const ownActionId = await insertModerationAction({
      actionType: 'POST_APPROVED',
      targetType: 'POST',
      targetId: postId,
    });
    await insertModerationAction({
      actionType: 'COMMENT_REMOVED',
      targetType: 'COMMENT',
      targetId: otherCommentId,
      reason: 'Unrelated comment action',
    });

    const { payload } = await fetchWorkspace(postId);

    assert.deepEqual(
      payload.discussion.items.map((item) => item.text),
      ['Only this Post discussion'],
    );
    assert.deepEqual(
      payload.reports.postReports.map((report) => report.id),
      [ownReportId],
    );
    assert.deepEqual(
      payload.reports.commentReports.map((report) => report.commentId),
      [ownCommentId],
    );
    assert.deepEqual(
      payload.history.map((entry) => entry.id),
      [ownActionId],
    );
  });

  it('retains staff review visibility for a removed Post without destructive cleanup', async () => {
    const ownerId = await insertUser('removed-owner');
    const commenterId = await insertUser('removed-commenter');
    const postId = await insertLostPost({ ownerId, title: 'Removed post review', status: 'REMOVED' });
    await insertPostMedia({ postId, publicUrl: 'https://cdn.pupzy.net/posts/removed.webp' });
    await insertComment({ postId, authorId: commenterId, text: 'Discussion retained after takedown' });

    const { payload } = await fetchWorkspace(postId);

    assert.equal(payload.post.statusLabel, 'Removed');
    assert.equal(payload.photos.length, 1);
    assert.equal(payload.photos[0].available, true);
    assert.equal(payload.discussion.total, 1);
    assert.equal(payload.discussion.items[0].text, 'Discussion retained after takedown');
  });

  it('still returns a clean not-found response when the Post no longer exists', async () => {
    const response = await fetch(
      `${baseUrl}/admin/api/resources/posts/records/00000000-0000-7000-8000-000000000000/show`,
      { headers: { cookie: superCookie } },
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.notice?.type, 'error');
    assert.equal(data.record.params.post_review_workspace, undefined);
  });

  it('keeps unauthenticated and unknown-session requests away from the review API', async () => {
    const anonymous = await fetch(`${baseUrl}/admin/api/resources/posts/actions/list`, { redirect: 'manual' });
    assert.equal(anonymous.status, 302);
    assert.match(anonymous.headers.get('location'), /\/admin\/login/);

    const forged = await fetch(`${baseUrl}/admin/api/resources/posts/actions/list`, {
      headers: { cookie: 'pupzy_admin_test=forged-session-value' },
      redirect: 'manual',
    });
    assert.equal(forged.status, 302);

    const csrfMissing = await fetch(
      `${baseUrl}/admin/api/resources/posts/records/00000000-0000-7000-8000-000000000000/removePost`,
      {
        method: 'POST',
        headers: {
          cookie: superCookie,
          origin: baseUrl,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason: 'CSRF boundary check' }),
      },
    );
    assert.equal(csrfMissing.status, 403);
  });
});

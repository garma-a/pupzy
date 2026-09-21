import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, it } from 'node:test';
import AdminJSExpress from '@adminjs/express';
import bcrypt from 'bcryptjs';
import connectPgSimple from 'connect-pg-simple';
import express from 'express';
import helmet from 'helmet';
import puppeteer from 'puppeteer-core';
import session from 'express-session';
import rateLimit from 'express-rate-limit';

import { buildAdminJs } from '../src/adminjs/index.js';
import { buildAuthenticate } from '../src/auth/authenticate.js';
import { buildCsrfProtection } from '../src/middleware/csrf.js';
import { requireSameOrigin } from '../src/middleware/same-origin.js';
import { TestDatabaseHelper, insertPost, seedPrincipals } from './test-database.helper.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const database = new TestDatabaseHelper();
const EVIDENCE_DIR = process.env.BWG06_EVIDENCE_DIR || '/tmp/opencode/bwg-06-evidence';
const RESOLUTION_EVIDENCE_DIR = process.env.BWG08_EVIDENCE_DIR || '/tmp/opencode/bwg-08-evidence';
const REOPEN_EVIDENCE_DIR = process.env.BWG09_EVIDENCE_DIR || '/tmp/opencode/bwg-09-evidence';

const BUSINESS_TABLES = `
  post_media, rescue_posts, lost_posts, adoption_posts, product_posts, mating_posts,
  post_upvotes, post_saves, contact_requests, adoption_applications, post_reports, comment_reports, account_reports,
  notifications, saved_searches, moderation_actions, posts, users,
  comments, comment_media, post_pins, comment_boosts, comment_idempotency,
  media_deletion_work, blocked_media_hashes, blocks, account_deletions
`;

const WIDE_PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100"><rect width="300" height="100" fill="#c4622d"/><circle cx="150" cy="50" r="30" fill="#faf6f1"/></svg>`;
const TALL_PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="240" viewBox="0 0 120 240"><rect width="120" height="240" fill="#2d8b6f"/><rect x="20" y="20" width="80" height="200" fill="#faf6f1"/></svg>`;

let server;
let baseUrl;
let sqlAdapterPool;
let principals;
let browser;
let fixture;
let originalCommentMediaBase;

function findChromePath() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Chrome/Chromium binary not found on system.');
}

async function recordEvidence(page, name, { fullPage = false } = {}) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  return file;
}

async function recordResolutionEvidence(page, name, { fullPage = false } = {}) {
  fs.mkdirSync(RESOLUTION_EVIDENCE_DIR, { recursive: true });
  const file = path.join(RESOLUTION_EVIDENCE_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  return file;
}

async function recordReopenEvidence(page, name, { fullPage = false } = {}) {
  fs.mkdirSync(REOPEN_EVIDENCE_DIR, { recursive: true });
  const file = path.join(REOPEN_EVIDENCE_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  return file;
}

async function createTestPage(browserInstance, allowedErrors = []) {
  const page = await browserInstance.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);
  await page.setViewport({ width: 1280, height: 900 });

  const errors = [];
  page.on('pageerror', (err) => {
    errors.push(`PageError: ${err.message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      const isAllowed = allowedErrors.some((pat) => (pat instanceof RegExp ? pat.test(text) : text.includes(pat)));
      if (!isAllowed) {
        errors.push(`ConsoleError: ${text}`);
      }
    }
  });

  await page.evaluateOnNewDocument(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push({
        blockedURI: e.blockedURI,
        violatedDirective: e.violatedDirective,
      });
    });
  });

  return { page, errors };
}

async function loginAsAdmin(page, url, email = 'admin@example.com', password = 'super secure password') {
  await page.goto(`${url}/admin/login`, { waitUntil: 'networkidle0' });
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('form button')]);
}

async function openWorkspace(page) {
  await page.goto(`${baseUrl}/admin/resources/posts/records/${fixture.postId}/show`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="pupzy-review-workspace"]', { timeout: 60000 });
}

async function insertUser(label) {
  const { rows } = await database.pool.query(
    `INSERT INTO users (firebase_user_id, email, full_name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [`bwg06-browser-${label}`, `${label}@example.com`, `User ${label}`],
  );
  return rows[0].id;
}

async function insertComment({ postId, authorId, text, status = 'ACTIVE', parentId = null, createdAt }) {
  const { rows } = await database.pool.query(
    `INSERT INTO comments (post_id, author_id, text, status, parent_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [postId, authorId, text, status, parentId, createdAt],
  );
  return rows[0].id;
}

async function insertCommentMedia({ commentId, storageKey, displayOrder = 0 }) {
  const { rows } = await database.pool.query(
    `INSERT INTO comment_media
       (comment_id, storage_key, sha256, width, height, file_size_bytes, file_content_type, display_order)
     VALUES ($1, $2, repeat('b', 64), 120, 240, 40_000, 'image/webp', $3)
     RETURNING id`,
    [commentId, storageKey, displayOrder],
  );
  return rows[0].id;
}

async function seedReviewFixture() {
  const ownerId = await insertUser('review-owner');
  const commenterId = await insertUser('review-commenter');
  const postId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType: 'LOST',
    title: 'Found stray near the market',
    status: 'ACTIVE',
    moderationStatus: 'FLAGGED',
    createdAt: new Date(Date.now() - 5 * 86_400_000),
  });
  await database.pool.query(
    `INSERT INTO lost_posts
       (post_id, report_type, species, current_condition, is_currently_safe_with_reporter, date_found)
     VALUES ($1, 'FOUND_STRAY', 'DOG', 'HEALTHY', true, '2026-08-20')`,
    [postId],
  );
  await database.pool.query(`UPDATE posts SET area_name = 'Maadi' WHERE id = $1`, [postId]);

  await database.pool.query(
    `INSERT INTO post_media
       (post_id, public_url, cloudflare_storage_key, display_order, width, height, file_content_type, file_size_bytes)
     VALUES
       ($1, $2, $3, 0, 300, 100, 'image/webp', 40_000),
       ($1, $4, $5, 1, 300, 100, 'image/webp', 40_000)`,
    [
      postId,
      `${baseUrl}/admin/test-media/photo-wide.svg`,
      `posts/${postId}/wide.svg`,
      `${baseUrl}/admin/test-media/unavailable.svg`,
      `posts/${postId}/unavailable.svg`,
    ],
  );

  const now = Date.now();
  const comments = [];
  for (let index = 1; index <= 12; index += 1) {
    comments[index] = await insertComment({
      postId,
      authorId: commenterId,
      text: `Community Evidence comment number ${index}`,
      createdAt: new Date(now - (13 - index) * 3_600_000),
    });
  }
  const hiddenCommentId = await insertComment({
    postId,
    authorId: commenterId,
    text: 'Hidden evidence awaiting a decision',
    status: 'HIDDEN',
    createdAt: new Date(now - 0.5 * 3_600_000),
  });
  const removedCommentId = await insertComment({
    postId,
    authorId: commenterId,
    text: 'Abusive evidence removed by staff',
    status: 'REMOVED',
    createdAt: new Date(now - 0.25 * 3_600_000),
  });

  await insertCommentMedia({
    commentId: comments[12],
    storageKey: 'comments/browser/tall.svg',
    displayOrder: 0,
  });
  await insertCommentMedia({
    commentId: comments[12],
    storageKey: 'comments/browser/unavailable.svg',
    displayOrder: 1,
  });
  await insertCommentMedia({ commentId: hiddenCommentId, storageKey: '' });
  await insertCommentMedia({ commentId: removedCommentId, storageKey: 'comments/browser/tall.svg' });

  await insertComment({
    postId,
    authorId: ownerId,
    text: 'Thank you for the photo',
    parentId: comments[1],
    createdAt: new Date(now - 12 * 3_600_000 + 1000),
  });
  await insertComment({
    postId,
    authorId: commenterId,
    text: 'A reply that was later deleted',
    parentId: comments[1],
    status: 'DELETED',
    createdAt: new Date(now - 12 * 3_600_000 + 2000),
  });

  const reporterId = await insertUser('review-reporter');
  const secondReporterId = await insertUser('review-reporter-two');
  await database.pool.query(
    `INSERT INTO post_reports (post_id, reporter_id, reason, details)
     VALUES ($1, $2, 'INAPPROPRIATE_CONTENT', 'Looks staged')`,
    [postId, reporterId],
  );
  const reviewedReport = await database.pool.query(
    `INSERT INTO post_reports (post_id, reporter_id, reason)
     VALUES ($1, $2, 'SPAM')
     RETURNING id`,
    [postId, secondReporterId],
  );
  await database.pool.query(
    `UPDATE post_reports
     SET reviewed_at = now(), reviewed_by_admin_id = $2, review_outcome = 'NO_ACTION'
     WHERE id = $1`,
    [reviewedReport.rows[0].id, principals.adminId],
  );
  await database.pool.query(
    `INSERT INTO comment_reports (comment_id, reporter_id, reason, details)
     VALUES ($1, $2, 'SPAM', 'Repeated posting')`,
    [comments[12], reporterId],
  );
  await database.pool.query(
    `INSERT INTO moderation_actions (admin_user_id, action_type, target_type, target_id, reason)
     VALUES
       ($1, 'POST_FLAGGED', 'POST', $2, 'Looks staged'),
       ($1, 'COMMENT_REMOVED', 'COMMENT', $3, 'Abusive language')`,
    [principals.adminId, postId, removedCommentId],
  );

  fixture = { postId, ownerId, commenterId, hiddenCommentId, removedCommentId };
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

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use('/admin/assets', express.static(path.join(currentDirectory, '../src/adminjs/public')));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
        },
      },
    }),
  );
  app.get(/^\/admin\/test-media\/(.+)$/, (request, response) => {
    const name = request.params[0];
    if (name.endsWith('photo-wide.svg')) {
      return response.type('image/svg+xml').send(WIDE_PHOTO_SVG);
    }
    if (name.endsWith('tall.svg')) {
      return response.type('image/svg+xml').send(TALL_PHOTO_SVG);
    }
    return response.status(404).type('text/plain').send('missing test media');
  });
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
    }),
  );
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  originalCommentMediaBase = process.env.COMMENT_MEDIA_CDN_BASE;
  process.env.COMMENT_MEDIA_CDN_BASE = `${baseUrl}/admin/test-media`;

  const built = await buildAdminJs(connectionString, databaseName, database.pool);
  sqlAdapterPool = built.sqlAdapterPool;
  await built.admin.initialize();
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

  try {
    const res = await fetch(`${baseUrl}/admin/login`);
    await res.text();
  } catch {}

  browser = await puppeteer.launch({
    executablePath: findChromePath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
});

beforeEach(async () => {
  await database.pool.query(`TRUNCATE TABLE ${BUSINESS_TABLES} CASCADE`);
  await seedReviewFixture();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await sqlAdapterPool?.destroy();
  await database.stop();
  if (originalCommentMediaBase === undefined) {
    delete process.env.COMMENT_MEDIA_CDN_BASE;
  } else {
    process.env.COMMENT_MEDIA_CDN_BASE = originalCommentMediaBase;
  }
});

describe('Post review workspace real browser suite', { timeout: 120000 }, () => {
  it('renders original photos and Community Evidence as aligned thumbnails with readable state labels', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource.*404/]);
    try {
      await loginAsAdmin(page, baseUrl);
      await openWorkspace(page);

      await page.waitForFunction(() =>
        Array.from(
          document.querySelectorAll('[data-testid="pupzy-original-photos"] [data-testid="pupzy-media-thumb"]'),
        ).some((element) => element.dataset.unavailable === 'true'),
      );

      const bodyText = await page.evaluate(() => document.body.innerText);
      assert.match(bodyText, /Found stray near the market/);
      assert.match(bodyText, /Lost & found/);
      assert.match(bodyText, /Found stray/);
      assert.match(bodyText, /Flagged/);
      assert.match(bodyText, /Cairo/);
      assert.match(bodyText, /Maadi/);

      const originalThumbs = await page.$$eval(
        '[data-testid="pupzy-original-photos"] [data-testid="pupzy-media-thumb"]',
        (elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect();
            return { width: box.width, height: box.height, unavailable: element.dataset.unavailable };
          }),
      );
      assert.equal(originalThumbs.length, 2, 'both original photos render as thumbnails');
      assert.ok(
        originalThumbs.some((thumb) => thumb.unavailable === 'true'),
        'the broken original photo falls back',
      );
      assert.ok(
        originalThumbs.some((thumb) => thumb.unavailable === 'false'),
        'the readable original photo renders',
      );
      assert.ok(Math.abs(originalThumbs[0].width - originalThumbs[1].width) <= 1);
      assert.ok(Math.abs(originalThumbs[0].height - originalThumbs[1].height) <= 1);
      assert.ok(Math.abs(originalThumbs[0].width - originalThumbs[0].height) <= 1, 'thumbnail cells are square');

      const discussionThumbs = await page.$$eval(
        '[data-testid="pupzy-discussion"] [data-testid="pupzy-media-thumb"]',
        (elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect();
            return { width: box.width, height: box.height, unavailable: element.dataset.unavailable };
          }),
      );
      assert.equal(discussionThumbs.length, 4, 'Comment attachments render on the first discussion page');
      assert.ok(Math.abs(discussionThumbs[0].width - discussionThumbs[1].width) <= 1);
      assert.ok(Math.abs(discussionThumbs[0].height - discussionThumbs[1].height) <= 1);

      const statuses = await page.$$eval('[data-testid="pupzy-discussion-item"]', (elements) =>
        elements.map((element) => ({ status: element.dataset.status, text: element.innerText })),
      );
      assert.equal(statuses.length, 10, 'the first page shows ten top-level Comments');
      assert.ok(statuses.some((item) => item.status === 'HIDDEN' && item.text.includes('Hidden')));
      assert.ok(statuses.some((item) => item.status === 'REMOVED' && item.text.includes('Removed')));
      assert.ok(statuses.some((item) => item.status === 'ACTIVE'));

      const pageLabel = await page.$eval('[data-testid="pupzy-discussion-page"]', (element) => element.innerText);
      assert.match(pageLabel, /Page 1 of 2/);
      assert.match(pageLabel, /14 Comments/);
      const previousDisabled = await page.$eval(
        '[data-testid="pupzy-discussion-previous"]',
        (element) => element.disabled,
      );
      assert.equal(previousDisabled, true);

      const reportsText = await page.$eval('[data-testid="pupzy-reports"]', (element) => element.innerText);
      assert.match(reportsText, /Open/);
      assert.match(reportsText, /Reviewed/);
      assert.match(reportsText, /Inappropriate content/);
      const reportHrefs = await page.$$eval('[data-testid="pupzy-report-review-link"]', (elements) =>
        elements.map((element) => element.getAttribute('href')),
      );
      assert.ok(reportHrefs.some((href) => href.includes('/admin/resources/post_reports/records/')));
      assert.ok(reportHrefs.some((href) => href.includes('/admin/resources/comment_reports/records/')));

      const historyText = await page.$eval('[data-testid="pupzy-action-history"]', (element) => element.innerText);
      assert.match(historyText, /Post flagged/);
      assert.match(historyText, /Looks staged/);
      assert.match(historyText, /Comment removed/);
      assert.match(historyText, /Abusive language/);
      assert.match(historyText, /Test Admin/);

      const cspViolations = await page.evaluate(() =>
        (window.__cspViolations || []).filter(
          (entry) =>
            entry.blockedURI && entry.blockedURI !== 'eval' && !entry.blockedURI.startsWith('chrome-extension'),
        ),
      );
      assert.deepEqual(cspViolations, []);
      assert.deepEqual(errors, []);
      console.log(
        `[bwg-06 evidence] workspace ${await recordEvidence(page, '01-workspace-desktop', { fullPage: true })}`,
      );
    } finally {
      await page.close();
    }
  });

  it('opens full-image previews preserving aspect ratio and supports keyboard focus, navigation and dismissal', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource.*404/]);
    try {
      await loginAsAdmin(page, baseUrl);
      await openWorkspace(page);

      const originalThumb = await page.waitForSelector(
        '[data-testid="pupzy-original-photos"] [data-testid="pupzy-media-thumb"][data-unavailable="false"]',
      );
      await originalThumb.click();
      await page.waitForSelector('[data-testid="pupzy-image-dialog"]');

      const opened = await page.evaluate(() => ({
        activeLabel: document.activeElement?.getAttribute('aria-label'),
        image: (() => {
          const element = document.querySelector('[data-testid="pupzy-image-dialog-content"]');
          if (!element) return null;
          return {
            naturalWidth: element.naturalWidth,
            naturalHeight: element.naturalHeight,
            width: element.clientWidth,
            height: element.clientHeight,
            objectFit: getComputedStyle(element).objectFit,
          };
        })(),
        dialogLabel: document.querySelector('[data-testid="pupzy-image-dialog"]')?.getAttribute('aria-label'),
      }));
      assert.equal(opened.activeLabel, 'Close image preview', 'focus moves into the dialog');
      assert.equal(opened.dialogLabel, 'Full image preview, image 1 of 2');
      assert.equal(opened.image.naturalWidth, 300);
      assert.equal(opened.image.naturalHeight, 100);
      assert.equal(opened.image.objectFit, 'contain');
      const naturalRatio = opened.image.naturalWidth / opened.image.naturalHeight;
      const renderedRatio = opened.image.width / opened.image.height;
      assert.ok(
        Math.abs(naturalRatio - renderedRatio) < 0.05,
        `the full preview preserves the ${naturalRatio.toFixed(2)} aspect ratio instead of cropping`,
      );
      assert.ok(opened.image.width <= 1080 && opened.image.height <= 900);
      console.log(`[bwg-06 evidence] image dialog ${await recordEvidence(page, '02-full-image-preview')}`);

      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="pupzy-image-dialog"]')?.getAttribute('aria-label') ===
          'Full image preview, image 2 of 2',
      );
      const fallbackText = await page.$eval('.pupzy-media-dialog-fallback', (element) => element.innerText);
      assert.match(fallbackText, /unavailable/i, 'a broken image degrades to a readable fallback');

      await page.keyboard.press('Tab');
      const focusInsideDialog = await page.evaluate(
        () => document.activeElement?.closest('[data-testid="pupzy-image-dialog"]') !== null,
      );
      assert.equal(focusInsideDialog, true, 'Tab keeps focus inside the modal');

      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('[data-testid="pupzy-image-dialog"]') === null);
      const focusReturned = await page.evaluate(() => ({
        testId: document.activeElement?.dataset?.testid,
        label: document.activeElement?.getAttribute('aria-label'),
      }));
      assert.equal(focusReturned.testId, 'pupzy-media-thumb', 'focus returns to the thumbnail that opened the preview');

      await page.evaluate(() => {
        const thumb = document.querySelector(
          '[data-testid="pupzy-original-photos"] [data-testid="pupzy-media-thumb"][data-unavailable="false"]',
        );
        thumb.focus();
      });
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-testid="pupzy-image-dialog"]');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('[data-testid="pupzy-image-dialog"]') === null);

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('paginates Community Evidence through the authenticated admin API and labels every page', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource.*404/]);
    const discussionRequests = [];
    try {
      page.on('request', (request) => {
        if (request.url().includes('postReviewDiscussion')) discussionRequests.push(request.url());
      });

      await loginAsAdmin(page, baseUrl);
      await openWorkspace(page);

      await page.click('[data-testid="pupzy-discussion-next"]');
      await page.waitForFunction(() =>
        document.querySelector('[data-testid="pupzy-discussion-page"]')?.innerText.includes('Page 2 of 2'),
      );

      const pageTwo = await page.evaluate(() => ({
        items: Array.from(document.querySelectorAll('[data-testid="pupzy-discussion-item"]')).map(
          (element) => element.innerText,
        ),
        replies: Array.from(document.querySelectorAll('[data-testid="pupzy-discussion-reply"]')).map(
          (element) => element.innerText,
        ),
        label: document.querySelector('[data-testid="pupzy-discussion-page"]').innerText,
        nextDisabled: document.querySelector('[data-testid="pupzy-discussion-next"]').disabled,
        previousDisabled: document.querySelector('[data-testid="pupzy-discussion-previous"]').disabled,
      }));
      assert.equal(pageTwo.items.length, 4, 'the final page holds the remaining Comments');
      assert.match(pageTwo.label, /Page 2 of 2/);
      assert.equal(pageTwo.nextDisabled, true);
      assert.equal(pageTwo.previousDisabled, false);
      assert.equal(pageTwo.replies.length, 2, 'Replies render with their parent Comment');
      assert.ok(pageTwo.replies.some((reply) => reply.includes('Deleted')));
      assert.equal(discussionRequests.length, 1);
      assert.match(discussionRequests[0], /postReviewDiscussion\?page=2$/);
      console.log(`[bwg-06 evidence] discussion page 2 ${await recordEvidence(page, '03-discussion-page-two')}`);

      await page.click('[data-testid="pupzy-discussion-previous"]');
      await page.waitForFunction(() =>
        document.querySelector('[data-testid="pupzy-discussion-page"]')?.innerText.includes('Page 1 of 2'),
      );
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('shows clear empty and request-error states without losing the record page', async () => {
    const { page, errors } = await createTestPage(browser, [
      /Failed to load resource.*404/,
      /Failed to load resource.*500/,
      /Request failed with status code 500/,
    ]);
    try {
      const emptyPostId = await insertPost(database.pool, {
        userId: fixture.ownerId,
        cityId: principals.cityId,
        postType: 'ADOPTION',
        title: 'Post without any evidence yet',
      });

      await loginAsAdmin(page, baseUrl);
      await page.goto(`${baseUrl}/admin/resources/posts/records/${emptyPostId}/show`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid="pupzy-review-workspace"]');
      const emptyText = await page.$eval('[data-testid="pupzy-review-workspace"]', (element) => element.innerText);
      assert.match(emptyText, /No photos were attached/);
      assert.match(emptyText, /No Comments or Replies/);
      assert.match(emptyText, /No Post Reports/);
      assert.match(emptyText, /No Comment Reports/);
      assert.match(emptyText, /No administrator actions/);

      await openWorkspace(page);

      let discussionRequests = 0;
      await page.setRequestInterception(true);
      page.on('request', async (request) => {
        if (request.url().includes('postReviewDiscussion')) {
          discussionRequests += 1;
          if (discussionRequests === 1) {
            await new Promise((resolve) => setTimeout(resolve, 700));
            return request.respond({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'simulated discussion failure' }),
            });
          }
          return request.continue();
        }
        return request.continue();
      });

      await page.click('[data-testid="pupzy-discussion-next"]');
      const loadingState = await page.evaluate(() => ({
        busy: document.querySelector('[data-testid="pupzy-discussion"] nav')?.getAttribute('aria-busy'),
        nextDisabled: document.querySelector('[data-testid="pupzy-discussion-next"]').disabled,
        previousDisabled: document.querySelector('[data-testid="pupzy-discussion-previous"]').disabled,
      }));
      assert.equal(loadingState.busy, 'true', 'the discussion reports its loading state');
      assert.equal(loadingState.nextDisabled, true, 'loading disables duplicate page submissions');
      assert.equal(loadingState.previousDisabled, true);

      await page.waitForFunction(() =>
        document.querySelector('[data-testid="pupzy-discussion"]')?.innerText.includes('could not be loaded'),
      );
      const afterError = await page.evaluate(() => {
        const alert = document.querySelector('[data-testid="pupzy-discussion"] [role="alert"]');
        return {
          errorText: alert?.innerText ?? '',
          errorRole: alert?.getAttribute('role'),
          label: document.querySelector('[data-testid="pupzy-discussion-page"]').innerText,
          busy: document.querySelector('[data-testid="pupzy-discussion"] nav')?.getAttribute('aria-busy'),
          nextDisabled: document.querySelector('[data-testid="pupzy-discussion-next"]').disabled,
        };
      });
      assert.equal(afterError.errorRole, 'alert');
      assert.match(afterError.errorText, /could not be loaded/);
      assert.match(afterError.label, /Page 1 of 2/, 'a failed page keeps the last good page visible');
      assert.equal(afterError.busy, 'false');
      assert.equal(afterError.nextDisabled, false, 'the failed request can be retried');
      console.log(`[bwg-06 evidence] discussion error ${await recordEvidence(page, '06-discussion-error-state')}`);

      await page.click('[data-testid="pupzy-discussion-next"]');
      await page.waitForFunction(() =>
        document.querySelector('[data-testid="pupzy-discussion-page"]')?.innerText.includes('Page 2 of 2'),
      );
      assert.equal(discussionRequests, 2);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('keeps the workspace usable under reduced motion and on a narrow screen', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource.*404/]);
    try {
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await loginAsAdmin(page, baseUrl);
      await page.setViewport({ width: 390, height: 844 });
      await openWorkspace(page);

      const reducedMotion = await page.evaluate(() => {
        const thumb = document.querySelector('[data-testid="pupzy-media-thumb"]');
        const style = getComputedStyle(thumb);
        return {
          transitionSeconds: parseFloat(style.transitionDuration),
          animationSeconds: parseFloat(style.animationDuration || '0'),
        };
      });
      assert.ok(
        reducedMotion.transitionSeconds <= 0.001,
        `reduced motion collapses thumbnail transitions (saw ${reducedMotion.transitionSeconds}s)`,
      );

      const layout = await page.evaluate(() => {
        const workspace = document.querySelector('[data-testid="pupzy-review-workspace"]');
        const workspaceBox = workspace.getBoundingClientRect();
        const measure = (selector) =>
          Array.from(document.querySelectorAll(selector)).map((element) => {
            const box = element.getBoundingClientRect();
            return { width: box.width, height: box.height, right: box.right };
          });
        const originalThumbs = measure('[data-testid="pupzy-original-photos"] [data-testid="pupzy-media-thumb"]');
        const discussionThumbs = measure('[data-testid="pupzy-discussion"] [data-testid="pupzy-media-thumb"]');
        const thumbs = [...originalThumbs, ...discussionThumbs];
        const spread = (items) =>
          Math.max(...items.map((thumb) => thumb.width)) - Math.min(...items.map((thumb) => thumb.width));
        return {
          documentClientWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          workspaceWidth: workspaceBox.width,
          workspaceRight: workspaceBox.right,
          originalSpread: spread(originalThumbs),
          discussionSpread: spread(discussionThumbs),
          widestThumbRight: Math.max(...thumbs.map((thumb) => thumb.right)),
        };
      });
      assert.equal(
        layout.documentScrollWidth,
        layout.documentClientWidth,
        'the 390px viewport must not scroll horizontally',
      );
      assert.ok(layout.workspaceWidth <= layout.documentClientWidth);
      assert.ok(layout.widestThumbRight <= layout.documentClientWidth + 1, 'thumbnails stay inside the viewport');
      assert.ok(layout.originalSpread <= 1, 'original photo cells stay aligned on narrow screens');
      assert.ok(layout.discussionSpread <= 1, 'Comment attachment cells stay aligned on narrow screens');

      await page.click('[data-testid="pupzy-media-thumb"][data-unavailable="false"]');
      await page.waitForSelector('[data-testid="pupzy-image-dialog"]');
      const dialogFits = await page.evaluate(() => {
        const element = document.querySelector('[data-testid="pupzy-image-dialog-content"]');
        const box = element.getBoundingClientRect();
        return {
          width: box.width,
          right: box.right,
          ratio: box.width / box.height,
          naturalRatio: element.naturalWidth / element.naturalHeight,
          objectFit: getComputedStyle(element).objectFit,
        };
      });
      assert.ok(dialogFits.width <= 390, 'the full preview fits the narrow viewport');
      assert.ok(Math.abs(dialogFits.ratio - dialogFits.naturalRatio) < 0.05);
      assert.equal(dialogFits.objectFit, 'contain');
      console.log(`[bwg-06 evidence] narrow screen ${await recordEvidence(page, '04-narrow-screen')}`);
      await page.keyboard.press('Escape');

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('lets a plain ADMIN review the workspace while keeping existing moderation actions intact', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource.*404/]);
    try {
      await loginAsAdmin(page, baseUrl, 'staff@example.com', 'staff secure password');
      await openWorkspace(page);

      assert.ok(await page.$('[data-testid="action-approvePost"]'), 'the existing Approve action stays available');
      assert.ok(await page.$('[data-testid="action-removePost"]'), 'the existing Remove action stays available');
      assert.equal(await page.$('[data-testid="action-flagPost"]'), null, 'invalid FLAGGED transitions stay hidden');
      assert.equal(
        await page.$('[data-testid="action-postReviewDiscussion"]'),
        null,
        'the pagination API action is not exposed as a button',
      );

      await page.click('[data-testid="action-removePost"]');
      await page.waitForSelector('#moderation-reason', { timeout: 30000 });
      const reasonLabel = await page.$eval('label[for="moderation-reason"]', (element) => element.innerText);
      assert.match(reasonLabel, /Reason/i);
      console.log(
        `[bwg-06 evidence] existing remove action ${await recordEvidence(page, '05-existing-remove-action')}`,
      );

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('resolves a found-stray case with a required reason, audit history and localized owner notification', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource.*404/]);
    try {
      await database.pool.query(
        `INSERT INTO contact_requests (post_id, requester_id, message)
         VALUES ($1, $2, 'Please share the owner contact')`,
        [fixture.postId, fixture.commenterId],
      );

      await loginAsAdmin(page, baseUrl, 'staff@example.com', 'staff secure password');
      await openWorkspace(page);

      const offered = await page.evaluate(() =>
        ['markRescued', 'markReunited', 'markResolved', 'markAdopted', 'markSold', 'removePost'].filter(
          (name) => document.querySelector(`[data-testid="action-${name}"]`) !== null,
        ),
      );
      assert.deepEqual(offered, ['markReunited', 'markResolved', 'removePost']);

      const stillActive = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [fixture.postId]))
        .rows[0];
      assert.equal(stillActive.status, 'ACTIVE', 'inspecting a case never forces an outcome');

      await page.click('[data-testid="action-markResolved"]');
      await page.waitForSelector('#moderation-reason', { timeout: 30000 });

      const confirmation = await page.evaluate(() => {
        const submit = document.querySelector('[data-testid="moderation-action-submit"]');
        return {
          heading: document.querySelector('h3')?.innerText ?? '',
          consequence: document.querySelector('#moderation-action-consequence')?.innerText ?? '',
          submitLabel: submit?.innerText ?? '',
          submitVariant: submit?.dataset.variant ?? '',
          submitDisabled: submit?.disabled ?? null,
          describedBy: document.querySelector('#moderation-reason')?.getAttribute('aria-describedby'),
        };
      });
      assert.match(confirmation.heading, /Mark resolved/);
      assert.match(confirmation.consequence, /Records this case as resolved/);
      assert.match(confirmation.consequence, /notifies the owner/);
      assert.match(confirmation.consequence, /not removed/);
      assert.equal(confirmation.submitVariant, 'primary', 'resolution is not styled as a destructive removal');
      assert.equal(confirmation.submitDisabled, true, 'the reason is required before the outcome can be recorded');
      assert.equal(confirmation.describedBy, 'moderation-action-consequence');
      console.log(
        `[bwg-08 evidence] resolution confirmation ${await recordResolutionEvidence(page, '01-resolution-confirmation')}`,
      );

      await page.type('#moderation-reason', 'Animal safely reunited with its owner');
      await page.waitForFunction(
        () => document.querySelector('[data-testid="moderation-action-submit"]')?.disabled === false,
      );
      await page.click('[data-testid="moderation-action-submit"]');

      await page.waitForFunction(() => document.body.innerText.includes('Post marked resolved'), {
        timeout: 60000,
      });
      const resultText = await page.$eval('body', (element) => element.innerText);
      assert.match(resultText, /Animal safely reunited with its owner/);
      console.log(
        `[bwg-08 evidence] resolution result ${await recordResolutionEvidence(page, '02-resolution-result', {
          fullPage: true,
        })}`,
      );

      const post = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [fixture.postId])).rows[0];
      assert.equal(post.status, 'RESOLVED');
      const audit = (
        await database.pool.query(
          `SELECT action_type, admin_user_id, reason, metadata FROM moderation_actions
           WHERE target_id = $1 AND action_type = 'POST_RESOLVED'`,
          [fixture.postId],
        )
      ).rows[0];
      assert.equal(audit.reason, 'Animal safely reunited with its owner');
      assert.equal(audit.metadata.outcome, 'RESOLVED');
      assert.ok(audit.admin_user_id);
      const notifications = (
        await database.pool.query(
          `SELECT type, recipient_id, related_post_id, title, body, title_arabic, body_arabic
           FROM notifications WHERE related_post_id = $1`,
          [fixture.postId],
        )
      ).rows;
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].type, 'POST_RESOLVED_BY_ADMIN');
      assert.equal(notifications[0].recipient_id, fixture.ownerId);
      assert.equal(notifications[0].title, 'Post outcome recorded');
      assert.equal(
        notifications[0].body,
        'An administrator marked your post "Found stray near the market" as resolved.',
      );
      assert.equal(notifications[0].title_arabic, 'تم تسجيل نتيجة المنشور');
      assert.ok(notifications[0].body_arabic.length > 0);
      const contactRequest = (
        await database.pool.query(`SELECT status, responded_at FROM contact_requests WHERE post_id = $1`, [
          fixture.postId,
        ])
      ).rows[0];
      assert.equal(contactRequest.status, 'REJECTED');
      assert.ok(contactRequest.responded_at);

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('offers only valid outcome actions per type and keeps resolution visually distinct from removal', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource.*404/]);
    try {
      const productId = await insertPost(database.pool, {
        userId: fixture.ownerId,
        cityId: principals.cityId,
        postType: 'PRODUCT',
        title: 'Product listing awaiting a buyer',
        marketCategory: 'FOOD',
      });
      const lostPetId = await insertPost(database.pool, {
        userId: fixture.ownerId,
        cityId: principals.cityId,
        postType: 'LOST',
        title: 'Lost pet case',
      });
      await database.pool.query(
        `INSERT INTO lost_posts (post_id, report_type, species, pet_name, date_last_seen)
         VALUES ($1, 'LOST_PET', 'DOG', 'Rex', '2026-08-20')`,
        [lostPetId],
      );

      await loginAsAdmin(page, baseUrl);

      await page.goto(`${baseUrl}/admin/resources/posts/records/${productId}/show`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid="pupzy-review-workspace"]');
      const productActions = await page.evaluate(() =>
        ['markRescued', 'markReunited', 'markResolved', 'markAdopted', 'markSold'].filter(
          (name) => document.querySelector(`[data-testid="action-${name}"]`) !== null,
        ),
      );
      assert.deepEqual(productActions, ['markSold'], 'a product listing only offers its sold outcome');

      await page.click('[data-testid="action-markSold"]');
      await page.waitForSelector('#moderation-reason', { timeout: 30000 });
      const soldDialog = await page.evaluate(() => ({
        heading: document.querySelector('h3')?.innerText ?? '',
        consequence: document.querySelector('#moderation-action-consequence')?.innerText ?? '',
        submitVariant: document.querySelector('[data-testid="moderation-action-submit"]')?.dataset.variant,
      }));
      assert.match(soldDialog.heading, /Mark sold/);
      assert.match(soldDialog.consequence, /Records this listing as sold/);
      assert.equal(soldDialog.submitVariant, 'primary');
      console.log(
        `[bwg-08 evidence] product outcome confirmation ${await recordResolutionEvidence(
          page,
          '03-product-outcome-confirmation',
        )}`,
      );

      await page.goto(`${baseUrl}/admin/resources/posts/records/${lostPetId}/show`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid="pupzy-review-workspace"]');
      const lostPetActions = await page.evaluate(() =>
        ['markRescued', 'markReunited', 'markResolved', 'markAdopted', 'markSold'].filter(
          (name) => document.querySelector(`[data-testid="action-${name}"]`) !== null,
        ),
      );
      assert.deepEqual(lostPetActions, ['markReunited'], 'a lost pet only offers its reunited outcome');

      await page.click('[data-testid="action-removePost"]');
      await page.waitForSelector('#moderation-reason', { timeout: 30000 });
      const removalDialog = await page.evaluate(() => ({
        heading: document.querySelector('h3')?.innerText ?? '',
        consequence: document.querySelector('#moderation-action-consequence')?.innerText ?? '',
        submitVariant: document.querySelector('[data-testid="moderation-action-submit"]')?.dataset.variant,
      }));
      assert.match(removalDialog.heading, /Remove Post/);
      assert.match(removalDialog.consequence, /Removes the Post from discovery/);
      assert.equal(removalDialog.submitVariant, 'danger', 'removal stays a distinct destructive action');
      console.log(
        `[bwg-08 evidence] removal confirmation ${await recordResolutionEvidence(page, '04-removal-confirmation')}`,
      );

      const lostPet = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [lostPetId])).rows[0];
      assert.equal(lostPet.status, 'ACTIVE', 'opening a confirmation never records an outcome');
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('corrects a mistaken resolution through Reopen with a required reason, audited history and owner notification', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource.*404/]);
    try {
      await database.pool.query(
        `INSERT INTO contact_requests (post_id, requester_id, message)
         VALUES ($1, $2, 'Please share the owner contact')`,
        [fixture.postId, fixture.commenterId],
      );

      await loginAsAdmin(page, baseUrl, 'staff@example.com', 'staff secure password');
      await openWorkspace(page);

      await page.click('[data-testid="action-markResolved"]');
      await page.waitForSelector('#moderation-reason', { timeout: 30000 });
      await page.type('#moderation-reason', 'Animal recovered, case is resolved');
      await page.waitForFunction(
        () => document.querySelector('[data-testid="moderation-action-submit"]')?.disabled === false,
      );
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }),
        page.click('[data-testid="moderation-action-submit"]'),
      ]);
      await page.waitForFunction(() => document.body.innerText.includes('Post marked resolved'), {
        timeout: 60000,
      });

      await page.waitForSelector('[data-testid="action-reopenPost"]', { timeout: 60000 });
      const lifecycleActions = await page.evaluate(() =>
        [
          'markRescued',
          'markReunited',
          'markResolved',
          'markAdopted',
          'markSold',
          'removePost',
          'restorePost',
          'reopenPost',
        ].filter((name) => document.querySelector(`[data-testid="action-${name}"]`) !== null),
      );
      assert.deepEqual(
        lifecycleActions,
        ['reopenPost'],
        'a recorded outcome offers only the Reopen correction, never removal, restoration or a second outcome',
      );

      await page.click('[data-testid="action-reopenPost"]');
      await page.waitForSelector('#moderation-reason', { timeout: 30000 });
      const confirmation = await page.evaluate(() => {
        const submit = document.querySelector('[data-testid="moderation-action-submit"]');
        return {
          heading: document.querySelector('h3')?.innerText ?? '',
          consequence: document.querySelector('#moderation-action-consequence')?.innerText ?? '',
          submitLabel: submit?.innerText ?? '',
          submitVariant: submit?.dataset.variant ?? '',
          submitDisabled: submit?.disabled ?? null,
        };
      });
      assert.match(confirmation.heading, /Reopen Post/);
      assert.match(confirmation.consequence, /Closed contact requests and adoption applications stay closed/);
      assert.match(confirmation.consequence, /removed content is not restored/i);
      assert.match(confirmation.consequence, /notifies the owner|owner is notified/i);
      assert.equal(confirmation.submitVariant, 'primary', 'a correction is not styled as a destructive removal');
      assert.equal(confirmation.submitDisabled, true, 'the reason is required before the correction can be recorded');
      console.log(
        `[bwg-09 evidence] reopen confirmation ${await recordReopenEvidence(page, '01-reopen-confirmation')}`,
      );

      await page.type('#moderation-reason', 'Resolution was recorded by mistake');
      await page.waitForFunction(
        () => document.querySelector('[data-testid="moderation-action-submit"]')?.disabled === false,
      );
      await page.click('[data-testid="moderation-action-submit"]');
      await page.waitForFunction(
        () => {
          const text = document.body.innerText;
          return text.includes('Post reopened.') || text.includes('Post reopened (was resolved)');
        },
        { timeout: 60000 },
      );
      await page.waitForSelector('[data-testid="pupzy-review-workspace"]', { timeout: 60000 });
      console.log(
        `[bwg-09 evidence] reopen result ${await recordReopenEvidence(page, '02-reopen-result', { fullPage: true })}`,
      );

      const post = (await database.pool.query(`SELECT status FROM posts WHERE id = $1`, [fixture.postId])).rows[0];
      assert.equal(post.status, 'ACTIVE', 'the corrected Post returns to discovery as Active');
      const audits = (
        await database.pool.query(
          `SELECT action_type, admin_user_id, reason, metadata FROM moderation_actions
           WHERE target_id = $1 AND action_type IN ('POST_RESOLVED', 'POST_REOPENED')
           ORDER BY created_at, action_type`,
          [fixture.postId],
        )
      ).rows;
      assert.deepEqual(audits.map((row) => row.action_type).sort(), ['POST_REOPENED', 'POST_RESOLVED']);
      const reopenAudit = audits.find((row) => row.action_type === 'POST_REOPENED');
      assert.equal(reopenAudit.reason, 'Resolution was recorded by mistake');
      assert.equal(reopenAudit.metadata.previousOutcome, 'RESOLVED');
      assert.ok(reopenAudit.admin_user_id);

      const notifications = (
        await database.pool.query(
          `SELECT type, recipient_id, related_post_id, title, body, title_arabic, body_arabic
           FROM notifications WHERE related_post_id = $1 ORDER BY created_at, type`,
          [fixture.postId],
        )
      ).rows;
      assert.deepEqual(notifications.map((row) => row.type).sort(), [
        'POST_REOPENED_BY_ADMIN',
        'POST_RESOLVED_BY_ADMIN',
      ]);
      const reopenNotification = notifications.find((row) => row.type === 'POST_REOPENED_BY_ADMIN');
      assert.equal(reopenNotification.recipient_id, fixture.ownerId);
      assert.equal(reopenNotification.title, 'Post reopened');
      assert.equal(reopenNotification.body, 'An administrator reopened your post "Found stray near the market".');
      assert.equal(reopenNotification.title_arabic, 'تمت إعادة فتح المنشور');
      assert.ok(reopenNotification.body_arabic.includes('Found stray near the market'));

      const contactRequest = (
        await database.pool.query(`SELECT status, responded_at FROM contact_requests WHERE post_id = $1`, [
          fixture.postId,
        ])
      ).rows[0];
      assert.equal(contactRequest.status, 'REJECTED', 'reopening never revives a closed request');
      assert.ok(contactRequest.responded_at);

      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid="pupzy-review-workspace"]', { timeout: 60000 });
      const historyText = await page.$eval('[data-testid="pupzy-action-history"]', (element) => element.innerText);
      assert.match(historyText, /Post reopened \(was resolved\)/);
      assert.match(historyText, /Resolution was recorded by mistake/);
      assert.match(historyText, /Post marked resolved/);
      const activeActions = await page.evaluate(() =>
        ['markRescued', 'markReunited', 'markResolved', 'markAdopted', 'markSold', 'reopenPost'].filter(
          (name) => document.querySelector(`[data-testid="action-${name}"]`) !== null,
        ),
      );
      assert.deepEqual(
        activeActions,
        ['markReunited', 'markResolved'],
        'the corrected case is resolvable again and no longer offers reopening',
      );
      console.log(
        `[bwg-09 evidence] reopened history ${await recordReopenEvidence(page, '03-reopen-history', {
          fullPage: true,
        })}`,
      );

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
});

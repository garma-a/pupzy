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
const EVIDENCE_DIR = process.env.BWG21_EVIDENCE_DIR || '/tmp/opencode/bwg-21-evidence';

const BUSINESS_TABLES = `
  post_media, rescue_posts, lost_posts, adoption_posts, product_posts, mating_posts,
  post_upvotes, post_saves, contact_requests, adoption_applications, post_reports, comment_reports, account_reports,
  notifications, moderation_actions, posts, users,
  comments, comment_media, post_pins, comment_boosts, comment_idempotency,
  media_deletion_work, blocked_media_hashes, blocks, account_deletions
`;

const WIDE_PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100"><rect width="300" height="100" fill="#c4622d"/><circle cx="150" cy="50" r="30" fill="#faf6f1"/></svg>`;
const LONG_TITLE =
  'A deliberately long listing title that keeps going well past the ordinary cell width so the responsive table has to truncate it without breaking the page layout';

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
      if (!isAllowed) errors.push(`ConsoleError: ${text}`);
    }
  });
  return { page, errors };
}

async function loginAsAdmin(page, url) {
  await page.goto(`${url}/admin/login`, { waitUntil: 'networkidle0' });
  await page.type('input[name="email"]', 'staff@example.com');
  await page.type('input[name="password"]', 'staff secure password');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('form button')]);
}

async function openDashboard(page) {
  await page.goto(`${baseUrl}/admin`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="pupzy-work-queues"]', { timeout: 60000 });
}

async function openWorkspace(page, postId) {
  await page.goto(`${baseUrl}/admin/resources/posts/records/${postId}/show`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="pupzy-review-workspace"]', { timeout: 60000 });
}

async function waitForEnabledSubmit(page) {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="moderation-action-submit"]')?.disabled === false,
    { timeout: 30000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
}

function submitStyles(page) {
  return page.evaluate(() => {
    const submit = document.querySelector('[data-testid="moderation-action-submit"]');
    const style = getComputedStyle(submit);
    return {
      variant: submit.dataset.variant,
      disabled: submit.disabled,
      ariaBusy: submit.getAttribute('aria-busy'),
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      color: style.color,
      cursor: style.cursor,
      transform: style.transform,
    };
  });
}

async function insertUser(label) {
  const { rows } = await database.pool.query(
    `INSERT INTO users (firebase_user_id, email, full_name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [`bwg21-browser-${label}`, `${label}@example.com`, `User ${label}`],
  );
  return rows[0].id;
}

async function insertComment({ postId, authorId, text, createdAt }) {
  const { rows } = await database.pool.query(
    `INSERT INTO comments (post_id, author_id, text, status, created_at)
     VALUES ($1, $2, $3, 'ACTIVE', $4)
     RETURNING id`,
    [postId, authorId, text, createdAt],
  );
  return rows[0].id;
}

async function insertCommentMedia(commentId, storageKey) {
  await database.pool.query(
    `INSERT INTO comment_media
       (comment_id, storage_key, sha256, width, height, file_size_bytes, file_content_type, display_order)
     VALUES ($1, $2, repeat('b', 64), 300, 100, 40_000, 'image/webp', 0)`,
    [commentId, storageKey],
  );
}

async function seedReviewExperienceFixture() {
  const ownerId = await insertUser('experience-owner');
  const commenterId = await insertUser('experience-commenter');
  const reporterId = await insertUser('experience-reporter');

  fixture = { ownerId, commenterId };

  fixture.flaggedId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType: 'LOST',
    title: 'Flagged case awaiting review',
    status: 'ACTIVE',
    moderationStatus: 'FLAGGED',
    createdAt: new Date(Date.now() - 5 * 86_400_000),
  });
  await database.pool.query(
    `INSERT INTO lost_posts
       (post_id, report_type, species, current_condition, is_currently_safe_with_reporter, date_found)
     VALUES ($1, 'FOUND_STRAY', 'DOG', 'HEALTHY', true, '2026-08-20')`,
    [fixture.flaggedId],
  );
  await database.pool.query(`UPDATE posts SET area_name = 'Maadi' WHERE id = $1`, [fixture.flaggedId]);
  await database.pool.query(
    `INSERT INTO post_media
       (post_id, public_url, cloudflare_storage_key, display_order, width, height, file_content_type, file_size_bytes)
     VALUES ($1, $2, $3, 0, 300, 100, 'image/webp', 40_000)`,
    [fixture.flaggedId, `${baseUrl}/admin/test-media/photo-wide.svg`, `posts/${fixture.flaggedId}/wide.svg`],
  );
  const flaggedCommentId = await insertComment({
    postId: fixture.flaggedId,
    authorId: commenterId,
    text: 'Community evidence on the flagged case',
    createdAt: new Date(Date.now() - 3_600_000),
  });
  await insertCommentMedia(flaggedCommentId, 'comments/review-experience/wide.svg');

  fixture.expiredId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType: 'PRODUCT',
    title: 'Expired listing with retained evidence',
    status: 'EXPIRED',
    moderationStatus: 'CLEAN',
    marketCategory: 'FOOD',
    createdAt: new Date(Date.now() - 40 * 86_400_000),
  });
  await database.pool.query(
    `INSERT INTO post_media
       (post_id, public_url, cloudflare_storage_key, display_order, width, height, file_content_type, file_size_bytes)
     VALUES ($1, $2, $3, 0, 300, 100, 'image/webp', 40_000)`,
    [fixture.expiredId, `${baseUrl}/admin/test-media/photo-wide.svg`, `posts/${fixture.expiredId}/wide.svg`],
  );
  const expiredCommentId = await insertComment({
    postId: fixture.expiredId,
    authorId: commenterId,
    text: 'Discussion retained after the listing expired',
    createdAt: new Date(Date.now() - 2 * 3_600_000),
  });
  await insertCommentMedia(expiredCommentId, 'comments/review-experience/wide.svg');
  await database.pool.query(
    `INSERT INTO post_reports (post_id, reporter_id, reason, details)
     VALUES ($1, $2, 'SPAM', 'Report retained after expiry')`,
    [fixture.expiredId, reporterId],
  );
  await database.pool.query(
    `INSERT INTO moderation_actions (admin_user_id, action_type, target_type, target_id, reason)
     VALUES ($1, 'POST_APPROVED', 'POST', $2, 'Approved before the listing expired')`,
    [principals.adminId, fixture.expiredId],
  );

  fixture.activeId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType: 'PRODUCT',
    title: LONG_TITLE,
    status: 'ACTIVE',
    moderationStatus: 'CLEAN',
    marketCategory: 'FOOD',
  });
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

  browser = await puppeteer.launch({
    executablePath: findChromePath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
});

beforeEach(async () => {
  await database.pool.query(`TRUNCATE TABLE ${BUSINESS_TABLES} CASCADE`);
  await seedReviewExperienceFixture();
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

describe('Admin review experience real browser suite', { timeout: 180000 }, () => {
  it('distinguishes an unavailable dashboard from an empty queue and recovers through Retry', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    try {
      let unavailable = true;
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (unavailable && request.url().includes('/admin/api/dashboard')) {
          return request.respond({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'simulated initial dashboard failure' }),
          });
        }
        return request.continue();
      });
      await loginAsAdmin(page, baseUrl);
      await page.waitForSelector('[role="alert"]');
      assert.equal(
        await page.$('[data-testid="pupzy-work-queues"]'),
        null,
        'failed data is never shown as zero counts',
      );
      assert.equal(
        await page.$('.pupzy-inbox-empty'),
        null,
        'a failed request must not claim the review queue is clear',
      );
      assert.equal(await page.$('.pupzy-metric-grid'), null, 'unavailable totals must not be rendered as zeros');
      unavailable = false;
      await page.click('[role="alert"] button');
      await page.waitForSelector('[data-testid="pupzy-work-queues"]');
      assert.equal(await page.$('[role="alert"]'), null);
      const count = await page.$eval(
        '[data-testid="pupzy-queue-flagged"] .pupzy-queue-button-count',
        (node) => node.innerText,
      );
      assert.equal(count, '1', 'Retry restores the actual review queue');
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('keeps shared control states consistent across the dashboard, action windows and workspace', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    try {
      let failNextDashboard = false;
      await page.setRequestInterception(true);
      page.on('request', async (request) => {
        if (request.url().includes('/admin/api/dashboard')) {
          if (failNextDashboard) {
            failNextDashboard = false;
            await new Promise((resolve) => setTimeout(resolve, 700));
            return request.respond({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'simulated dashboard failure' }),
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        return request.continue();
      });

      await loginAsAdmin(page, baseUrl);
      await page.waitForSelector('[data-testid="pupzy-work-queues"]', { timeout: 60000 });

      const refreshIdle = await page.evaluate(() => {
        const button = document.querySelector('.pupzy-dashboard-refresh');
        const style = getComputedStyle(button);
        const box = button.getBoundingClientRect();
        return {
          label: button.innerText,
          disabled: button.disabled,
          ariaBusy: button.getAttribute('aria-busy'),
          backgroundColor: style.backgroundColor,
          cursor: style.cursor,
          height: box.height,
        };
      });
      assert.equal(refreshIdle.label, 'Refresh now');
      assert.equal(refreshIdle.disabled, false);
      assert.equal(refreshIdle.ariaBusy, 'false');
      assert.equal(refreshIdle.backgroundColor, 'rgb(255, 255, 255)', 'refresh stays secondary to moderation work');
      assert.equal(refreshIdle.cursor, 'pointer');
      assert.ok(refreshIdle.height >= 32, 'the refresh control keeps a usable target size');
      await page.hover('.pupzy-dashboard-refresh');
      await new Promise((resolve) => setTimeout(resolve, 250));
      const refreshHover = await page.$eval(
        '.pupzy-dashboard-refresh',
        (element) => getComputedStyle(element).backgroundColor,
      );
      assert.notEqual(refreshHover, refreshIdle.backgroundColor, 'hovering the refresh control changes its state');
      await page.mouse.down();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const refreshPressed = await page.$eval('.pupzy-dashboard-refresh', (element) => ({
        backgroundColor: getComputedStyle(element).backgroundColor,
        transform: getComputedStyle(element).transform,
      }));
      await page.mouse.move(5, 5);
      await page.mouse.up();
      assert.notEqual(refreshPressed.backgroundColor, refreshHover, 'pressing the refresh control changes its state');
      assert.notEqual(refreshPressed.transform, 'none', 'the press is felt as a brief translation');

      failNextDashboard = true;
      await page.click('.pupzy-dashboard-refresh');
      await page.waitForFunction(() => document.querySelector('.pupzy-dashboard-refresh')?.disabled === true);
      const refreshLoading = await page.evaluate(() => {
        const button = document.querySelector('.pupzy-dashboard-refresh');
        const style = getComputedStyle(button);
        return {
          label: button.innerText,
          disabled: button.disabled,
          ariaBusy: button.getAttribute('aria-busy'),
          backgroundColor: style.backgroundColor,
          cursor: style.cursor,
        };
      });
      assert.equal(refreshLoading.label, 'Refreshing…', 'loading announces itself on the control');
      assert.equal(refreshLoading.disabled, true, 'loading prevents duplicate refreshes');
      assert.equal(refreshLoading.ariaBusy, 'true');
      assert.notEqual(
        refreshLoading.backgroundColor,
        refreshIdle.backgroundColor,
        'a disabled refresh control is visibly inactive',
      );
      assert.notEqual(refreshLoading.cursor, 'pointer');

      await page.waitForSelector('[role="alert"]');
      const errorState = await page.$eval('[role="alert"]', (element) => element.innerText);
      assert.match(errorState, /Dashboard data could not be loaded/);
      assert.ok(
        await page.$('[data-testid="pupzy-work-queues"]'),
        'a failed refresh keeps the last good dashboard visible',
      );
      console.log(`[bwg-21 evidence] dashboard error state ${await recordEvidence(page, '02-dashboard-error-state')}`);

      await Promise.all([
        page.waitForFunction(() => document.querySelector('[role="alert"]') === null),
        page.click('[role="alert"] button'),
      ]);
      await page.waitForFunction(() => document.querySelector('.pupzy-dashboard-refresh')?.disabled === false);
      const refreshed = await page.$eval('.pupzy-dashboard-refresh', (element) => ({
        label: element.innerText,
        disabled: element.disabled,
      }));
      assert.equal(refreshed.label, 'Refresh now', 'a successful retry restores the idle control');
      assert.equal(refreshed.disabled, false);
      console.log(
        `[bwg-21 evidence] dashboard shared states ${await recordEvidence(page, '01-dashboard-control-states', {
          fullPage: true,
        })}`,
      );

      await openWorkspace(page, fixture.flaggedId);
      await page.click('[data-testid="action-markReunited"]');
      await page.waitForSelector('#moderation-reason', { timeout: 60000 });

      const disabledSubmit = await submitStyles(page);
      assert.equal(disabledSubmit.variant, 'primary');
      assert.equal(disabledSubmit.disabled, true);
      assert.equal(disabledSubmit.ariaBusy, 'false');
      assert.equal(disabledSubmit.backgroundColor, 'rgb(184, 164, 153)', 'an invalid outcome is visibly inactive');
      assert.notEqual(disabledSubmit.cursor, 'pointer');

      await page.type('#moderation-reason', 'Animal safely reunited with its owner');
      await waitForEnabledSubmit(page);
      const primarySubmit = await submitStyles(page);
      assert.equal(
        primarySubmit.backgroundColor,
        'rgb(196, 98, 45)',
        'outcome confirmation is a filled primary action',
      );
      assert.equal(primarySubmit.color, 'rgb(255, 255, 255)');

      await page.hover('[data-testid="moderation-action-submit"]');
      await new Promise((resolve) => setTimeout(resolve, 250));
      const primaryHover = await submitStyles(page);
      assert.notEqual(
        primaryHover.backgroundColor,
        primarySubmit.backgroundColor,
        'the confirmation has a hover state',
      );
      await page.mouse.down();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const primaryPressed = await submitStyles(page);
      await page.mouse.move(5, 5);
      await page.mouse.up();
      assert.notEqual(
        primaryPressed.backgroundColor,
        primaryHover.backgroundColor,
        'the confirmation has a pressed state',
      );
      assert.notEqual(primaryPressed.transform, 'none');
      console.log(
        `[bwg-21 evidence] outcome confirmation states ${await recordEvidence(page, '03-outcome-submit-states')}`,
      );

      await page.goto(page.url().replace(/markReunited$/, 'removePost'), { waitUntil: 'networkidle0' });
      await page.waitForSelector('#moderation-reason', { timeout: 60000 });
      await page.type('#moderation-reason', 'Unavailable content');
      await waitForEnabledSubmit(page);
      const dangerSubmit = await submitStyles(page);
      assert.equal(dangerSubmit.variant, 'danger');
      assert.equal(dangerSubmit.backgroundColor, 'rgb(217, 64, 64)', 'removal keeps its destructive danger treatment');
      assert.notEqual(
        dangerSubmit.backgroundColor,
        primarySubmit.backgroundColor,
        'removal and outcome confirmation are visibly distinct',
      );
      console.log(`[bwg-21 evidence] removal submit states ${await recordEvidence(page, '04-removal-submit-states')}`);

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('reaches expired history from the dashboard and returns to the same filtered list', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    try {
      await loginAsAdmin(page, baseUrl);
      await openDashboard(page);

      const expiredQueue = await page.$eval('[data-testid="pupzy-queue-expired"]', (element) => ({
        label: element.innerText,
        count: element.querySelector('.pupzy-queue-button-count')?.innerText,
      }));
      assert.match(expiredQueue.label, /Expired/);
      assert.equal(expiredQueue.count, '1', 'the expired history queue counts the seeded expired listing');

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('[data-testid="pupzy-queue-expired"]'),
      ]);
      const url = new URL(page.url());
      assert.equal(url.pathname, '/admin/resources/posts');
      assert.equal(url.searchParams.get('filters.status'), 'EXPIRED');
      await page.waitForSelector('tr[data-id]');
      const rowIds = await page.$$eval('tr[data-id]', (rows) => rows.map((row) => row.dataset.id));
      assert.deepEqual(rowIds, [fixture.expiredId], 'expired history contains exactly the expired listing');
      console.log(`[bwg-21 evidence] expired history list ${await recordEvidence(page, '05-expired-history-list')}`);

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('tr[data-id] td[data-property-name="title"]'),
      ]);
      await page.waitForSelector('[data-testid="pupzy-review-workspace"]', { timeout: 60000 });

      const workspace = await page.evaluate(() => {
        const text = document.querySelector('[data-testid="pupzy-review-workspace"]').innerText;
        const lifecycleActions = [
          'markSold',
          'markAdopted',
          'markResolved',
          'markReunited',
          'markRescued',
          'reopenPost',
          'removePost',
          'restorePost',
        ].filter((name) => document.querySelector(`[data-testid="action-${name}"]`) !== null);
        return {
          text,
          lifecycleActions,
          backHref: document.querySelector('[data-testid="pupzy-back-to-queue"]')?.getAttribute('href'),
          backLabel: document.querySelector('[data-testid="pupzy-back-to-queue"]')?.innerText,
          originalPhotos: document.querySelectorAll(
            '[data-testid="pupzy-original-photos"] [data-testid="pupzy-media-thumb"]',
          ).length,
          discussionThumbs: document.querySelectorAll(
            '[data-testid="pupzy-discussion"] [data-testid="pupzy-media-thumb"]',
          ).length,
        };
      });
      assert.match(workspace.text, /Expired listing with retained evidence/);
      assert.match(workspace.text, /Product/);
      assert.match(workspace.text, /Expired/);
      assert.match(workspace.text, /Clean/);
      assert.match(workspace.text, /Discussion retained after the listing expired/);
      assert.match(workspace.text, /Report retained after expiry/);
      assert.match(workspace.text, /Post approved/);
      assert.match(workspace.text, /Approved before the listing expired/);
      assert.equal(workspace.originalPhotos, 1, 'expired listings keep their original photos');
      assert.equal(workspace.discussionThumbs, 1, 'expired listings keep their discussion attachments');
      assert.deepEqual(
        workspace.lifecycleActions,
        [],
        'an expired listing exposes no outcome, reopen, remove or restore action',
      );
      assert.match(workspace.backHref, /filters\.status=EXPIRED/);
      assert.match(workspace.backLabel, /Back to filtered list/);
      console.log(
        `[bwg-21 evidence] expired workspace ${await recordEvidence(page, '06-expired-workspace', { fullPage: true })}`,
      );

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('[data-testid="pupzy-back-to-queue"]'),
      ]);
      const backUrl = new URL(page.url());
      assert.equal(backUrl.searchParams.get('filters.status'), 'EXPIRED');
      await page.waitForSelector('tr[data-id]');
      assert.deepEqual(await page.$$eval('tr[data-id]', (rows) => rows.map((row) => row.dataset.id)), [
        fixture.expiredId,
      ]);
      console.log(
        `[bwg-21 evidence] returned to expired history ${await recordEvidence(page, '07-return-to-expired')}`,
      );

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('tr[data-id] td[data-property-name="title"]'),
      ]);
      await page.waitForSelector('[data-testid="pupzy-review-workspace"]', { timeout: 60000 });
      await page.goBack({ waitUntil: 'networkidle0' });
      await page.waitForSelector('tr[data-id]');
      assert.equal(new URL(page.url()).searchParams.get('filters.status'), 'EXPIRED', 'browser Back keeps the filters');

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('keeps keyboard, reduced-motion and narrow-screen journeys consistent across screens', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    try {
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await loginAsAdmin(page, baseUrl);
      await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
      await openDashboard(page);

      const dashboardLayout = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.pupzy-metric-grid > *')).map((element) => {
          const box = element.getBoundingClientRect();
          return { width: box.width, left: box.left };
        });
        const queue = document.querySelector('[data-testid="pupzy-queue-flagged"]');
        const refresh = document.querySelector('.pupzy-dashboard-refresh');
        return {
          documentClientWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          cardWidths: cards.map((card) => card.width),
          cardLefts: cards.map((card) => card.left),
          queueTransition: parseFloat(getComputedStyle(queue).transitionDuration),
          refreshTransition: parseFloat(getComputedStyle(refresh).transitionDuration),
          refreshHeight: refresh.getBoundingClientRect().height,
        };
      });
      assert.equal(
        dashboardLayout.documentScrollWidth,
        dashboardLayout.documentClientWidth,
        'the dashboard does not scroll horizontally at 390px',
      );
      assert.ok(
        Math.max(...dashboardLayout.cardWidths) - Math.min(...dashboardLayout.cardWidths) <= 1,
        'metric cards keep a shared width',
      );
      assert.equal(
        new Set(dashboardLayout.cardLefts.map(Math.round)).size,
        2,
        'compact totals align to two mobile columns',
      );
      assert.ok(dashboardLayout.queueTransition <= 0.001, 'reduced motion collapses queue button transitions');
      assert.ok(dashboardLayout.refreshTransition <= 0.001, 'reduced motion collapses refresh transitions');
      assert.ok(dashboardLayout.refreshHeight >= 38, 'the refresh action keeps a usable touch target');

      await page.keyboard.press('Tab');
      await page.evaluate(() => document.querySelector('.pupzy-dashboard-refresh').focus());
      await page.waitForFunction(
        () => {
          const element = document.querySelector('.pupzy-dashboard-refresh');
          return document.activeElement === element && parseFloat(getComputedStyle(element).outlineWidth) > 0;
        },
        { timeout: 5000 },
      );
      const refreshFocus = await page.evaluate(() => {
        const element = document.activeElement;
        const style = getComputedStyle(element);
        return {
          testId: element?.className ?? '',
          focusVisible: element?.matches(':focus-visible'),
          outlineWidth: style.outlineWidth,
          outlineColor: style.outlineColor,
        };
      });
      assert.match(refreshFocus.testId, /pupzy-dashboard-refresh/);
      assert.equal(refreshFocus.focusVisible, true);
      assert.notEqual(
        refreshFocus.outlineWidth,
        '0px',
        `keyboard focus stays visible on the refresh control: ${JSON.stringify(refreshFocus)}`,
      );
      console.log(`[bwg-21 evidence] narrow dashboard ${await recordEvidence(page, '08-narrow-dashboard')}`);

      const queueFocus = await page.evaluate(() => {
        document.querySelector('[data-testid="pupzy-queue-flagged"]').focus();
        return {
          testId: document.activeElement?.dataset?.testid,
          focusVisible: document.activeElement?.matches(':focus-visible'),
          outlineWidth: getComputedStyle(document.activeElement).outlineWidth,
        };
      });
      assert.equal(queueFocus.testId, 'pupzy-queue-flagged');
      assert.equal(queueFocus.focusVisible, true);
      assert.notEqual(queueFocus.outlineWidth, '0px');
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.keyboard.press('Enter')]);
      assert.match(page.url(), /filters\.moderation_status=FLAGGED/);
      await page.waitForSelector('tr[data-id]');
      assert.deepEqual(await page.$$eval('tr[data-id]', (rows) => rows.map((row) => row.dataset.id)), [
        fixture.flaggedId,
      ]);

      await page.goto(`${baseUrl}/admin/resources/posts`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('tr[data-id]');
      const longTitleLayout = await page.evaluate(() => {
        const cell = Array.from(document.querySelectorAll('td[data-property-name="title"]')).find((element) =>
          element.innerText.includes('deliberately long listing title'),
        );
        return {
          documentClientWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          textOverflow: cell ? getComputedStyle(cell).textOverflow : null,
          truncated: cell ? cell.scrollWidth > cell.clientWidth : false,
        };
      });
      assert.equal(
        longTitleLayout.documentScrollWidth,
        longTitleLayout.documentClientWidth,
        'a long title does not break the 390px page layout',
      );
      assert.equal(longTitleLayout.textOverflow, 'ellipsis', 'long list titles truncate instead of colliding');
      assert.equal(longTitleLayout.truncated, true, 'the long title is actually clipped inside its cell');
      console.log(
        `[bwg-21 evidence] narrow long-title list ${await recordEvidence(page, '09-narrow-long-title-list')}`,
      );

      await openDashboard(page);
      await page.evaluate(() => {
        document.querySelector('[data-testid="pupzy-needs-review-table"] tbody tr td a[href*="/records/"]').focus();
      });
      const focusedTitle = await page.evaluate(() => ({
        focusVisible: document.activeElement?.matches(':focus-visible'),
        href: document.activeElement?.getAttribute('href'),
      }));
      assert.equal(focusedTitle.focusVisible, true, 'the review-table title link is keyboard reachable');
      assert.match(focusedTitle.href ?? '', /\/admin\/resources\/posts\/records\/.+\/show/);
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.keyboard.press('Enter')]);
      await page.waitForSelector('[data-testid="pupzy-review-workspace"]', { timeout: 60000 });

      const workspaceLayout = await page.evaluate(() => {
        const workspace = document.querySelector('[data-testid="pupzy-review-workspace"]');
        const header = document.querySelector('.pupzy-review-header');
        const sections = Array.from(document.querySelectorAll('.pupzy-post-review-section'));
        const lefts = [header, ...sections].map((element) => element.getBoundingClientRect().left);
        return {
          documentClientWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          leftSpread: Math.max(...lefts) - Math.min(...lefts),
        };
      });
      assert.equal(
        workspaceLayout.documentScrollWidth,
        workspaceLayout.documentClientWidth,
        'the workspace does not scroll horizontally at 390px',
      );
      assert.ok(workspaceLayout.leftSpread <= 1, 'workspace sections align to one left edge');
      console.log(`[bwg-21 evidence] narrow workspace ${await recordEvidence(page, '10-narrow-workspace')}`);

      await page.evaluate(() => {
        document.querySelector('[data-testid="pupzy-media-thumb"]').focus();
      });
      const thumbTransition = await page.$eval('[data-testid="pupzy-media-thumb"]', (element) =>
        parseFloat(getComputedStyle(element).transitionDuration),
      );
      assert.ok(thumbTransition <= 0.001, 'reduced motion collapses thumbnail transitions');
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-testid="pupzy-image-dialog"]');
      const dialog = await page.evaluate(() => {
        const content = document.querySelector('[data-testid="pupzy-image-dialog-content"]');
        const box = content.getBoundingClientRect();
        return {
          objectFit: getComputedStyle(content).objectFit,
          width: box.width,
          ratio: box.width / box.height,
          naturalRatio: content.naturalWidth / content.naturalHeight,
        };
      });
      assert.equal(dialog.objectFit, 'contain');
      assert.ok(Math.abs(dialog.ratio - dialog.naturalRatio) < 0.05, 'the preview keeps the complete image');
      assert.ok(dialog.width <= 390, 'the preview fits the narrow viewport');
      console.log(`[bwg-21 evidence] narrow image preview ${await recordEvidence(page, '11-narrow-image-preview')}`);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('[data-testid="pupzy-image-dialog"]') === null);
      const focusReturned = await page.evaluate(() => document.activeElement?.dataset?.testid);
      assert.equal(focusReturned, 'pupzy-media-thumb', 'closing the preview returns focus to the trigger');

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('approves a flagged Post from its record page, keeps the success notice and shows the new status', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    try {
      const requests = [];
      page.on('request', (request) => {
        if (request.url().includes('/approvePost')) requests.push(request.method());
      });
      await loginAsAdmin(page, baseUrl);
      await openWorkspace(page, fixture.flaggedId);
      await page.click('[data-testid="action-approvePost"]');
      await page.waitForSelector('[data-testid="moderation-action-submit"]', { timeout: 60000 });

      assert.equal(await page.$eval('h3', (node) => node.innerText), 'Approve Post');
      assert.match(
        await page.$eval('#moderation-action-consequence', (node) => node.innerText),
        /clean/i,
        'the form states the consequence in a sentence',
      );
      assert.equal(
        await page.$eval('[data-testid="moderation-action-submit"]', (node) => node.innerText),
        'Approve Post',
      );
      await waitForEnabledSubmit(page);
      console.log(`[fix1 evidence] approve form ${await recordEvidence(page, 'fix1-approve-form')}`);
      await page.click('[data-testid="moderation-action-submit"]');

      await page.waitForSelector('[data-testid="pupzy-review-workspace"]', { timeout: 60000 });
      await page.waitForFunction(() => document.body.innerText.includes('Post approved.'), { timeout: 30000 });
      assert.match(page.url(), new RegExp(`/admin/resources/posts/records/${fixture.flaggedId}/show`));
      // The action page loads the record with a read-only GET; the approval itself is one POST.
      assert.equal(
        requests.filter((method) => method === 'POST').length,
        1,
        'the approval is submitted once, as a POST',
      );

      const { rows } = await database.pool.query(
        `SELECT moderation_status, moderation_reason FROM posts WHERE id = $1`,
        [fixture.flaggedId],
      );
      assert.equal(rows[0].moderation_status, 'CLEAN');
      assert.equal(rows[0].moderation_reason, null);
      const audit = await database.pool.query(
        `SELECT action_type FROM moderation_actions WHERE target_id = $1 AND action_type = 'POST_APPROVED'`,
        [fixture.flaggedId],
      );
      assert.equal(audit.rows.length, 1);

      const text = await page.$eval('body', (node) => node.innerText);
      assert.match(text, /clean/i, 'the record page shows the new moderation status');
      assert.equal(await page.$('[data-testid="action-approvePost"]'), null, 'a clean Post no longer offers Approve');
      console.log(`[fix1 evidence] approved record ${await recordEvidence(page, 'fix1-approved-record')}`);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('reviews a report from the workspace in the same tab and returns to a workspace that shows it closed', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    try {
      const reporterId = await insertUser('workspace-reporter');
      const { rows } = await database.pool.query(
        `INSERT INTO post_reports (post_id, reporter_id, reason, details)
         VALUES ($1, $2, 'SPAM', 'Workspace review journey') RETURNING id`,
        [fixture.flaggedId, reporterId],
      );
      const reportId = rows[0].id;
      const workspaceUrl = `${baseUrl}/admin/resources/posts/records/${fixture.flaggedId}/show`;

      await loginAsAdmin(page, baseUrl);
      await openWorkspace(page, fixture.flaggedId);
      const before = await page.$eval('[data-testid="pupzy-reports"]', (node) => node.innerText);
      assert.match(before, /Open/);
      const link = await page.$('[data-testid="pupzy-report-review-link"]');
      assert.ok(link, 'an open report offers the review link');
      assert.equal(await link.evaluate((node) => node.getAttribute('target')), null, 'it opens in the same tab');
      console.log(`[fix2 evidence] workspace before ${await recordEvidence(page, 'fix2-workspace-before-review')}`);

      await link.click();
      await page.waitForSelector('[data-testid="moderation-action-submit"]', { timeout: 60000 });
      assert.match(page.url(), /reviewWithNoAction\?returnTo=/);
      await waitForEnabledSubmit(page);
      await page.click('[data-testid="moderation-action-submit"]');

      await page.waitForSelector('[data-testid="pupzy-review-workspace"]', { timeout: 60000 });
      await page.waitForFunction(() => document.body.innerText.includes('reviewed with no action'), {
        timeout: 30000,
      });
      assert.equal(page.url().split('?')[0], workspaceUrl, 'the moderator is back on the workspace');

      const { rows: stored } = await database.pool.query(
        `SELECT reviewed_at, review_outcome FROM post_reports WHERE id = $1`,
        [reportId],
      );
      assert.ok(stored[0].reviewed_at);
      assert.equal(stored[0].review_outcome, 'NO_ACTION');

      await page.waitForFunction(
        () => document.querySelector('[data-testid="pupzy-report-status"]')?.innerText === 'Closed: no action',
        { timeout: 30000 },
      );
      assert.equal(
        await page.$('[data-testid="pupzy-report-review-link"]'),
        null,
        'a closed report has no review link',
      );
      const closedNote = await page.$eval('[data-testid="pupzy-report-closed-note"]', (node) => node.innerText);
      assert.match(closedNote, /Closed on .* by Staff Admin/);
      console.log(`[fix2 evidence] workspace after ${await recordEvidence(page, 'fix2-workspace-after-review')}`);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('shows a Status column on the report lists and a Status at the top of a closed report', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    try {
      const reporterId = await insertUser('status-reporter');
      const reportedId = await insertUser('status-reported');
      const commentId = await insertComment({
        postId: fixture.flaggedId,
        authorId: fixture.commenterId,
        text: 'Comment with a closed report',
        createdAt: new Date(Date.now() - 3_600_000),
      });
      const { rows: closedPost } = await database.pool.query(
        `INSERT INTO post_reports (post_id, reporter_id, reason, reviewed_at, reviewed_by_admin_id, review_outcome)
         VALUES ($1, $2, 'SPAM', now(), $3, 'NO_ACTION') RETURNING id`,
        [fixture.flaggedId, reporterId, principals.adminId],
      );
      await database.pool.query(`INSERT INTO post_reports (post_id, reporter_id, reason) VALUES ($1, $2, 'SCAM')`, [
        fixture.flaggedId,
        reportedId,
      ]);
      await database.pool.query(
        `INSERT INTO comment_reports (comment_id, reporter_id, reason, reviewed_at) VALUES ($1, $2, 'SPAM', now())`,
        [commentId, reporterId],
      );
      await database.pool.query(
        `INSERT INTO account_reports (reporter_id, reported_user_id, reason, reviewed_at, reviewed_by_admin_id, review_outcome)
         VALUES ($1, $2, 'SPAM', now(), $3, 'ACTION_TAKEN')`,
        [reporterId, reportedId, principals.adminId],
      );

      await loginAsAdmin(page, baseUrl);
      const rowTexts = async (resourceId) => {
        await page.goto(`${baseUrl}/admin/resources/${resourceId}`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('table tbody tr', { timeout: 60000 });
        const header = await page.$$eval('table thead td', (nodes) => nodes.map((node) => node.innerText.trim()));
        assert.ok(header.includes('Status'), `${resourceId} list has a Status column, got ${JSON.stringify(header)}`);
        return page.$$eval('table tbody tr', (nodes) => nodes.map((node) => node.innerText));
      };

      const postRows = await rowTexts('post_reports');
      assert.ok(postRows.some((text) => text.includes('Closed: no action')));
      assert.ok(postRows.some((text) => /\bOpen\b/.test(text)));
      console.log(`[fix2 evidence] post report list ${await recordEvidence(page, 'fix2-post-reports-list')}`);
      const commentRows = await rowTexts('comment_reports');
      assert.ok(commentRows.some((text) => /\bClosed\b/.test(text) && !text.includes('Closed:')));
      const accountRows = await rowTexts('account_reports');
      assert.ok(accountRows.some((text) => text.includes('Closed: action taken')));

      await page.goto(`${baseUrl}/admin/resources/post_reports/records/${closedPost[0].id}/show`, {
        waitUntil: 'networkidle0',
      });
      await page.waitForSelector('[data-testid="pupzy-report-status"]', { timeout: 60000 });
      const status = await page.$eval('[data-testid="pupzy-report-status"]', (node) => node.innerText);
      assert.match(status, /^Closed: no action/);
      assert.match(status, /Closed on .* by Test Admin/);
      console.log(`[fix2 evidence] closed report ${await recordEvidence(page, 'fix2-closed-report-show')}`);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('links every reference to its record by a readable name, from reports and the audit log', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    try {
      const { rows: arabic } = await database.pool.query(
        `INSERT INTO users (firebase_user_id, email, full_name_arabic)
         VALUES ('bwg-ref-arabic', 'ref-arabic@example.com', 'هنا إبراهيم') RETURNING id`,
      );
      const reporterId = arabic[0].id;
      const commentId = await insertComment({
        postId: fixture.flaggedId,
        authorId: fixture.commenterId,
        text: 'A comment that someone reported for review',
        createdAt: new Date(Date.now() - 3_600_000),
      });
      const { rows: postReport } = await database.pool.query(
        `INSERT INTO post_reports (post_id, reporter_id, reason) VALUES ($1, $2, 'SPAM') RETURNING id`,
        [fixture.flaggedId, reporterId],
      );
      const { rows: commentReport } = await database.pool.query(
        `INSERT INTO comment_reports (comment_id, reporter_id, reason) VALUES ($1, $2, 'SPAM') RETURNING id`,
        [commentId, reporterId],
      );
      await database.pool.query(
        `INSERT INTO moderation_actions (admin_user_id, action_type, target_type, target_id)
         VALUES ($1, 'POST_FLAGGED', 'POST', $2)`,
        [principals.adminId, fixture.flaggedId],
      );

      const waitForPath = (fragment) =>
        page.waitForFunction((text) => window.location.pathname.includes(text), { timeout: 30000 }, fragment);
      const openShow = async (resourceId, recordId) => {
        await page.goto(`${baseUrl}/admin/resources/${resourceId}/records/${recordId}/show`, {
          waitUntil: 'networkidle0',
        });
        await page.waitForSelector('[data-testid="pupzy-reference-link"]', { timeout: 60000 });
      };
      const clickReference = async (resourceId) => {
        await page.click(`[data-testid="pupzy-reference-link"][data-reference-resource="${resourceId}"]`);
      };

      await loginAsAdmin(page, baseUrl);

      // List: readable names, no raw UUIDs for references, and a link click opens the target, not the row.
      await page.goto(`${baseUrl}/admin/resources/post_reports`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid="pupzy-reference-link"]', { timeout: 60000 });
      const listText = await page.$eval('table tbody', (node) => node.innerText);
      assert.match(listText, /Flagged case awaiting review/);
      assert.match(listText, /هنا إبراهيم/);
      const rowCount = await page.$$eval('table tbody tr', (rows) => rows.length);
      assert.equal(
        (listText.match(/[0-9a-f]{8}…[0-9a-f]{4}/g) ?? []).length,
        rowCount,
        "only each row's own id is a short UUID; references show names",
      );
      console.log(`[fix3 evidence] post reports list ${await recordEvidence(page, 'fix3-post-reports-list')}`);
      await clickReference('posts');
      await waitForPath(`/resources/posts/records/${fixture.flaggedId}/show`);
      assert.ok(!page.url().includes('post_reports'), 'the link opened the Post, not the report row');

      // Post Report: Post, back, then the reporter.
      await openShow('post_reports', postReport[0].id);
      const showText = await page.$eval('body', (node) => node.innerText);
      assert.match(showText, /Reported by/);
      assert.doesNotMatch(showText, /reporter_id|post_id/, 'reference labels are plain words');
      console.log(`[fix3 evidence] post report show ${await recordEvidence(page, 'fix3-post-report-show')}`);
      await clickReference('posts');
      await waitForPath(`/resources/posts/records/${fixture.flaggedId}/show`);
      await page.goBack({ waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid="pupzy-reference-link"][data-reference-resource="users"]');
      await clickReference('users');
      await waitForPath(`/resources/users/records/${reporterId}/show`);

      // Comment Report: the Comment, then its author.
      await openShow('comment_reports', commentReport[0].id);
      const commentLink = await page.$eval(
        '[data-testid="pupzy-reference-link"][data-reference-resource="comments"]',
        (node) => node.innerText,
      );
      assert.match(commentLink, /A comment that someone reported/);
      await clickReference('comments');
      await waitForPath(`/resources/comments/records/${commentId}/show`);
      await page.waitForSelector('[data-testid="pupzy-reference-link"][data-reference-resource="users"]');
      await clickReference('users');
      await waitForPath(`/resources/users/records/${fixture.commenterId}/show`);

      // Moderation Actions: a target cell opens the Post.
      await page.goto(`${baseUrl}/admin/resources/moderation_actions`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid="pupzy-reference-link"][data-reference-resource="posts"]', {
        timeout: 60000,
      });
      console.log(
        `[fix3 evidence] moderation actions list ${await recordEvidence(page, 'fix3-moderation-actions-list')}`,
      );
      await clickReference('posts');
      await waitForPath(`/resources/posts/records/${fixture.flaggedId}/show`);
      assert.ok(!page.url().includes('moderation_actions'));
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('labels every field on the report pages and reads an empty value as a dash', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    try {
      const reporterId = await insertUser('label-reporter');
      const reportedId = await insertUser('label-reported');
      const commentId = await insertComment({
        postId: fixture.flaggedId,
        authorId: fixture.commenterId,
        text: 'Comment for the label check',
        createdAt: new Date(Date.now() - 3_600_000),
      });
      const { rows: post } = await database.pool.query(
        `INSERT INTO post_reports (post_id, reporter_id, reason) VALUES ($1, $2, 'SPAM') RETURNING id`,
        [fixture.flaggedId, reporterId],
      );
      const { rows: comment } = await database.pool.query(
        `INSERT INTO comment_reports (comment_id, reporter_id, reason) VALUES ($1, $2, 'SPAM') RETURNING id`,
        [commentId, reporterId],
      );
      const { rows: account } = await database.pool.query(
        `INSERT INTO account_reports (reporter_id, reported_user_id, reason, reviewed_at, reviewed_by_admin_id, review_outcome)
         VALUES ($1, $2, 'SPAM', now(), $3, 'ACTION_TAKEN') RETURNING id`,
        [reporterId, reportedId, principals.adminId],
      );

      await loginAsAdmin(page, baseUrl);
      const pages = [
        ['post_reports', post[0].id],
        ['comment_reports', comment[0].id],
        ['account_reports', account[0].id],
        ['users', reporterId],
        ['comments', commentId],
      ];
      for (const [resourceId, recordId] of pages) {
        await page.goto(`${baseUrl}/admin/resources/${resourceId}/records/${recordId}/show`, {
          waitUntil: 'networkidle0',
        });
        await page.waitForSelector('main label, [data-css*="show"] label, label', { timeout: 60000 });
        await new Promise((resolve) => setTimeout(resolve, 800));
        const rows = await page.evaluate(() => {
          const first = [...document.querySelectorAll('label')].find((node) => !node.closest('[data-css^="sidebar"]'));
          const container = first.parentElement.parentElement.parentElement;
          return [...container.children].map((row) => ({
            label: row.querySelector('label')?.innerText.trim() ?? null,
            hasEvidence: Boolean(row.querySelector('[data-testid="pupzy-comment-evidence"]')),
            text: row.innerText.trim(),
          }));
        });
        assert.ok(rows.length > 3, `${resourceId} show page has fields`);
        for (const row of rows) {
          // The Comment evidence block carries its own "Comment" heading.
          if (row.hasEvidence) continue;
          assert.ok(row.label, `${resourceId}: a value has no label: ${JSON.stringify(row.text.slice(0, 60))}`);
        }
        if (resourceId !== 'users') {
          const labels = rows.map((row) => row.label);
          assert.ok(labels.includes('ID'), `${resourceId} labels its own id`);
          assert.ok(!labels.some((label) => /_id$/.test(label)), `${resourceId} labels read as plain words`);
        }
        if (resourceId === 'post_reports') {
          const reviewedAt = rows.find((row) => row.label === 'Reviewed At');
          assert.match(reviewedAt.text, /—/, 'an empty value is a dash, not a blank gap');
          console.log(`[fix4 evidence] report show ${await recordEvidence(page, 'fix4-report-show-labelled')}`);
        }
      }
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  describe('comment evidence', () => {
    async function seedEvidenceComment({ text, status = 'ACTIVE', images = 2, parentId = null }) {
      const { rows } = await database.pool.query(
        `INSERT INTO comments (post_id, author_id, parent_id, text, status, created_at)
         VALUES ($1, $2, $3, $4, $5, now() - interval '2 hours') RETURNING id`,
        [fixture.flaggedId, fixture.commenterId, parentId, text, status],
      );
      for (let index = 0; index < images; index += 1) {
        await insertCommentMedia(rows[0].id, `comments/evidence/${rows[0].id}-${index}-photo-wide.svg`);
      }
      return rows[0].id;
    }

    const waitForImages = (page, count) =>
      page.waitForFunction(
        (expected) =>
          [...document.querySelectorAll('[data-testid="pupzy-comment-images"] img')].filter(
            (image) => image.complete && image.naturalWidth > 0,
          ).length === expected,
        { timeout: 30000 },
        count,
      );

    it('shows a rescue Comment with its images and opens them in a keyboard-driven lightbox', async () => {
      const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
      try {
        const commentId = await seedEvidenceComment({ text: 'Rescue evidence with two photos' });
        await loginAsAdmin(page, baseUrl);
        await page.goto(`${baseUrl}/admin/resources/comments/records/${commentId}/show`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('[data-testid="pupzy-comment-evidence"]', { timeout: 60000 });
        await waitForImages(page, 2);
        assert.equal(
          await page.$$eval('[data-testid="pupzy-comment-images"] [data-testid="pupzy-media-thumb"]', (n) => n.length),
          2,
        );
        assert.match(
          await page.$eval('[data-testid="pupzy-comment-text"]', (n) => n.innerText),
          /Rescue evidence with two photos/,
        );
        assert.equal(
          await page.$('[data-testid="pupzy-image-hidden-badge"]'),
          null,
          'an active Comment shows no hidden marker',
        );
        assert.equal(
          await page.$('[data-testid="action-inspectMedia"]'),
          null,
          'there is no dead Inspect Media button',
        );
        console.log(`[fix4 evidence] comment show ${await recordEvidence(page, 'fix4-comment-show')}`);

        await page.click('[data-testid="pupzy-media-thumb"]');
        await page.waitForSelector('[data-testid="pupzy-image-dialog"]');
        const dialogText = () => page.$eval('[data-testid="pupzy-image-dialog"]', (n) => n.innerText);
        assert.match(await dialogText(), /1 of 2/);
        console.log(`[fix4 evidence] lightbox ${await recordEvidence(page, 'fix4-lightbox')}`);
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(() =>
          document.querySelector('[data-testid="pupzy-image-dialog"]')?.innerText.includes('2 of 2'),
        );
        await page.keyboard.press('ArrowLeft');
        await page.waitForFunction(() =>
          document.querySelector('[data-testid="pupzy-image-dialog"]')?.innerText.includes('1 of 2'),
        );
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[data-testid="pupzy-image-dialog"]'));
        assert.equal(
          await page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
          'pupzy-media-thumb',
          'closing returns focus to the thumbnail',
        );
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });

    it('shows the reported Comment, its images and every report on the Comment Report page', async () => {
      const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
      try {
        const commentId = await seedEvidenceComment({ text: 'Evidence for the report page', status: 'IMAGE_HIDDEN' });
        const first = await insertUser('evidence-first');
        const second = await insertUser('evidence-second');
        const { rows } = await database.pool.query(
          `INSERT INTO comment_reports (comment_id, reporter_id, reason, details) VALUES ($1, $2, 'SPAM', 'first details') RETURNING id`,
          [commentId, first],
        );
        await database.pool.query(
          `INSERT INTO comment_reports (comment_id, reporter_id, reason, details, reviewed_at) VALUES ($1, $2, 'OTHER', 'second details', now())`,
          [commentId, second],
        );
        await loginAsAdmin(page, baseUrl);
        await page.goto(`${baseUrl}/admin/resources/comment_reports/records/${rows[0].id}/show`, {
          waitUntil: 'networkidle0',
        });
        await page.waitForSelector('[data-testid="pupzy-comment-evidence"]', { timeout: 60000 });
        await waitForImages(page, 2);
        const text = await page.$eval('[data-testid="pupzy-comment-evidence"]', (n) => n.innerText);
        assert.match(text, /Evidence for the report page/);
        assert.match(text, /Images hidden from users/);
        assert.doesNotMatch(text, /Image hidden/, 'one badge, not two saying the same thing');
        assert.match(
          await page.$eval('[data-testid="pupzy-comment-report-reporter"]', (node) => node.parentElement.innerText),
          /Reported by[\s\S]+·\s+\d{1,2} \w{3} \d{4}, \d{2}:\d{2}/,
          'the reporter and date read as one line',
        );
        assert.equal(await page.$$eval('[data-testid="pupzy-image-hidden-badge"]', (n) => n.length), 2);
        assert.match(text, /Reports on this comment \(2\)/);
        assert.match(text, /first details/);
        assert.match(text, /second details/);
        assert.match(text, /This report/);
        assert.equal(await page.$$eval('[data-testid="pupzy-comment-report"]', (n) => n.length), 2);
        assert.equal(
          await page.$$eval('[data-testid="pupzy-comment-report-link"]', (n) => n.length),
          1,
          'only the other report links away',
        );
        const evidenceTop = await page.$eval(
          '[data-testid="pupzy-comment-evidence"]',
          (n) => n.getBoundingClientRect().top,
        );
        const statusTop = await page.$eval('[data-testid="pupzy-report-status"]', (n) => n.getBoundingClientRect().top);
        assert.ok(evidenceTop < statusTop, 'the evidence sits above the report fields');
        console.log(`[fix4 evidence] comment report show ${await recordEvidence(page, 'fix4-comment-report-show')}`);

        await page.click('[data-testid="pupzy-comment-post"]');
        await page.waitForFunction(
          (id) => window.location.pathname.includes(`/resources/posts/records/${id}/show`),
          {},
          fixture.flaggedId,
        );
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });

    it('renders an Arabic Comment right to left and links a Reply to its parent', async () => {
      const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
      try {
        const parentId = await seedEvidenceComment({ text: 'Parent in English', images: 0 });
        const replyId = await seedEvidenceComment({ text: 'رأيت هذا الكلب بالقرب من الجسر أمس', images: 1, parentId });
        await loginAsAdmin(page, baseUrl);
        await page.goto(`${baseUrl}/admin/resources/comments/records/${replyId}/show`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('[data-testid="pupzy-comment-text"]', { timeout: 60000 });
        assert.equal(
          await page.$eval('[data-testid="pupzy-comment-text"]', (n) => getComputedStyle(n).direction),
          'rtl',
        );
        assert.equal(await page.$eval('[data-testid="pupzy-comment-parent"]', (n) => n.innerText), 'Parent in English');
        await page.click('[data-testid="pupzy-comment-parent"]');
        await page.waitForFunction(
          (id) => window.location.pathname.includes(`/resources/comments/records/${id}/show`),
          {},
          parentId,
        );
        await page.waitForSelector('[data-testid="pupzy-comment-text"]');
        assert.equal(
          await page.$eval('[data-testid="pupzy-comment-text"]', (n) => getComputedStyle(n).direction),
          'ltr',
        );
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
  });

  describe('profile photos', () => {
    async function insertPhotoUser(label, { withPhoto = true } = {}) {
      const { rows } = await database.pool.query(
        `INSERT INTO users (firebase_user_id, email, full_name, profile_picture_url, profile_photo_storage_key)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          `bwg-photo-${label}`,
          `photo-${label}@example.com`,
          `Photo ${label}`,
          withPhoto ? `${baseUrl}/admin/test-media/avatars-photo-wide.svg` : null,
          withPhoto ? `profiles/${label}-photo-wide.svg` : null,
        ],
      );
      return rows[0].id;
    }

    it('shows a large enlargeable avatar on the user page and removes the photo the way the app does', async () => {
      const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
      try {
        const userId = await insertPhotoUser('remove');
        await loginAsAdmin(page, baseUrl);
        await page.goto(`${baseUrl}/admin/resources/users/records/${userId}/show`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('[data-testid="pupzy-profile-photo-open"]', { timeout: 60000 });
        const labelText = await page.$eval('body', (node) => node.innerText);
        assert.match(labelText, /Profile photo/);
        assert.doesNotMatch(labelText, /avatars-photo-wide\.svg/, 'the photo is not printed as URL text');
        const size = await page.$eval(
          '[data-testid="pupzy-profile-photo-open"] [data-testid="pupzy-avatar"]',
          (node) => {
            const box = node.getBoundingClientRect();
            return { width: Math.round(box.width), radius: getComputedStyle(node).borderRadius };
          },
        );
        assert.equal(size.width, 96);
        assert.match(size.radius, /50%|48px/);
        await page.waitForFunction(
          () => document.querySelector('[data-testid="pupzy-profile-photo-open"] img')?.naturalWidth > 0,
          { timeout: 30000 },
        );
        console.log(`[fix5 evidence] user with photo ${await recordEvidence(page, 'fix5-user-show-before')}`);

        await page.click('[data-testid="pupzy-profile-photo-open"]');
        await page.waitForSelector('[data-testid="pupzy-image-dialog"]');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[data-testid="pupzy-image-dialog"]'));

        await page.click('[data-testid="action-removeProfilePhoto"]');
        await page.waitForSelector('#moderation-reason', { timeout: 60000 });
        assert.equal(await page.$eval('h3', (node) => node.innerText), 'Remove Profile Photo');
        assert.equal(
          await page.$eval('[data-testid="moderation-action-submit"]', (node) => node.disabled),
          true,
          'a reason is required',
        );
        await page.type('#moderation-reason', 'Photo breaks the community rules');
        await waitForEnabledSubmit(page);
        await page.click('[data-testid="moderation-action-submit"]');
        await page.waitForSelector('[data-testid="pupzy-profile-photo-none"]', { timeout: 60000 });
        await page.waitForFunction(() => document.body.innerText.includes('Profile photo removed.'), {
          timeout: 30000,
        });
        assert.match(
          await page.$eval('[data-testid="pupzy-profile-photo-none"]', (node) => node.innerText),
          /PR/,
          'initials replace the photo',
        );
        assert.equal(
          await page.$('[data-testid="action-removeProfilePhoto"]'),
          null,
          'the action goes away with the photo',
        );
        console.log(`[fix5 evidence] user after removal ${await recordEvidence(page, 'fix5-user-show-after')}`);

        const { rows } = await database.pool.query(
          `SELECT profile_picture_url, profile_photo_storage_key, profile_photo_changed_at FROM users WHERE id = $1`,
          [userId],
        );
        assert.equal(rows[0].profile_picture_url, null);
        assert.equal(rows[0].profile_photo_storage_key, null);
        assert.ok(rows[0].profile_photo_changed_at);
        const work = await database.pool.query(
          `SELECT storage_key, status FROM media_deletion_work WHERE storage_key = 'profiles/remove-photo-wide.svg'`,
        );
        assert.deepEqual(work.rows, [{ storage_key: 'profiles/remove-photo-wide.svg', status: 'PENDING' }]);
        const audit = await database.pool.query(
          `SELECT action_type, reason FROM moderation_actions WHERE target_id = $1`,
          [userId],
        );
        assert.deepEqual(audit.rows, [
          { action_type: 'USER_PROFILE_PHOTO_REMOVED', reason: 'Photo breaks the community rules' },
        ]);
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });

    it('puts a small avatar first in the users list and falls back to initials without a photo', async () => {
      const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
      try {
        await insertPhotoUser('with');
        await insertPhotoUser('without', { withPhoto: false });
        await loginAsAdmin(page, baseUrl);
        await page.goto(`${baseUrl}/admin/resources/users`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('[data-testid="pupzy-avatar"]', { timeout: 60000 });
        const headers = await page.$$eval('table thead td', (nodes) => nodes.map((node) => node.innerText.trim()));
        assert.equal(headers[1], 'Profile photo', 'the avatar is the first data column');
        const rows = await page.$$eval('table tbody tr', (nodes) =>
          nodes.map((row) => ({
            text: row.innerText,
            hasImage: Boolean(row.querySelector('[data-testid="pupzy-avatar"] img')),
            size: Math.round(row.querySelector('[data-testid="pupzy-avatar"]').getBoundingClientRect().width),
          })),
        );
        const withPhoto = rows.find((row) => row.text.includes('photo-with@example.com'));
        const without = rows.find((row) => row.text.includes('photo-without@example.com'));
        assert.equal(withPhoto.hasImage, true);
        assert.equal(withPhoto.size, 32);
        assert.equal(without.hasImage, false);
        assert.match(without.text, /PW/, 'initials of "Photo without"');
        console.log(`[fix5 evidence] users list ${await recordEvidence(page, 'fix5-users-list')}`);
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
  });

  it('shows the dashboard empty state when no review work remains', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    try {
      await database.pool.query(`TRUNCATE TABLE ${BUSINESS_TABLES} CASCADE`);
      const ownerId = await insertUser('empty-owner');
      await insertPost(database.pool, {
        userId: ownerId,
        cityId: principals.cityId,
        postType: 'PRODUCT',
        title: 'Clean active listing with no review work',
        status: 'ACTIVE',
        moderationStatus: 'CLEAN',
        marketCategory: 'FOOD',
      });

      await loginAsAdmin(page, baseUrl);
      await openDashboard(page);

      const dashboardText = await page.$eval('body', (element) => element.innerText);
      assert.match(dashboardText, /Review queue clear/);
      assert.match(dashboardText, /There are no active Posts awaiting review/);
      const flaggedCount = await page.$eval(
        '[data-testid="pupzy-queue-flagged"] .pupzy-queue-button-count',
        (element) => element.innerText,
      );
      assert.equal(flaggedCount, '0');
      assert.equal(await page.$('[data-testid="pupzy-needs-review-table"] tbody tr'), null);
      assert.ok(
        await page.$('[data-testid="pupzy-work-queues"]'),
        'queue navigation stays available when the queue is empty',
      );
      console.log(`[bwg-21 evidence] dashboard empty state ${await recordEvidence(page, '12-dashboard-empty-state')}`);

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
});

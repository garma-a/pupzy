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
const EVIDENCE_DIR = process.env.BWG05_EVIDENCE_DIR || '/tmp/opencode/bwg-05-evidence';

const BUSINESS_TABLES = `
  post_media, rescue_posts, lost_posts, adoption_posts, product_posts, mating_posts,
  post_upvotes, post_saves, contact_requests, adoption_applications, post_reports, comment_reports, account_reports,
  notifications, saved_searches, moderation_actions, posts, users,
  comments, comment_media, post_pins, comment_boosts, comment_idempotency,
  media_deletion_work, blocked_media_hashes, blocks, account_deletions
`;

let server;
let baseUrl;
let sqlAdapterPool;
let principals;
let browser;
let fixture;

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

async function loginAsAdmin(page, url, email = 'staff@example.com', password = 'staff secure password') {
  await page.goto(`${url}/admin/login`, { waitUntil: 'networkidle0' });
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('form button')]);
}

async function openDashboard(page) {
  await page.goto(`${baseUrl}/admin`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="pupzy-work-queues"]', { timeout: 60000 });
}

async function openList(page, resource, filters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) query.set(`filters.${key}`, value);
  await page.goto(`${baseUrl}/admin/resources/${resource}?${query.toString()}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('tr[data-id]', { timeout: 60000 });
}

function listRowIds(page) {
  return page.$$eval('tr[data-id]', (rows) => rows.map((row) => row.dataset.id));
}

async function insertUser(label) {
  const { rows } = await database.pool.query(
    `INSERT INTO users (firebase_user_id, email, full_name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [`bwg05-browser-${label}`, `${label}@example.com`, `User ${label}`],
  );
  return rows[0].id;
}

async function seedQueueFixture() {
  const ownerId = await insertUser('owner');
  const reporterId = await insertUser('reporter');
  const secondReporterId = await insertUser('reporter-two');

  fixture = { ownerId };

  fixture.flaggedPostId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType: 'LOST',
    title: 'Flagged browser case',
    status: 'ACTIVE',
    moderationStatus: 'FLAGGED',
  });
  await database.pool.query(
    `INSERT INTO lost_posts
       (post_id, report_type, species, current_condition, is_currently_safe_with_reporter, date_found)
     VALUES ($1, 'FOUND_STRAY', 'DOG', 'HEALTHY', true, '2026-08-20')`,
    [fixture.flaggedPostId],
  );
  fixture.approvedPostId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType: 'PRODUCT',
    title: 'Approved case with an open report',
    status: 'ACTIVE',
    moderationStatus: 'CLEAN',
    marketCategory: 'FOOD',
  });
  fixture.pendingPostId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType: 'RESCUE',
    title: 'Pending moderation browser case',
    status: 'ACTIVE',
    moderationStatus: 'PENDING_AUTO_REVIEW',
  });
  fixture.lostPetId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType: 'LOST',
    title: 'Lost pet browser case',
    status: 'ACTIVE',
    moderationStatus: 'CLEAN',
  });
  await database.pool.query(
    `INSERT INTO lost_posts (post_id, report_type, species, pet_name, date_last_seen)
     VALUES ($1, 'LOST_PET', 'DOG', 'Rex', '2026-08-20')`,
    [fixture.lostPetId],
  );
  fixture.foundStrayId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType: 'LOST',
    title: 'Found stray browser case',
    status: 'ACTIVE',
    moderationStatus: 'CLEAN',
  });
  await database.pool.query(
    `INSERT INTO lost_posts
       (post_id, report_type, species, current_condition, is_currently_safe_with_reporter, date_found)
     VALUES ($1, 'FOUND_STRAY', 'DOG', 'HEALTHY', true, '2026-08-20')`,
    [fixture.foundStrayId],
  );
  fixture.rescueId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType: 'RESCUE',
    title: 'Rescue browser case',
    status: 'ACTIVE',
    moderationStatus: 'CLEAN',
  });
  fixture.adoptionId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType: 'ADOPTION',
    title: 'Adoption browser listing',
    status: 'ACTIVE',
    moderationStatus: 'CLEAN',
  });
  fixture.productId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType: 'PRODUCT',
    title: 'Product browser listing',
    status: 'ACTIVE',
    moderationStatus: 'CLEAN',
    marketCategory: 'FOOD',
  });
  fixture.matingId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType: 'MATING',
    title: 'Mating browser listing',
    status: 'ACTIVE',
    moderationStatus: 'CLEAN',
  });
  fixture.completedId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType: 'RESCUE',
    title: 'Completed browser case',
    status: 'RESOLVED',
    moderationStatus: 'CLEAN',
  });
  fixture.expiredId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType: 'PRODUCT',
    title: 'Expired browser listing',
    status: 'EXPIRED',
    moderationStatus: 'CLEAN',
    marketCategory: 'FOOD',
  });
  fixture.removedId = await insertPost(database.pool, {
    userId: ownerId,
    cityId: principals.cityId,
    postType: 'ADOPTION',
    title: 'Removed browser listing',
    status: 'REMOVED',
    moderationStatus: 'CLEAN',
  });

  const openReportOnFlagged = await database.pool.query(
    `INSERT INTO post_reports (post_id, reporter_id, reason, details)
     VALUES ($1, $2, 'INAPPROPRIATE_CONTENT', 'Flagged case report')
     RETURNING id`,
    [fixture.flaggedPostId, reporterId],
  );
  fixture.openReportOnFlaggedId = openReportOnFlagged.rows[0].id;
  const openReportOnApproved = await database.pool.query(
    `INSERT INTO post_reports (post_id, reporter_id, reason, details)
     VALUES ($1, $2, 'SPAM', 'Approved case report')
     RETURNING id`,
    [fixture.approvedPostId, secondReporterId],
  );
  fixture.openReportOnApprovedId = openReportOnApproved.rows[0].id;
  const reviewedReport = await database.pool.query(
    `INSERT INTO post_reports (post_id, reporter_id, reason, details, reviewed_at, reviewed_by_admin_id, review_outcome)
     VALUES ($1, $2, 'SPAM', 'Already reviewed report', now(), $3, 'NO_ACTION')
     RETURNING id`,
    [fixture.flaggedPostId, secondReporterId, principals.adminId],
  );
  fixture.reviewedReportId = reviewedReport.rows[0].id;
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
  await seedQueueFixture();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await sqlAdapterPool?.destroy();
  await database.stop();
});

describe('Admin work-queue real browser suite', { timeout: 120000 }, () => {
  it('reaches flagged Posts from one labeled dashboard action and counts the same work', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    try {
      await loginAsAdmin(page, baseUrl);
      await openDashboard(page);

      const labels = await page.$$eval('[data-testid^="pupzy-queue-group-"]', (groups) =>
        groups.map((group) => ({ id: group.dataset.testid, text: group.innerText })),
      );
      const groupText = labels.map((group) => group.text).join('\n');
      for (const heading of ['Needs review', 'Rescue', 'Lost & found', 'Listings', 'History']) {
        assert.match(groupText, new RegExp(heading.replace('&', '&')));
      }
      for (const queueId of [
        'flagged',
        'pending_moderation',
        'open_post_reports',
        'open_comment_reports',
        'open_account_reports',
        'rescue',
        'lost_found',
        'lost_pet',
        'found_stray',
        'adoption',
        'products',
        'mating',
        'completed',
        'expired',
        'removed',
      ]) {
        assert.ok(await page.$(`[data-testid="pupzy-queue-${queueId}"]`), `queue ${queueId} must be visible`);
      }

      const flaggedLabel = await page.$eval('[data-testid="pupzy-queue-flagged"]', (element) => element.innerText);
      assert.match(flaggedLabel, /Flagged — needs review/);
      const flaggedCount = await page.$eval(
        '[data-testid="pupzy-queue-flagged"] .pupzy-queue-button-count',
        (element) => element.innerText,
      );
      assert.equal(flaggedCount, '1', 'the flagged queue shows the count of flagged active Posts');
      const openReportsCount = await page.$eval(
        '[data-testid="pupzy-queue-open_post_reports"] .pupzy-queue-button-count',
        (element) => element.innerText,
      );
      assert.equal(openReportsCount, '2', 'open Reports are counted separately from moderation flags');
      console.log(
        `[bwg-05 evidence] dashboard queues ${await recordEvidence(page, '01-dashboard-queues', { fullPage: true })}`,
      );

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('[data-testid="pupzy-queue-flagged"]'),
      ]);
      const url = new URL(page.url());
      assert.equal(url.pathname, '/admin/resources/posts');
      assert.equal(url.searchParams.get('filters.moderation_status'), 'FLAGGED');
      assert.equal(url.searchParams.get('filters.status'), 'ACTIVE');

      await page.waitForSelector('tr[data-id]');
      const rowIds = await listRowIds(page);
      assert.deepEqual(rowIds, [fixture.flaggedPostId], 'one labeled action reaches exactly the flagged Posts');
      const listText = await page.evaluate(() => document.body.innerText);
      assert.match(listText, /Flagged browser case/);
      assert.doesNotMatch(listText, /Approved case with an open report/);
      assert.equal(rowIds.length, Number(flaggedCount), 'the list page holds the same total as the queue count');
      console.log(`[bwg-05 evidence] flagged queue ${await recordEvidence(page, '02-flagged-queue')}`);

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('returns to the same filtered queue after opening and reviewing a Post', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    try {
      await loginAsAdmin(page, baseUrl);
      await openList(page, 'posts', { moderation_status: 'FLAGGED', status: 'ACTIVE' });
      assert.deepEqual(await listRowIds(page), [fixture.flaggedPostId]);

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('tr[data-id] td[data-property-name="title"]'),
      ]);
      await page.waitForSelector('[data-testid="pupzy-review-workspace"]');
      const recordUrl = new URL(page.url());
      assert.match(recordUrl.pathname, /\/admin\/resources\/posts\/records\/.+\/show/);
      const backHref = await page.$eval('[data-testid="pupzy-back-to-queue"]', (element) =>
        element.getAttribute('href'),
      );
      assert.match(backHref, /filters\.moderation_status=FLAGGED/, 'the return link keeps the queue filter');
      assert.match(backHref, /filters\.status=ACTIVE/);

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('[data-testid="pupzy-back-to-queue"]'),
      ]);
      const backUrl = new URL(page.url());
      assert.equal(backUrl.pathname, '/admin/resources/posts');
      assert.equal(backUrl.searchParams.get('filters.moderation_status'), 'FLAGGED');
      assert.equal(backUrl.searchParams.get('filters.status'), 'ACTIVE');
      await page.waitForSelector('tr[data-id]');
      assert.deepEqual(await listRowIds(page), [fixture.flaggedPostId]);
      console.log(`[bwg-05 evidence] returned to filtered queue ${await recordEvidence(page, '03-return-to-queue')}`);

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('tr[data-id] td[data-property-name="title"]'),
      ]);
      await page.waitForSelector('[data-testid="pupzy-review-workspace"]');
      await page.goBack({ waitUntil: 'networkidle0' });
      await page.waitForSelector('tr[data-id]');
      const browserBackUrl = new URL(page.url());
      assert.equal(browserBackUrl.searchParams.get('filters.moderation_status'), 'FLAGGED');
      assert.equal(browserBackUrl.searchParams.get('filters.status'), 'ACTIVE');
      assert.deepEqual(await listRowIds(page), [fixture.flaggedPostId]);

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('distinguishes an approved Post with an open Report from a flagged Post without one', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    try {
      await loginAsAdmin(page, baseUrl);
      await openDashboard(page);

      const reviewRows = await page.$$eval('[data-testid="pupzy-needs-review-table"] tbody tr', (rows) =>
        rows.map((row) => row.innerText),
      );
      const flaggedRow = reviewRows.find((row) => row.includes('Flagged browser case'));
      const pendingRow = reviewRows.find((row) => row.includes('Pending moderation browser case'));
      assert.ok(flaggedRow, 'the flagged Post appears in the review table');
      assert.ok(pendingRow, 'the pending-moderation Post appears in the review table');
      assert.match(flaggedRow, /1/, 'the flagged Post shows its one open Report');
      assert.match(pendingRow, /0/, 'pending moderation is not represented as an open Report');
      assert.equal(
        reviewRows.some((row) => row.includes('Approved case with an open report')),
        false,
        'an approved Post is not presented as moderation work',
      );

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('[data-testid="pupzy-queue-open_post_reports"]'),
      ]);
      const url = new URL(page.url());
      assert.equal(url.pathname, '/admin/resources/post_reports');
      assert.equal(url.searchParams.get('filters.review_state'), 'OPEN');
      await page.waitForSelector('tr[data-id]');
      const reportIds = await listRowIds(page);
      assert.deepEqual(
        new Set(reportIds),
        new Set([fixture.openReportOnFlaggedId, fixture.openReportOnApprovedId]),
        'only unreviewed Reports are listed',
      );
      assert.equal(reportIds.includes(fixture.reviewedReportId), false, 'a reviewed Report leaves the open queue');
      console.log(`[bwg-05 evidence] open reports queue ${await recordEvidence(page, '04-open-reports-queue')}`);

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('keeps queue navigation usable on a narrow screen with focus, hover and reduced-motion support', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    try {
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await loginAsAdmin(page, baseUrl);
      await page.setViewport({ width: 390, height: 844 });
      await openDashboard(page);

      const layout = await page.evaluate(() => {
        const button = document.querySelector('[data-testid="pupzy-queue-flagged"]');
        const box = button.getBoundingClientRect();
        return {
          documentClientWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          buttonLeft: box.left,
          buttonRight: box.right,
          buttonHeight: box.height,
          transitionSeconds: parseFloat(getComputedStyle(button).transitionDuration),
        };
      });
      assert.equal(layout.documentScrollWidth, layout.documentClientWidth, 'no horizontal scroll at 390px');
      assert.ok(layout.buttonLeft >= 0 && layout.buttonRight <= layout.documentClientWidth + 1);
      assert.ok(layout.buttonHeight >= 38, 'queue buttons keep a usable touch target');
      assert.ok(
        layout.transitionSeconds <= 0.001,
        `reduced motion collapses queue button transitions (saw ${layout.transitionSeconds}s)`,
      );
      console.log(
        `[bwg-05 evidence] narrow dashboard ${await recordEvidence(page, '05-narrow-dashboard', { fullPage: true })}`,
      );

      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
      const selector = '[data-testid="pupzy-queue-flagged"]';
      const beforeHover = await page.$eval(selector, (element) => getComputedStyle(element).backgroundColor);
      const transitionSeconds = await page.$eval(selector, (element) =>
        parseFloat(getComputedStyle(element).transitionDuration),
      );
      assert.ok(transitionSeconds > 0, 'queue buttons keep a brief transition when motion is allowed');
      await page.hover(selector);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const afterHover = await page.$eval(selector, (element) => getComputedStyle(element).backgroundColor);
      assert.notEqual(afterHover, beforeHover, 'hovering a queue button changes its surface');

      await page.keyboard.press('Tab');
      await page.evaluate((target) => document.querySelector(target).focus(), selector);
      const focus = await page.evaluate(() => ({
        testId: document.activeElement?.dataset?.testid,
        focusVisible: document.activeElement?.matches(':focus-visible'),
        outlineWidth: getComputedStyle(document.activeElement).outlineWidth,
      }));
      assert.equal(focus.testId, 'pupzy-queue-flagged');
      assert.equal(focus.focusVisible, true, 'keyboard focus is visible on the queue button');
      assert.notEqual(focus.outlineWidth, '0px', 'the focused queue button keeps a visible focus indicator');

      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.keyboard.press('Enter')]);
      assert.match(page.url(), /filters\.moderation_status=FLAGGED/);
      assert.deepEqual(await listRowIds(page), [fixture.flaggedPostId]);

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
});

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
  notifications, moderation_actions, posts, users,
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

async function openDashboard(page, search = '') {
  await page.goto(`${baseUrl}/admin${search}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="pupzy-tiles"]', { timeout: 60000 });
  await page.waitForSelector('[data-testid="pupzy-cases"], [data-testid="pupzy-inbox-empty"]', { timeout: 60000 });
}

function tileCount(page, kind) {
  return page.$eval(`[data-testid="pupzy-tile-count-${kind}"]`, (element) => element.innerText);
}

function inboxCases(page) {
  return page.$$eval('[data-testid="pupzy-case"]', (rows) =>
    rows.map((row) => ({
      kind: row.dataset.kind,
      text: row.innerText,
      title: row.querySelector('.pupzy-case-title')?.innerText,
      count: row.querySelector('[data-testid="pupzy-case-count"]')?.innerText,
    })),
  );
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
  it('counts grouped cases separately from reports in the heading', async () => {
    const reporter = await insertUser('extra-reporter');
    await database.pool.query("INSERT INTO post_reports(post_id,reporter_id,reason) VALUES ($1,$2,'SPAM')", [
      fixture.approvedPostId,
      reporter,
    ]);
    const { page } = await createTestPage(browser);
    try {
      await loginAsAdmin(page, baseUrl);
      await openDashboard(page, '?kind=post_report');
      assert.equal(
        await page.$eval('[data-testid="pupzy-cases-heading"]', (el) => el.innerText),
        'Open Post Reports · 2 cases, 3 reports',
      );
      assert.equal((await inboxCases(page)).length, 2);
    } finally {
      await page.close();
    }
  });

  it('counts the same open work in the Inbox tiles as the lists show, and filters the Inbox from a tile', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    try {
      await loginAsAdmin(page, baseUrl);
      await openDashboard(page);

      assert.equal(await page.$eval('h1', (element) => element.innerText), 'Inbox');
      const tiles = await page.$$eval('[data-testid="pupzy-tiles"] button', (links) =>
        links.map((link) => link.innerText),
      );
      assert.deepEqual(
        tiles.map((text) => text.split('\n')[1]),
        ['Open Post Reports', 'Open Comment Reports', 'Open Account Reports', 'Flagged posts', 'Pending review'],
      );
      assert.equal(await tileCount(page, 'flagged'), '1', 'the flagged tile counts flagged active Posts');
      assert.equal(await tileCount(page, 'pending'), '1');
      assert.equal(await tileCount(page, 'post_report'), '2', 'open Reports are counted separately from flags');
      assert.equal(await tileCount(page, 'comment_report'), '0');
      assert.equal(await tileCount(page, 'account_report'), '0');
      assert.match(
        await page.$eval('[data-testid="pupzy-cases-heading"]', (el) => el.innerText),
        /^All open cases · \d+$/,
      );
      console.log(`[bwg-05 evidence] inbox tiles ${await recordEvidence(page, '01-inbox-tiles', { fullPage: true })}`);

      await page.click('[data-testid="pupzy-tile-flagged"]');
      await page.waitForFunction(() => new URL(location.href).searchParams.get('kind') === 'flagged');
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="pupzy-case"]').length === 1 &&
          document.querySelector('[data-testid="pupzy-case"]').dataset.kind === 'flagged',
      );
      const flaggedCases = await inboxCases(page);
      assert.equal(
        flaggedCases.length,
        Number(await tileCount(page, 'flagged')),
        'the filtered Inbox holds the tile count',
      );
      assert.match(flaggedCases[0].title, /Flagged browser case/);
      const pressed = (kind) =>
        page.$eval(`[data-testid="pupzy-tile-${kind}"]`, (el) => el.getAttribute('aria-pressed'));
      assert.equal(await pressed('flagged'), 'true');
      assert.equal(await pressed('post_report'), 'false');
      assert.equal(await page.$eval('[data-testid="pupzy-cases-heading"]', (el) => el.innerText), 'Flagged posts · 1');
      await page.click('[data-testid="pupzy-tile-flagged"]');
      await page.waitForFunction(() => !new URL(location.href).searchParams.has('kind'));
      assert.equal(await pressed('flagged'), 'false', 'clicking the active tile goes back to all cases');
      await page.click('[data-testid="pupzy-tile-flagged"]');
      await page.waitForFunction(() => new URL(location.href).searchParams.get('kind') === 'flagged');
      await page.click('[data-testid="pupzy-all-cases"]');
      await page.waitForFunction(() => !new URL(location.href).searchParams.has('kind'));
      await page.click('[data-testid="pupzy-tile-flagged"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="pupzy-case"]').length === 1);
      console.log(`[bwg-05 evidence] flagged filter ${await recordEvidence(page, '02-flagged-filter')}`);

      // The same work is reachable as a Posts list with the same total.
      await page.goto(`${baseUrl}/admin/resources/posts?filters.moderation_status=FLAGGED&filters.status=ACTIVE`, {
        waitUntil: 'networkidle0',
      });
      await page.waitForSelector('tr[data-id]');
      assert.deepEqual(await listRowIds(page), [fixture.flaggedPostId]);

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

      const cases = await inboxCases(page);
      const flaggedCase = cases.find((row) => row.title === 'Flagged browser case' && row.kind === 'flagged');
      const pendingCase = cases.find((row) => row.title === 'Pending moderation browser case');
      assert.ok(flaggedCase, 'the flagged Post appears in the Inbox');
      assert.ok(pendingCase, 'the pending-moderation Post appears in the Inbox');
      assert.equal(pendingCase.kind, 'pending');
      assert.match(pendingCase.text, /Automatic review/);
      assert.equal(
        (pendingCase.text.match(/Automatic review/g) ?? []).length,
        1,
        'Automatic review appears once on a system row',
      );
      assert.doesNotMatch(pendingCase.text, /Waiting for automatic review/);
      assert.equal(flaggedCase.count, '1 report', 'the flagged Post shows its one open Report');
      assert.equal(pendingCase.count, 'No reports', 'pending moderation is not represented as an open Report');
      const approved = cases.filter((row) => row.title === 'Approved case with an open report');
      assert.deepEqual(
        approved.map((row) => row.kind),
        ['post_report'],
        'an approved Post is shown only as a Post report, never as flagged or pending work',
      );

      await page.click('[data-testid="pupzy-tile-post_report"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="pupzy-case"]').length === 2);
      assert.equal(
        await page.$eval('[data-testid="pupzy-cases-heading"]', (el) => el.innerText),
        'Open Post Reports · 2 cases, 2 reports',
      );
      assert.deepEqual(
        new Set((await inboxCases(page)).map((row) => row.title)),
        new Set(['Flagged browser case', 'Approved case with an open report']),
        'only Posts with unreviewed Reports are listed, once each',
      );

      await openList(page, 'post_reports', { review_state: 'OPEN' });
      const reportIds = await listRowIds(page);
      assert.deepEqual(
        new Set(reportIds),
        new Set([fixture.openReportOnFlaggedId, fixture.openReportOnApprovedId]),
        'the Reports list holds the same open work',
      );
      assert.equal(reportIds.includes(fixture.reviewedReportId), false, 'a reviewed Report leaves the open queue');
      console.log(`[bwg-05 evidence] open reports list ${await recordEvidence(page, '04-open-reports-queue')}`);

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('groups the sidebar by task, collapses Records and hides super-admin entries from admins', async () => {
    const sidebar = (page) =>
      page.$eval('[data-css="sidebar-resources"]', (element) =>
        element.innerText
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      );
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    try {
      await loginAsAdmin(page, baseUrl);
      await openDashboard(page);
      assert.deepEqual(await sidebar(page), [
        'Navigation',
        'Inbox',
        'Reports',
        'Post Reports',
        'Comment Reports',
        'Account Reports',
        'Content',
        'Posts',
        'Comments',
        'Post photos',
        'People',
        'Users',
        'Places',
        'Cities',
        'Vet clinics',
        'Admin',
        'Audit log',
        'Notifications',
        'Records',
      ]);
      console.log(`[inbox evidence] admin sidebar ${await recordEvidence(page, '08-sidebar-admin')}`);

      await page.evaluate(() => {
        const label = Array.from(document.querySelectorAll('[data-css="sidebar-resources"] *')).find(
          (element) => element.children.length === 0 && element.textContent.trim() === 'Records',
        );
        label.click();
      });
      await page.waitForFunction(() =>
        document.querySelector('[data-css="sidebar-resources"]').innerText.includes('Saved posts'),
      );
      const opened = await sidebar(page);
      assert.deepEqual(opened.slice(opened.indexOf('Records')), [
        'Records',
        'Rescue details',
        'Lost and found details',
        'Adoption details',
        'Product details',
        'Mating details',
        'Saved posts',
        'Upvotes',
        'Contact requests',
        'Adoption applications',
        'Vet clinic location audits',
      ]);

      await page.goto(`${baseUrl}/admin/resources/post_reports`, { waitUntil: 'networkidle0' });
      assert.equal(
        await page.$eval(
          '[data-css="sidebar-resources"] a[aria-current], [data-css="sidebar-resources"] a[href$="/resources/post_reports"]',
          (el) => el.getAttribute('href'),
        ),
        '/admin/resources/post_reports',
      );
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }

    const superPage = await createTestPage(browser, [/Failed to load resource/]);
    try {
      await superPage.page.goto(`${baseUrl}/admin/login`, { waitUntil: 'networkidle0' });
      assert.match(
        await superPage.page.evaluate(() => localStorage.getItem('pupzy:nav-open')),
        /"Records":true/,
        'opening Records is remembered for this browser',
      );
      await superPage.page.evaluate(() => localStorage.clear());
      await loginAsAdmin(superPage.page, baseUrl, 'admin@example.com', 'super secure password');
      await superPage.page.waitForSelector('[data-testid="pupzy-tiles"]', { timeout: 60000 });
      const entries = await sidebar(superPage.page);
      assert.deepEqual(entries.slice(entries.indexOf('Places')), [
        'Places',
        'Cities',
        'Vet clinics',
        'Announcements',
        'Admin',
        'Admin users',
        'Audit log',
        'Notifications',
        'Records',
      ]);
      console.log(`[inbox evidence] super admin sidebar ${await recordEvidence(superPage.page, '09-sidebar-super')}`);
      assert.deepEqual(superPage.errors, []);
    } finally {
      await superPage.page.close();
    }
  });

  it('opens a case from the Inbox, reviews it and goes back to the same filter and page', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    try {
      // 25 older cases push the fixture's two Post Reports onto page 2 of the oldest-first list.
      const reporterId = await insertUser('journey-reporter');
      for (let index = 0; index < 25; index += 1) {
        const target = await insertPost(database.pool, {
          userId: fixture.ownerId,
          cityId: principals.cityId,
          postType: 'PRODUCT',
          title: `Older reported listing ${index}`,
          status: 'ACTIVE',
          moderationStatus: 'CLEAN',
          marketCategory: 'FOOD',
        });
        await database.pool.query(
          `INSERT INTO post_reports (post_id, reporter_id, reason, created_at)
           VALUES ($1, $2, 'SPAM', now() - interval '10 days' - make_interval(mins => $3::int))`,
          [target, reporterId, 25 - index],
        );
      }

      await loginAsAdmin(page, baseUrl);
      await openDashboard(page, '?kind=post_report&page=2');
      const secondPage = await inboxCases(page);
      assert.deepEqual(
        secondPage.map((row) => row.title),
        ['Flagged browser case', 'Approved case with an open report'],
        'page 2 holds the two newest cases, the oldest first',
      );
      assert.match(await page.$eval('[data-testid="pupzy-pager"]', (el) => el.innerText), /Page 2 of 2/);

      await page.click('[data-testid="pupzy-case"][data-kind="post_report"] [data-testid="pupzy-case-open"]');
      await page.waitForSelector('[data-testid="pupzy-back-to-inbox"]', { timeout: 60000 });
      assert.match(
        page.url(),
        new RegExp(`/admin/resources/post_reports/records/${fixture.openReportOnApprovedId}/show`),
      );
      assert.equal(
        await page.$eval('[data-testid="pupzy-back-to-inbox"]', (el) => el.getAttribute('href')),
        '/admin?kind=post_report&page=2',
      );

      await page.click('[data-testid="action-reviewWithNoAction"]');
      await page.waitForSelector('[data-testid="moderation-action-submit"]', { timeout: 60000 });
      assert.ok(await page.$('[data-testid="pupzy-back-to-inbox"]'), 'the action page also offers the way back');
      await page.click('[data-testid="moderation-action-submit"]');
      await page.waitForSelector('[data-testid="pupzy-report-status"]', { timeout: 60000 });
      assert.match(await page.$eval('[data-testid="pupzy-report-status"]', (el) => el.innerText), /Closed: no action/);
      console.log(`[inbox evidence] case after review ${await recordEvidence(page, '06-case-after-review')}`);

      await page.click('[data-testid="pupzy-back-to-inbox"]');
      await page.waitForSelector('[data-testid="pupzy-cases"]', { timeout: 60000 });
      assert.equal(new URL(page.url()).search, '?kind=post_report&page=2', 'back to the same filter and page');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="pupzy-case"]').length === 1);
      const remaining = await inboxCases(page);
      assert.deepEqual(
        remaining.map((row) => row.title),
        ['Flagged browser case'],
        'the reviewed case left the Inbox',
      );
      assert.equal(await tileCount(page, 'post_report'), '26');
      console.log(`[inbox evidence] back at page 2 ${await recordEvidence(page, '07-back-to-inbox')}`);

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('keeps Inbox navigation usable on a narrow screen with focus, hover and reduced-motion support', async () => {
    const { page, errors } = await createTestPage(browser, [/Failed to load resource/]);
    const selector = '[data-testid="pupzy-tile-flagged"]';
    try {
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await loginAsAdmin(page, baseUrl);
      await page.setViewport({ width: 390, height: 844 });
      await openDashboard(page);

      const layout = await page.evaluate((target) => {
        const button = document.querySelector(target);
        const box = button.getBoundingClientRect();
        const row = document.querySelector('[data-testid="pupzy-case"]').getBoundingClientRect();
        return {
          documentClientWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          buttonLeft: box.left,
          buttonRight: box.right,
          buttonHeight: box.height,
          rowRight: row.right,
          transitionSeconds: parseFloat(getComputedStyle(button).transitionDuration),
        };
      }, selector);
      assert.equal(layout.documentScrollWidth, layout.documentClientWidth, 'no horizontal scroll at 390px');
      assert.ok(layout.buttonLeft >= 0 && layout.buttonRight <= layout.documentClientWidth + 1);
      assert.ok(layout.rowRight <= layout.documentClientWidth + 1, 'case rows fit the screen');
      assert.ok(layout.buttonHeight >= 38, 'tiles keep a usable touch target');
      assert.ok(
        layout.transitionSeconds <= 0.001,
        `reduced motion collapses tile transitions (saw ${layout.transitionSeconds}s)`,
      );
      console.log(
        `[bwg-05 evidence] narrow inbox ${await recordEvidence(page, '05-narrow-dashboard', { fullPage: true })}`,
      );

      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
      const transitionSeconds = await page.$eval(selector, (element) =>
        parseFloat(getComputedStyle(element).transitionDuration),
      );
      assert.ok(transitionSeconds > 0, 'tiles keep a brief transition when motion is allowed');
      const beforeHover = await page.$eval(selector, (element) => getComputedStyle(element).transform);
      await page.hover(selector);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const afterHover = await page.$eval(selector, (element) => getComputedStyle(element).transform);
      assert.notEqual(afterHover, beforeHover, 'hovering a tile lifts it');

      await page.keyboard.press('Tab');
      await page.evaluate((target) => document.querySelector(target).focus(), selector);
      const focus = await page.evaluate(() => ({
        testId: document.activeElement?.dataset?.testid,
        focusVisible: document.activeElement?.matches(':focus-visible'),
        outlineWidth: getComputedStyle(document.activeElement).outlineWidth,
      }));
      assert.equal(focus.testId, 'pupzy-tile-flagged');
      assert.equal(focus.focusVisible, true, 'keyboard focus is visible on the tile');
      assert.notEqual(focus.outlineWidth, '0px', 'the focused tile keeps a visible focus indicator');

      await page.keyboard.press('Enter');
      await page.waitForFunction(() => new URL(location.href).searchParams.get('kind') === 'flagged');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="pupzy-case"]').length === 1);
      assert.match((await inboxCases(page))[0].title, /Flagged browser case/);

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
});

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

import { buildAdminJs } from '../src/adminjs/index.js';
import { buildAuthenticate } from '../src/auth/authenticate.js';
import { buildCsrfProtection } from '../src/middleware/csrf.js';
import { requireSameOrigin } from '../src/middleware/same-origin.js';
import { TestDatabaseHelper } from './test-database.helper.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const database = new TestDatabaseHelper();
const SCREENSHOT_DIR =
  process.env.ANNOUNCEMENT_SCREENSHOT_DIR ||
  path.resolve(currentDirectory, '../../.scratch/admin-announcements/screenshots');

let server;
let baseUrl;
let sqlAdapterPool;
let browser;
let testvilleId;

const USER_COUNT = 240;
// The same seed model as the HTTP tests: banned and deletion-requested accounts are not recipients.
const isEligible = (i) => i % 25 !== 0 && i % 40 !== 1;
const inTestville = (i) => i % 10 !== 0 && i % 2 === 0;
const numbers = Array.from({ length: USER_COUNT }, (_, index) => index + 1);
const ALL_COUNT = numbers.filter(isEligible).length;
const TESTVILLE_COUNT = numbers.filter((i) => isEligible(i) && inTestville(i)).length;

const ENGLISH_TITLE = 'Free vaccination week';
const ENGLISH_BODY = 'Partner clinics offer free rabies shots all week. Bring your pet and its vaccination card.';
const ARABIC_TITLE = 'أسبوع التطعيم المجاني';
const ARABIC_BODY = 'تقدم العيادات الشريكة تطعيمًا مجانيًا ضد السعار طوال الأسبوع. أحضر حيوانك الأليف وبطاقة التطعيم.';

function findChromePath() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  for (const candidate of ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Chrome/Chromium binary not found on system.');
}

async function screenshot(page, name) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function newPage(allowedErrors = []) {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);
  await page.setViewport({ width: 1360, height: 1000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`PageError: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!allowedErrors.some((pattern) => (pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern)))) {
      errors.push(`ConsoleError: ${text}`);
    }
  });
  return { page, errors };
}

async function login(page, email, password) {
  await page.goto(`${baseUrl}/admin/login`, { waitUntil: 'networkidle0' });
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('form button')]);
}

const loginSuper = (page) => login(page, 'super@example.com', 'super secure password');
const loginStaff = (page) => login(page, 'staff@example.com', 'staff secure password');

async function openCompose(page) {
  await page.goto(`${baseUrl}/admin/resources/announcements/actions/new`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="announcement-compose"]');
}

async function fillAnnouncement(page, overrides = {}) {
  const values = {
    'announcement-title-en': ENGLISH_TITLE,
    'announcement-body-en': ENGLISH_BODY,
    'announcement-title-ar': ARABIC_TITLE,
    'announcement-body-ar': ARABIC_BODY,
    ...overrides,
  };
  for (const [testId, value] of Object.entries(values)) {
    await page.click(`[data-testid="${testId}"]`, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    if (value) await page.type(`[data-testid="${testId}"]`, value);
  }
}

const text = (page, selector) => page.$eval(selector, (element) => element.innerText.trim());

async function dbAnnouncements() {
  const { rows } = await database.pool.query(`SELECT * FROM announcements ORDER BY created_at`);
  return rows;
}

before(async () => {
  const connectionString = await database.start();
  const superHash = await bcrypt.hash('super secure password', 4);
  const staffHash = await bcrypt.hash('staff secure password', 4);
  await database.pool.query(
    `INSERT INTO admin_users (email, password_hash, full_name, role) VALUES
       ('super@example.com', $1, 'Super Admin', 'SUPER_ADMIN'),
       ('staff@example.com', $2, 'Staff Admin', 'ADMIN')`,
    [superHash, staffHash],
  );
  const cities = await database.pool.query(
    `INSERT INTO cities (name_english, name_arabic, governorate, center_point) VALUES
       ('Testville', 'تيست فيل', 'Test Governorate', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)),
       ('Otherton', 'أذرتون', 'Test Governorate', ST_SetSRID(ST_MakePoint(29.9187, 31.2001), 4326))
     RETURNING id, name_english`,
  );
  testvilleId = cities.rows.find((row) => row.name_english === 'Testville').id;
  const otherId = cities.rows.find((row) => row.name_english === 'Otherton').id;
  await database.pool.query(
    `INSERT INTO users (firebase_user_id, email, full_name, home_city_id, is_banned, created_at)
     SELECT 'fb-' || g, 'u' || g || '@example.com', 'User ' || g,
            CASE WHEN g % 10 = 0 THEN NULL WHEN g % 2 = 0 THEN $1::uuid ELSE $2::uuid END,
            g % 25 = 0, now() - interval '1 day'
     FROM generate_series(1, $3::int) g`,
    [testvilleId, otherId, USER_COUNT],
  );
  await database.pool.query(
    `INSERT INTO account_deletions (user_id, firebase_user_id, email, status, step, progress_token_hash)
     SELECT u.id, u.firebase_user_id, u.email, 'PENDING', 'ACCEPTED', 'hash-' || u.firebase_user_id
     FROM users u WHERE substring(u.firebase_user_id from 4)::int % 40 = 1`,
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
  await database.pool.query(`TRUNCATE announcements, moderation_actions, notifications CASCADE`);
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await sqlAdapterPool?.destroy();
  await database.stop();
});

describe('Admin announcements real browser suite', { timeout: 240000 }, () => {
  it('a super admin composes in both languages, previews, confirms the exact count and finds it in the history', async () => {
    const { page, errors } = await newPage([/Failed to load resource/]);
    try {
      await loginSuper(page);

      // The history starts empty and offers the New announcement action.
      await page.goto(`${baseUrl}/admin/resources/announcements`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid="action-new"]');
      assert.match(await text(page, '[data-testid="action-new"]'), /New announcement/i);
      await Promise.all([
        page.waitForSelector('[data-testid="announcement-compose"]'),
        page.click('[data-testid="action-new"]'),
      ]);

      // Compose: both languages, right-to-left Arabic, counters and validation messages.
      assert.equal(await page.$eval('[data-testid="announcement-title-ar"]', (el) => el.dir), 'rtl');
      assert.equal(await page.$eval('[data-testid="announcement-body-ar"]', (el) => el.dir), 'rtl');
      assert.equal(await page.$eval('[data-testid="announcement-title-en"]', (el) => el.dir), 'ltr');
      assert.equal(await text(page, '[data-testid="announcement-title-en-counter"]'), '0 / 80');
      assert.equal(await text(page, '[data-testid="announcement-body-ar-counter"]'), '0 / 500');

      await Promise.all([
        page.waitForSelector('[data-testid="announcement-title-en-error"]'),
        page.click('[data-testid="announcement-preview"]'),
      ]);
      for (const field of ['title-en', 'body-en', 'title-ar', 'body-ar']) {
        assert.match(await text(page, `[data-testid="announcement-${field}-error"]`), /Enter the/);
      }
      await screenshot(page, '00-compose-validation');
      assert.equal((await dbAnnouncements()).length, 0, 'a refused draft writes nothing');

      await fillAnnouncement(page);
      assert.equal(await text(page, '[data-testid="announcement-title-en-counter"]'), `${ENGLISH_TITLE.length} / 80`);
      assert.equal(
        await text(page, '[data-testid="announcement-title-ar-counter"]'),
        `${Array.from(ARABIC_TITLE).length} / 80`,
      );
      await screenshot(page, '01-compose');

      // Preview: both languages rendered as notification cards.
      await Promise.all([
        page.waitForSelector('[data-testid="announcement-preview-en"]'),
        page.click('[data-testid="announcement-preview"]'),
      ]);
      assert.equal(await text(page, '[data-testid="announcement-preview-en-title"]'), ENGLISH_TITLE);
      assert.equal(await text(page, '[data-testid="announcement-preview-en-body"]'), ENGLISH_BODY);
      assert.equal(await text(page, '[data-testid="announcement-preview-ar-title"]'), ARABIC_TITLE);
      assert.equal(await text(page, '[data-testid="announcement-preview-ar-body"]'), ARABIC_BODY);
      assert.equal(
        await page.$eval('[data-testid="announcement-preview-ar"] .pupzy-announcement-card', (el) => el.dir),
        'rtl',
      );
      assert.match(await text(page, '[data-testid="announcement-preview-audience"]'), /All users/);
      await screenshot(page, '02-preview');

      // Confirm: the exact count, and the button says it.
      await Promise.all([
        page.waitForSelector('[data-testid="announcement-confirm"]'),
        page.click('[data-testid="announcement-continue"]'),
      ]);
      assert.equal(await text(page, '[data-testid="announcement-confirm-count"]'), String(ALL_COUNT));
      assert.equal(await text(page, '[data-testid="announcement-send"]'), `Send to ${ALL_COUNT} users`);
      await screenshot(page, '03-confirm');
      assert.equal((await dbAnnouncements()).length, 0, 'nothing is sent before the confirmation');

      // Send: lands on the detail page, queued, with nothing inserted inline.
      await Promise.all([
        page.waitForSelector('[data-testid="announcement-show"]'),
        page.click('[data-testid="announcement-send"]'),
      ]);
      await page.waitForSelector('[data-testid="announcement-progress"]');
      assert.equal(await page.$eval('[data-testid="announcement-show"]', (el) => el.dataset.status), 'PENDING');
      assert.match(await text(page, '[data-testid="announcement-status"]'), /Pending/);
      assert.equal(await text(page, '[data-testid="announcement-stat-recipients"] dd'), String(ALL_COUNT));
      assert.equal(await text(page, '[data-testid="announcement-stat-in-app"] dd'), '0');
      assert.match(await text(page, '[data-testid="announcement-audience"]'), /All users/);
      assert.equal(await text(page, '[data-testid="announcement-card-en-title"]'), ENGLISH_TITLE);
      assert.equal(await text(page, '[data-testid="announcement-card-ar-body"]'), ARABIC_BODY);
      await screenshot(page, '04-detail-queued');

      const rows = await dbAnnouncements();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, 'PENDING', 'SENT is reached by the Nest processor, covered in backend integration');
      assert.equal(rows[0].expected_recipients, ALL_COUNT);
      assert.equal(rows[0].title_ar, ARABIC_TITLE);
      assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n, 0);
      assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM moderation_actions')).rows[0].n, 1);

      // History: the announcement is listed with its sender, audience, both texts, status and counts.
      await page.goto(`${baseUrl}/admin/resources/announcements`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('tr[data-id]');
      const rowText = await page.$eval('tr[data-id]', (row) => row.innerText);
      assert.match(rowText, /Super Admin/);
      assert.match(rowText, /All users/);
      assert.ok(rowText.includes(ENGLISH_TITLE));
      assert.ok(rowText.includes(ARABIC_TITLE));
      assert.match(rowText, /Pending/);
      assert.ok(rowText.includes(String(ALL_COUNT)));
      await screenshot(page, '05-history');

      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('a super admin can address one City and sees that City count', async () => {
    const { page, errors } = await newPage([/Failed to load resource/]);
    try {
      await loginSuper(page);
      await openCompose(page);
      await fillAnnouncement(page);
      await page.click('[data-testid="announcement-audience-city"]');

      // A City audience needs a City.
      await Promise.all([
        page.waitForSelector('[data-testid="announcement-city-error"]'),
        page.click('[data-testid="announcement-preview"]'),
      ]);
      assert.match(await text(page, '[data-testid="announcement-city-error"]'), /Choose a City/);

      await page.type('[data-testid="announcement-city-search"]', 'Testv');
      await page.waitForSelector('[data-testid="announcement-city-option"]');
      await page.click('[data-testid="announcement-city-option"]');
      assert.match(await text(page, '[data-testid="announcement-city-selected"]'), /Testville/);

      await Promise.all([
        page.waitForSelector('[data-testid="announcement-preview-en"]'),
        page.click('[data-testid="announcement-preview"]'),
      ]);
      assert.match(await text(page, '[data-testid="announcement-preview-audience"]'), /Users in Testville/);
      await Promise.all([
        page.waitForSelector('[data-testid="announcement-confirm"]'),
        page.click('[data-testid="announcement-continue"]'),
      ]);
      assert.equal(await text(page, '[data-testid="announcement-confirm-count"]'), String(TESTVILLE_COUNT));
      assert.ok(TESTVILLE_COUNT < ALL_COUNT);
      await Promise.all([
        page.waitForSelector('[data-testid="announcement-show"]'),
        page.click('[data-testid="announcement-send"]'),
      ]);
      assert.match(await text(page, '[data-testid="announcement-audience"]'), /Testville/);
      const [row] = await dbAnnouncements();
      assert.equal(row.audience, 'CITY');
      assert.equal(row.audience_city_id, testvilleId);
      assert.equal(row.expected_recipients, TESTVILLE_COUNT);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('refuses a send when the audience changed after the count was confirmed', async () => {
    const { page, errors } = await newPage([/Failed to load resource/]);
    try {
      await loginSuper(page);
      await openCompose(page);
      await fillAnnouncement(page);
      await page.click('[data-testid="announcement-preview"]');
      await page.waitForSelector('[data-testid="announcement-continue"]');
      await page.click('[data-testid="announcement-continue"]');
      await page.waitForSelector('[data-testid="announcement-confirm"]');
      assert.equal(await text(page, '[data-testid="announcement-confirm-count"]'), String(ALL_COUNT));

      // Another account is banned while the administrator is on the confirmation step.
      await database.pool.query(`UPDATE users SET is_banned = true WHERE firebase_user_id = 'fb-2'`);
      try {
        await page.click('[data-testid="announcement-send"]');
        await page.waitForSelector('[data-testid="announcement-stale"]');
        assert.match(await text(page, '[data-testid="announcement-stale"]'), new RegExp(String(ALL_COUNT - 1)));
        assert.equal(await text(page, '[data-testid="announcement-confirm-count"]'), String(ALL_COUNT - 1));
        assert.equal((await dbAnnouncements()).length, 0);

        // The button now names the new number, so one click confirms it; nothing is retyped.
        assert.equal(await text(page, '[data-testid="announcement-send"]'), `Send to ${ALL_COUNT - 1} users`);
        assert.equal(await page.$eval('[data-testid="announcement-send"]', (el) => el.disabled), false);
        // Confirming the new number sends.
        await page.click('[data-testid="announcement-send"]');
        await page.waitForSelector('[data-testid="announcement-show"]');
        assert.equal((await dbAnnouncements())[0].expected_recipients, ALL_COUNT - 1);
      } finally {
        await database.pool.query(`UPDATE users SET is_banned = false WHERE firebase_user_id = 'fb-2'`);
      }
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('a double click on Send, and a replayed request, create one announcement', async () => {
    const { page, errors } = await newPage([/Failed to load resource/]);
    try {
      const posts = [];
      page.on('request', (request) => {
        if (request.method() === 'POST' && request.url().endsWith('/actions/new')) posts.push(request.postData());
      });
      await loginSuper(page);
      await openCompose(page);
      await fillAnnouncement(page);
      await page.click('[data-testid="announcement-preview"]');
      await page.waitForSelector('[data-testid="announcement-continue"]');
      await page.click('[data-testid="announcement-continue"]');
      await page.waitForSelector('[data-testid="announcement-send"]');

      await page.click('[data-testid="announcement-send"]', { clickCount: 2 });
      await page.waitForSelector('[data-testid="announcement-show"]');

      assert.ok(posts.length >= 1);
      const keys = new Set(posts.map((body) => JSON.parse(body).requestKey));
      assert.equal(keys.size, 1, 'every POST of one draft carries the same request key');
      assert.match([...keys][0], /^[0-9a-f-]{36}$/);
      // The same request replayed (a network retry) answers with the same announcement.
      const replay = await page.evaluate(async (body) => {
        const csrf = decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/) ?? [])[1] ?? '');
        const response = await fetch('/admin/api/resources/announcements/actions/new', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-xsrf-token': csrf },
          body,
        });
        return response.json();
      }, posts[0]);
      assert.equal(replay.ok, true);
      const rows = await dbAnnouncements();
      assert.equal(rows.length, 1);
      assert.equal(replay.id, rows[0].id);
      assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM moderation_actions')).rows[0].n, 1);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('the detail page follows the backend while the announcement is delivered', async () => {
    const { rows } = await database.pool.query(
      `INSERT INTO announcements (request_key, audience, title_en, body_en, title_ar, body_ar, expected_recipients, sent_by_admin_id)
       VALUES (uuidv7(), 'ALL', $1, $2, $3, $4, 200, (SELECT id FROM admin_users WHERE role = 'SUPER_ADMIN'))
       RETURNING id`,
      [ENGLISH_TITLE, ENGLISH_BODY, ARABIC_TITLE, ARABIC_BODY],
    );
    const id = rows[0].id;
    const { page, errors } = await newPage([/Failed to load resource/]);
    try {
      await loginSuper(page);
      await page.goto(`${baseUrl}/admin/resources/announcements/records/${id}/show`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid="announcement-show"]');
      assert.equal(await page.$eval('[data-testid="announcement-show"]', (el) => el.dataset.status), 'PENDING');

      // Stand-in for the backend processor (its real behaviour is covered by the backend integration suite):
      // the notifications, push intents and counters it would have written once delivery finished.
      const recipients = await database.pool.query(`SELECT id FROM users ORDER BY id LIMIT 3`);
      for (const [index, user] of recipients.rows.entries()) {
        const notification = await database.pool.query(
          `INSERT INTO notifications (recipient_id, type, title, body, announcement_id)
           VALUES ($1, 'ADMIN_ANNOUNCEMENT', $2, $3, $4) RETURNING id`,
          [user.id, ENGLISH_TITLE, ENGLISH_BODY, id],
        );
        const device = await database.pool.query(
          `INSERT INTO device_registrations (user_id, token, platform) VALUES ($1, $2, 'ANDROID') RETURNING id`,
          [user.id, `browser-test-token-${index}`],
        );
        await database.pool.query(
          `INSERT INTO push_deliveries (notification_id, recipient_id, device_id, status)
           VALUES ($1, $2, $3, $4)`,
          [notification.rows[0].id, user.id, device.rows[0].id, index < 2 ? 'DELIVERED' : 'PENDING'],
        );
      }
      await database.pool.query(
        `UPDATE announcements
         SET status = 'SENT', in_app_count = 200, push_intent_count = 3, started_at = now(), completed_at = now()
         WHERE id = $1`,
        [id],
      );
      await page.waitForFunction(
        () => document.querySelector('[data-testid="announcement-show"]')?.dataset.status === 'SENT',
        { timeout: 20000 },
      );
      assert.equal(await text(page, '[data-testid="announcement-stat-in-app"] dd'), '200');
      assert.equal(await text(page, '[data-testid="announcement-stat-push-queued"] dd'), '3');
      assert.equal(await text(page, '[data-testid="announcement-stat-push-delivered"] dd'), '2');
      assert.equal(await text(page, '[data-testid="announcement-stat-push-waiting"] dd'), '1');
      assert.equal(await page.$('[data-testid="announcement-progress"]'), null, 'no progress bar once SENT');
      await screenshot(page, '06-detail-sent');

      await page.goto(`${baseUrl}/admin/resources/announcements`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('tr[data-id]');
      const sentRow = await page.$eval('tr[data-id]', (row) => row.innerText);
      assert.match(sentRow, /Sent/);
      assert.ok(sentRow.includes('200'), 'the history shows the in-app count');
      assert.ok(sentRow.includes('2 / 3'), 'the history shows push delivered out of queued');
      await screenshot(page, '07-history-sent');
      await page.goto(`${baseUrl}/admin/resources/announcements/records/${id}/show`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid="announcement-show"]');

      await database.pool.query(
        `UPDATE announcements SET status = 'FAILED', failure_reason = 'The database connection was lost.' WHERE id = $1`,
        [id],
      );
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid="announcement-failure"]');
      assert.match(await text(page, '[data-testid="announcement-failure"]'), /database connection was lost/);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('a plain admin has no Announcements entry and cannot open the pages', async () => {
    const { page } = await newPage([/Failed to load resource/]);
    try {
      await loginStaff(page);
      await page.goto(`${baseUrl}/admin`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid="pupzy-tiles"], nav, aside');
      const navText = await page.evaluate(() => document.body.innerText);
      assert.doesNotMatch(navText, /Announcements/);

      await page.goto(`${baseUrl}/admin/resources/announcements/actions/new`, { waitUntil: 'networkidle0' });
      assert.equal(await page.$('[data-testid="announcement-compose"]'), null);
      assert.equal(await page.$('[data-testid="announcement-send"]'), null);
      assert.equal((await dbAnnouncements()).length, 0);
    } finally {
      await page.close();
    }
  });

  it('shows Announcements in the super admin navigation', async () => {
    const { page } = await newPage([/Failed to load resource/]);
    try {
      await loginSuper(page);
      await page.goto(`${baseUrl}/admin`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid="pupzy-tiles"]');
      assert.match(await page.evaluate(() => document.body.innerText), /Announcements/);
    } finally {
      await page.close();
    }
  });
});

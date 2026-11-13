import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { buildAudienceCountQuery } from '../../src/notifications/admin-announcement.contract.ts';
import { TestDatabaseHelper } from './test-database.helper.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const database = new TestDatabaseHelper();

let server;
let baseUrl;
let sqlAdapterPool;
let superSession;
let staffSession;
let superId;
let cairoId;
let alexId;

/** Seed model: attributes are pure functions of the account number, so the oracle is independent of the SQL. */
const USER_COUNT = 240;
const model = {
  city: (i) => (i % 10 === 0 ? null : i % 2 === 0 ? 'CAIRO' : 'ALEX'),
  banned: (i) => i % 25 === 0,
  deletion: (i) => i % 40 === 1,
  eligible: (i) => !model.banned(i) && !model.deletion(i),
};
const numbers = Array.from({ length: USER_COUNT }, (_, index) => index + 1);
const eligibleCount = (city) => numbers.filter((i) => model.eligible(i) && (!city || model.city(i) === city)).length;

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
  const cookie = response.headers
    .getSetCookie()
    .find((entry) => entry.startsWith('pupzy_admin_test='))
    ?.split(';', 1)[0];
  assert.ok(cookie, `${email} must be able to sign in`);
  return { cookie: `${cookie}; ${csrfCookie}`, token: csrfToken };
}

async function api(sessionState, resource, action, body, { method = 'POST' } = {}) {
  const response = await fetch(`${baseUrl}/admin/api/resources/${resource}/actions/${action}`, {
    method,
    headers: {
      cookie: sessionState.cookie,
      origin: baseUrl,
      'x-xsrf-token': sessionState.token,
      'content-type': 'application/json',
    },
    ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  assert.equal(response.status, 200, `${resource}/${action} should answer`);
  return response.json();
}

const draft = (overrides = {}) => ({
  titleEn: 'Vaccination week',
  bodyEn: 'Free rabies shots at partner clinics this week.',
  titleAr: 'أسبوع التطعيم',
  bodyAr: 'تطعيم مجاني ضد السعار في العيادات الشريكة هذا الأسبوع.',
  audience: 'ALL',
  cityId: '',
  ...overrides,
});

async function rowCount(table) {
  const { rows } = await database.pool.query(`SELECT count(*)::int AS count FROM ${table}`);
  return rows[0].count;
}

describe('Admin announcements (HTTP, real database)', () => {
  before(async () => {
    const connectionString = await database.start();
    const superHash = await bcrypt.hash('super secure password', 4);
    const staffHash = await bcrypt.hash('staff secure password', 4);
    const admins = await database.pool.query(
      `INSERT INTO admin_users (email, password_hash, full_name, role) VALUES
         ('super@example.com', $1, 'Super Admin', 'SUPER_ADMIN'),
         ('staff@example.com', $2, 'Staff Admin', 'ADMIN')
       RETURNING id, role`,
      [superHash, staffHash],
    );
    superId = admins.rows.find((row) => row.role === 'SUPER_ADMIN').id;

    const cities = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, center_point) VALUES
         ('Testville', 'تيست فيل', 'Test Governorate', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)),
         ('Otherton', 'أذرتون', 'Test Governorate', ST_SetSRID(ST_MakePoint(29.9187, 31.2001), 4326))
       RETURNING id, name_english`,
    );
    cairoId = cities.rows.find((row) => row.name_english === 'Testville').id;
    alexId = cities.rows.find((row) => row.name_english === 'Otherton').id;

    await database.pool.query(
      `INSERT INTO users (firebase_user_id, email, full_name, home_city_id, is_banned, created_at)
       SELECT 'fb-' || g, 'u' || g || '@example.com', 'User ' || g,
              CASE WHEN g % 10 = 0 THEN NULL WHEN g % 2 = 0 THEN $1::uuid ELSE $2::uuid END,
              g % 25 = 0, now() - interval '1 day'
       FROM generate_series(1, $3::int) g`,
      [cairoId, alexId, USER_COUNT],
    );
    await database.pool.query(
      `INSERT INTO account_deletions (user_id, firebase_user_id, email, status, step, progress_token_hash)
       SELECT u.id, u.firebase_user_id, u.email, 'PENDING', 'ACCEPTED', 'hash-' || u.firebase_user_id
       FROM users u WHERE substring(u.firebase_user_id from 4)::int % 40 = 1`,
    );

    const databaseName = new URL(connectionString).pathname.replace(/^\//, '');
    const built = await buildAdminJs(connectionString, databaseName, database.pool);
    sqlAdapterPool = built.sqlAdapterPool;

    const app = express();
    app.disable('x-powered-by');
    app.use('/admin/assets', express.static(path.join(currentDirectory, '../src/adminjs/public')));
    app.use('/admin', requireSameOrigin);
    app.use('/admin', buildCsrfProtection('a test CSRF signing secret at least 32 chars'));
    const PgSession = connectPgSimple(session);
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

    superSession = await login('super@example.com', 'super secure password');
    staffSession = await login('staff@example.com', 'staff secure password');
  });

  after(async () => {
    if (server) {
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    await sqlAdapterPool?.destroy();
    await database.stop();
  });

  beforeEach(async () => {
    await database.pool.query(`TRUNCATE announcements, moderation_actions, notifications CASCADE`);
  });

  it('the seed model matches the database', async () => {
    const query = buildAudienceCountQuery({ cutoff: new Date(), audience: 'ALL', cityId: null });
    const { rows } = await database.pool.query(query.text, query.values);
    assert.equal(rows[0].count, eligibleCount());
  });

  describe('a plain admin', () => {
    it('does not see the Announcements entry, a super admin does', async () => {
      const stateOf = async (sessionState) => {
        const html = await (await fetch(`${baseUrl}/admin`, { headers: { cookie: sessionState.cookie } })).text();
        const match = html.match(/window\.REDUX_STATE = (.*?);\s*window\.THEME = /s);
        assert.ok(match, 'the page carries its initial state');
        return JSON.parse(match[1]);
      };
      const hrefOf = (state) => state.resources.find((resource) => resource.id === 'announcements')?.href;

      assert.ok(hrefOf(await stateOf(superSession)), 'a super admin gets a link to the history');
      assert.ok(!hrefOf(await stateOf(staffSession)), 'a plain admin gets no link');
    });

    it('is refused on every announcement action by the server and nothing is written', async () => {
      const refused = async (action, body) => {
        const result = await api(staffSession, 'announcements', action, body);
        assert.equal(result.notice?.type, 'error', `${action} must be refused`);
        assert.ok(!result.id && !result.count, `${action} must return no data`);
      };
      await refused('new', { ...draft(), requestKey: randomUUID(), confirmedCount: eligibleCount() });
      await refused('previewAnnouncement', draft());
      for (const action of ['list', 'search']) {
        const result = await api(staffSession, 'announcements', action, null, { method: 'GET' });
        assert.equal(result.notice?.type, 'error', `${action} must be refused`);
        assert.deepEqual(result.records ?? [], []);
      }

      assert.equal(await rowCount('announcements'), 0);
      assert.equal(await rowCount('moderation_actions'), 0);
      assert.equal(await rowCount('notifications'), 0);
    });

    it('cannot read an announcement either', async () => {
      const { rows } = await database.pool.query(
        `INSERT INTO announcements (request_key, audience, title_en, body_en, title_ar, body_ar, expected_recipients)
         VALUES (uuidv7(), 'ALL', 'Hello', 'World', 'مرحبا', 'عالم', 1) RETURNING id`,
      );
      const response = await fetch(`${baseUrl}/admin/api/resources/announcements/records/${rows[0].id}/show`, {
        headers: { cookie: staffSession.cookie },
      });
      const result = await response.json();
      assert.equal(result.notice?.type, 'error');
      assert.ok(!result.record?.params?.title_en);
    });
  });

  describe('a super admin', () => {
    it('gets validation messages for each invalid field and nothing is written', async () => {
      const bad = draft({ titleEn: '', bodyEn: 'x'.repeat(501), titleAr: 'English only', bodyAr: '   ' });
      for (const action of ['previewAnnouncement', 'new']) {
        const result = await api(superSession, 'announcements', action, { ...bad, confirmedCount: 5 });
        assert.equal(result.ok, false, action);
        assert.deepEqual(Object.keys(result.errors).sort(), ['bodyAr', 'bodyEn', 'titleAr', 'titleEn']);
        assert.match(result.errors.titleEn, /Enter the english title/i);
        assert.match(result.errors.bodyEn, /at most 500/);
        assert.match(result.errors.titleAr, /Arabic/);
      }
      const city = await api(superSession, 'announcements', 'previewAnnouncement', draft({ audience: 'CITY' }));
      assert.deepEqual(Object.keys(city.errors), ['cityId']);
      assert.equal(await rowCount('announcements'), 0);
    });

    it('counts exactly the users the backend would deliver to', async () => {
      const everyone = await api(superSession, 'announcements', 'previewAnnouncement', draft());
      assert.deepEqual(everyone, { ok: true, count: eligibleCount(), audience: 'ALL', cityName: null });
      assert.ok(everyone.count < USER_COUNT - 9, 'banned and deleted accounts are not counted');

      const cairo = await api(
        superSession,
        'announcements',
        'previewAnnouncement',
        draft({ audience: 'CITY', cityId: cairoId }),
      );
      assert.deepEqual(cairo, { ok: true, count: eligibleCount('CAIRO'), audience: 'CITY', cityName: 'Testville' });

      const alex = await api(
        superSession,
        'announcements',
        'previewAnnouncement',
        draft({ audience: 'CITY', cityId: alexId }),
      );
      assert.equal(alex.count, eligibleCount('ALEX'));
      assert.equal(
        cairo.count + alex.count + numbers.filter((i) => model.eligible(i) && model.city(i) === null).length,
        everyone.count,
      );
    });

    it('sending writes one announcement and one audit row, and no notifications inline', async () => {
      const count = eligibleCount();
      const result = await api(superSession, 'announcements', 'new', {
        ...draft(),
        requestKey: randomUUID(),
        confirmedCount: count,
      });
      assert.equal(result.ok, true);
      assert.equal(result.count, count);
      assert.equal(result.notice.type, 'success');

      const { rows } = await database.pool.query(`SELECT * FROM announcements`);
      assert.equal(rows.length, 1);
      const [row] = rows;
      assert.equal(row.id, result.id);
      assert.equal(row.status, 'PENDING');
      assert.equal(row.audience, 'ALL');
      assert.equal(row.audience_city_id, null);
      assert.equal(row.sent_by_admin_id, superId);
      assert.equal(row.expected_recipients, count);
      assert.equal(row.in_app_count, 0);
      assert.equal(row.push_intent_count, 0);
      assert.equal(row.cursor_user_id, null);
      assert.equal(row.title_en, 'Vaccination week');
      assert.equal(row.title_ar, 'أسبوع التطعيم');
      assert.ok(row.audience_cutoff_at instanceof Date);

      const audit = await database.pool.query(`SELECT * FROM moderation_actions`);
      assert.equal(audit.rows.length, 1);
      assert.equal(audit.rows[0].action_type, 'ANNOUNCEMENT_SENT');
      assert.equal(audit.rows[0].target_type, 'ANNOUNCEMENT');
      assert.equal(audit.rows[0].target_id, row.id);
      assert.equal(audit.rows[0].admin_user_id, superId);
      assert.equal(audit.rows[0].metadata.expectedRecipients, count);

      assert.equal(await rowCount('notifications'), 0, 'fan-out belongs to the backend, not this request');
      assert.equal(await rowCount('push_deliveries'), 0);
    });

    it('a city announcement records the City and its name', async () => {
      const count = eligibleCount('CAIRO');
      const result = await api(superSession, 'announcements', 'new', {
        ...draft({ audience: 'CITY', cityId: cairoId }),
        requestKey: randomUUID(),
        confirmedCount: count,
      });
      assert.equal(result.ok, true);
      const { rows } = await database.pool.query(`SELECT * FROM announcements WHERE id = $1`, [result.id]);
      assert.equal(rows[0].audience, 'CITY');
      assert.equal(rows[0].audience_city_id, cairoId);
      assert.equal(rows[0].audience_city_name, 'Testville');
      assert.equal(rows[0].expected_recipients, count);
    });

    it('refuses a send whose confirmed count is stale and reports the current one', async () => {
      const result = await api(superSession, 'announcements', 'new', {
        ...draft(),
        requestKey: randomUUID(),
        confirmedCount: eligibleCount() + 3,
      });
      assert.equal(result.ok, false);
      assert.equal(result.currentCount, eligibleCount());
      assert.equal(result.notice.type, 'error');
      assert.equal(await rowCount('announcements'), 0);
      assert.equal(await rowCount('moderation_actions'), 0);
    });

    it('sends once when the same request is posted twice at the same time', async () => {
      const body = { ...draft(), requestKey: randomUUID(), confirmedCount: eligibleCount() };
      const [first, second] = await Promise.all([
        api(superSession, 'announcements', 'new', body),
        api(superSession, 'announcements', 'new', body),
      ]);
      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      assert.equal(first.id, second.id, 'both responses name the one announcement');
      assert.equal(first.count, second.count);
      assert.equal(first.notice.type, 'success');
      assert.equal(second.notice.type, 'success');
      assert.equal(await rowCount('announcements'), 1);
      assert.equal(await rowCount('moderation_actions'), 1);
    });

    it('a sequential retry returns the same announcement and writes nothing more', async () => {
      const body = { ...draft(), requestKey: randomUUID(), confirmedCount: eligibleCount() };
      const first = await api(superSession, 'announcements', 'new', body);
      const retry = await api(superSession, 'announcements', 'new', body);
      assert.equal(retry.ok, true);
      assert.equal(retry.id, first.id);
      assert.equal(retry.count, first.count);
      assert.equal(await rowCount('announcements'), 1);
      assert.equal(await rowCount('moderation_actions'), 1);

      // Still a replay after the audience changed: the answer is the original announcement.
      await database.pool.query(`UPDATE users SET is_banned = true WHERE firebase_user_id = 'fb-2'`);
      try {
        const later = await api(superSession, 'announcements', 'new', body);
        assert.equal(later.id, first.id);
        assert.equal(await rowCount('announcements'), 1);
      } finally {
        await database.pool.query(`UPDATE users SET is_banned = false WHERE firebase_user_id = 'fb-2'`);
      }
    });

    it('a different request key sends a new announcement', async () => {
      const count = eligibleCount();
      const first = await api(superSession, 'announcements', 'new', {
        ...draft(),
        requestKey: randomUUID(),
        confirmedCount: count,
      });
      const second = await api(superSession, 'announcements', 'new', {
        ...draft(),
        requestKey: randomUUID(),
        confirmedCount: count,
      });
      assert.notEqual(first.id, second.id);
      assert.equal(await rowCount('announcements'), 2);
    });

    it('rejects a send without a request key and a key reused for different content', async () => {
      const missing = await api(superSession, 'announcements', 'new', { ...draft(), confirmedCount: eligibleCount() });
      assert.equal(missing.ok, false);
      assert.match(missing.error, /request key/i);
      assert.equal(await rowCount('announcements'), 0);

      const requestKey = randomUUID();
      const first = await api(superSession, 'announcements', 'new', {
        ...draft(),
        requestKey,
        confirmedCount: eligibleCount(),
      });
      assert.equal(first.ok, true);
      const reused = await api(superSession, 'announcements', 'new', {
        ...draft({ titleEn: 'A different announcement' }),
        requestKey,
        confirmedCount: eligibleCount(),
      });
      assert.equal(reused.ok, false);
      assert.match(reused.error, /different announcement/i);
      assert.equal(await rowCount('announcements'), 1);
    });

    it('refuses to send without a confirmed count', async () => {
      const result = await api(superSession, 'announcements', 'new', { ...draft(), requestKey: randomUUID() });
      assert.equal(result.ok, false);
      assert.match(result.error, /confirm/i);
      assert.equal(await rowCount('announcements'), 0);
    });

    it('cannot edit or delete an announcement after it is sent', async () => {
      const sent = await api(superSession, 'announcements', 'new', {
        ...draft(),
        requestKey: randomUUID(),
        confirmedCount: eligibleCount(),
      });
      for (const action of ['edit', 'delete']) {
        const response = await fetch(`${baseUrl}/admin/api/resources/announcements/records/${sent.id}/${action}`, {
          method: 'POST',
          headers: {
            cookie: superSession.cookie,
            origin: baseUrl,
            'x-xsrf-token': superSession.token,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ title_en: 'Changed' }),
        });
        const result = await response.json();
        assert.equal(result.notice?.type, 'error', `${action} must be refused`);
      }
      const { rows } = await database.pool.query(`SELECT title_en FROM announcements WHERE id = $1`, [sent.id]);
      assert.equal(rows[0].title_en, 'Vaccination week');
    });

    it('lists the history and shows the detail with the live push breakdown', async () => {
      const sent = await api(superSession, 'announcements', 'new', {
        ...draft(),
        requestKey: randomUUID(),
        confirmedCount: eligibleCount(),
      });
      // What the backend would have done for two recipients, so the breakdown has something to count.
      const recipients = await database.pool.query(`SELECT id FROM users ORDER BY id LIMIT 2`);
      for (const [index, user] of recipients.rows.entries()) {
        const notification = await database.pool.query(
          `INSERT INTO notifications (recipient_id, type, title, body, announcement_id)
           VALUES ($1, 'ADMIN_ANNOUNCEMENT', 'Vaccination week', 'Body', $2) RETURNING id`,
          [user.id, sent.id],
        );
        const device = await database.pool.query(
          `INSERT INTO device_registrations (user_id, token, platform) VALUES ($1, $2, 'ANDROID') RETURNING id`,
          [user.id, `announcement-test-token-${index}`],
        );
        await database.pool.query(
          `INSERT INTO push_deliveries (notification_id, recipient_id, device_id, status)
           VALUES ($1, $2, $3, $4)`,
          [notification.rows[0].id, user.id, device.rows[0].id, index === 0 ? 'DELIVERED' : 'PENDING'],
        );
      }
      await database.pool.query(`UPDATE announcements SET push_intent_count = 2, in_app_count = 2 WHERE id = $1`, [
        sent.id,
      ]);

      const list = await api(superSession, 'announcements', 'list', null, { method: 'GET' });
      assert.notEqual(list.notice?.type, 'error');
      assert.equal(list.records.length, 1);
      assert.equal(list.records[0].params.title_ar, 'أسبوع التطعيم');
      assert.equal(list.records[0].params.push_delivered, 1);
      assert.equal(list.records[0].params.push_pending, 1);

      const show = await fetch(`${baseUrl}/admin/api/resources/announcements/records/${sent.id}/show`, {
        headers: { cookie: superSession.cookie },
      });
      const detail = await show.json();
      assert.equal(detail.record.params.status, 'PENDING');
      assert.equal(detail.record.params.body_en, 'Free rabies shots at partner clinics this week.');
      assert.equal(detail.record.params.push_delivered, 1);
      assert.equal(detail.record.populated.sent_by_admin_id.params.full_name, 'Super Admin');
      assert.ok(!('password_hash' in detail.record.populated.sent_by_admin_id.params));
    });

    it('filters the history by status and audience', async () => {
      await api(superSession, 'announcements', 'new', {
        ...draft(),
        requestKey: randomUUID(),
        confirmedCount: eligibleCount(),
      });
      const listWith = async (query) =>
        (
          await (
            await fetch(`${baseUrl}/admin/api/resources/announcements/actions/list?${query}`, {
              headers: { cookie: superSession.cookie },
            })
          ).json()
        ).records.length;
      assert.equal(await listWith('filters.status=PENDING'), 1);
      assert.equal(await listWith('filters.status=SENT'), 0);
      assert.equal(await listWith('filters.audience=ALL'), 1);
      assert.equal(await listWith('filters.audience=CITY'), 0);
    });

    it('the audit row links back to the announcement for a super admin without breaking for others', async () => {
      const sent = await api(superSession, 'announcements', 'new', {
        ...draft(),
        requestKey: randomUUID(),
        confirmedCount: eligibleCount(),
      });
      for (const sessionState of [superSession, staffSession]) {
        const response = await fetch(`${baseUrl}/admin/api/resources/moderation_actions/actions/list`, {
          headers: { cookie: sessionState.cookie },
        });
        const result = await response.json();
        const row = result.records.find((record) => record.params.target_id === sent.id);
        assert.ok(row, 'the audit row is listed');
        assert.equal(row.params.action_type, 'ANNOUNCEMENT_SENT');
        assert.equal(row.populated.target_id.resourceId, 'announcements');
        assert.equal(row.populated.target_id.params.title_en, 'Vaccination week');
      }
    });
  });
});

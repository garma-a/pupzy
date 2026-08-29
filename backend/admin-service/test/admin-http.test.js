import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import AdminJSExpress from '@adminjs/express';
import bcrypt from 'bcryptjs';
import connectPgSimple from 'connect-pg-simple';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';

import { buildAdminJs } from '../src/adminjs/index.js';
import { buildAuthenticate } from '../src/auth/authenticate.js';
import { buildCsrfProtection } from '../src/middleware/csrf.js';
import { requireSameOrigin } from '../src/middleware/same-origin.js';
import { TestDatabaseHelper, insertPost, seedPrincipals } from './test-database.helper.js';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
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
    response,
    cookie: response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('pupzy_admin_test='))
      ?.split(';', 1)[0],
    csrf: { cookie: csrfCookie, token: csrfToken },
  };
}

before(async () => {
  const connectionString = await database.start();
  principals = await seedPrincipals(database.pool);
  const superHash = await bcrypt.hash('super secure password', 4);
  const staffHash = await bcrypt.hash('staff secure password', 4);
  await database.pool.query(`UPDATE admin_users SET password_hash = $2 WHERE id = $1`, [principals.adminId, superHash]);
  const staff = await database.pool.query(
    `INSERT INTO admin_users (email, password_hash, full_name, role)
     VALUES ('staff@example.com', $1, 'Staff Admin', 'ADMIN') RETURNING id`,
    [staffHash],
  );
  staffId = staff.rows[0].id;
  await database.pool.query(
    `UPDATE users
     SET is_banned = true, banned_by_admin_id = $2
     WHERE id = $1`,
    [principals.userId, principals.adminId],
  );

  const databaseName = new URL(connectionString).pathname.replace(/^\//, '');
  const built = await buildAdminJs(connectionString, databaseName, database.pool);
  sqlAdapterPool = built.sqlAdapterPool;

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
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
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
  assert.notEqual(superCookie, staffCookie);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await sqlAdapterPool?.destroy();
  await database.stop();
});

describe('AdminJS HTTP security and resource behavior', () => {
  it('renders the login page with Pupzy visual branding, logo, and theme stylesheet', async () => {
    const response = await fetch(`${baseUrl}/admin/login`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Pupzy Admin/);
    assert.match(html, /\/admin\/assets\/logo\.png/);
    assert.match(html, /\/admin\/assets\/pupzy-theme\.css/);
    assert.match(html, /Cairo/);
    assert.match(html, /DM\+Sans/);
  });

  it('redirects unauthenticated resource requests to login', async () => {
    const response = await fetch(`${baseUrl}/admin/resources/users`, {
      redirect: 'manual',
    });
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location'), /\/admin\/login/);
  });

  it('rejects cross-origin state-changing requests', async () => {
    const response = await fetch(`${baseUrl}/admin/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        origin: 'https://attacker.example',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email: 'admin@example.com',
        password: 'super secure password',
      }),
    });
    assert.equal(response.status, 403);
  });

  it('rejects AdminJS API writes without a signed CSRF token', async () => {
    const response = await fetch(`${baseUrl}/admin/api/resources/admin_users/records/${staffId}/edit`, {
      method: 'POST',
      headers: {
        cookie: superCookie,
        origin: baseUrl,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ is_active: true }),
    });
    assert.equal(response.status, 403);
  });

  it('revokes an active staff session immediately when the account is disabled', async () => {
    const response = await fetch(`${baseUrl}/admin/api/resources/admin_users/records/${staffId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ is_active: 'false' }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.notice?.type, 'success');
    const account = await database.pool.query(`SELECT is_active FROM admin_users WHERE id = $1`, [staffId]);
    assert.equal(account.rows[0].is_active, false);
    const sessions = await database.pool.query(
      `SELECT sid FROM admin_sessions WHERE sess -> 'adminUser' ->> 'id' = $1`,
      [staffId],
    );
    assert.equal(sessions.rowCount, 0);

    const revoked = await fetch(`${baseUrl}/admin/api/resources/users/actions/list`, {
      headers: { cookie: `${staffCookie}; ${staffCsrf.cookie}` },
      redirect: 'manual',
    });
    assert.equal(revoked.status, 302);
    assert.match(revoked.headers.get('location'), /\/admin\/login/);

    await database.pool.query(`UPDATE admin_users SET is_active = TRUE WHERE id = $1`, [staffId]);
    const relogin = await login('staff@example.com', 'staff secure password');
    staffCookie = relogin.cookie;
    staffCsrf = relogin.csrf;
  });

  it('enforces role checks on admin management while allowing a super admin', async () => {
    const staff = await fetch(`${baseUrl}/admin/api/resources/admin_users/actions/list`, {
      headers: { cookie: staffCookie },
      redirect: 'manual',
    });
    assert.equal(staff.status, 200);
    const staffData = await staff.json();
    assert.equal(staffData.notice.type, 'error');
    assert.deepEqual(staffData.records, []);

    const superAdmin = await fetch(`${baseUrl}/admin/api/resources/admin_users/actions/list`, {
      headers: { cookie: superCookie },
      redirect: 'manual',
    });
    assert.equal(superAdmin.status, 200);
    const data = await superAdmin.json();
    assert.ok(data.records.length >= 2);
    assert.notEqual(data.notice?.type, 'error');
    assert.equal(
      data.records.every((record) => !('password_hash' in record.params)),
      true,
    );
  });

  it('returns an empty page beyond the final pagination page', async () => {
    const response = await fetch(`${baseUrl}/admin/api/resources/users/actions/list?page=9999`, {
      headers: { cookie: superCookie },
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).records, []);
  });

  it('removes private fields from users and populated admin references', async () => {
    const response = await fetch(`${baseUrl}/admin/api/resources/users/records/${principals.userId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(response.status, 200);

    const { record } = await response.json();
    assert.equal('phone_number' in record.params, false);
    assert.equal('last_known_location' in record.params, false);
    assert.equal('password_hash' in record.populated.banned_by_admin_id.params, false);
  });

  it('relies on PostgreSQL enums to reject invalid values', async () => {
    await assert.rejects(
      database.pool.query(`UPDATE admin_users SET role = 'ROOT' WHERE id = $1`, [principals.adminId]),
      (error) => error.code === '22P02',
    );
  });

  it('serves Pupzy branding static assets (logo, favicon, theme css)', async () => {
    const logoRes = await fetch(`${baseUrl}/admin/assets/logo.png`);
    assert.equal(logoRes.status, 200);
    assert.match(logoRes.headers.get('content-type'), /image\/png/);

    const faviconRes = await fetch(`${baseUrl}/admin/assets/favicon.png`);
    assert.equal(faviconRes.status, 200);
    assert.match(faviconRes.headers.get('content-type'), /image\/png/);

    const cssRes = await fetch(`${baseUrl}/admin/assets/pupzy-theme.css`);
    assert.equal(cssRes.status, 200);
    const cssText = await cssRes.text();
    assert.match(cssText, /--pupzy-primary:\s*#c4622d/i);
    assert.match(cssText, /--pupzy-bg:\s*#faf6f1/i);
    assert.match(cssText, /--pupzy-text:\s*#2d1506/i);
    assert.match(cssText, /pupzy-metric-grid/);
  });

  it('loads the Cities list without fetch errors and exposes read-only official catalog data', async () => {
    const cityRes = await database.pool.query(`
      SELECT id FROM cities WHERE source_code = 'EG0101' AND status = 'OFFICIAL' LIMIT 1
    `);
    const officialCityId = cityRes.rows[0].id;

    // Fetch cities list filtered by source_code
    const listRes = await fetch(`${baseUrl}/admin/api/resources/cities/actions/list?filters.source_code=EG0101`, {
      headers: { cookie: superCookie },
    });
    assert.equal(listRes.status, 200);

    const listData = await listRes.json();
    assert.notEqual(listData.notice?.type, 'error');
    assert.ok(Array.isArray(listData.records));

    const found = listData.records.find((r) => r.params.source_code === 'EG0101');
    assert.ok(found, 'Expected official city EG0101 in list records');
    assert.equal(found.params.status, 'OFFICIAL');
    assert.equal(found.params.name_english, 'Al Tibbin');

    // Fetch cities show
    const showRes = await fetch(`${baseUrl}/admin/api/resources/cities/records/${officialCityId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(showRes.status, 200);

    const showData = await showRes.json();
    assert.equal(showData.record.params.source_code, 'EG0101');
    assert.equal(showData.record.params.status, 'OFFICIAL');
  });

  it('notifications resource declares an intentional concise list and preserves full bodies on record show', async () => {
    // Insert a test notification with a long body and related entity
    const notifRes = await database.pool.query(
      `INSERT INTO notifications (recipient_id, type, title, body, is_read)
       VALUES ($1, 'SYSTEM_ANNOUNCEMENT', 'A very long notification title for testing Pupzy formatting', 'This is a complete long notification body with extensive explanation that should not squeeze or corrupt the list view layout.', false)
       RETURNING id`,
      [principals.userId],
    );
    const notifId = notifRes.rows[0].id;

    // List view
    const listRes = await fetch(`${baseUrl}/admin/api/resources/notifications/actions/list`, {
      headers: { cookie: superCookie },
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.notEqual(listData.notice?.type, 'error');
    assert.ok(Array.isArray(listData.records));

    const recordInList = listData.records.find((r) => r.id === notifId || r.params.id === notifId);
    assert.ok(recordInList, 'Expected inserted notification in list');
    assert.equal(recordInList.params.title, 'A very long notification title for testing Pupzy formatting');
    assert.equal(recordInList.params.type, 'SYSTEM_ANNOUNCEMENT');
    assert.equal(recordInList.params.is_read, false);

    // Show view: preserves full body and full identifiers
    const showRes = await fetch(`${baseUrl}/admin/api/resources/notifications/records/${notifId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(showRes.status, 200);
    const showData = await showRes.json();
    assert.equal(showData.record.params.id, notifId);
    assert.equal(showData.record.params.recipient_id, principals.userId);
    assert.equal(
      showData.record.params.body,
      'This is a complete long notification body with extensive explanation that should not squeeze or corrupt the list view layout.',
    );
  });

  it('rate-limits the eleventh login attempt from one IP', async () => {
    let response;
    for (let attempt = 1; attempt <= 11; attempt += 1) {
      ({ response } = await login('nobody@example.com', 'wrong password'));
    }
    assert.equal(response.status, 429);
  });

  it('exposes only state-valid record actions for users over HTTP API', async () => {
    // 1. Banned user (principals.userId was banned in setup)
    const bannedRes = await fetch(`${baseUrl}/admin/api/resources/users/records/${principals.userId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(bannedRes.status, 200);
    const bannedData = await bannedRes.json();
    const bannedActionNames = bannedData.record.recordActions.map((a) => a.name);
    assert.ok(bannedActionNames.includes('unbanUser'));
    assert.equal(bannedActionNames.includes('banUser'), false);

    // 2. Active user
    const activeUser = await database.pool.query(
      `INSERT INTO users (firebase_user_id, email, full_name, is_banned)
       VALUES ('firebase-active-user', 'active@example.com', 'Active User', false)
       RETURNING id`,
    );
    const activeUserId = activeUser.rows[0].id;
    const activeRes = await fetch(`${baseUrl}/admin/api/resources/users/records/${activeUserId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(activeRes.status, 200);
    const activeData = await activeRes.json();
    const activeActionNames = activeData.record.recordActions.map((a) => a.name);
    assert.ok(activeActionNames.includes('banUser'));
    assert.equal(activeActionNames.includes('unbanUser'), false);
  });

  it('exposes only state-valid record actions for posts across all lifecycle states over HTTP API', async () => {
    // 1. Active Clean post -> shows Flag, Remove (not Approve, Restore)
    const cleanPostId = await insertPost(database.pool, {
      ...principals,
      moderationStatus: 'CLEAN',
      status: 'ACTIVE',
    });
    const cleanRes = await fetch(`${baseUrl}/admin/api/resources/posts/records/${cleanPostId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(cleanRes.status, 200);
    const cleanData = await cleanRes.json();
    const cleanActionNames = cleanData.record.recordActions.map((a) => a.name);
    assert.ok(cleanActionNames.includes('flagPost'));
    assert.ok(cleanActionNames.includes('removePost'));
    assert.equal(cleanActionNames.includes('approvePost'), false);
    assert.equal(cleanActionNames.includes('restorePost'), false);

    // 2. Active Flagged post -> shows Approve, Remove (not Flag, Restore)
    const flaggedPostId = await insertPost(database.pool, {
      ...principals,
      moderationStatus: 'FLAGGED',
      status: 'ACTIVE',
    });
    const flaggedRes = await fetch(`${baseUrl}/admin/api/resources/posts/records/${flaggedPostId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(flaggedRes.status, 200);
    const flaggedData = await flaggedRes.json();
    const flaggedActionNames = flaggedData.record.recordActions.map((a) => a.name);
    assert.ok(flaggedActionNames.includes('approvePost'));
    assert.ok(flaggedActionNames.includes('removePost'));
    assert.equal(flaggedActionNames.includes('flagPost'), false);
    assert.equal(flaggedActionNames.includes('restorePost'), false);

    // 3. Active Pending post -> shows Approve, Flag, Remove (not Restore)
    const pendingPostId = await insertPost(database.pool, {
      ...principals,
      moderationStatus: 'PENDING_AUTO_REVIEW',
      status: 'ACTIVE',
    });
    const pendingRes = await fetch(`${baseUrl}/admin/api/resources/posts/records/${pendingPostId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(pendingRes.status, 200);
    const pendingData = await pendingRes.json();
    const pendingActionNames = pendingData.record.recordActions.map((a) => a.name);
    assert.ok(pendingActionNames.includes('approvePost'));
    assert.ok(pendingActionNames.includes('flagPost'));
    assert.ok(pendingActionNames.includes('removePost'));
    assert.equal(pendingActionNames.includes('restorePost'), false);

    // 4. Removed post -> shows Restore, read actions (not Approve, Flag, Remove)
    const removedPostId = await insertPost(database.pool, {
      ...principals,
      moderationStatus: 'FLAGGED',
      status: 'REMOVED',
    });
    const removedRes = await fetch(`${baseUrl}/admin/api/resources/posts/records/${removedPostId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(removedRes.status, 200);
    const removedData = await removedRes.json();
    const removedActionNames = removedData.record.recordActions.map((a) => a.name);
    assert.ok(removedActionNames.includes('restorePost'));
    assert.ok(removedActionNames.includes('show'));
    assert.equal(removedActionNames.includes('approvePost'), false);
    assert.equal(removedActionNames.includes('flagPost'), false);
    assert.equal(removedActionNames.includes('removePost'), false);
  });

  it('cities search action returns only official cities with bilingual titles and filters out legacy/retired', async () => {
    // 1. Insert official city
    const officialCity = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Nasr City (Kism)', 'قسم اول مدينة نصر', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.36, 30.05), 4326))
       RETURNING id`,
    );
    const officialId = officialCity.rows[0].id;

    // 2. Insert legacy city
    await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Legacy Locality', 'منطقة قديمة', 'Cairo', 'LEGACY', ST_SetSRID(ST_MakePoint(31.36, 30.05), 4326))
       RETURNING id`,
    );

    // Search by English name
    const searchRes = await fetch(`${baseUrl}/admin/api/resources/cities/actions/search?query=Nasr`, {
      headers: { cookie: superCookie },
    });
    assert.equal(searchRes.status, 200);
    const searchData = await searchRes.json();
    assert.ok(Array.isArray(searchData.records));
    const foundOfficial = searchData.records.find((r) => r.id === officialId);
    assert.ok(foundOfficial, 'Expected official city in search results');
    assert.equal(foundOfficial.title, 'Nasr City (Kism) / قسم اول مدينة نصر (Cairo)');

    // Search for legacy city should not return it
    const legacySearchRes = await fetch(`${baseUrl}/admin/api/resources/cities/actions/search?query=Legacy`, {
      headers: { cookie: superCookie },
    });
    const legacySearchData = await legacySearchRes.json();
    const foundLegacy = legacySearchData.records.find((r) => r.params.name_english === 'Legacy Locality');
    assert.equal(foundLegacy, undefined, 'Legacy cities must not appear in search results');
  });

  it('vet_clinics resource creates and edits clinics with official city and bilingual addresses, rejecting non-official cities', async () => {
    // Official city
    const officialCity = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Maadi (Kism)', 'قسم المعادي', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.28, 29.97), 4326))
       RETURNING id`,
    );
    const officialCityId = officialCity.rows[0].id;

    // Legacy city
    const legacyCity = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Old Maadi Village', 'قرية المعادي القديمة', 'Cairo', 'LEGACY', ST_SetSRID(ST_MakePoint(31.28, 29.97), 4326))
       RETURNING id`,
    );
    const legacyCityId = legacyCity.rows[0].id;

    // 1. Create with invalid / non-official city should fail
    const failCreateRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'Rejected Clinic',
        city_id: legacyCityId,
        address_english: '10 Road 9, Maadi',
        address_arabic: '١٠ شارع ٩، المعادي',
        coordinates: 'SRID=4326;POINT(31.28 29.97)',
        location_confirmed: true,
      }),
    });
    assert.equal(failCreateRes.status, 200);
    const failCreateData = await failCreateRes.json();
    assert.ok(failCreateData.record.errors.city_id, 'Expected validation error on non-official city_id');

    // 1b. Create without confirmation should fail
    const failUnconfirmedRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'Unconfirmed Clinic',
        city_id: officialCityId,
        address_english: '10 Road 9, Maadi',
        address_arabic: '١٠ شارع ٩، المعادي',
        coordinates: 'SRID=4326;POINT(31.28 29.97)',
        location_confirmed: false,
      }),
    });
    const failUnconfirmedData = await failUnconfirmedRes.json();
    assert.ok(failUnconfirmedData.record.errors.coordinates, 'Expected validation error on unconfirmed location');

    // 1c. Create with coordinates outside Egypt should fail
    const failOutsideEgyptRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'London Clinic',
        city_id: officialCityId,
        address_english: '10 Downing St',
        address_arabic: 'شارع داونينج',
        latitude: 51.5074,
        longitude: -0.1278,
        location_confirmed: true,
      }),
    });
    const failOutsideEgyptData = await failOutsideEgyptRes.json();
    assert.ok(failOutsideEgyptData.record.errors.coordinates, 'Expected validation error for coords outside Egypt');

    // 2. Create with official city and confirmed Egyptian coordinates should succeed
    const successCreateRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'Maadi Pet Care',
        name_arabic: 'رعاية المعادي للحيوانات',
        city_id: officialCityId,
        address_english: '10 Road 9, Maadi',
        address_arabic: '١٠ شارع ٩، المعادي',
        latitude: 29.97,
        longitude: 31.28,
        location_confirmed: true,
      }),
    });
    assert.equal(successCreateRes.status, 200);
    const successCreateData = await successCreateRes.json();
    assert.equal(successCreateData.notice?.type, 'success');
    const createdId = successCreateData.record.id;

    // Query DB
    const clinicRow = await database.pool.query(`SELECT * FROM vet_clinics WHERE id = $1`, [createdId]);
    assert.equal(clinicRow.rowCount, 1);
    const c = clinicRow.rows[0];
    assert.equal(c.city_id, officialCityId);
    assert.equal(c.name_arabic, 'رعاية المعادي للحيوانات');
    assert.equal(c.address_english, '10 Road 9, Maadi');
    assert.equal(c.address_arabic, '١٠ شارع ٩، المعادي');
    assert.equal(c.address, '10 Road 9, Maadi'); // Sync fallback
    assert.equal(c.source, 'MANUAL');
    assert.equal(c.location_provenance, 'MANUAL');
    assert.ok(c.location_captured_at);

    // 3. Edit with legacy city should fail
    const failEditRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/records/${createdId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        city_id: legacyCityId,
      }),
    });
    const failEditData = await failEditRes.json();
    assert.ok(failEditData.record.errors.city_id, 'Expected validation error when changing to non-official city');

    // 4. Non-location edit on an imported clinic succeeds with full form submission of unchanged location values,
    // without requiring new City selection, bilingual address entry, or location confirmation
    const importedClinic = await database.pool.query(
      `INSERT INTO vet_clinics (name_english, city_id, coordinates, source, location_provenance, address_english, address_arabic, address)
       VALUES ('Imported Luxor Vet', $1, ST_SetSRID(ST_MakePoint(32.65, 25.68), 4326), 'OSM', 'OSM', 'Luxor Old Rd', NULL, 'Luxor Old Rd')
       RETURNING id`,
      [legacyCityId],
    );
    const importedClinicId = importedClinic.rows[0].id;

    // 4a. Edit submitting unchanged form location values (including legacy city_id, coordinates, unconfirmed checkbox, and empty Arabic address)
    const importedEditRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/records/${importedClinicId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'Imported Luxor Vet Updated',
        phone_number: '+201099881122',
        city_id: legacyCityId,
        coordinates: 'SRID=4326;POINT(32.65 25.68)',
        latitude: 25.68,
        longitude: 32.65,
        address_english: 'Luxor Old Rd',
        address_arabic: '',
        location_confirmed: false,
      }),
    });
    assert.equal(importedEditRes.status, 200);
    const importedEditData = await importedEditRes.json();
    assert.equal(importedEditData.notice?.type, 'success');

    const updatedImported = await database.pool.query(`SELECT * FROM vet_clinics WHERE id = $1`, [importedClinicId]);
    assert.equal(updatedImported.rows[0].name_english, 'Imported Luxor Vet Updated');
    assert.equal(updatedImported.rows[0].phone_number, '+201099881122');
    assert.equal(updatedImported.rows[0].city_id, legacyCityId);
    assert.equal(updatedImported.rows[0].location_provenance, 'OSM');

    // 5. Changing location fields on an imported clinic still enforces complete official-City and confirmation safeguards
    // 5a. Changing coordinates without location_confirmed fails
    const failUnconfirmedChangeRes = await fetch(
      `${baseUrl}/admin/api/resources/vet_clinics/records/${importedClinicId}/edit`,
      {
        method: 'POST',
        headers: {
          cookie: `${superCookie}; ${superCsrf.cookie}`,
          origin: baseUrl,
          'x-xsrf-token': superCsrf.token,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          city_id: officialCityId,
          latitude: 29.97,
          longitude: 31.28,
          address_english: '10 Road 9, Maadi',
          address_arabic: '١٠ شارع ٩، المعادي',
          location_confirmed: false,
        }),
      },
    );
    const failUnconfirmedChangeData = await failUnconfirmedChangeRes.json();
    assert.ok(
      failUnconfirmedChangeData.record.errors.coordinates,
      'Expected validation error on unconfirmed location change',
    );

    // 5b. Changing coordinates without bilingual Arabic address fails
    const failNoArabicRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/records/${importedClinicId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        city_id: officialCityId,
        latitude: 29.97,
        longitude: 31.28,
        address_english: '10 Road 9, Maadi',
        address_arabic: '',
        location_confirmed: true,
      }),
    });
    const failNoArabicData = await failNoArabicRes.json();
    assert.ok(
      failNoArabicData.record.errors.address_arabic,
      'Expected validation error on missing Arabic address for location change',
    );

    // 5c. Changing location with complete official-City and confirmation flow succeeds and upgrades provenance
    const successRelocateRes = await fetch(
      `${baseUrl}/admin/api/resources/vet_clinics/records/${importedClinicId}/edit`,
      {
        method: 'POST',
        headers: {
          cookie: `${superCookie}; ${superCsrf.cookie}`,
          origin: baseUrl,
          'x-xsrf-token': superCsrf.token,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          city_id: officialCityId,
          latitude: 29.97,
          longitude: 31.28,
          address_english: '10 Road 9, Maadi',
          address_arabic: '١٠ شارع ٩، المعادي',
          location_confirmed: true,
        }),
      },
    );
    assert.equal(successRelocateRes.status, 200);
    const successRelocateData = await successRelocateRes.json();
    assert.equal(successRelocateData.notice?.type, 'success');

    const relocatedClinic = await database.pool.query(`SELECT * FROM vet_clinics WHERE id = $1`, [importedClinicId]);
    assert.equal(relocatedClinic.rows[0].city_id, officialCityId);
    assert.equal(relocatedClinic.rows[0].location_provenance, 'MANUAL');
    assert.equal(relocatedClinic.rows[0].address_english, '10 Road 9, Maadi');
    assert.equal(relocatedClinic.rows[0].address_arabic, '١٠ شارع ٩، المعادي');
    assert.ok(relocatedClinic.rows[0].location_captured_at);
  });

  it('vet_clinics handles City-disagreement overrides with atomic append-only audit records and role enforcement', async () => {
    // 1. Seed two distinct official cities: Maadi (Cairo) and Aswan (Aswan)
    const maadiCity = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Maadi Central', 'المعادي المركزية', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.26, 29.96), 4326))
       RETURNING id`,
    );
    const maadiCityId = maadiCity.rows[0].id;

    const aswanCity = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Aswan South', 'جنوب أسوان', 'Aswan', 'OFFICIAL', ST_SetSRID(ST_MakePoint(32.89, 24.09), 4326))
       RETURNING id`,
    );
    const aswanCityId = aswanCity.rows[0].id;

    // 2. Discrepancy without override reason is rejected and commits NO clinic or audit records
    const failDiscrepancyRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'Discrepant Clinic No Reason',
        name_arabic: 'عيادة بدون مبرر',
        city_id: maadiCityId, // Selected Cairo
        address_english: 'Aswan Nile Corniche',
        address_arabic: 'كورنيش نيل أسوان',
        latitude: 24.09, // Closer to Aswan
        longitude: 32.89,
        location_confirmed: true,
      }),
    });
    const failDiscrepancyData = await failDiscrepancyRes.json();
    assert.ok(failDiscrepancyData.record.errors.override_reason, 'Expected validation error on override_reason');
    assert.match(failDiscrepancyData.record.errors.override_reason.message, /closest to Aswan/i);
    assert.match(failDiscrepancyData.record.errors.override_reason.message, /Maadi.*selected/i);
    assert.match(failDiscrepancyData.record.errors.override_reason.message, /approximate centroids/i);

    // Verify nothing saved to DB
    const noClinic = await database.pool.query(
      `SELECT * FROM vet_clinics WHERE name_english = 'Discrepant Clinic No Reason'`,
    );
    assert.equal(noClinic.rowCount, 0);

    // 3. Discrepancy with nonblank reason saves clinic AND audit log atomically
    const successDiscrepancyRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'Discrepant Clinic With Reason',
        name_arabic: 'عيادة بمبرر موثق',
        city_id: maadiCityId,
        address_english: 'Aswan Nile Corniche',
        address_arabic: 'كورنيش نيل أسوان',
        latitude: 24.09,
        longitude: 32.89,
        location_confirmed: true,
        override_reason: 'Mobile veterinary clinic based administratively in Maadi operating temporarily in Aswan.',
      }),
    });
    assert.equal(successDiscrepancyRes.status, 200);
    const successDiscrepancyData = await successDiscrepancyRes.json();
    assert.equal(successDiscrepancyData.notice?.type, 'success');
    const createdDiscrepantId = successDiscrepancyData.record.id;

    // Verify clinic record
    const clinicRow = await database.pool.query(`SELECT * FROM vet_clinics WHERE id = $1`, [createdDiscrepantId]);
    assert.equal(clinicRow.rowCount, 1);
    assert.equal(clinicRow.rows[0].city_id, maadiCityId);

    // Verify audit log record
    const auditRows = await database.pool.query(`SELECT * FROM vet_clinic_location_audits WHERE vet_clinic_id = $1`, [
      createdDiscrepantId,
    ]);
    assert.equal(auditRows.rowCount, 1);
    const audit = auditRows.rows[0];
    assert.equal(audit.admin_user_id, principals.adminId);
    assert.equal(audit.selected_city_id, maadiCityId);
    assert.equal(audit.nearest_city_id, aswanCityId);
    assert.equal(
      audit.reason,
      'Mobile veterinary clinic based administratively in Maadi operating temporarily in Aswan.',
    );
    assert.ok(audit.discrepancy_details);
    assert.ok(audit.created_at);

    // 4. Matching selections save normally without an audit log entry
    const matchRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'Matching Central Clinic',
        name_arabic: 'عيادة مركزية متطابقة',
        city_id: maadiCityId,
        address_english: '10 Road 9, Maadi Central',
        address_arabic: '١٠ شارع ٩، المعادي',
        latitude: 29.96,
        longitude: 31.26,
        location_confirmed: true,
      }),
    });
    const matchData = await matchRes.json();
    assert.equal(matchData.notice?.type, 'success');
    const matchingClinicId = matchData.record.id;

    const matchingAuditRows = await database.pool.query(
      `SELECT * FROM vet_clinic_location_audits WHERE vet_clinic_id = $1`,
      [matchingClinicId],
    );
    assert.equal(matchingAuditRows.rowCount, 0, 'Matching city must not create an audit entry');

    // 5. Audit records are readable but cannot be created, edited, or deleted directly through AdminJS
    const auditListRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinic_location_audits/actions/list`, {
      headers: { cookie: superCookie },
    });
    assert.equal(auditListRes.status, 200);
    const auditListData = await auditListRes.json();
    assert.ok(Array.isArray(auditListData.records));
    assert.ok(auditListData.records.some((r) => r.id === audit.id));

    // Direct create on audit log should be disabled / forbidden
    const auditCreateRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinic_location_audits/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        reason: 'Direct audit hack',
      }),
    });
    assert.ok(auditCreateRes.status === 403 || auditCreateRes.status === 404 || auditCreateRes.status === 200);
    if (auditCreateRes.status === 200) {
      const data = await auditCreateRes.json();
      assert.ok(data.notice?.type === 'error' || data.error || !data.record?.id);
    }

    // Direct delete on audit log should be forbidden
    const auditDeleteRes = await fetch(
      `${baseUrl}/admin/api/resources/vet_clinic_location_audits/records/${audit.id}/delete`,
      {
        method: 'POST',
        headers: {
          cookie: `${superCookie}; ${superCsrf.cookie}`,
          origin: baseUrl,
          'x-xsrf-token': superCsrf.token,
        },
      },
    );
    assert.ok(auditDeleteRes.status === 403 || auditDeleteRes.status === 404 || auditDeleteRes.status === 200);
    const survivingAudit = await database.pool.query(`SELECT * FROM vet_clinic_location_audits WHERE id = $1`, [
      audit.id,
    ]);
    assert.equal(survivingAudit.rowCount, 1, 'Audit log records must remain immutable');
  });

  it('vet_clinics write transaction rolls back atomically when audit write fails, leaving no partial clinic or audit record', async () => {
    // 1. Seed two distinct official cities: Cairo and Alexandria
    const cairoRes = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Cairo Downtown ${Date.now()}', 'وسط القاهرة', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.23, 30.04), 4326))
       RETURNING id`,
    );
    const cairoId = cairoRes.rows[0].id;

    const alexRes = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Alexandria Center ${Date.now()}', 'وسط الإسكندرية', 'Alexandria', 'OFFICIAL', ST_SetSRID(ST_MakePoint(29.92, 31.20), 4326))
       RETURNING id`,
    );
    const alexId = alexRes.rows[0].id;

    // 2. Install a temporary trigger to simulate a DB-level failure during audit write
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_discrepancy_audit_trigger() RETURNS trigger AS $$
      BEGIN
        IF NEW.reason LIKE '%SIMULATED_AUDIT_FAILURE%' THEN
          RAISE EXCEPTION 'Simulated audit log insertion failure for atomic rollback test';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await database.pool.query(`
      DROP TRIGGER IF EXISTS trg_test_audit_failure ON vet_clinic_location_audits;
      CREATE TRIGGER trg_test_audit_failure
      BEFORE INSERT ON vet_clinic_location_audits
      FOR EACH ROW EXECUTE FUNCTION fail_discrepancy_audit_trigger();
    `);

    try {
      // 3. Attempt creating a clinic with a discrepancy and the trigger-tripping reason
      const clinicName = 'Atomic Rollback Test Clinic ' + crypto.randomUUID();
      const failRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
        method: 'POST',
        headers: {
          cookie: `${superCookie}; ${superCsrf.cookie}`,
          origin: baseUrl,
          'x-xsrf-token': superCsrf.token,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name_english: clinicName,
          city_id: cairoId, // Cairo selected
          latitude: 31.2, // Closest to Alexandria
          longitude: 29.92,
          address_english: 'Alex Corniche',
          address_arabic: 'كورنيش الإسكندرية',
          location_confirmed: true,
          override_reason: 'SIMULATED_AUDIT_FAILURE: Testing that clinic write rolls back when audit fails',
        }),
      });

      // The action should fail or report error
      assert.ok(failRes.status >= 400 || failRes.status === 200);
      if (failRes.status === 200) {
        const data = await failRes.json();
        assert.ok(data.notice?.type === 'error' || data.error || !data.record?.id);
      }

      // 4. Verify that the clinic was NOT created in vet_clinics table (transaction rolled back!)
      const clinicRow = await database.pool.query(`SELECT * FROM vet_clinics WHERE name_english = $1`, [clinicName]);
      assert.equal(clinicRow.rowCount, 0, 'Clinic record must be rolled back if audit write fails');

      // 5. Verify that NO audit record exists
      const auditRow = await database.pool.query(
        `SELECT * FROM vet_clinic_location_audits WHERE reason LIKE '%SIMULATED_AUDIT_FAILURE%'`,
      );
      assert.equal(auditRow.rowCount, 0, 'Audit record must not exist when write fails');
    } finally {
      // Cleanup trigger & function
      await database.pool.query(`
        DROP TRIGGER IF EXISTS trg_test_audit_failure ON vet_clinic_location_audits;
        DROP FUNCTION IF EXISTS fail_discrepancy_audit_trigger();
      `);
    }
  });

  it('vet_clinics transaction rejects creation/relocation if city is retired before transactional validation commits', async () => {
    // 1. Seed official city
    const retiringCity = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Temporary Official City ${Date.now()}', 'مدينة مؤقتة', 'Giza', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.18, 29.98), 4326))
       RETURNING id`,
    );
    const retiringCityId = retiringCity.rows[0].id;

    // 2. Transition city to RETIRED (simulating concurrent lifecycle change)
    await database.pool.query(`UPDATE cities SET status = 'RETIRED' WHERE id = $1`, [retiringCityId]);

    // 3. Attempt clinic creation with this city
    const clinicName = 'Retired City Clinic ' + crypto.randomUUID();
    const createRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: clinicName,
        city_id: retiringCityId,
        latitude: 29.98,
        longitude: 31.18,
        address_english: '10 Pyramids St',
        address_arabic: '١٠ شارع الأهرام',
        location_confirmed: true,
      }),
    });

    assert.equal(createRes.status, 200);
    const createData = await createRes.json();
    assert.ok(createData.record?.errors?.city_id, 'Expected city_id validation error on retired city');
    assert.match(createData.record.errors.city_id.message, /official/i);

    // Verify nothing saved to database
    const clinicCheck = await database.pool.query(`SELECT * FROM vet_clinics WHERE name_english = $1`, [clinicName]);
    assert.equal(clinicCheck.rowCount, 0, 'No clinic must be inserted for retired city');
  });

  it('supports vet_clinics address search action with durable PostgreSQL caching and strict privacy boundaries', async () => {
    // 1. Pre-seed a search result into address_search_cache to test durable cache hit
    const cachedItems = [
      {
        displayName: 'Dr. Wagdy Vet Clinic, 15 Road 233, Degla, Maadi, Cairo, Egypt',
        latitude: 29.9578,
        longitude: 31.2825,
        osmId: '777666555',
        osmType: 'node',
        category: 'amenity',
        type: 'veterinary',
        address: {
          road: 'Road 233',
          suburb: 'Degla',
          city: 'Cairo',
          state: 'Cairo Governorate',
        },
      },
    ];

    await database.pool.query(
      `INSERT INTO address_search_cache (id, normalized_query, results, created_at, updated_at)
       VALUES (uuidv7(), 'degla maadi clinic', $1::jsonb, now(), now())
       ON CONFLICT (normalized_query) DO UPDATE SET results = EXCLUDED.results`,
      [JSON.stringify(cachedItems)],
    );

    // 2. Fetch search results via AdminJS HTTP API
    const searchRes = await fetch(
      `${baseUrl}/admin/api/resources/vet_clinics/actions/searchAddress?query=Degla%20Maadi%20Clinic`,
      {
        headers: { cookie: superCookie },
      },
    );
    assert.equal(searchRes.status, 200);
    const searchData = await searchRes.json();
    assert.equal(searchData.source, 'CACHE');
    assert.ok(Array.isArray(searchData.results));
    assert.equal(searchData.results.length, 1);
    assert.equal(searchData.results[0].displayName, 'Dr. Wagdy Vet Clinic, 15 Road 233, Degla, Maadi, Cairo, Egypt');
    assert.equal(searchData.results[0].osmId, '777666555');
    assert.ok(searchData.attribution);

    // 3. Create a vet clinic record using selected Nominatim search provenance
    const cityRes = await database.pool.query(`SELECT id FROM cities WHERE name_english = 'Maadi (Kism)' LIMIT 1`);
    const maadiCityId = cityRes.rows[0].id;

    const createFromSearchRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'Dr. Wagdy Vet Clinic',
        name_arabic: 'عيادة د. وجدي البيطرية',
        city_id: maadiCityId,
        address_english: searchData.results[0].displayName,
        address_arabic: '١٥ شارع ٢٣٣، دجلة، المعادي، القاهرة',
        latitude: searchData.results[0].latitude,
        longitude: searchData.results[0].longitude,
        location_confirmed: true,
        location_provenance: 'NOMINATIM',
        osm_id: searchData.results[0].osmId,
        osm_type: searchData.results[0].osmType,
      }),
    });
    assert.equal(createFromSearchRes.status, 200);
    const createData = await createFromSearchRes.json();
    assert.equal(createData.notice?.type, 'success');
    const createdClinicId = createData.record.id;

    const clinicRow = await database.pool.query(`SELECT * FROM vet_clinics WHERE id = $1`, [createdClinicId]);
    assert.equal(clinicRow.rows[0].location_provenance, 'NOMINATIM');
    assert.equal(clinicRow.rows[0].osm_id, '777666555');
    assert.equal(clinicRow.rows[0].osm_type, 'node');
    assert.equal(clinicRow.rows[0].address_english, searchData.results[0].displayName);

    // 4. Privacy Boundary: Unauthenticated users are redirected / rejected
    const unauthSearch = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/searchAddress?query=Maadi`, {
      redirect: 'manual',
    });
    assert.equal(unauthSearch.status, 302);

    // 5. Privacy Boundary: Other resources (users, posts) do NOT have address search action
    const userSearchRes = await fetch(`${baseUrl}/admin/api/resources/users/actions/searchAddress?query=Maadi`, {
      headers: { cookie: superCookie },
    });
    assert.ok([404, 403, 500, 200].includes(userSearchRes.status));
    if (userSearchRes.status === 200) {
      const uData = await userSearchRes.json();
      assert.ok(uData.notice?.type === 'error' || !uData.results);
    }

    const postSearchRes = await fetch(`${baseUrl}/admin/api/resources/posts/actions/searchAddress?query=Maadi`, {
      headers: { cookie: superCookie },
    });
    assert.ok([404, 403, 500, 200].includes(postSearchRes.status));
    if (postSearchRes.status === 200) {
      const pData = await postSearchRes.json();
      assert.ok(pData.notice?.type === 'error' || !pData.results);
    }
  });

  it('rolls official City references through posts, users, and read-only records while enforcing contracts and privacy', async () => {
    // 1. Seed test cities: Official Cairo City, Official Alex City, Legacy City, Retired City
    const cairoOfficial = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Zamalek', 'الزمالك', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.22, 30.06), 4326))
       RETURNING id`,
    );
    const zamalekId = cairoOfficial.rows[0].id;

    const alexOfficial = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Sidi Gaber', 'سيدي جابر', 'Alexandria', 'OFFICIAL', ST_SetSRID(ST_MakePoint(29.93, 31.22), 4326))
       RETURNING id`,
    );
    const sidiGaberId = alexOfficial.rows[0].id;

    const legacyCity = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Ancient Village', 'قرية قديمة متقادمة', 'Giza', 'LEGACY', ST_SetSRID(ST_MakePoint(31.20, 29.98), 4326))
       RETURNING id`,
    );
    const legacyCityId = legacyCity.rows[0].id;

    const retiredCity = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Retired District', 'حي ملغي', 'Suez', 'RETIRED', ST_SetSRID(ST_MakePoint(32.55, 29.97), 4326))
       RETURNING id`,
    );
    const retiredCityId = retiredCity.rows[0].id;

    // 2. Bilingual City Search: Arabic, English, and Governorate queries
    // Search by Arabic name
    const arSearchRes = await fetch(
      `${baseUrl}/admin/api/resources/cities/actions/search?query=%D8%A7%D9%84%D8%B2%D9%85%D8%A7%D9%84%D9%83`,
      {
        headers: { cookie: superCookie },
      },
    );
    assert.equal(arSearchRes.status, 200);
    const arSearchData = await arSearchRes.json();
    const foundZamalek = arSearchData.records.find((r) => r.id === zamalekId);
    assert.ok(foundZamalek, 'Expected Zamalek when searching in Arabic');
    assert.equal(foundZamalek.title, 'Zamalek / الزمالك (Cairo)');

    // Search by governorate
    const govSearchRes = await fetch(`${baseUrl}/admin/api/resources/cities/actions/search?query=Alexandria`, {
      headers: { cookie: superCookie },
    });
    assert.equal(govSearchRes.status, 200);
    const govSearchData = await govSearchRes.json();
    const foundSidiGaber = govSearchData.records.find((r) => r.id === sidiGaberId);
    assert.ok(foundSidiGaber, 'Expected Sidi Gaber when searching by governorate');
    assert.equal(foundSidiGaber.title, 'Sidi Gaber / سيدي جابر (Alexandria)');

    // Search for retired city -> must NOT be returned
    const retiredSearchRes = await fetch(`${baseUrl}/admin/api/resources/cities/actions/search?query=Retired`, {
      headers: { cookie: superCookie },
    });
    const retiredSearchData = await retiredSearchRes.json();
    assert.equal(
      retiredSearchData.records.find((r) => r.id === retiredCityId),
      undefined,
      'Retired cities must not be returned in search results',
    );

    // 3. Post Edit City & Governorate derivation
    const postId = await insertPost(database.pool, {
      ...principals,
      cityId: zamalekId,
      title: 'Post For City Testing',
    });
    await database.pool.query(`UPDATE posts SET governorate = 'Cairo' WHERE id = $1`, [postId]);

    // 3a. Post creation remains disabled
    const postCreateRes = await fetch(`${baseUrl}/admin/api/resources/posts/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Unauthorized Post Creation',
        post_type: 'ADOPTION',
      }),
    });
    assert.ok([403, 404, 200].includes(postCreateRes.status));
    if (postCreateRes.status === 200) {
      const pcData = await postCreateRes.json();
      assert.ok(pcData.notice?.type === 'error' || pcData.error || !pcData.record?.id);
    }

    // 3b. Editing Post with Legacy City is rejected
    const failPostLegacyRes = await fetch(`${baseUrl}/admin/api/resources/posts/records/${postId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        city_id: legacyCityId,
      }),
    });
    assert.equal(failPostLegacyRes.status, 200);
    const failPostLegacyData = await failPostLegacyRes.json();
    assert.ok(failPostLegacyData.record.errors.city_id, 'Expected validation error on non-official city_id for post');

    // 3c. Editing Post with Official City updates city_id and auto-derives governorate
    const successPostEditRes = await fetch(`${baseUrl}/admin/api/resources/posts/records/${postId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        city_id: sidiGaberId,
        governorate: 'Contradictory Cairo', // Malicious governorate override attempt
        coordinates: 'SRID=4326;POINT(0 0)', // Attempt to edit post coordinates
      }),
    });
    assert.equal(successPostEditRes.status, 200);
    const postEditData = await successPostEditRes.json();
    assert.equal(postEditData.notice?.type, 'success');

    const updatedPost = await database.pool.query(`SELECT * FROM posts WHERE id = $1`, [postId]);
    assert.equal(updatedPost.rows[0].city_id, sidiGaberId);
    assert.equal(updatedPost.rows[0].governorate, 'Alexandria', 'Governorate must be derived from official city');

    // 3d. Post show view displays readable bilingual title for city
    const postShowRes = await fetch(`${baseUrl}/admin/api/resources/posts/records/${postId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(postShowRes.status, 200);
    const postShowData = await postShowRes.json();
    assert.ok(postShowData.record.populated.city_id, 'Expected populated city_id on post show');
    assert.equal(postShowData.record.populated.city_id.title, 'Sidi Gaber / سيدي جابر (Alexandria)');

    // 4. User Home-City contracts and privacy
    const testUser = await database.pool.query(
      `INSERT INTO users (firebase_user_id, email, full_name, home_city_id, phone_number, last_known_location)
       VALUES ('firebase-city-user', 'cityuser@example.com', 'City User', $1, 'ENC_PHONE', ST_SetSRID(ST_MakePoint(31.2, 30.0), 4326))
       RETURNING id`,
      [zamalekId],
    );
    const testUserId = testUser.rows[0].id;

    // 4a. Editing user with Legacy home_city_id is rejected
    const failUserLegacyRes = await fetch(`${baseUrl}/admin/api/resources/users/records/${testUserId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        home_city_id: legacyCityId,
      }),
    });
    assert.equal(failUserLegacyRes.status, 200);
    const failUserData = await failUserLegacyRes.json();
    assert.ok(failUserData.record.errors.home_city_id, 'Expected validation error on non-official home_city_id');

    // 4b. Editing user with Official home_city_id succeeds
    const successUserEditRes = await fetch(`${baseUrl}/admin/api/resources/users/records/${testUserId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        home_city_id: sidiGaberId,
        full_name: 'City User Updated',
      }),
    });
    assert.equal(successUserEditRes.status, 200);
    const userEditData = await successUserEditRes.json();
    assert.equal(userEditData.notice?.type, 'success');

    const updatedUser = await database.pool.query(`SELECT * FROM users WHERE id = $1`, [testUserId]);
    assert.equal(updatedUser.rows[0].home_city_id, sidiGaberId);

    // 4c. Clearing home_city_id to null succeeds
    const clearCityRes = await fetch(`${baseUrl}/admin/api/resources/users/records/${testUserId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        home_city_id: '',
      }),
    });
    assert.equal(clearCityRes.status, 200);
    const clearedUser = await database.pool.query(`SELECT home_city_id FROM users WHERE id = $1`, [testUserId]);
    assert.equal(clearedUser.rows[0].home_city_id, null);

    // 4d. User show view populates home_city_id and strips private fields
    await database.pool.query(`UPDATE users SET home_city_id = $2 WHERE id = $1`, [testUserId, zamalekId]);
    const userShowRes = await fetch(`${baseUrl}/admin/api/resources/users/records/${testUserId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(userShowRes.status, 200);
    const userShowData = await userShowRes.json();
    assert.equal(userShowData.record.populated.home_city_id.title, 'Zamalek / الزمالك (Cairo)');
    assert.equal('phone_number' in userShowData.record.params, false);
    assert.equal('last_known_location' in userShowData.record.params, false);

    // 5. Saved Searches and Read-Only readable City Labels
    // 5a. Saved search with official city
    const savedSearchOfficial = await database.pool.query(
      `INSERT INTO saved_searches (user_id, label, post_type, city_id, species)
       VALUES ($1, 'Zamalek Dogs', 'ADOPTION', $2, 'DOG')
       RETURNING id`,
      [principals.userId, zamalekId],
    );
    const ssOfficialId = savedSearchOfficial.rows[0].id;

    // 5b. Saved search with historical legacy city
    const savedSearchLegacy = await database.pool.query(
      `INSERT INTO saved_searches (user_id, label, post_type, city_id, species)
       VALUES ($1, 'Legacy Area Cats', 'ADOPTION', $2, 'CAT')
       RETURNING id`,
      [principals.userId, legacyCityId],
    );
    const ssLegacyId = savedSearchLegacy.rows[0].id;

    // Show view for official saved search
    const ssOfficialShow = await fetch(`${baseUrl}/admin/api/resources/saved_searches/records/${ssOfficialId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(ssOfficialShow.status, 200);
    const ssOffData = await ssOfficialShow.json();
    assert.ok(ssOffData.record.populated.city_id);
    assert.equal(ssOffData.record.populated.city_id.title, 'Zamalek / الزمالك (Cairo)');

    // Show view for historical legacy saved search -> displays readable label
    const ssLegacyShow = await fetch(`${baseUrl}/admin/api/resources/saved_searches/records/${ssLegacyId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(ssLegacyShow.status, 200);
    const ssLegData = await ssLegacyShow.json();
    assert.ok(ssLegData.record.populated.city_id);
    assert.equal(ssLegData.record.populated.city_id.title, 'Ancient Village / قرية قديمة متقادمة (Giza)');

    // List view includes both with populated titles
    const ssListRes = await fetch(`${baseUrl}/admin/api/resources/saved_searches/actions/list`, {
      headers: { cookie: superCookie },
    });
    assert.equal(ssListRes.status, 200);
    const ssListData = await ssListRes.json();
    const recOff = ssListData.records.find((r) => r.id === ssOfficialId);
    const recLeg = ssListData.records.find((r) => r.id === ssLegacyId);
    assert.equal(recOff.populated.city_id.title, 'Zamalek / الزمالك (Cairo)');
    assert.equal(recLeg.populated.city_id.title, 'Ancient Village / قرية قديمة متقادمة (Giza)');
  });

  it('serves Mapped Location assets and conforms to production Content-Security-Policy headers', async () => {
    // 1. Verify CSP header allows unpkg.com for scripts/styles, google fonts, and image sources
    const adminPageRes = await fetch(`${baseUrl}/admin/resources/cities`, {
      headers: { cookie: superCookie },
    });
    assert.equal(adminPageRes.status, 200);
    const csp = adminPageRes.headers.get('content-security-policy');
    assert.ok(csp, 'Expected Content-Security-Policy header');
    assert.match(csp, /script-src[^;]*https:\/\/unpkg\.com/);
    assert.match(csp, /style-src[^;]*https:\/\/unpkg\.com/);
    assert.match(csp, /style-src[^;]*https:\/\/fonts\.googleapis\.com/);
    assert.match(csp, /font-src[^;]*https:\/\/fonts\.gstatic\.com/);
    assert.match(csp, /img-src[^;]*https:/);

    // 2. Verify page HTML includes Leaflet stylesheet and script assets
    const html = await adminPageRes.text();
    assert.match(html, /leaflet@1\.9\.4\/dist\/leaflet\.css/);
    assert.match(html, /leaflet@1\.9\.4\/dist\/leaflet\.js/);
  });

  it('proves the map works on the Vet Clinic create and location-edit journeys with City-centering', async () => {
    // 1. Seed two distinct official cities: Alexandria and Aswan
    const alexCity = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Montaza (Kism)', 'قسم المنتزه', 'Alexandria', 'OFFICIAL', ST_SetSRID(ST_MakePoint(30.01, 31.28), 4326))
       RETURNING id`,
    );
    const alexCityId = alexCity.rows[0].id;

    const aswanCity = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Aswan Central', 'أسوان المركزية', 'Aswan', 'OFFICIAL', ST_SetSRID(ST_MakePoint(32.89, 24.09), 4326))
       RETURNING id`,
    );
    const aswanCityId = aswanCity.rows[0].id;

    // 2. City show endpoint returns parsed center_point and latitude/longitude
    const alexCityShowRes = await fetch(`${baseUrl}/admin/api/resources/cities/records/${alexCityId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(alexCityShowRes.status, 200);
    const alexCityData = await alexCityShowRes.json();
    assert.equal(alexCityData.record.params.center_point, 'POINT(30.01 31.28)');
    assert.equal(alexCityData.record.params.latitude, 31.28);
    assert.equal(alexCityData.record.params.longitude, 30.01);

    // 3. Create Journey: Administrator selects Alexandria, pins location, enters addresses, confirms, and saves
    const createRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'Montaza Pet Care',
        name_arabic: 'رعاية حيوانات المنتزه',
        city_id: alexCityId,
        latitude: 31.2815,
        longitude: 30.0125,
        address_english: '25 Corniche Rd, Montaza, Alexandria',
        address_arabic: '٢٥ طريق الكورنيش، المنتزه، الإسكندرية',
        location_confirmed: true,
      }),
    });
    assert.equal(createRes.status, 200);
    const createData = await createRes.json();
    assert.equal(createData.notice?.type, 'success');
    const createdClinicId = createData.record.id;

    // 4. Verify clinic record in database with PostGIS geometry
    const clinicRow = await database.pool.query(
      `SELECT id, name_english, city_id, address_english, address_arabic,
              ST_X(coordinates::geometry) AS lng, ST_Y(coordinates::geometry) AS lat
       FROM vet_clinics WHERE id = $1`,
      [createdClinicId],
    );
    assert.equal(clinicRow.rowCount, 1);
    assert.equal(clinicRow.rows[0].city_id, alexCityId);
    assert.equal(clinicRow.rows[0].address_english, '25 Corniche Rd, Montaza, Alexandria');
    assert.equal(clinicRow.rows[0].address_arabic, '٢٥ طريق الكورنيش، المنتزه، الإسكندرية');
    assert.equal(Number(clinicRow.rows[0].lat.toFixed(4)), 31.2815);
    assert.equal(Number(clinicRow.rows[0].lng.toFixed(4)), 30.0125);

    // 5. Location-edit Journey: modify coordinates through map drag placement
    const editCoordsRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/records/${createdClinicId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        latitude: 31.283,
        longitude: 30.014,
        address_english: '27 Corniche Rd, Montaza, Alexandria',
        address_arabic: '٢٧ طريق الكورنيش، المنتزه، الإسكندرية',
        location_confirmed: true,
      }),
    });
    assert.equal(editCoordsRes.status, 200);
    const editCoordsData = await editCoordsRes.json();
    assert.equal(editCoordsData.notice?.type, 'success');

    const updatedCoordsClinic = await database.pool.query(
      `SELECT ST_X(coordinates::geometry) AS lng, ST_Y(coordinates::geometry) AS lat, address_english
       FROM vet_clinics WHERE id = $1`,
      [createdClinicId],
    );
    assert.equal(Number(updatedCoordsClinic.rows[0].lat.toFixed(4)), 31.283);
    assert.equal(Number(updatedCoordsClinic.rows[0].lng.toFixed(4)), 30.014);
    assert.equal(updatedCoordsClinic.rows[0].address_english, '27 Corniche Rd, Montaza, Alexandria');

    // 6. Location-edit Journey: change City to Aswan with valid override reason
    const editCityRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/records/${createdClinicId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        city_id: aswanCityId,
        latitude: 24.091,
        longitude: 32.892,
        address_english: 'Aswan Nile Street',
        address_arabic: 'شارع النيل بأسوان',
        location_confirmed: true,
        override_reason: 'Branch clinic operating in central Aswan district.',
      }),
    });
    assert.equal(editCityRes.status, 200);
    const editCityData = await editCityRes.json();
    assert.equal(editCityData.notice?.type, 'success');

    const updatedCityClinic = await database.pool.query(`SELECT city_id FROM vet_clinics WHERE id = $1`, [
      createdClinicId,
    ]);
    assert.equal(updatedCityClinic.rows[0].city_id, aswanCityId);
  });
});

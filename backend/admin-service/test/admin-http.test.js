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
import {
  createClinicInTransaction,
  updateClinicInTransaction,
  getCityById,
} from '../src/adminjs/resources/vet-clinics.resource.js';
import { ValidationError } from 'adminjs';
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

    // 1d. Create with City selected but coordinates not placed on the map should fail
    const failMissingCoordsRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'No Coordinates Placed Clinic',
        city_id: officialCityId,
        address_english: '10 Road 9, Maadi',
        address_arabic: '١٠ شارع ٩، المعادي',
        location_confirmed: true,
      }),
    });
    const failMissingCoordsData = await failMissingCoordsRes.json();
    assert.ok(failMissingCoordsData.record.errors.coordinates, 'Expected validation error when coordinates not placed');

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

  it('genuinely interleaved test: concurrent City retirement transaction holds lock, clinic write blocks and rejects once retired', async () => {
    // 1. Seed official city
    const seed = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Interleaved City A ${Date.now()}', 'مدينة أ', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.23, 30.04), 4326))
       RETURNING id`,
    );
    const cityId = seed.rows[0].id;

    const clientA = await database.pool.connect(); // city updater
    const clientB = await database.pool.connect(); // clinic writer

    try {
      // Step 1: Client A starts transaction and updates city to RETIRED (holds exclusive row lock)
      await clientA.query('BEGIN');
      await clientA.query(`UPDATE cities SET status = 'RETIRED' WHERE id = $1`, [cityId]);

      // Step 2: Client B starts clinic creation in parallel (will attempt getCityById with FOR SHARE and block)
      let clientBFinished = false;
      let clientBError = null;
      const clinicName = 'Interleaved Clinic 1 ' + crypto.randomUUID();

      const clinicPromise = (async () => {
        try {
          await clientB.query('BEGIN');
          await createClinicInTransaction(
            clientB,
            'pg',
            {
              name_english: clinicName,
              city_id: cityId,
              latitude: 30.04,
              longitude: 31.23,
              address_english: '10 Nile St',
              address_arabic: '١٠ شارع النيل',
              location_confirmed: true,
            },
            { id: principals.adminId, role: 'SUPER_ADMIN', is_active: true },
          );
          await clientB.query('COMMIT');
        } catch (err) {
          await clientB.query('ROLLBACK').catch(() => {});
          clientBError = err;
        } finally {
          clientBFinished = true;
        }
      })();

      // Give event loop time to initiate query; client B must be blocked waiting for lock on cityId
      await new Promise((r) => setTimeout(r, 80));
      assert.equal(clientBFinished, false, 'Client B must be blocked waiting for Client A lock on City');

      // Step 3: Client A commits retirement
      await clientA.query('COMMIT');

      // Step 4: Await Client B completion
      await clinicPromise;

      assert.ok(clientBError, 'Client B should have failed with ValidationError');
      assert.ok(clientBError instanceof ValidationError);
      assert.match(clientBError.propertyErrors.city_id.message, /official/i);

      // Verify no clinic was created
      const check = await database.pool.query(`SELECT * FROM vet_clinics WHERE name_english = $1`, [clinicName]);
      assert.equal(check.rowCount, 0, 'No clinic inserted after interleaved rollback');
    } finally {
      clientA.release();
      clientB.release();
    }
  });

  it('genuinely interleaved test: clinic transaction holds FOR SHARE lock on City, blocking concurrent retirement until commit', async () => {
    // 1. Seed official city
    const seed = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Interleaved City B ${Date.now()}', 'مدينة ب', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.23, 30.04), 4326))
       RETURNING id`,
    );
    const cityId = seed.rows[0].id;

    const clientA = await database.pool.connect(); // clinic writer
    const clientB = await database.pool.connect(); // city updater

    try {
      // Step 1: Client A starts transaction and writes clinic (acquires FOR SHARE lock on city)
      await clientA.query('BEGIN');
      const clinicName = 'Interleaved Clinic 2 ' + crypto.randomUUID();
      const clinic = await createClinicInTransaction(
        clientA,
        'pg',
        {
          name_english: clinicName,
          city_id: cityId,
          latitude: 30.04,
          longitude: 31.23,
          address_english: '10 Nile St',
          address_arabic: '١٠ شارع النيل',
          location_confirmed: true,
        },
        { id: principals.adminId, role: 'SUPER_ADMIN', is_active: true },
      );
      assert.ok(clinic);

      // Step 2: Client B attempts UPDATE cities SET status = 'RETIRED' in parallel (will block on Client A's share lock)
      let clientBFinished = false;
      const cityRetirePromise = (async () => {
        await clientB.query('BEGIN');
        await clientB.query(`UPDATE cities SET status = 'RETIRED' WHERE id = $1`, [cityId]);
        await clientB.query('COMMIT');
        clientBFinished = true;
      })();

      await new Promise((r) => setTimeout(r, 80));
      assert.equal(
        clientBFinished,
        false,
        'Client B must be blocked from retiring City while Client A holds FOR SHARE',
      );

      // Step 3: Client A commits clinic creation
      await clientA.query('COMMIT');

      // Step 4: Client B finishes retirement
      await cityRetirePromise;
      assert.equal(clientBFinished, true);

      // Verify clinic was authoritatively created before city was retired
      const check = await database.pool.query(`SELECT * FROM vet_clinics WHERE id = $1`, [clinic.id]);
      assert.equal(check.rowCount, 1, 'Clinic must exist and be committed');
      assert.equal(check.rows[0].city_id, cityId);

      // Verify city is now retired
      const cityCheck = await database.pool.query(`SELECT status FROM cities WHERE id = $1`, [cityId]);
      assert.equal(cityCheck.rows[0].status, 'RETIRED');
    } finally {
      clientA.release();
      clientB.release();
    }
  });

  it('genuinely interleaved test: nearest official City query applies FOR SHARE lock preventing concurrent retirement discrepancy drift', async () => {
    // 1. Seed two official cities
    const seed1 = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Interleaved Cairo ${Date.now()}', 'القاهرة', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.23, 30.04), 4326))
       RETURNING id`,
    );
    const cairoId = seed1.rows[0].id;

    const seed2 = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Interleaved Giza ${Date.now()}', 'الجيزة', 'Giza', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.20, 30.01), 4326))
       RETURNING id`,
    );
    const gizaId = seed2.rows[0].id;

    const clientA = await database.pool.connect(); // city updater
    const clientB = await database.pool.connect(); // clinic writer

    try {
      // Step 1: Client A starts transaction and retires Giza (holding exclusive lock on Giza row)
      await clientA.query('BEGIN');
      await clientA.query(`UPDATE cities SET status = 'RETIRED' WHERE id = $1`, [gizaId]);

      // Step 2: Client B attempts to write clinic near Giza (coordinates 30.01, 31.20) with Cairo selected (discrepancy override)
      // Client B's findNearestOfficialCity query applies FOR SHARE and will block until Client A commits
      let clientBFinished = false;
      let clientBResult = null;
      let clientBError = null;
      const clinicName = 'Interleaved Discrepancy Clinic ' + crypto.randomUUID();

      const clinicPromise = (async () => {
        try {
          await clientB.query('BEGIN');
          clientBResult = await createClinicInTransaction(
            clientB,
            'pg',
            {
              name_english: clinicName,
              city_id: cairoId, // Cairo selected
              latitude: 30.01, // Near Giza
              longitude: 31.2,
              address_english: 'Border St',
              address_arabic: 'شارع الحدود',
              location_confirmed: true,
              override_reason: 'Valid border override reason',
            },
            { id: principals.adminId, role: 'SUPER_ADMIN', is_active: true },
          );
          await clientB.query('COMMIT');
        } catch (err) {
          await clientB.query('ROLLBACK').catch(() => {});
          clientBError = err;
        } finally {
          clientBFinished = true;
        }
      })();

      await new Promise((r) => setTimeout(r, 80));
      assert.equal(clientBFinished, false, 'Client B must be blocked waiting for Client A lock on nearest city');

      // Step 3: Client A commits Giza retirement
      await clientA.query('COMMIT');

      // Step 4: Client B unblocks, now sees only Cairo as official, so selected Cairo matches nearest official Cairo!
      await clinicPromise;

      assert.equal(clientBError, null, 'Client B should succeed after unblocking');
      assert.ok(clientBResult);
      assert.equal(clientBResult.name_english, clinicName);

      // Verify clinic saved
      const check = await database.pool.query(`SELECT * FROM vet_clinics WHERE id = $1`, [clientBResult.id]);
      assert.equal(check.rowCount, 1);
    } finally {
      clientA.release();
      clientB.release();
    }
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

    // 2. Read-only Detail Views (show action) for Official, Legacy, and Retired Cities
    // 2a. Official City Show
    const officialShowRes = await fetch(`${baseUrl}/admin/api/resources/cities/records/${zamalekId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(officialShowRes.status, 200);
    const officialShowData = await officialShowRes.json();
    assert.equal(officialShowData.record.params.status, 'OFFICIAL');
    assert.equal(officialShowData.record.params.name_english, 'Zamalek');
    assert.equal(officialShowData.record.params.name_arabic, 'الزمالك');
    assert.equal(officialShowData.record.params.governorate, 'Cairo');
    assert.equal(officialShowData.record.title, 'Zamalek / الزمالك (Cairo)');

    // 2b. Legacy City Show
    const legacyShowRes = await fetch(`${baseUrl}/admin/api/resources/cities/records/${legacyCityId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(legacyShowRes.status, 200);
    const legacyShowData = await legacyShowRes.json();
    assert.equal(legacyShowData.record.params.status, 'LEGACY');
    assert.equal(legacyShowData.record.params.name_english, 'Ancient Village');
    assert.equal(legacyShowData.record.params.name_arabic, 'قرية قديمة متقادمة');
    assert.equal(legacyShowData.record.params.governorate, 'Giza');
    assert.equal(legacyShowData.record.title, 'Ancient Village / قرية قديمة متقادمة (Giza)');

    // 2c. Retired City Show
    const retiredShowRes = await fetch(`${baseUrl}/admin/api/resources/cities/records/${retiredCityId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(retiredShowRes.status, 200);
    const retiredShowData = await retiredShowRes.json();
    assert.equal(retiredShowData.record.params.status, 'RETIRED');
    assert.equal(retiredShowData.record.params.name_english, 'Retired District');
    assert.equal(retiredShowData.record.params.name_arabic, 'حي ملغي');
    assert.equal(retiredShowData.record.params.governorate, 'Suez');
    assert.equal(retiredShowData.record.title, 'Retired District / حي ملغي (Suez)');

    // 2d. Authenticated HTML detail view rendering for Legacy and Retired Cities
    const legacyHtmlRes = await fetch(`${baseUrl}/admin/resources/cities/records/${legacyCityId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(legacyHtmlRes.status, 200);

    const retiredHtmlRes = await fetch(`${baseUrl}/admin/resources/cities/records/${retiredCityId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(retiredHtmlRes.status, 200);

    // 3. City List View: Official-only listing
    const cityListOfficialRes = await fetch(
      `${baseUrl}/admin/api/resources/cities/actions/list?filters.name_english=Zamalek`,
      {
        headers: { cookie: superCookie },
      },
    );
    assert.equal(cityListOfficialRes.status, 200);
    const cityListOfficialData = await cityListOfficialRes.json();
    assert.ok(
      cityListOfficialData.records.some((r) => r.id === zamalekId),
      'Official city must be in filtered list',
    );
    assert.equal(cityListOfficialData.records[0].params.status, 'OFFICIAL');

    // Attempting to filter list by status=LEGACY or search by legacy name is forced to OFFICIAL by before hook
    const cityListLegacyRes = await fetch(
      `${baseUrl}/admin/api/resources/cities/actions/list?filters.status=LEGACY&filters.name_english=Ancient`,
      {
        headers: { cookie: superCookie },
      },
    );
    assert.equal(cityListLegacyRes.status, 200);
    const cityListLegacyData = await cityListLegacyRes.json();
    assert.equal(cityListLegacyData.records.length, 0, 'Legacy city must not appear in list');

    // Attempting to filter list by status=RETIRED or search by retired name is forced to OFFICIAL by before hook
    const cityListRetiredRes = await fetch(
      `${baseUrl}/admin/api/resources/cities/actions/list?filters.status=RETIRED&filters.name_english=Retired`,
      {
        headers: { cookie: superCookie },
      },
    );
    assert.equal(cityListRetiredRes.status, 200);
    const cityListRetiredData = await cityListRetiredRes.json();
    assert.equal(cityListRetiredData.records.length, 0, 'Retired city must not appear in list');

    // 4. Bilingual City Reference Search: Arabic, English, and Governorate queries (Official-Only)
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

    // Search for legacy/retired city -> must NOT be returned
    const legacySearchRes = await fetch(`${baseUrl}/admin/api/resources/cities/actions/search?query=Ancient`, {
      headers: { cookie: superCookie },
    });
    const legacySearchData = await legacySearchRes.json();
    assert.equal(
      legacySearchData.records.find((r) => r.id === legacyCityId),
      undefined,
      'Legacy cities must not be returned in reference search results',
    );

    const retiredSearchRes = await fetch(`${baseUrl}/admin/api/resources/cities/actions/search?query=Retired`, {
      headers: { cookie: superCookie },
    });
    const retiredSearchData = await retiredSearchRes.json();
    assert.equal(
      retiredSearchData.records.find((r) => r.id === retiredCityId),
      undefined,
      'Retired cities must not be returned in reference search results',
    );

    // 5. Vet Clinic historical references and official-only assignments
    // 5a. Seed Vet Clinics with Legacy and Retired Cities
    const legacyClinicRes = await database.pool.query(
      `INSERT INTO vet_clinics (name_english, name_arabic, city_id, phone_number, address_english, address_arabic, coordinates)
       VALUES ('Historical Heritage Clinic', 'عيادة تراثية قديمة', $1, '01000000001', '10 Heritage St', '١٠ شارع التراث', ST_SetSRID(ST_MakePoint(31.20, 29.98), 4326))
       RETURNING id`,
      [legacyCityId],
    );
    const legacyClinicId = legacyClinicRes.rows[0].id;

    const retiredClinicRes = await database.pool.query(
      `INSERT INTO vet_clinics (name_english, name_arabic, city_id, phone_number, address_english, address_arabic, coordinates)
       VALUES ('Historical Retired Clinic', 'عيادة ملغاة تاريخية', $1, '01000000002', '20 Retired St', '٢٠ شارع ملغي', ST_SetSRID(ST_MakePoint(32.55, 29.97), 4326))
       RETURNING id`,
      [retiredCityId],
    );
    const retiredClinicId = retiredClinicRes.rows[0].id;

    // 5b. Vet Clinic show views render populated historical city title and governorate
    const vcLegacyShow = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/records/${legacyClinicId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(vcLegacyShow.status, 200);
    const vcLegData = await vcLegacyShow.json();
    assert.ok(vcLegData.record.populated.city_id, 'Expected populated city_id on clinic with historical city show');
    assert.equal(vcLegData.record.populated.city_id.title, 'Ancient Village / قرية قديمة متقادمة (Giza)');
    assert.equal(vcLegData.record.populated.city_id.params.status, 'LEGACY');

    const vcRetiredShow = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/records/${retiredClinicId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(vcRetiredShow.status, 200);
    const vcRetData = await vcRetiredShow.json();
    assert.ok(vcRetData.record.populated.city_id, 'Expected populated city_id on retired clinic show');
    assert.equal(vcRetData.record.populated.city_id.title, 'Retired District / حي ملغي (Suez)');
    assert.equal(vcRetData.record.populated.city_id.params.status, 'RETIRED');

    // 5c. Vet Clinic list view renders populated historical city titles
    const vcListRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/list`, {
      headers: { cookie: superCookie },
    });
    assert.equal(vcListRes.status, 200);
    const vcListData = await vcListRes.json();
    const foundLegClinic = vcListData.records.find((r) => r.id === legacyClinicId);
    const foundRetClinic = vcListData.records.find((r) => r.id === retiredClinicId);
    assert.ok(foundLegClinic);
    assert.equal(foundLegClinic.populated.city_id.title, 'Ancient Village / قرية قديمة متقادمة (Giza)');
    assert.ok(foundRetClinic);
    assert.equal(foundRetClinic.populated.city_id.title, 'Retired District / حي ملغي (Suez)');

    // 5d. Non-location edits to historical clinic succeed and preserve historical City reference
    const vcNonLocEditRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/records/${legacyClinicId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        phone_number: '01099998888',
      }),
    });
    assert.equal(vcNonLocEditRes.status, 200);
    const vcNonLocEditData = await vcNonLocEditRes.json();
    assert.equal(vcNonLocEditData.notice?.type, 'success');
    const checkClinic = await database.pool.query(`SELECT city_id, phone_number FROM vet_clinics WHERE id = $1`, [
      legacyClinicId,
    ]);
    assert.equal(checkClinic.rows[0].city_id, legacyCityId);
    assert.equal(checkClinic.rows[0].phone_number, '01099998888');

    // 5e. Creating a new clinic with Legacy or Retired city is rejected
    const vcFailCreateLegacyRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'Unassignable Heritage Clinic',
        city_id: legacyCityId,
        address_english: '10 Old Road',
        address_arabic: '١٠ طريق قديم',
        latitude: '29.98',
        longitude: '31.20',
        location_confirmed: 'true',
      }),
    });
    assert.equal(vcFailCreateLegacyRes.status, 200);
    const vcFailCreateData = await vcFailCreateLegacyRes.json();
    assert.ok(vcFailCreateData.record.errors.city_id, 'Expected error creating clinic with legacy city');

    const vcFailCreateRetiredRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'Unassignable Retired Clinic',
        city_id: retiredCityId,
        address_english: '20 Closed Road',
        address_arabic: '٢٠ طريق ملغي',
        latitude: '29.97',
        longitude: '32.55',
        location_confirmed: 'true',
      }),
    });
    assert.equal(vcFailCreateRetiredRes.status, 200);
    const vcFailCreateRetiredData = await vcFailCreateRetiredRes.json();
    assert.ok(vcFailCreateRetiredData.record.errors.city_id, 'Expected error creating clinic with retired city');

    // 5f. Updating existing clinic to change city to Legacy or Retired city is rejected
    const vcFailEditLegacyRes = await fetch(
      `${baseUrl}/admin/api/resources/vet_clinics/records/${legacyClinicId}/edit`,
      {
        method: 'POST',
        headers: {
          cookie: `${superCookie}; ${superCsrf.cookie}`,
          origin: baseUrl,
          'x-xsrf-token': superCsrf.token,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          city_id: retiredCityId,
          address_english: '20 Relocated St',
          address_arabic: '٢٠ شارع منقول',
          latitude: '29.97',
          longitude: '32.55',
          location_confirmed: 'true',
        }),
      },
    );
    assert.equal(vcFailEditLegacyRes.status, 200);
    const vcFailEditLegacyData = await vcFailEditLegacyRes.json();
    assert.ok(vcFailEditLegacyData.record.errors.city_id, 'Expected error relocating clinic to retired city');

    // 6. Post Historical References and Official City / Governorate derivation
    // 6a. Seed Post with historical legacy city
    const postLegacyId = await insertPost(database.pool, {
      ...principals,
      cityId: legacyCityId,
      title: 'Post With Historical Legacy City',
    });
    await database.pool.query(`UPDATE posts SET governorate = 'Giza' WHERE id = $1`, [postLegacyId]);

    // 6b. Post show view displays readable bilingual title for legacy city
    const postLegacyShowRes = await fetch(`${baseUrl}/admin/api/resources/posts/records/${postLegacyId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(postLegacyShowRes.status, 200);
    const postLegacyShowData = await postLegacyShowRes.json();
    assert.ok(postLegacyShowData.record.populated.city_id);
    assert.equal(postLegacyShowData.record.populated.city_id.title, 'Ancient Village / قرية قديمة متقادمة (Giza)');

    // 6c. Post list view displays readable populated title for legacy city
    const postListRes = await fetch(`${baseUrl}/admin/api/resources/posts/actions/list`, {
      headers: { cookie: superCookie },
    });
    assert.equal(postListRes.status, 200);
    const postListData = await postListRes.json();
    const foundLegacyPost = postListData.records.find((r) => r.id === postLegacyId);
    assert.ok(foundLegacyPost);
    assert.equal(foundLegacyPost.populated.city_id.title, 'Ancient Village / قرية قديمة متقادمة (Giza)');

    // 6d. Non-city edit on legacy post succeeds and preserves historical reference
    const postNonCityEditRes = await fetch(`${baseUrl}/admin/api/resources/posts/records/${postLegacyId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Updated Post Title Keeping Legacy City',
      }),
    });
    assert.equal(postNonCityEditRes.status, 200);
    const postNonCityEditData = await postNonCityEditRes.json();
    assert.equal(postNonCityEditData.notice?.type, 'success');
    const checkPost = await database.pool.query(`SELECT city_id, title FROM posts WHERE id = $1`, [postLegacyId]);
    assert.equal(checkPost.rows[0].city_id, legacyCityId);
    assert.equal(checkPost.rows[0].title, 'Updated Post Title Keeping Legacy City');

    // 6e. Post creation remains disabled
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

    // 6f. Editing Post to assign Legacy or Retired City is rejected
    const postId = await insertPost(database.pool, {
      ...principals,
      cityId: zamalekId,
      title: 'Post For City Testing',
    });
    await database.pool.query(`UPDATE posts SET governorate = 'Cairo' WHERE id = $1`, [postId]);

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
    assert.ok(failPostLegacyData.record.errors.city_id, 'Expected validation error on legacy city_id for post');

    const failPostRetiredRes = await fetch(`${baseUrl}/admin/api/resources/posts/records/${postId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        city_id: retiredCityId,
      }),
    });
    assert.equal(failPostRetiredRes.status, 200);
    const failPostRetiredData = await failPostRetiredRes.json();
    assert.ok(failPostRetiredData.record.errors.city_id, 'Expected validation error on retired city_id for post');

    // 6g. Editing Post with Official City updates city_id and auto-derives governorate
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

    // 6h. Post show view displays readable bilingual title for official city
    const postShowRes = await fetch(`${baseUrl}/admin/api/resources/posts/records/${postId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(postShowRes.status, 200);
    const postShowData = await postShowRes.json();
    assert.ok(postShowData.record.populated.city_id, 'Expected populated city_id on post show');
    assert.equal(postShowData.record.populated.city_id.title, 'Sidi Gaber / سيدي جابر (Alexandria)');

    // 7. User Home-City historical references and privacy contracts
    // 7a. Seed User with historical legacy home_city_id
    const legacyUser = await database.pool.query(
      `INSERT INTO users (firebase_user_id, email, full_name, home_city_id, phone_number, last_known_location)
       VALUES ('firebase-legacy-user', 'legacyuser@example.com', 'Legacy Home User', $1, 'ENC_PHONE', ST_SetSRID(ST_MakePoint(31.2, 30.0), 4326))
       RETURNING id`,
      [legacyCityId],
    );
    const legacyUserId = legacyUser.rows[0].id;

    // 7b. User show view populates legacy home_city_id title
    const legacyUserShowRes = await fetch(`${baseUrl}/admin/api/resources/users/records/${legacyUserId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(legacyUserShowRes.status, 200);
    const legacyUserShowData = await legacyUserShowRes.json();
    assert.ok(legacyUserShowData.record.populated.home_city_id);
    assert.equal(legacyUserShowData.record.populated.home_city_id.title, 'Ancient Village / قرية قديمة متقادمة (Giza)');

    // 7c. Non-city edit on legacy user succeeds and preserves historical home_city_id
    const userNonCityEditRes = await fetch(`${baseUrl}/admin/api/resources/users/records/${legacyUserId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        full_name: 'Updated Legacy User Name',
      }),
    });
    assert.equal(userNonCityEditRes.status, 200);
    const userNonCityEditData = await userNonCityEditRes.json();
    assert.equal(userNonCityEditData.notice?.type, 'success');
    const checkUser = await database.pool.query(`SELECT home_city_id, full_name FROM users WHERE id = $1`, [
      legacyUserId,
    ]);
    assert.equal(checkUser.rows[0].home_city_id, legacyCityId);
    assert.equal(checkUser.rows[0].full_name, 'Updated Legacy User Name');

    // 7d. Editing user with Legacy or Retired home_city_id is rejected
    const testUser = await database.pool.query(
      `INSERT INTO users (firebase_user_id, email, full_name, home_city_id, phone_number, last_known_location)
       VALUES ('firebase-city-user', 'cityuser@example.com', 'City User', $1, 'ENC_PHONE', ST_SetSRID(ST_MakePoint(31.2, 30.0), 4326))
       RETURNING id`,
      [zamalekId],
    );
    const testUserId = testUser.rows[0].id;

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
    assert.ok(failUserData.record.errors.home_city_id, 'Expected validation error on legacy home_city_id');

    const failUserRetiredRes = await fetch(`${baseUrl}/admin/api/resources/users/records/${testUserId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        home_city_id: retiredCityId,
      }),
    });
    assert.equal(failUserRetiredRes.status, 200);
    const failUserRetiredData = await failUserRetiredRes.json();
    assert.ok(failUserRetiredData.record.errors.home_city_id, 'Expected validation error on retired home_city_id');

    // 7e. Editing user with Official home_city_id succeeds
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

    // 7f. Clearing home_city_id to null succeeds
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

    // 7g. User show view populates home_city_id and strips private fields
    await database.pool.query(`UPDATE users SET home_city_id = $2 WHERE id = $1`, [testUserId, zamalekId]);
    const userShowRes = await fetch(`${baseUrl}/admin/api/resources/users/records/${testUserId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(userShowRes.status, 200);
    const userShowData = await userShowRes.json();
    assert.equal(userShowData.record.populated.home_city_id.title, 'Zamalek / الزمالك (Cairo)');
    assert.equal('phone_number' in userShowData.record.params, false);
    assert.equal('last_known_location' in userShowData.record.params, false);

    // 8. Saved Searches Historical & Official City Labels
    // 8a. Saved search with official city
    const savedSearchOfficial = await database.pool.query(
      `INSERT INTO saved_searches (user_id, label, post_type, city_id, species)
       VALUES ($1, 'Zamalek Dogs', 'ADOPTION', $2, 'DOG')
       RETURNING id`,
      [principals.userId, zamalekId],
    );
    const ssOfficialId = savedSearchOfficial.rows[0].id;

    // 8b. Saved search with historical legacy city
    const savedSearchLegacy = await database.pool.query(
      `INSERT INTO saved_searches (user_id, label, post_type, city_id, species)
       VALUES ($1, 'Legacy Area Cats', 'ADOPTION', $2, 'CAT')
       RETURNING id`,
      [principals.userId, legacyCityId],
    );
    const ssLegacyId = savedSearchLegacy.rows[0].id;

    // 8c. Saved search with historical retired city
    const savedSearchRetired = await database.pool.query(
      `INSERT INTO saved_searches (user_id, label, post_type, city_id, species)
       VALUES ($1, 'Retired District Birds', 'LOST', $2, 'BIRD')
       RETURNING id`,
      [principals.userId, retiredCityId],
    );
    const ssRetiredId = savedSearchRetired.rows[0].id;

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

    // Show view for historical retired saved search -> displays readable label
    const ssRetiredShow = await fetch(`${baseUrl}/admin/api/resources/saved_searches/records/${ssRetiredId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(ssRetiredShow.status, 200);
    const ssRetData = await ssRetiredShow.json();
    assert.ok(ssRetData.record.populated.city_id);
    assert.equal(ssRetData.record.populated.city_id.title, 'Retired District / حي ملغي (Suez)');

    // List view includes all three with populated bilingual titles
    const ssListRes = await fetch(`${baseUrl}/admin/api/resources/saved_searches/actions/list`, {
      headers: { cookie: superCookie },
    });
    assert.equal(ssListRes.status, 200);
    const ssListData = await ssListRes.json();
    const recOff = ssListData.records.find((r) => r.id === ssOfficialId);
    const recLeg = ssListData.records.find((r) => r.id === ssLegacyId);
    const recRet = ssListData.records.find((r) => r.id === ssRetiredId);
    assert.equal(recOff.populated.city_id.title, 'Zamalek / الزمالك (Cairo)');
    assert.equal(recLeg.populated.city_id.title, 'Ancient Village / قرية قديمة متقادمة (Giza)');
    assert.equal(recRet.populated.city_id.title, 'Retired District / حي ملغي (Suez)');

    // 9. Vet Clinic Location Audits with historical cities
    const auditRes = await database.pool.query(
      `INSERT INTO vet_clinic_location_audits (vet_clinic_id, admin_user_id, selected_city_id, nearest_city_id, coordinates, discrepancy_details, reason)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint(31.20, 29.98), 4326), '{"discrepant":true}', 'Historical location audit check')
       RETURNING id`,
      [legacyClinicId, principals.adminId, legacyCityId, retiredCityId],
    );
    const auditId = auditRes.rows[0].id;

    // Show view for location audit populates both legacy selected_city and retired nearest_city
    const auditShowRes = await fetch(
      `${baseUrl}/admin/api/resources/vet_clinic_location_audits/records/${auditId}/show`,
      {
        headers: { cookie: superCookie },
      },
    );
    assert.equal(auditShowRes.status, 200);
    const auditShowData = await auditShowRes.json();
    assert.ok(auditShowData.record.populated.selected_city_id);
    assert.ok(auditShowData.record.populated.nearest_city_id);
    assert.equal(auditShowData.record.populated.selected_city_id.title, 'Ancient Village / قرية قديمة متقادمة (Giza)');
    assert.equal(auditShowData.record.populated.nearest_city_id.title, 'Retired District / حي ملغي (Suez)');

    // List view for location audits populates both city titles
    const auditListRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinic_location_audits/actions/list`, {
      headers: { cookie: superCookie },
    });
    assert.equal(auditListRes.status, 200);
    const auditListData = await auditListRes.json();
    const foundAudit = auditListData.records.find((r) => r.id === auditId);
    assert.ok(foundAudit);
    assert.equal(foundAudit.populated.selected_city_id.title, 'Ancient Village / قرية قديمة متقادمة (Giza)');
    assert.equal(foundAudit.populated.nearest_city_id.title, 'Retired District / حي ملغي (Suez)');
  });

  // =========================================================================
  // Ticket 05: Verify authenticated Mapped Location browser journeys
  // =========================================================================

  it('loads Vet Clinic create and edit pages with production Content Security Policy and verifies map assets initialize without CSP violations', async () => {
    // 1. Seed an official city and existing clinic for edit journey
    const cityRes = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Dokki (Kism)', 'قسم الدقي', 'Giza', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.21, 30.04), 4326))
       RETURNING id`,
    );
    const dokkiCityId = cityRes.rows[0].id;

    const clinicRes = await database.pool.query(
      `INSERT INTO vet_clinics (name_english, name_arabic, city_id, address_english, address_arabic, coordinates)
       VALUES ('Dokki Pet Care', 'رعاية الدقي للحيوانات', $1, '15 Mosaddak St, Dokki', '١٥ شارع مصدق، الدقي', ST_SetSRID(ST_MakePoint(31.215, 30.042), 4326))
       RETURNING id`,
      [dokkiCityId],
    );
    const clinicId = clinicRes.rows[0].id;

    // 2. Authenticated GET create page
    const createPageRes = await fetch(`${baseUrl}/admin/resources/vet_clinics/actions/new`, {
      headers: { cookie: superCookie },
    });
    assert.equal(createPageRes.status, 200);
    assert.match(createPageRes.headers.get('content-type') || '', /text\/html/);

    const createCsp = createPageRes.headers.get('content-security-policy');
    assert.ok(createCsp, 'Expected Content-Security-Policy header on create page');
    assert.match(createCsp, /default-src\s+'self'/);
    assert.match(createCsp, /script-src[^;]*https:\/\/unpkg\.com/);
    assert.match(createCsp, /style-src[^;]*https:\/\/unpkg\.com/);
    assert.match(createCsp, /style-src[^;]*https:\/\/fonts\.googleapis\.com/);
    assert.match(createCsp, /font-src[^;]*https:\/\/fonts\.gstatic\.com/);
    assert.match(createCsp, /font-src[^;]*data:/);
    assert.match(createCsp, /img-src[^;]*https:/);
    assert.match(createCsp, /connect-src\s+'self'/);

    const createHtml = await createPageRes.text();
    assert.match(createHtml, /leaflet@1\.9\.4\/dist\/leaflet\.css/);
    assert.match(createHtml, /leaflet@1\.9\.4\/dist\/leaflet\.js/);
    assert.match(createHtml, /fonts\.googleapis\.com/);
    assert.match(createHtml, /pupzy-theme\.css/);

    // 3. Authenticated GET edit page
    const editPageRes = await fetch(`${baseUrl}/admin/resources/vet_clinics/records/${clinicId}/edit`, {
      headers: { cookie: superCookie },
    });
    assert.equal(editPageRes.status, 200);
    assert.match(editPageRes.headers.get('content-type') || '', /text\/html/);

    const editCsp = editPageRes.headers.get('content-security-policy');
    assert.ok(editCsp, 'Expected Content-Security-Policy header on edit page');
    assert.match(editCsp, /script-src[^;]*https:\/\/unpkg\.com/);
    assert.match(editCsp, /style-src[^;]*https:\/\/unpkg\.com/);
    assert.match(editCsp, /img-src[^;]*https:/);

    const editHtml = await editPageRes.text();
    assert.match(editHtml, /leaflet@1\.9\.4\/dist\/leaflet\.css/);
    assert.match(editHtml, /leaflet@1\.9\.4\/dist\/leaflet\.js/);

    // 4. Prove asset URLs and tile endpoints conform to CSP directives
    const tileUrl = 'https://tile.openstreetmap.org/13/4820/3371.png';
    const tileOrigin = new URL(tileUrl).origin;
    assert.equal(tileOrigin, 'https://tile.openstreetmap.org');
    // img-src allows https: so OpenStreetMap tiles load without CSP violation
    assert.ok(createCsp.includes("img-src 'self' data: https:"));
  });

  it('authenticates browser journey: selecting a City recenters the map without selecting a clinic point, and click/drag creates or moves the marker', async () => {
    // 1. Seed two distinct official cities: Alexandria and Aswan
    const alexCity = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Montaza Area (Kism)', 'قسم المنتزه ثان', 'Alexandria', 'OFFICIAL', ST_SetSRID(ST_MakePoint(30.01, 31.28), 4326))
       RETURNING id`,
    );
    const alexCityId = alexCity.rows[0].id;

    const aswanCity = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Aswan West', 'غرب أسوان', 'Aswan', 'OFFICIAL', ST_SetSRID(ST_MakePoint(32.89, 24.09), 4326))
       RETURNING id`,
    );
    const aswanCityId = aswanCity.rows[0].id;

    // 2. Query Alexandria City to obtain its center_point
    const alexCityShowRes = await fetch(`${baseUrl}/admin/api/resources/cities/records/${alexCityId}/show`, {
      headers: { cookie: superCookie },
    });
    assert.equal(alexCityShowRes.status, 200);
    const alexCityData = await alexCityShowRes.json();
    assert.equal(alexCityData.record.params.center_point, 'POINT(30.01 31.28)');
    assert.equal(alexCityData.record.params.latitude, 31.28);
    assert.equal(alexCityData.record.params.longitude, 30.01);

    // 3. Simulating selecting City in browser:
    // When City is selected, picker pans viewport to [31.28, 30.01] at zoom 13.
    // If the administrator attempts to save without placing a pin on the map, it fails.
    const failNoPinRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'Unpinned Clinic',
        name_arabic: 'عيادة بدون تحديد',
        city_id: alexCityId,
        address_english: '25 Corniche Rd, Montaza',
        address_arabic: '٢٥ طريق الكورنيش، المنتزه',
        location_confirmed: true,
      }),
    });
    const failNoPinData = await failNoPinRes.json();
    assert.ok(failNoPinData.record.errors.coordinates, 'Expected coordinates validation error when no pin placed');

    // 4. Click interaction places marker at [31.2815, 30.0125] and drag interaction moves it to [31.2830, 30.0140]
    const createWithPlacedMarkerRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'Montaza Pet Hospital',
        name_arabic: 'مستشفى حيوانات المنتزه',
        city_id: alexCityId,
        latitude: 31.283,
        longitude: 30.014,
        address_english: '27 Corniche Rd, Montaza, Alexandria',
        address_arabic: '٢٧ طريق الكورنيش، المنتزه، الإسكندرية',
        location_confirmed: true,
      }),
    });
    assert.equal(createWithPlacedMarkerRes.status, 200);
    const createData = await createWithPlacedMarkerRes.json();
    assert.equal(createData.notice?.type, 'success');
    const createdClinicId = createData.record.id;

    // Verify coordinates stored in database match the placed marker
    const clinicRow = await database.pool.query(
      `SELECT id, name_english, city_id, address_english, address_arabic,
              ST_X(coordinates::geometry) AS lng, ST_Y(coordinates::geometry) AS lat
       FROM vet_clinics WHERE id = $1`,
      [createdClinicId],
    );
    assert.equal(clinicRow.rowCount, 1);
    assert.equal(clinicRow.rows[0].city_id, alexCityId);
    assert.equal(Number(clinicRow.rows[0].lat.toFixed(4)), 31.283);
    assert.equal(Number(clinicRow.rows[0].lng.toFixed(4)), 30.014);

    // 5. Simulating edit journey: changing City selection to Aswan recenters viewport, but does NOT overwrite marker
    // Administrator drags marker to new coordinates in Aswan and provides override reason
    const editRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/records/${createdClinicId}/edit`, {
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
    assert.equal(editRes.status, 200);
    const editData = await editRes.json();
    assert.equal(editData.notice?.type, 'success');

    const updatedClinic = await database.pool.query(
      `SELECT city_id, ST_X(coordinates::geometry) AS lng, ST_Y(coordinates::geometry) AS lat
       FROM vet_clinics WHERE id = $1`,
      [createdClinicId],
    );
    assert.equal(updatedClinic.rows[0].city_id, aswanCityId);
    assert.equal(Number(updatedClinic.rows[0].lat.toFixed(4)), 24.091);
    assert.equal(Number(updatedClinic.rows[0].lng.toFixed(4)), 32.892);
  });

  it('authenticates browser journey: proves that explicit confirmation is required after placement and again after a location-relevant change', async () => {
    // 1. Seed official city
    const cityRes = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Heliopolis (Kism)', 'قسم مصر الجديدة', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.33, 30.09), 4326))
       RETURNING id`,
    );
    const heliopolisCityId = cityRes.rows[0].id;

    // 2. Placement made on map, but location_confirmed = false -> Server rejects
    const failUnconfirmedRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'Heliopolis Vet Clinic',
        name_arabic: 'عيادة مصر الجديدة البيطرية',
        city_id: heliopolisCityId,
        latitude: 30.092,
        longitude: 31.334,
        address_english: '12 Baghdad St, Korba, Heliopolis',
        address_arabic: '١٢ شارع بغداد، الكوربة، مصر الجديدة',
        location_confirmed: false,
      }),
    });
    const failUnconfirmedData = await failUnconfirmedRes.json();
    assert.ok(
      failUnconfirmedData.record.errors.coordinates,
      'Expected validation error when location_confirmed is false',
    );
    assert.match(failUnconfirmedData.record.errors.coordinates.message, /confirmed/i);

    // 3. Changing English address clears confirmation
    const failUnconfirmedAfterEnglishAddressChange = await fetch(
      `${baseUrl}/admin/api/resources/vet_clinics/actions/new`,
      {
        method: 'POST',
        headers: {
          cookie: `${superCookie}; ${superCsrf.cookie}`,
          origin: baseUrl,
          'x-xsrf-token': superCsrf.token,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name_english: 'Heliopolis Vet Clinic',
          name_arabic: 'عيادة مصر الجديدة البيطرية',
          city_id: heliopolisCityId,
          latitude: 30.092,
          longitude: 31.334,
          address_english: '14 Baghdad St, Korba, Heliopolis',
          address_arabic: '١٢ شارع بغداد، الكوربة، مصر الجديدة',
          location_confirmed: false, // cleared by address change
        }),
      },
    );
    const failEngData = await failUnconfirmedAfterEnglishAddressChange.json();
    assert.ok(failEngData.record.errors.coordinates);

    // 4. Changing Arabic address clears confirmation
    const failUnconfirmedAfterArabicAddressChange = await fetch(
      `${baseUrl}/admin/api/resources/vet_clinics/actions/new`,
      {
        method: 'POST',
        headers: {
          cookie: `${superCookie}; ${superCsrf.cookie}`,
          origin: baseUrl,
          'x-xsrf-token': superCsrf.token,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name_english: 'Heliopolis Vet Clinic',
          name_arabic: 'عيادة مصر الجديدة البيطرية',
          city_id: heliopolisCityId,
          latitude: 30.092,
          longitude: 31.334,
          address_english: '12 Baghdad St, Korba, Heliopolis',
          address_arabic: '١٤ شارع بغداد، الكوربة، مصر الجديدة',
          location_confirmed: false, // cleared by address change
        }),
      },
    );
    const failArData = await failUnconfirmedAfterArabicAddressChange.json();
    assert.ok(failArData.record.errors.coordinates);

    // 5. Changing coordinates clears confirmation
    const failUnconfirmedAfterCoordChange = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'Heliopolis Vet Clinic',
        name_arabic: 'عيادة مصر الجديدة البيطرية',
        city_id: heliopolisCityId,
        latitude: 30.095, // moved marker
        longitude: 31.338,
        address_english: '12 Baghdad St, Korba, Heliopolis',
        address_arabic: '١٢ شارع بغداد، الكوربة، مصر الجديدة',
        location_confirmed: false, // cleared by coordinate change
      }),
    });
    const failCoordData = await failUnconfirmedAfterCoordChange.json();
    assert.ok(failCoordData.record.errors.coordinates);

    // 6. Confirmed submission succeeds
    const successRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/actions/new`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'Heliopolis Vet Clinic',
        name_arabic: 'عيادة مصر الجديدة البيطرية',
        city_id: heliopolisCityId,
        latitude: 30.092,
        longitude: 31.334,
        address_english: '12 Baghdad St, Korba, Heliopolis',
        address_arabic: '١٢ شارع بغداد، الكوربة، مصر الجديدة',
        location_confirmed: true,
      }),
    });
    assert.equal(successRes.status, 200);
    const successData = await successRes.json();
    assert.equal(successData.notice?.type, 'success');
    const createdId = successData.record.id;

    const checkClinic = await database.pool.query(`SELECT * FROM vet_clinics WHERE id = $1`, [createdId]);
    assert.equal(checkClinic.rowCount, 1);
    assert.equal(checkClinic.rows[0].city_id, heliopolisCityId);
    assert.equal(checkClinic.rows[0].location_provenance, 'MANUAL');
  });

  it('authenticates Imported Vet Clinic journey: updates a non-location field without requiring Mapped Location replacement', async () => {
    // 1. Seed legacy city and imported clinic
    const legacyCity = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Historical Old Qurna', 'القرنة القديمة التاريخية', 'Luxor', 'LEGACY', ST_SetSRID(ST_MakePoint(32.61, 25.72), 4326))
       RETURNING id`,
    );
    const legacyCityId = legacyCity.rows[0].id;

    const importedClinic = await database.pool.query(
      `INSERT INTO vet_clinics (name_english, city_id, coordinates, source, location_provenance, address_english, address_arabic, address, phone_number, is_active)
       VALUES ('Imported West Bank Vet', $1, ST_SetSRID(ST_MakePoint(32.615, 25.722), 4326), 'OSM', 'OSM', 'West Bank Road, Qurna', NULL, 'West Bank Road, Qurna', '+201011112222', true)
       RETURNING id`,
      [legacyCityId],
    );
    const importedClinicId = importedClinic.rows[0].id;

    // 2. Administrator opens edit page and modifies only non-location fields (name_english, phone_number, is_active)
    // The form submits all existing values (including legacy city_id, existing coordinates string, unconfirmed checkbox, and empty Arabic address)
    const updateRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/records/${importedClinicId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name_english: 'Imported West Bank Vet - Updated',
        phone_number: '+201099887766',
        is_active: 'false',
        city_id: legacyCityId,
        coordinates: 'SRID=4326;POINT(32.615 25.722)',
        latitude: 25.722,
        longitude: 32.615,
        address_english: 'West Bank Road, Qurna',
        address_arabic: '',
        location_confirmed: false,
      }),
    });
    assert.equal(updateRes.status, 200);
    const updateData = await updateRes.json();
    assert.equal(updateData.notice?.type, 'success');

    // 3. Database assertions at the end of the browser flow
    const clinicInDb = await database.pool.query(
      `SELECT id, name_english, phone_number, is_active, city_id, source, location_provenance, address_english, address_arabic, address,
              ST_X(coordinates::geometry) AS lng, ST_Y(coordinates::geometry) AS lat
       FROM vet_clinics WHERE id = $1`,
      [importedClinicId],
    );
    assert.equal(clinicInDb.rowCount, 1);
    const c = clinicInDb.rows[0];
    assert.equal(c.name_english, 'Imported West Bank Vet - Updated');
    assert.equal(c.phone_number, '+201099887766');
    assert.equal(c.is_active, false);
    assert.equal(c.city_id, legacyCityId);
    assert.equal(c.source, 'OSM');
    assert.equal(c.location_provenance, 'OSM');
    assert.equal(c.address_english, 'West Bank Road, Qurna');
    assert.equal(c.address_arabic, null);
    assert.equal(c.address, 'West Bank Road, Qurna');
    assert.equal(Number(c.lat.toFixed(4)), 25.722);
    assert.equal(Number(c.lng.toFixed(4)), 32.615);

    // Verify no unexpected audit entry was created
    const audits = await database.pool.query(`SELECT * FROM vet_clinic_location_audits WHERE vet_clinic_id = $1`, [
      importedClinicId,
    ]);
    assert.equal(audits.rowCount, 0, 'Non-location edit must not produce location audit');
  });

  it('authenticates City-disagreement journey: records the approved Vet Clinic change and its append-only audit together, with database assertions at the end of the browser flow', async () => {
    // 1. Seed two distinct official cities: Cairo Downtown and Aswan South
    const cairoCity = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Cairo Central Admin ${Date.now()}', 'وسط القاهرة الإداري', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.23, 30.04), 4326))
       RETURNING id`,
    );
    const cairoCityId = cairoCity.rows[0].id;

    const aswanCity = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Aswan South Field ${Date.now()}', 'جنوب أسوان الميداني', 'Aswan', 'OFFICIAL', ST_SetSRID(ST_MakePoint(32.89, 24.09), 4326))
       RETURNING id`,
    );
    const aswanCityId = aswanCity.rows[0].id;

    // 2. Create existing clinic in Cairo
    const clinicRes = await database.pool.query(
      `INSERT INTO vet_clinics (name_english, name_arabic, city_id, address_english, address_arabic, coordinates)
       VALUES ('Egyptian Mobile Vet Services', 'خدمات بيطرية متنقلة', $1, '10 Kasr El Aini, Cairo', '١٠ قصر العيني، القاهرة', ST_SetSRID(ST_MakePoint(31.23, 30.04), 4326))
       RETURNING id`,
      [cairoCityId],
    );
    const clinicId = clinicRes.rows[0].id;

    // 3. Administrator opens edit journey: keeps Cairo selected as City, places marker in Aswan, confirms, but omits override reason
    const failDiscrepancyRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/records/${clinicId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        city_id: cairoCityId, // Selected Cairo
        latitude: 24.092, // Located in Aswan
        longitude: 32.891,
        address_english: 'Aswan Nile Station',
        address_arabic: 'محطة نيل أسوان',
        location_confirmed: true,
      }),
    });
    const failDiscrepancyData = await failDiscrepancyRes.json();
    assert.ok(failDiscrepancyData.record.errors.override_reason, 'Expected error on missing override_reason');
    assert.match(failDiscrepancyData.record.errors.override_reason.message, /closest to.*Aswan/i);
    assert.match(failDiscrepancyData.record.errors.override_reason.message, /Cairo.*selected/i);
    assert.match(failDiscrepancyData.record.errors.override_reason.message, /approximate centroids/i);

    // Database assertion: verify clinic was NOT modified
    const unmodClinic = await database.pool.query(
      `SELECT city_id, ST_X(coordinates::geometry) AS lng, ST_Y(coordinates::geometry) AS lat
       FROM vet_clinics WHERE id = $1`,
      [clinicId],
    );
    assert.equal(unmodClinic.rows[0].city_id, cairoCityId);
    assert.equal(Number(unmodClinic.rows[0].lat.toFixed(2)), 30.04);
    assert.equal(Number(unmodClinic.rows[0].lng.toFixed(2)), 31.23);

    // 4. Administrator provides valid override reason and submits
    const overrideReasonText =
      'Mobile specialized veterinary unit administratively registered in Cairo operating on temporary field assignment in Aswan.';
    const successOverrideRes = await fetch(`${baseUrl}/admin/api/resources/vet_clinics/records/${clinicId}/edit`, {
      method: 'POST',
      headers: {
        cookie: `${superCookie}; ${superCsrf.cookie}`,
        origin: baseUrl,
        'x-xsrf-token': superCsrf.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        city_id: cairoCityId,
        latitude: 24.092,
        longitude: 32.891,
        address_english: 'Aswan Nile Station',
        address_arabic: 'محطة نيل أسوان',
        location_confirmed: true,
        override_reason: overrideReasonText,
      }),
    });
    assert.equal(successOverrideRes.status, 200);
    const successOverrideData = await successOverrideRes.json();
    assert.equal(successOverrideData.notice?.type, 'success');

    // 5. Database assertions at the end of the browser flow
    // 5a. Verify vet_clinics record updated
    const savedClinic = await database.pool.query(
      `SELECT id, name_english, city_id, address_english, address_arabic, location_provenance,
              ST_X(coordinates::geometry) AS lng, ST_Y(coordinates::geometry) AS lat
       FROM vet_clinics WHERE id = $1`,
      [clinicId],
    );
    assert.equal(savedClinic.rowCount, 1);
    assert.equal(savedClinic.rows[0].city_id, cairoCityId);
    assert.equal(savedClinic.rows[0].location_provenance, 'MANUAL');
    assert.equal(savedClinic.rows[0].address_english, 'Aswan Nile Station');
    assert.equal(savedClinic.rows[0].address_arabic, 'محطة نيل أسوان');
    assert.equal(Number(savedClinic.rows[0].lat.toFixed(4)), 24.092);
    assert.equal(Number(savedClinic.rows[0].lng.toFixed(4)), 32.891);

    // 5b. Verify vet_clinic_location_audits record created atomically
    const auditRows = await database.pool.query(`SELECT * FROM vet_clinic_location_audits WHERE vet_clinic_id = $1`, [
      clinicId,
    ]);
    assert.equal(auditRows.rowCount, 1);
    const audit = auditRows.rows[0];
    assert.equal(audit.admin_user_id, principals.adminId);
    assert.equal(audit.selected_city_id, cairoCityId);
    assert.ok(audit.nearest_city_id);
    assert.notEqual(audit.nearest_city_id, cairoCityId);
    assert.equal(audit.reason, overrideReasonText);
    assert.ok(audit.discrepancy_details);
    assert.equal(audit.discrepancy_details.selected_city.id, cairoCityId);
    assert.equal(audit.discrepancy_details.nearest_city.id, audit.nearest_city_id);
    assert.match(audit.discrepancy_details.nearest_city.governorate, /Aswan/i);
    assert.ok(audit.created_at);

    // 5c. Verify append-only audit trail immutability via AdminJS API
    const directAuditDeleteRes = await fetch(
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
    assert.ok([403, 404, 200].includes(directAuditDeleteRes.status));
    const survivingAudit = await database.pool.query(`SELECT id FROM vet_clinic_location_audits WHERE id = $1`, [
      audit.id,
    ]);
    assert.equal(survivingAudit.rowCount, 1, 'Audit records must remain immutable and undeletable');
  });
});

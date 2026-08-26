import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
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
import { TestDatabaseHelper, seedPrincipals } from './test-database.helper.js';

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
  app.set('trust proxy', 1);
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
  it('renders the login page', async () => {
    const response = await fetch(`${baseUrl}/admin/login`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Pupzy Admin/);
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

  it('rate-limits the eleventh login attempt from one IP', async () => {
    let response;
    for (let attempt = 1; attempt <= 11; attempt += 1) {
      ({ response } = await login('nobody@example.com', 'wrong password'));
    }
    assert.equal(response.status, 429);
  });
});

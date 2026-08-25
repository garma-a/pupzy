import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import AdminJSExpress from "@adminjs/express";
import bcrypt from "bcryptjs";
import express from "express";
import rateLimit from "express-rate-limit";

import { buildAdminJs } from "../src/adminjs/index.js";
import { buildAuthenticate } from "../src/auth/authenticate.js";
import { requireSameOrigin } from "../src/middleware/same-origin.js";
import { TestDatabaseHelper, seedPrincipals } from "./test-database.helper.js";

const database = new TestDatabaseHelper();
let server;
let baseUrl;
let sqlAdapterPool;
let principals;
let superCookie;
let staffCookie;

async function login(email, password) {
  const response = await fetch(`${baseUrl}/admin/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: baseUrl,
    },
    body: new URLSearchParams({ email, password }),
  });
  return {
    response,
    cookie: response.headers.get("set-cookie")?.split(";", 1)[0],
  };
}

before(async () => {
  const connectionString = await database.start();
  principals = await seedPrincipals(database.pool);
  const superHash = await bcrypt.hash("super secure password", 4);
  const staffHash = await bcrypt.hash("staff secure password", 4);
  await database.pool.query(
    `UPDATE admin_users SET password_hash = $2 WHERE id = $1`,
    [principals.adminId, superHash],
  );
  await database.pool.query(
    `INSERT INTO admin_users (email, password_hash, full_name, role)
     VALUES ('staff@example.com', $1, 'Staff Admin', 'ADMIN')`,
    [staffHash],
  );
  await database.pool.query(
    `UPDATE users
     SET is_banned = true, banned_by_admin_id = $2
     WHERE id = $1`,
    [principals.userId, principals.adminId],
  );

  const databaseName = new URL(connectionString).pathname.replace(/^\//, "");
  const built = await buildAdminJs(
    connectionString,
    databaseName,
    database.pool,
  );
  sqlAdapterPool = built.sqlAdapterPool;

  const app = express();
  app.set("trust proxy", 1);
  app.use("/admin", requireSameOrigin);
  app.use(
    "/admin/login",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(
    "/admin",
    AdminJSExpress.buildAuthenticatedRouter(
      built.admin,
      {
        authenticate: buildAuthenticate(database.pool),
        cookiePassword: "a test cookie password at least 32 chars",
        cookieName: "pupzy_admin_test",
      },
      null,
      {
        resave: false,
        saveUninitialized: false,
        secret: "a test session secret at least 32 chars",
        cookie: { httpOnly: true, sameSite: "lax" },
      },
    ),
  );
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  superCookie = (await login("admin@example.com", "super secure password"))
    .cookie;
  staffCookie = (await login("staff@example.com", "staff secure password"))
    .cookie;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await sqlAdapterPool?.destroy();
  await database.stop();
});

describe("AdminJS HTTP security and resource behavior", () => {
  it("renders the login page", async () => {
    const response = await fetch(`${baseUrl}/admin/login`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Pupzy Admin/);
  });

  it("redirects unauthenticated resource requests to login", async () => {
    const response = await fetch(`${baseUrl}/admin/resources/users`, {
      redirect: "manual",
    });
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location"), /\/admin\/login/);
  });

  it("rejects cross-origin state-changing requests", async () => {
    const response = await fetch(`${baseUrl}/admin/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        origin: "https://attacker.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        email: "admin@example.com",
        password: "super secure password",
      }),
    });
    assert.equal(response.status, 403);
  });

  it("enforces role checks on admin management while allowing a super admin", async () => {
    const staff = await fetch(
      `${baseUrl}/admin/api/resources/admin_users/actions/list`,
      {
        headers: { cookie: staffCookie },
        redirect: "manual",
      },
    );
    assert.equal(staff.status, 200);
    const staffData = await staff.json();
    assert.equal(staffData.notice.type, "error");
    assert.deepEqual(staffData.records, []);

    const superAdmin = await fetch(
      `${baseUrl}/admin/api/resources/admin_users/actions/list`,
      {
        headers: { cookie: superCookie },
        redirect: "manual",
      },
    );
    assert.equal(superAdmin.status, 200);
    const data = await superAdmin.json();
    assert.ok(data.records.length >= 2);
    assert.notEqual(data.notice?.type, "error");
    assert.equal(
      data.records.every((record) => !("password_hash" in record.params)),
      true,
    );
  });

  it("returns an empty page beyond the final pagination page", async () => {
    const response = await fetch(
      `${baseUrl}/admin/api/resources/users/actions/list?page=9999`,
      {
        headers: { cookie: superCookie },
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).records, []);
  });

  it("removes private fields from users and populated admin references", async () => {
    const response = await fetch(
      `${baseUrl}/admin/api/resources/users/records/${principals.userId}/show`,
      { headers: { cookie: superCookie } },
    );
    assert.equal(response.status, 200);

    const { record } = await response.json();
    assert.equal("phone_number" in record.params, false);
    assert.equal("last_known_location" in record.params, false);
    assert.equal(
      "password_hash" in record.populated.banned_by_admin_id.params,
      false,
    );
  });

  it("relies on PostgreSQL enums to reject invalid values", async () => {
    await assert.rejects(
      database.pool.query(
        `UPDATE admin_users SET role = 'ROOT' WHERE id = $1`,
        [principals.adminId],
      ),
      (error) => error.code === "22P02",
    );
  });

  it("rate-limits the eleventh login attempt from one IP", async () => {
    let response;
    for (let attempt = 1; attempt <= 11; attempt += 1) {
      ({ response } = await login("nobody@example.com", "wrong password"));
    }
    assert.equal(response.status, 429);
  });
});

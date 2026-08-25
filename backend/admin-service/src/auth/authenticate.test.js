import assert from "node:assert/strict";
import { describe, it } from "node:test";
import bcrypt from "bcryptjs";

import { buildAuthenticate } from "./authenticate.js";

async function authenticateWith(overrides = {}) {
  const row = {
    id: "admin-id",
    email: "admin@example.com",
    password_hash: await bcrypt.hash("correct password", 4),
    role: "SUPER_ADMIN",
    full_name: "Admin",
    is_active: true,
    ...overrides,
  };
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("SELECT id"))
        return { rows: overrides.missing ? [] : [row] };
      return { rows: [] };
    },
  };
  return { authenticate: buildAuthenticate(pool), calls };
}

describe("admin authentication", () => {
  it("returns an admin and updates last_login_at on valid credentials", async () => {
    const { authenticate, calls } = await authenticateWith();
    const result = await authenticate(
      " ADMIN@example.com ",
      "correct password",
    );
    assert.deepEqual(result, {
      id: "admin-id",
      email: "admin@example.com",
      role: "SUPER_ADMIN",
      fullName: "Admin",
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].values, ["admin@example.com"]);
  });

  for (const [name, overrides, password] of [
    ["wrong password", {}, "wrong"],
    ["missing user", { missing: true }, "correct password"],
    ["inactive user", { is_active: false }, "correct password"],
  ]) {
    it(`returns null and does not update login time for ${name}`, async () => {
      const { authenticate, calls } = await authenticateWith(overrides);
      assert.equal(await authenticate("admin@example.com", password), null);
      assert.equal(calls.length, 1);
    });
  }
});

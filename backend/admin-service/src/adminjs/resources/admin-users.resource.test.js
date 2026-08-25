import assert from "node:assert/strict";
import { describe, it } from "node:test";
import bcrypt from "bcryptjs";

import {
  buildAdminUsersResource,
  hashAdminPassword,
} from "./admin-users.resource.js";

describe("admin password hook", () => {
  it("hashes a plaintext password before create or edit", async () => {
    const request = {
      method: "post",
      payload: { password_hash: "correct horse battery staple" },
    };
    await hashAdminPassword(request);
    assert.notEqual(
      request.payload.password_hash,
      "correct horse battery staple",
    );
    assert.match(request.payload.password_hash, /^\$2/);
    assert.equal(
      await bcrypt.compare(
        "correct horse battery staple",
        request.payload.password_hash,
      ),
      true,
    );
  });

  it("strips an empty password so edit preserves the stored hash", async () => {
    const request = {
      method: "post",
      payload: { full_name: "Changed", password_hash: "" },
    };
    await hashAdminPassword(request);
    assert.equal("password_hash" in request.payload, false);
    assert.equal(request.payload.full_name, "Changed");
  });
  it("removes password hashes from AdminJS action responses", async () => {
    const db = { table: (name) => ({ name }) };
    const resource = buildAdminUsersResource(db);
    const response = {
      record: { params: { email: "admin.com", password_hash: "secret hash" } },
      records: [{ params: { password_hash: "another hash" } }],
    };
    const sanitized = await resource.options.actions.list.after(response);
    assert.equal("password_hash" in sanitized.record.params, false);
    assert.equal("password_hash" in sanitized.records[0].params, false);
  });
});

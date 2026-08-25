import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAnyAdmin, isSuperAdmin } from "./rbac.js";

describe("RBAC", () => {
  it("restricts super-admin operations", () => {
    assert.equal(isSuperAdmin({ currentAdmin: { role: "ADMIN" } }), false);
    assert.equal(isSuperAdmin({ currentAdmin: { role: "SUPER_ADMIN" } }), true);
    assert.equal(isSuperAdmin({}), false);
  });

  it("allows both staff moderation roles", () => {
    assert.equal(isAnyAdmin({ currentAdmin: { role: "ADMIN" } }), true);
    assert.equal(isAnyAdmin({ currentAdmin: { role: "SUPER_ADMIN" } }), true);
    assert.equal(isAnyAdmin({ currentAdmin: { role: "USER" } }), false);
  });
});

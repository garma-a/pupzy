import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCitiesResource } from "./cities.resource.js";

const db = { table: (name) => ({ name }) };

describe("AdminJS Cities Resource", () => {
  const resource = buildCitiesResource(db);

  it("disables all four mutation actions (new, edit, delete, bulkDelete) for every role including super-admin", () => {
    const actions = resource.options.actions;

    assert.equal(actions.new.isAccessible, false);
    assert.equal(actions.edit.isAccessible, false);
    assert.equal(actions.delete.isAccessible, false);
    assert.equal(actions.bulkDelete.isAccessible, false);

    // Verify when accessed by SUPER_ADMIN context, action accessibility remains disabled
    const superAdminContext = { currentAdmin: { role: "SUPER_ADMIN" } };
    assert.equal(typeof actions.new.isAccessible === "function" ? actions.new.isAccessible(superAdminContext) : actions.new.isAccessible, false);
    assert.equal(typeof actions.edit.isAccessible === "function" ? actions.edit.isAccessible(superAdminContext) : actions.edit.isAccessible, false);
    assert.equal(typeof actions.delete.isAccessible === "function" ? actions.delete.isAccessible(superAdminContext) : actions.delete.isAccessible, false);
    assert.equal(typeof actions.bulkDelete.isAccessible === "function" ? actions.bulkDelete.isAccessible(superAdminContext) : actions.bulkDelete.isAccessible, false);
  });

  it("forces list filter to status=OFFICIAL only", async () => {
    const listBeforeHook = resource.options.actions.list.before;
    assert.equal(typeof listBeforeHook, "function");

    const request = { query: { "filters.governorate": "Cairo" } };
    const modifiedRequest = await listBeforeHook(request);

    assert.equal(modifiedRequest.query["filters.status"], "OFFICIAL");
    assert.equal(modifiedRequest.query["filters.governorate"], "Cairo");
  });

  it("restricts show action to OFFICIAL cities only", () => {
    const showIsAccessible = resource.options.actions.show.isAccessible;
    assert.equal(typeof showIsAccessible, "function");

    assert.equal(
      showIsAccessible({ record: { params: { status: "OFFICIAL" } } }),
      true,
    );
    assert.equal(
      showIsAccessible({ record: { params: { status: "LEGACY" } } }),
      false,
    );
    assert.equal(
      showIsAccessible({ record: { params: { status: "RETIRED" } } }),
      false,
    );
  });

  it("exposes internal source information in properties and show views", () => {
    const properties = resource.options.properties;
    assert.ok(properties.source_code);
    assert.ok(properties.source_name_english);
    assert.ok(properties.source_name_arabic);

    assert.equal(properties.source_code.isVisible.show, true);
    assert.equal(properties.source_name_english.isVisible.show, true);
    assert.equal(properties.source_name_arabic.isVisible.show, true);

    assert.ok(resource.options.showProperties.includes("source_code"));
    assert.ok(resource.options.showProperties.includes("source_name_english"));
    assert.ok(resource.options.showProperties.includes("source_name_arabic"));
  });
});

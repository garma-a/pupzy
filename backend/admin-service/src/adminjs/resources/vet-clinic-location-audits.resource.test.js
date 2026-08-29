import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildVetClinicLocationAuditsResource } from "./vet-clinic-location-audits.resource.js";

describe("AdminJS Vet Clinic Location Audits Resource", () => {
  const db = {
    table: (name) => ({ name }),
  };

  const resource = buildVetClinicLocationAuditsResource(db);

  it("enforces read-only actions (disables new, edit, delete, bulkDelete)", () => {
    const actions = resource.options.actions;
    assert.equal(actions.new.isAccessible, false);
    assert.equal(actions.edit.isAccessible, false);
    assert.equal(actions.delete.isAccessible, false);
    assert.equal(actions.bulkDelete.isAccessible, false);
  });

  it("declares intentional list and show properties", () => {
    const listProps = resource.options.listProperties;
    assert.ok(listProps.includes("vet_clinic_id"));
    assert.ok(listProps.includes("admin_user_id"));
    assert.ok(listProps.includes("selected_city_id"));
    assert.ok(listProps.includes("nearest_city_id"));
    assert.ok(listProps.includes("reason"));
    assert.ok(listProps.includes("created_at"));

    const showProps = resource.options.showProperties;
    assert.ok(showProps.includes("coordinates"));
    assert.ok(showProps.includes("discrepancy_details"));
    assert.ok(showProps.includes("reason"));
  });

  it("configures default sort by created_at descending", () => {
    assert.deepEqual(resource.options.sort, {
      sortBy: "created_at",
      direction: "desc",
    });
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ENUMS } from "../enums.js";
import { buildAdoptionApplicationsResource } from "./adoption-applications.resource.js";

const db = { table: (name) => ({ name }) };

describe("AdminJS Adoption Applications Resource Configuration", () => {
  it("declares concise intentional listProperties excluding detailed questionnaires", () => {
    const resource = buildAdoptionApplicationsResource(db);
    assert.deepEqual(resource.options.listProperties, [
      "id",
      "target_post_id",
      "applicant_id",
      "status",
      "living_situation",
      "created_at",
    ]);
    assert.equal(
      resource.options.listProperties.includes("why_adopt"),
      false,
      "why_adopt must be excluded from listProperties to prevent vertical wrapping",
    );
    assert.equal(
      resource.options.listProperties.includes("previous_pet_experience"),
      false,
    );
  });

  it("preserves full questionnaire answers and commitment flags on record show view", () => {
    const resource = buildAdoptionApplicationsResource(db);
    assert.deepEqual(resource.options.showProperties, [
      "id",
      "target_post_id",
      "applicant_id",
      "status",
      "species_preference",
      "breed_preference",
      "age_preference",
      "gender_preference",
      "living_situation",
      "has_outdoor_access",
      "has_other_pets_at_home",
      "has_children_at_home",
      "hours_at_home_per_day",
      "previous_pet_experience",
      "why_adopt",
      "consent_home_visit",
      "can_provide_vet_reference",
      "responded_at",
      "created_at",
    ]);
  });

  it("attaches ShortUuid custom component to ID and relation fields when provided", () => {
    const components = { ShortUuid: "CustomShortUuidComponent" };
    const resource = buildAdoptionApplicationsResource(db, components);
    assert.equal(
      resource.options.properties.id.components.list,
      "CustomShortUuidComponent",
    );
    assert.equal(
      resource.options.properties.id.components.show,
      "CustomShortUuidComponent",
    );
    assert.equal(
      resource.options.properties.target_post_id.components.list,
      "CustomShortUuidComponent",
    );
    assert.equal(
      resource.options.properties.target_post_id.components.show,
      "CustomShortUuidComponent",
    );
    assert.equal(
      resource.options.properties.applicant_id.components.list,
      "CustomShortUuidComponent",
    );
    assert.equal(
      resource.options.properties.applicant_id.components.show,
      "CustomShortUuidComponent",
    );
  });

  it("enforces read-only actions (disables new, edit, delete, bulkDelete)", () => {
    const resource = buildAdoptionApplicationsResource(db);
    assert.equal(resource.options.actions.new.isAccessible, false);
    assert.equal(resource.options.actions.edit.isAccessible, false);
    assert.equal(resource.options.actions.delete.isAccessible, false);
    assert.equal(resource.options.actions.bulkDelete.isAccessible, false);
  });

  it("strips populated password hashes from list and show after hooks", () => {
    const resource = buildAdoptionApplicationsResource(db);
    const showAfter = resource.options.actions.show.after;
    const response = {
      record: {
        params: { id: "app-1" },
        populated: {
          applicant_id: {
            params: { id: "user-1", password_hash: "secret_hash" },
          },
        },
      },
    };
    const cleaned = showAfter(response);
    assert.equal(
      cleaned.record.populated.applicant_id.params.password_hash,
      undefined,
    );
  });

  it("transcribes all enum-backed preference and status fields accurately", () => {
    const resource = buildAdoptionApplicationsResource(db);
    assert.deepEqual(
      resource.options.properties.status.availableValues.map((v) => v.value),
      ENUMS.requestStatus,
    );
    assert.deepEqual(
      resource.options.properties.species_preference.availableValues.map(
        (v) => v.value,
      ),
      ENUMS.speciesType,
    );
    assert.deepEqual(
      resource.options.properties.gender_preference.availableValues.map(
        (v) => v.value,
      ),
      ENUMS.genderType,
    );
    assert.deepEqual(
      resource.options.properties.living_situation.availableValues.map(
        (v) => v.value,
      ),
      ENUMS.livingSituation,
    );
  });
});

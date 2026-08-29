import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ENUMS } from "../enums.js";
import { ADMIN_RESOURCE_TABLES } from "../index.js";
import { buildAdminUsersResource } from "./admin-users.resource.js";
import { buildAdoptionApplicationsResource } from "./adoption-applications.resource.js";
import { buildAdoptionPostsResource } from "./adoption-posts.resource.js";
import { buildCitiesResource } from "./cities.resource.js";
import { buildContactRequestsResource } from "./contact-requests.resource.js";
import { buildLostPostsResource } from "./lost-posts.resource.js";
import { buildMatingPostsResource } from "./mating-posts.resource.js";
import { buildModerationActionsResource } from "./moderation-actions.resource.js";
import { buildNotificationsResource } from "./notifications.resource.js";
import { buildPostMediaResource } from "./post-media.resource.js";
import { buildPostReportsResource } from "./post-reports.resource.js";
import { buildPostSavesResource } from "./post-saves.resource.js";
import { buildPostUpvotesResource } from "./post-upvotes.resource.js";
import { buildPostsResource } from "./posts.resource.js";
import { buildProductPostsResource } from "./product-posts.resource.js";
import { buildRescuePostsResource } from "./rescue-posts.resource.js";
import { buildSavedSearchesResource } from "./saved-searches.resource.js";
import { buildUsersResource } from "./users.resource.js";
import { buildVetClinicsResource } from "./vet-clinics.resource.js";
import { buildVetClinicLocationAuditsResource } from "./vet-clinic-location-audits.resource.js";

const db = { table: (name) => ({ name }) };
const pool = {};
const components = { ModerationAction: "ModerationAction", ShortUuid: "ShortUuid" };

function values(resource, property) {
  return resource.options.properties[property].availableValues.map(
    ({ value }) => value,
  );
}

function resources() {
  return [
    buildUsersResource(db, pool, components),
    buildPostsResource(db, pool, components),
    buildRescuePostsResource(db, components),
    buildLostPostsResource(db, components),
    buildAdoptionPostsResource(db, components),
    buildProductPostsResource(db, components),
    buildMatingPostsResource(db, components),
    buildPostMediaResource(db, components),
    buildPostUpvotesResource(db, components),
    buildPostSavesResource(db, components),
    buildPostReportsResource(db, components),
    buildContactRequestsResource(db, components),
    buildAdoptionApplicationsResource(db, components),
    buildSavedSearchesResource(db, components),
    buildNotificationsResource(db, components),
    buildCitiesResource(db, components),
    buildVetClinicsResource(db, pool, components),
    buildAdminUsersResource(db, components),
    buildModerationActionsResource(db, components),
    buildVetClinicLocationAuditsResource(db, components),
  ];
}

describe("AdminJS resource configuration", () => {
  it("includes all 20 registered domain tables", () => {
    const list = resources();
    assert.equal(list.length, 20);
    const names = list.map((r) => r.resource.name);
    assert.deepEqual(names, [...ADMIN_RESOURCE_TABLES]);
  });

  it("transcribes every enum-backed property exactly", () => {
    const byTable = Object.fromEntries(
      resources().map((item) => [item.resource.name, item]),
    );
    const expectations = [
      ["posts", "post_type", ENUMS.postType],
      ["posts", "status", ENUMS.postStatus],
      ["posts", "moderation_status", ENUMS.moderationStatus],
      ["posts", "urgency", ENUMS.urgencyTier],
      ["posts", "market_category", ENUMS.productCategory],
      ["rescue_posts", "species", ENUMS.speciesType],
      ["rescue_posts", "reporter_role", ENUMS.reporterRole],
      ["lost_posts", "report_type", ENUMS.lostFoundType],
      ["lost_posts", "species", ENUMS.speciesType],
      ["lost_posts", "current_condition", ENUMS.foundAnimalCondition],
      ["adoption_posts", "species", ENUMS.speciesType],
      ["adoption_posts", "gender", ENUMS.genderType],
      ["adoption_posts", "age_unit", ENUMS.ageUnit],
      ["adoption_posts", "space_requirement", ENUMS.spaceRequirement],
      ["product_posts", "category", ENUMS.productCategory],
      ["product_posts", "condition", ENUMS.productCondition],
      ["mating_posts", "species", ENUMS.speciesType],
      ["mating_posts", "gender", ENUMS.genderType],
      ["mating_posts", "age_unit", ENUMS.ageUnit],
      ["post_reports", "reason", ENUMS.reportReason],
      ["contact_requests", "status", ENUMS.requestStatus],
      ["adoption_applications", "status", ENUMS.requestStatus],
      ["adoption_applications", "species_preference", ENUMS.speciesType],
      ["adoption_applications", "gender_preference", ENUMS.genderType],
      ["adoption_applications", "living_situation", ENUMS.livingSituation],
      ["saved_searches", "post_type", ENUMS.postType],
      ["saved_searches", "species", ENUMS.speciesType],
      ["saved_searches", "market_category", ENUMS.productCategory],
      ["notifications", "type", ENUMS.notificationType],
      ["cities", "status", ENUMS.cityLifecycleStatus],
      ["vet_clinics", "source", ENUMS.vetClinicSource],
      ["admin_users", "role", ENUMS.adminRole],
      ["moderation_actions", "action_type", ENUMS.moderationActionType],
      ["moderation_actions", "target_type", ENUMS.moderationTargetType],
    ];
    for (const [table, property, expected] of expectations) {
      assert.deepEqual(
        values(byTable[table], property),
        expected,
        `${table}.${property}`,
      );
    }
  });

  it("disables hard delete and bulk delete on every resource", () => {
    for (const resource of resources()) {
      assert.equal(
        resource.options.actions.delete.isAccessible,
        false,
        `${resource.resource.name}.delete`,
      );
      assert.equal(
        resource.options.actions.bulkDelete.isAccessible,
        false,
        `${resource.resource.name}.bulkDelete`,
      );
    }
  });

  it("enforces explicit listProperties on every registered resource to prevent automatic column fallback", () => {
    for (const resource of resources()) {
      const listProps = resource.options.listProperties;
      assert.ok(
        Array.isArray(listProps) && listProps.length >= 2 && listProps.length <= 10,
        `${resource.resource.name} must declare explicit listProperties with 2-10 columns (got ${JSON.stringify(listProps)})`,
      );
      // Ensure no raw coordinates or password hashes in list properties
      assert.ok(
        !listProps.includes("coordinates"),
        `${resource.resource.name} must not expose raw coordinates in listProperties`,
      );
      assert.ok(
        !listProps.includes("password_hash"),
        `${resource.resource.name} must not expose password_hash in listProperties`,
      );
    }
  });

  it("enforces explicit showProperties and filterProperties on every registered resource", () => {
    for (const resource of resources()) {
      const showProps = resource.options.showProperties;
      const filterProps = resource.options.filterProperties;
      assert.ok(
        Array.isArray(showProps) && showProps.length >= 2,
        `${resource.resource.name} must declare explicit showProperties`,
      );
      assert.ok(
        Array.isArray(filterProps) && filterProps.length >= 1,
        `${resource.resource.name} must declare explicit filterProperties`,
      );
      assert.ok(
        !showProps.includes("password_hash"),
        `${resource.resource.name} must not expose password_hash in showProperties`,
      );
      assert.ok(
        !filterProps.includes("password_hash"),
        `${resource.resource.name} must not expose password_hash in filterProperties`,
      );
    }
  });

  it("attaches cache invalidation hooks to enabled mutating actions and preserves existing after hooks", async () => {
    let invalidated = false;
    const cache = {
      invalidate: () => {
        invalidated = true;
      },
    };

    let existingAfterCalled = false;
    const testResource = {
      resource: { name: "test_res" },
      options: {
        actions: {
          delete: { isAccessible: false },
          edit: {
            after: (response) => {
              existingAfterCalled = true;
              return response;
            },
          },
          new: {},
        },
      },
    };

    const wrapped = (await import("./resource-helpers.js")).attachCacheInvalidation(
      testResource,
      cache,
    );

    // Disabled action is left alone
    assert.equal(wrapped.options.actions.delete.isAccessible, false);

    // New action gets invalidator hook
    const newRes = await wrapped.options.actions.new.after({
      notice: { type: "success" },
    });
    assert.equal(invalidated, true);
    assert.equal(newRes.notice.type, "success");

    // Edit action preserves existing hook and invalidates
    invalidated = false;
    const editHooks = Array.isArray(wrapped.options.actions.edit.after)
      ? wrapped.options.actions.edit.after
      : [wrapped.options.actions.edit.after];
    for (const hook of editHooks) {
      await hook({ notice: { type: "success" } });
    }
    assert.equal(existingAfterCalled, true);
    assert.equal(invalidated, true);

    // Failed action does not invalidate
    invalidated = false;
    for (const hook of editHooks) {
      await hook({ notice: { type: "error" } });
    }
    assert.equal(invalidated, false);
  });
});

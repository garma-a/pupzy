import { buildReadOnlyResource } from "./resource-helpers.js";

export function buildPostSavesResource(db) {
  return buildReadOnlyResource(db, "post_saves", {
    name: "Engagement",
    icon: "Activity",
  });
}

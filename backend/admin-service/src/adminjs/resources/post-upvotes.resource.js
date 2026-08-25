import { buildReadOnlyResource } from "./resource-helpers.js";

export function buildPostUpvotesResource(db) {
  return buildReadOnlyResource(db, "post_upvotes", {
    name: "Engagement",
    icon: "Activity",
  });
}

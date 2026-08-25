import { ENUMS } from "../enums.js";
import { buildReadOnlyResource, enumProperty } from "./resource-helpers.js";

export function buildPostReportsResource(db) {
  return buildReadOnlyResource(
    db,
    "post_reports",
    { name: "Moderation", icon: "Flag" },
    { reason: enumProperty(ENUMS.reportReason) },
    { sort: { sortBy: "created_at", direction: "desc" } },
  );
}

import { ENUMS } from "../enums.js";
import { buildReadOnlyResource, enumProperty } from "./resource-helpers.js";

export function buildNotificationsResource(db) {
  return buildReadOnlyResource(
    db,
    "notifications",
    { name: "User Activity", icon: "Users" },
    { type: enumProperty(ENUMS.notificationType) },
    { sort: { sortBy: "created_at", direction: "desc" } },
  );
}

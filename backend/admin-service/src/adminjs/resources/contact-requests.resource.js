import { ENUMS } from "../enums.js";
import { buildReadOnlyResource, enumProperty } from "./resource-helpers.js";

export function buildContactRequestsResource(db) {
  return buildReadOnlyResource(
    db,
    "contact_requests",
    { name: "User Activity", icon: "Users" },
    { status: enumProperty(ENUMS.requestStatus) },
  );
}

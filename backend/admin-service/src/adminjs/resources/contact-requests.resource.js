import { ENUMS } from "../enums.js";
import {
  attachShortUuid,
  buildReadOnlyResource,
  enumProperty,
  stripPopulatedPasswordHashes,
} from "./resource-helpers.js";

export function buildContactRequestsResource(db, components = {}) {
  const properties = {
    status: enumProperty(ENUMS.requestStatus, { isDisabled: true }),
    message: { isDisabled: true },
    responded_at: { isDisabled: true },
    created_at: { isDisabled: true },
  };

  attachShortUuid(
    properties,
    ["id", "post_id", "requester_id"],
    components,
    ["list", "show"],
  );

  return buildReadOnlyResource(
    db,
    "contact_requests",
    { name: "User Activity", icon: "Users" },
    properties,
    {
      sort: { sortBy: "created_at", direction: "desc" },
      listProperties: [
        "id",
        "post_id",
        "requester_id",
        "status",
        "responded_at",
        "created_at",
      ],
      showProperties: [
        "id",
        "post_id",
        "requester_id",
        "status",
        "message",
        "responded_at",
        "created_at",
      ],
      filterProperties: [
        "status",
        "post_id",
        "requester_id",
        "created_at",
      ],
      actions: {
        list: { after: stripPopulatedPasswordHashes },
        show: { after: stripPopulatedPasswordHashes },
      },
    },
  );
}

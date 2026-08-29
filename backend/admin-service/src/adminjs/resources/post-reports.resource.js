import { ENUMS } from "../enums.js";
import {
  attachShortUuid,
  buildReadOnlyResource,
  enumProperty,
  stripPopulatedPasswordHashes,
} from "./resource-helpers.js";

export function buildPostReportsResource(db, components = {}) {
  const properties = {
    reason: enumProperty(ENUMS.reportReason),
    details: { isDisabled: true },
    created_at: { isDisabled: true },
  };

  attachShortUuid(
    properties,
    ["id", "post_id", "reporter_id"],
    components,
    ["list", "show"],
  );

  return buildReadOnlyResource(
    db,
    "post_reports",
    { name: "Moderation", icon: "Flag" },
    properties,
    {
      sort: { sortBy: "created_at", direction: "desc" },
      listProperties: [
        "id",
        "post_id",
        "reporter_id",
        "reason",
        "created_at",
      ],
      showProperties: [
        "id",
        "post_id",
        "reporter_id",
        "reason",
        "details",
        "created_at",
      ],
      filterProperties: [
        "reason",
        "post_id",
        "reporter_id",
        "created_at",
      ],
      actions: {
        list: { after: stripPopulatedPasswordHashes },
        show: { after: stripPopulatedPasswordHashes },
      },
    },
  );
}

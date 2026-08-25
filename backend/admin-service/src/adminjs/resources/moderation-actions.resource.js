import { ENUMS } from "../enums.js";
import {
  buildReadOnlyResource,
  enumProperty,
  stripRecordParams,
} from "./resource-helpers.js";

const stripPopulatedPasswordHashes = (response) =>
  stripRecordParams(response, ["password_hash"]);

export function buildModerationActionsResource(db) {
  return buildReadOnlyResource(
    db,
    "moderation_actions",
    { name: "Admin Management", icon: "Lock" },
    {
      action_type: enumProperty(ENUMS.moderationActionType),
      target_type: enumProperty(ENUMS.moderationTargetType),
      created_at: { isDisabled: true },
    },
    {
      sort: { sortBy: "created_at", direction: "desc" },
      actions: {
        list: { after: stripPopulatedPasswordHashes },
        show: { after: stripPopulatedPasswordHashes },
      },
    },
  );
}

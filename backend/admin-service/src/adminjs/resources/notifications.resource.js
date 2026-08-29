import { ENUMS } from "../enums.js";
import {
  attachShortUuid,
  buildReadOnlyResource,
  enumProperty,
  stripPopulatedPasswordHashes,
} from "./resource-helpers.js";

export function buildNotificationsResource(db, components = {}) {
  const properties = {
    type: enumProperty(ENUMS.notificationType, { isDisabled: true }),
    title: { isTitle: true, isDisabled: true },
    body: { isDisabled: true },
    is_read: { isDisabled: true },
    created_at: { isDisabled: true },
  };

  attachShortUuid(
    properties,
    ["id", "recipient_id"],
    components,
    ["list", "show"],
  );
  attachShortUuid(
    properties,
    ["related_post_id", "related_contact_request_id", "related_application_id"],
    components,
    ["show"],
  );

  return buildReadOnlyResource(
    db,
    "notifications",
    { name: "User Activity", icon: "Users" },
    properties,
    {
      sort: { sortBy: "created_at", direction: "desc" },
      listProperties: [
        "id",
        "recipient_id",
        "type",
        "title",
        "is_read",
        "created_at",
      ],
      showProperties: [
        "id",
        "recipient_id",
        "type",
        "title",
        "body",
        "related_post_id",
        "related_contact_request_id",
        "related_application_id",
        "is_read",
        "created_at",
      ],
      filterProperties: [
        "id",
        "type",
        "is_read",
        "recipient_id",
        "created_at",
      ],
      actions: {
        list: { after: stripPopulatedPasswordHashes },
        show: { after: stripPopulatedPasswordHashes },
      },
    },
  );
}

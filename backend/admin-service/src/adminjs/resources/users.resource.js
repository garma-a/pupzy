import {
  buildBanUserAction,
  buildUnbanUserAction,
} from "../actions/ban-user.action.js";
import { noDeleteActions, stripRecordParams } from "./resource-helpers.js";

const stripPrivateFields = (response) =>
  stripRecordParams(response, [
    "phone_number",
    "last_known_location",
    "password_hash",
  ]);

export function buildUsersResource(db, pool, components, cache) {
  return {
    resource: db.table("users"),
    options: {
      navigation: { name: "Moderation", icon: "User" },
      properties: {
        id: { isTitle: true },
        phone_number: { isVisible: false },
        last_known_location: { isVisible: false },
        post_count: { isDisabled: true },
        rescue_post_count: { isDisabled: true },
        lost_post_count: { isDisabled: true },
        adoption_post_count: { isDisabled: true },
        product_post_count: { isDisabled: true },
        is_banned: { isDisabled: true },
        banned_at: { isDisabled: true },
        ban_reason: { isDisabled: true },
        banned_by_admin_id: { isDisabled: true },
        created_at: { isDisabled: true },
        updated_at: { isDisabled: true },
      },
      actions: {
        ...noDeleteActions,
        new: { isAccessible: false },
        list: { after: stripPrivateFields },
        search: { after: stripPrivateFields },
        show: { after: stripPrivateFields },
        edit: { after: stripPrivateFields },
        banUser: buildBanUserAction(pool, components.ModerationAction, cache),
        unbanUser: buildUnbanUserAction(pool, cache),
      },
      listProperties: [
        "id",
        "email",
        "full_name",
        "is_verified",
        "is_banned",
        "post_count",
        "created_at",
      ],
      filterProperties: [
        "email",
        "full_name",
        "is_banned",
        "is_verified",
        "home_city_id",
        "created_at",
      ],
    },
  };
}

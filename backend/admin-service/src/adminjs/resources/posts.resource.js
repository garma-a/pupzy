import { ENUMS } from "../enums.js";
import { buildPostActions } from "../actions/moderate-post.actions.js";
import {
  enumProperty,
  noDeleteActions,
  stripRecordParams,
} from "./resource-helpers.js";

const stripPopulatedPasswordHashes = (response) =>
  stripRecordParams(response, ["password_hash"]);

export function buildPostsResource(db, pool, components, cache) {
  return {
    resource: db.table("posts"),
    options: {
      navigation: { name: "Moderation", icon: "FileText" },
      properties: {
        id: { isTitle: true },
        post_type: enumProperty(ENUMS.postType),
        status: enumProperty(ENUMS.postStatus, { isDisabled: true }),
        moderation_status: enumProperty(ENUMS.moderationStatus, {
          isDisabled: true,
        }),
        urgency: enumProperty(ENUMS.urgencyTier),
        market_category: enumProperty(ENUMS.productCategory),
        effective_score: { isDisabled: true },
        upvote_count: { isDisabled: true },
        save_count: { isDisabled: true },
        view_count: { isDisabled: true },
        report_count: { isDisabled: true },
        moderation_reason: { isDisabled: true },
        moderated_at: { isDisabled: true },
        moderated_by_admin_id: { isDisabled: true },
        coordinates: {
          isVisible: { list: false, show: true, edit: false, filter: false },
        },
        created_at: { isDisabled: true },
        updated_at: { isDisabled: true },
      },
      actions: {
        ...noDeleteActions,
        new: { isAccessible: false },
        list: { after: stripPopulatedPasswordHashes },
        show: { after: stripPopulatedPasswordHashes },
        edit: { after: stripPopulatedPasswordHashes },
        ...buildPostActions(pool, components.ModerationAction, cache),
      },
      listProperties: [
        "id",
        "title",
        "post_type",
        "status",
        "moderation_status",
        "report_count",
        "created_at",
      ],
      filterProperties: [
        "id",
        "creator_id",
        "post_type",
        "status",
        "moderation_status",
        "urgency",
        "city_id",
        "created_at",
      ],
      sort: { sortBy: "created_at", direction: "desc" },
    },
  };
}

import { ENUMS } from "../enums.js";
import { enumProperty, noDeleteActions } from "./resource-helpers.js";

export function buildLostPostsResource(db) {
  return {
    resource: db.table("lost_posts"),
    options: {
      navigation: { name: "Post Details", icon: "Layers" },
      properties: {
        post_id: { isTitle: true, isDisabled: true },
        report_type: enumProperty(ENUMS.lostFoundType),
        species: enumProperty(ENUMS.speciesType),
        current_condition: enumProperty(ENUMS.foundAnimalCondition),
      },
      actions: noDeleteActions,
    },
  };
}

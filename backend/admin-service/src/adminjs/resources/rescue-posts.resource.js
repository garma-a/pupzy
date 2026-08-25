import { ENUMS } from "../enums.js";
import { enumProperty, noDeleteActions } from "./resource-helpers.js";

export function buildRescuePostsResource(db) {
  return {
    resource: db.table("rescue_posts"),
    options: {
      navigation: { name: "Post Details", icon: "Layers" },
      properties: {
        post_id: { isTitle: true, isDisabled: true },
        species: enumProperty(ENUMS.speciesType),
        reporter_role: enumProperty(ENUMS.reporterRole),
      },
      actions: noDeleteActions,
    },
  };
}

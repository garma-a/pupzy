import { ENUMS } from "../enums.js";
import { enumProperty, noDeleteActions } from "./resource-helpers.js";

export function buildMatingPostsResource(db) {
  return {
    resource: db.table("mating_posts"),
    options: {
      navigation: { name: "Post Details", icon: "Layers" },
      properties: {
        post_id: { isTitle: true, isDisabled: true },
        species: enumProperty(ENUMS.speciesType),
        gender: enumProperty(ENUMS.genderType),
        age_unit: enumProperty(ENUMS.ageUnit),
      },
      actions: noDeleteActions,
    },
  };
}

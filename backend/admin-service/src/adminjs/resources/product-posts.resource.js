import { ENUMS } from "../enums.js";
import { enumProperty, noDeleteActions } from "./resource-helpers.js";

export function buildProductPostsResource(db) {
  return {
    resource: db.table("product_posts"),
    options: {
      navigation: { name: "Post Details", icon: "Layers" },
      properties: {
        post_id: { isTitle: true, isDisabled: true },
        category: enumProperty(ENUMS.productCategory),
        condition: enumProperty(ENUMS.productCondition),
      },
      actions: noDeleteActions,
    },
  };
}

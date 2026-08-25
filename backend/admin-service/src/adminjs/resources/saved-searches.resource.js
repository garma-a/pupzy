import { ENUMS } from "../enums.js";
import { buildReadOnlyResource, enumProperty } from "./resource-helpers.js";

export function buildSavedSearchesResource(db) {
  return buildReadOnlyResource(
    db,
    "saved_searches",
    { name: "User Activity", icon: "Users" },
    {
      post_type: enumProperty(ENUMS.postType),
      species: enumProperty(ENUMS.speciesType),
      market_category: enumProperty(ENUMS.productCategory),
    },
  );
}

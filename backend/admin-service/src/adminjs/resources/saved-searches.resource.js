import { ENUMS } from "../enums.js";
import {
  attachShortUuid,
  buildReadOnlyResource,
  enumProperty,
  stripPopulatedPasswordHashes,
} from "./resource-helpers.js";

export function buildSavedSearchesResource(db, components = {}) {
  const properties = {
    id: { isTitle: true, isDisabled: true },
    user_id: { isDisabled: true },
    city_id: {},
    post_type: enumProperty(ENUMS.postType, { isDisabled: true }),
    species: enumProperty(ENUMS.speciesType, { isDisabled: true }),
    market_category: enumProperty(ENUMS.productCategory, { isDisabled: true }),
    breed: { isDisabled: true },
    max_price: { isDisabled: true },
    created_at: { isDisabled: true },
  };

  attachShortUuid(properties, ["id", "user_id"], components, ["list", "show"]);

  return buildReadOnlyResource(
    db,
    "saved_searches",
    { name: "User Activity", icon: "Users" },
    properties,
    {
      sort: { sortBy: "created_at", direction: "desc" },
      listProperties: [
        "id",
        "user_id",
        "label",
        "post_type",
        "city_id",
        "species",
        "created_at",
      ],
      showProperties: [
        "id",
        "user_id",
        "label",
        "post_type",
        "city_id",
        "species",
        "breed",
        "market_category",
        "max_price",
        "created_at",
      ],
      filterProperties: [
        "id",
        "user_id",
        "post_type",
        "city_id",
        "species",
        "market_category",
        "created_at",
      ],
      actions: {
        list: { after: stripPopulatedPasswordHashes },
        show: { after: stripPopulatedPasswordHashes },
      },
    },
  );
}

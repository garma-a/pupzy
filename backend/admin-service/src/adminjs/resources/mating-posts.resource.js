import { ENUMS } from "../enums.js";
import {
  attachShortUuid,
  enumProperty,
  noDeleteActions,
  stripPopulatedPasswordHashes,
} from "./resource-helpers.js";

export function buildMatingPostsResource(db, components = {}) {
  const properties = {
    post_id: { isTitle: true, isDisabled: true },
    pet_name: {},
    species: enumProperty(ENUMS.speciesType),
    gender: enumProperty(ENUMS.genderType),
    breed: {},
    age_value: {},
    age_unit: enumProperty(ENUMS.ageUnit),
    is_purebred: {},
    has_pedigree_certificate: {},
    vaccinated: {},
    dewormed: {},
    terms_summary: {},
    mating_conditions: {},
  };

  attachShortUuid(properties, ["post_id"], components, ["list", "show"]);

  return {
    resource: db.table("mating_posts"),
    options: {
      navigation: { name: "Post Details", icon: "Layers" },
      properties,
      actions: {
        ...noDeleteActions,
        new: { isAccessible: false },
        list: { after: stripPopulatedPasswordHashes },
        show: { after: stripPopulatedPasswordHashes },
        edit: { after: stripPopulatedPasswordHashes },
      },
      listProperties: [
        "post_id",
        "pet_name",
        "species",
        "gender",
        "breed",
        "is_purebred",
        "has_pedigree_certificate",
      ],
      showProperties: [
        "post_id",
        "pet_name",
        "species",
        "gender",
        "breed",
        "age_value",
        "age_unit",
        "is_purebred",
        "has_pedigree_certificate",
        "vaccinated",
        "dewormed",
        "terms_summary",
        "mating_conditions",
      ],
      filterProperties: [
        "post_id",
        "species",
        "gender",
        "breed",
        "is_purebred",
        "has_pedigree_certificate",
        "vaccinated",
        "dewormed",
      ],
    },
  };
}

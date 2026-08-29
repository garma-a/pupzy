import { ENUMS } from "../enums.js";
import {
  attachShortUuid,
  enumProperty,
  noDeleteActions,
  stripPopulatedPasswordHashes,
} from "./resource-helpers.js";

export function buildAdoptionPostsResource(db, components = {}) {
  const properties = {
    post_id: { isTitle: true, isDisabled: true },
    pet_name: {},
    species: enumProperty(ENUMS.speciesType),
    gender: enumProperty(ENUMS.genderType),
    breed: {},
    age_value: {},
    age_unit: enumProperty(ENUMS.ageUnit),
    vaccinated: {},
    neutered: {},
    space_requirement: enumProperty(ENUMS.spaceRequirement),
    prior_pet_experience_required: {},
    personality_tags: {},
    health_notes: {},
    additional_requirements: {},
    currently_with: {},
  };

  attachShortUuid(properties, ["post_id"], components, ["list", "show"]);

  return {
    resource: db.table("adoption_posts"),
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
        "vaccinated",
        "neutered",
        "space_requirement",
      ],
      showProperties: [
        "post_id",
        "pet_name",
        "species",
        "gender",
        "breed",
        "age_value",
        "age_unit",
        "vaccinated",
        "neutered",
        "space_requirement",
        "prior_pet_experience_required",
        "personality_tags",
        "health_notes",
        "additional_requirements",
        "currently_with",
      ],
      filterProperties: [
        "post_id",
        "species",
        "gender",
        "breed",
        "vaccinated",
        "neutered",
        "space_requirement",
      ],
    },
  };
}

import { ENUMS } from "../enums.js";
import { buildReadOnlyResource, enumProperty } from "./resource-helpers.js";

export function buildAdoptionApplicationsResource(db) {
  return buildReadOnlyResource(
    db,
    "adoption_applications",
    { name: "User Activity", icon: "Users" },
    {
      status: enumProperty(ENUMS.requestStatus),
      species_preference: enumProperty(ENUMS.speciesType),
      gender_preference: enumProperty(ENUMS.genderType),
      living_situation: enumProperty(ENUMS.livingSituation),
    },
  );
}

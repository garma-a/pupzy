import { ENUMS, toAvailableValues } from "../enums.js";
import { readOnlyActions } from "./resource-helpers.js";

export function buildCitiesResource(db) {
  return {
    resource: db.table("cities"),
    options: {
      navigation: { name: "Reference Data", icon: "Map" },
      properties: {
        status: {
          availableValues: toAvailableValues(ENUMS.cityLifecycleStatus),
        },
        center_point: {
          isVisible: { list: false, show: true, edit: false, filter: false },
        },
      },
      actions: {
        ...readOnlyActions,
      },
    },
  };
}

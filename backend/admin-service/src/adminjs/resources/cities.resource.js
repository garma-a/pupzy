import { isSuperAdmin } from "../rbac.js";
import { noDeleteActions } from "./resource-helpers.js";

export function buildCitiesResource(db) {
  return {
    resource: db.table("cities"),
    options: {
      navigation: { name: "Reference Data", icon: "Map" },
      properties: {
        center_point: {
          isVisible: { list: false, show: true, edit: false, filter: false },
        },
      },
      actions: {
        ...noDeleteActions,
        edit: { isAccessible: isSuperAdmin },
      },
    },
  };
}

import { ENUMS, toAvailableValues } from "../enums.js";
import { readOnlyActions } from "./resource-helpers.js";

export function buildCitiesResource(db) {
  return {
    resource: db.table("cities"),
    options: {
      navigation: { name: "Reference Data", icon: "Map" },
      properties: {
        id: { isTitle: false },
        name_english: { isTitle: true },
        name_arabic: {},
        governorate: {},
        source_code: {
          isVisible: { list: true, show: true, edit: false, filter: true },
        },
        source_name_english: {
          isVisible: { list: false, show: true, edit: false, filter: false },
        },
        source_name_arabic: {
          isVisible: { list: false, show: true, edit: false, filter: false },
        },
        status: {
          availableValues: toAvailableValues(ENUMS.cityLifecycleStatus),
          isVisible: { list: true, show: true, edit: false, filter: false },
        },
        center_point: {
          isVisible: { list: false, show: true, edit: false, filter: false },
        },
      },
      actions: {
        ...readOnlyActions,
        list: {
          before: async (request) => {
            request.query = {
              ...request.query,
              "filters.status": "OFFICIAL",
            };
            return request;
          },
        },
        show: {
          isAccessible: (context) => {
            const record = context.record;
            if (!record) return true;
            return record.params?.status === "OFFICIAL";
          },
        },
      },
      listProperties: [
        "name_english",
        "name_arabic",
        "governorate",
        "source_code",
        "status",
      ],
      showProperties: [
        "id",
        "source_code",
        "name_english",
        "name_arabic",
        "governorate",
        "source_name_english",
        "source_name_arabic",
        "status",
        "center_point",
        "created_at",
      ],
      filterProperties: [
        "name_english",
        "governorate",
        "source_code",
      ],
    },
  };
}

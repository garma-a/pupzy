import { ENUMS } from "../enums.js";
import { enumProperty, noDeleteActions } from "./resource-helpers.js";

function defaultManualSource(request) {
  if (request.method === "post")
    request.payload = {
      ...request.payload,
      source: request.payload?.source || "MANUAL",
    };
  return request;
}

export function buildVetClinicsResource(db) {
  return {
    resource: db.table("vet_clinics"),
    options: {
      navigation: { name: "Reference Data", icon: "Map" },
      properties: {
        source: enumProperty(ENUMS.vetClinicSource),
        coordinates: {
          isVisible: { list: false, show: true, edit: false, filter: false },
        },
      },
      actions: {
        ...noDeleteActions,
        new: { before: defaultManualSource },
      },
    },
  };
}

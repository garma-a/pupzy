import { BaseRecord, ResourceDecorator } from "adminjs";
import { ENUMS, toAvailableValues } from "../enums.js";
import {
  attachShortUuid,
  readOnlyActions,
  stripPopulatedPasswordHashes,
} from "./resource-helpers.js";

export function formatCityTitle(city) {
  if (!city) return "";
  const { name_english, name_arabic, governorate } = city;
  if (name_english && name_arabic && governorate) {
    return `${name_english} / ${name_arabic} (${governorate})`;
  }
  if (name_english && name_arabic) {
    return `${name_english} / ${name_arabic}`;
  }
  if (name_english && governorate) {
    return `${name_english} (${governorate})`;
  }
  return name_english || name_arabic || city.id || "";
}

export class CityRecord extends BaseRecord {
  title() {
    return formatCityTitle(this.params);
  }

  toJSON(currentAdmin) {
    const json = super.toJSON(currentAdmin);
    json.title = formatCityTitle(this.params);
    return json;
  }
}

const originalTitleOf = ResourceDecorator.prototype.titleOf;
ResourceDecorator.prototype.titleOf = function (record) {
  if (this._resource?.id() === "cities" || this.id() === "cities") {
    return formatCityTitle(record?.params);
  }
  return originalTitleOf.call(this, record);
};

export function buildCitiesResource(db, components = {}) {
  const table = db?.table ? db.table("cities") : db;
  if (table && typeof table === "object") {
    table.build = function (params) {
      return new CityRecord(params, this);
    };
  }

  const properties = {
    id: { isTitle: false, isDisabled: true },
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
    created_at: { isDisabled: true },
  };

  attachShortUuid(properties, ["id"], components, ["show"]);

  return {
    resource: table,
    options: {
      navigation: { name: "Reference Data", icon: "Map" },
      properties,
      actions: {
        ...readOnlyActions,
        list: {
          after: stripPopulatedPasswordHashes,
          before: async (request) => {
            request.query = {
              ...request.query,
              "filters.status": "OFFICIAL",
            };
            return request;
          },
        },
        search: {
          isVisible: false,
          handler: async (request, response, context) => {
            const { currentAdmin, resource } = context;
            const queryString =
              request.params?.query ??
              request.query?.query ??
              request.query?.q ??
              request.query?.["filters.name_english"] ??
              request.query?.["filters.name_arabic"] ??
              request.query?.["filters.governorate"] ??
              "";
            const q = String(queryString).trim();

            const knex = resource.knex(resource.tableName);
            let qb = knex.where("status", "OFFICIAL");
            if (q) {
              qb = qb.where((builder) => {
                builder
                  .whereILike("name_english", `%${q}%`)
                  .orWhereILike("name_arabic", `%${q}%`)
                  .orWhereILike("governorate", `%${q}%`);
              });
            }
            const rows = await qb.orderBy("name_english", "asc").limit(50);
            const records = rows.map((row) => resource.build(row));
            return {
              records: records.map((record) => {
                const json = record.toJSON(currentAdmin);
                json.title = formatCityTitle(record.params);
                return json;
              }),
            };
          },
        },
        show: {
          after: stripPopulatedPasswordHashes,
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

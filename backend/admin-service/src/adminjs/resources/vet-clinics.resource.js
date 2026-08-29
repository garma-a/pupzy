import crypto from "node:crypto";
import { ValidationError } from "adminjs";
import { ENUMS } from "../enums.js";
import {
  attachShortUuid,
  enumProperty,
  noDeleteActions,
  stripPopulatedPasswordHashes,
} from "./resource-helpers.js";
import {
  validateMappedLocation,
  isLocationModified,
  findNearestOfficialCity,
  checkCityDiscrepancy,
  readOverrideReason,
} from "./vet-clinics.location.js";
import { searchVetClinicAddress } from "./vet-clinics.geocoder.js";

const VET_CLINIC_COLUMNS = new Set([
  "id",
  "name_english",
  "name_arabic",
  "city_id",
  "area_name",
  "coordinates",
  "phone_number",
  "address",
  "address_english",
  "address_arabic",
  "website",
  "location_provenance",
  "location_captured_at",
  "source",
  "osm_id",
  "osm_type",
  "is_active",
  "created_at",
  "updated_at",
]);

function isAuthorizedToOverride(currentAdmin) {
  if (!currentAdmin) return false;
  const role = currentAdmin.role;
  const isActive = currentAdmin.is_active !== false;
  return (role === "ADMIN" || role === "SUPER_ADMIN") && isActive;
}

export function buildVetClinicsResource(
  db,
  poolOrComponents = {},
  componentsOrCache = {},
  cache = null,
) {
  let pool = null;
  let components = {};
  let statsCache = null;

  if (
    poolOrComponents &&
    (typeof poolOrComponents.connect === "function" ||
      typeof poolOrComponents.query === "function")
  ) {
    pool = poolOrComponents;
    components = componentsOrCache || {};
    statsCache = cache;
  } else if (
    poolOrComponents &&
    (poolOrComponents.ShortUuid ||
      poolOrComponents.MappedLocationEdit ||
      poolOrComponents.MappedLocationShow ||
      poolOrComponents.Dashboard)
  ) {
    components = poolOrComponents || {};
    statsCache = componentsOrCache;
  } else if (
    componentsOrCache &&
    (componentsOrCache.ShortUuid ||
      componentsOrCache.MappedLocationEdit ||
      componentsOrCache.MappedLocationShow)
  ) {
    pool = poolOrComponents;
    components = componentsOrCache;
    statsCache = cache;
  } else {
    components = poolOrComponents || {};
    statsCache =
      componentsOrCache && typeof componentsOrCache.invalidate === "function"
        ? componentsOrCache
        : cache;
  }

  const knex = db.table("cities")?.knex ?? db.table("vet_clinics")?.knex;

  async function getCityById(cityId) {
    if (!cityId) return null;
    if (pool) {
      const { rows } = await pool.query(
        `SELECT id, name_english, name_arabic, governorate, status FROM cities WHERE id = $1`,
        [cityId],
      );
      return rows[0] ?? null;
    }
    if (knex) {
      const rows = await knex("cities")
        .select("id", "name_english", "name_arabic", "governorate", "status")
        .where("id", cityId);
      return rows[0] ?? null;
    }
    return null;
  }

  async function getNearestCity(lat, lng) {
    return findNearestOfficialCity(pool || knex, lat, lng);
  }

  async function prepareNewPayload(request, context = {}) {
    if (request.method !== "post") return request;
    const payload = { ...(request.payload || {}) };
    const currentAdmin = context.currentAdmin;
    payload.id = payload.id || crypto.randomUUID();
    payload.source = payload.source || "MANUAL";

    // 1. Validate official City selection
    if (!payload.city_id) {
      throw new ValidationError({
        city_id: { message: "Must select an existing official City" },
      });
    }

    const city = await getCityById(payload.city_id);
    if (!city || city.status !== "OFFICIAL") {
      throw new ValidationError({
        city_id: { message: "Must select an existing official City" },
      });
    }

    // 2. Full Mapped Location validation on create
    const location = validateMappedLocation(payload);
    payload.coordinates = location.coordinatesStr;
    payload.address_english = location.address_english;
    payload.address_arabic = location.address_arabic;
    payload.address = location.address;
    payload.location_provenance =
      payload.location_provenance === "NOMINATIM" ? "NOMINATIM" : "MANUAL";
    payload.location_captured_at = new Date().toISOString();
    if (payload.osm_id !== undefined && payload.osm_id !== null && payload.osm_id !== "") {
      const rawOsm = String(payload.osm_id).trim();
      if (/^\d+$/.test(rawOsm)) {
        payload.osm_id = rawOsm;
      }
    }
    if (payload.osm_type !== undefined && payload.osm_type !== null) {
      payload.osm_type = String(payload.osm_type).trim();
    }

    // 3. Nearest official City & Discrepancy check
    const nearestCity = await getNearestCity(
      location.latitude,
      location.longitude,
    );
    const discrepancy = checkCityDiscrepancy(city, nearestCity);

    let overrideReason = null;
    if (discrepancy.isDiscrepant) {
      if (!isAuthorizedToOverride(currentAdmin)) {
        throw new ValidationError({
          override_reason: {
            message:
              "Only active administrators may override City disagreements.",
          },
        });
      }

      const reasonValue = payload.override_reason ?? payload.reason;
      const reasonResult = readOverrideReason(reasonValue);
      if (reasonResult.error) {
        throw new ValidationError({
          override_reason: {
            message: `${discrepancy.explanation} ${reasonResult.error}`,
          },
        });
      }
      overrideReason = reasonResult.reason;
    }

    request._discrepancyMeta = {
      selectedCity: city,
      nearestCity,
      discrepancy,
      overrideReason,
      location,
    };

    // Clean up transient fields not in the vet_clinics table schema
    delete payload.location_confirmed;
    delete payload.latitude;
    delete payload.longitude;
    delete payload["coordinates.latitude"];
    delete payload["coordinates.longitude"];
    delete payload.override_reason;
    delete payload.reason;

    request.payload = payload;
    return request;
  }

  async function prepareEditPayload(request, context = {}) {
    if (request.method !== "post") return request;
    const payload = { ...(request.payload || {}) };
    const recordId = request.params?.recordId;
    const currentAdmin = context.currentAdmin;

    let existing = null;
    if (recordId) {
      if (pool) {
        const { rows } = await pool.query(
          `SELECT * FROM vet_clinics WHERE id = $1`,
          [recordId],
        );
        existing = rows[0] ?? null;
      } else if (knex) {
        const rows = await knex("vet_clinics").where("id", recordId);
        existing = rows[0] ?? null;
      }
    }

    const locationChanged = isLocationModified(payload, existing);
    let selectedCity = null;
    let nearestCity = null;
    let discrepancy = { isDiscrepant: false };
    let overrideReason = null;
    let location = null;

    if (locationChanged) {
      const targetCityId = payload.city_id || existing?.city_id;
      if (!targetCityId) {
        throw new ValidationError({
          city_id: { message: "Must select an existing official City" },
        });
      }

      selectedCity = await getCityById(targetCityId);
      if (!selectedCity || selectedCity.status !== "OFFICIAL") {
        throw new ValidationError({
          city_id: { message: "Must select an existing official City" },
        });
      }

      location = validateMappedLocation(payload);
      payload.coordinates = location.coordinatesStr;
      payload.address_english = location.address_english;
      payload.address_arabic = location.address_arabic;
      payload.address = location.address;
      payload.location_provenance =
        payload.location_provenance === "NOMINATIM" ? "NOMINATIM" : "MANUAL";
      payload.location_captured_at = new Date().toISOString();
      if (payload.osm_id !== undefined && payload.osm_id !== null && payload.osm_id !== "") {
        const rawOsm = String(payload.osm_id).trim();
        if (/^\d+$/.test(rawOsm)) {
          payload.osm_id = rawOsm;
        }
      }
      if (payload.osm_type !== undefined && payload.osm_type !== null) {
        payload.osm_type = String(payload.osm_type).trim();
      }

      // Nearest official City & Discrepancy check
      nearestCity = await getNearestCity(
        location.latitude,
        location.longitude,
      );
      discrepancy = checkCityDiscrepancy(selectedCity, nearestCity);

      if (discrepancy.isDiscrepant) {
        if (!isAuthorizedToOverride(currentAdmin)) {
          throw new ValidationError({
            override_reason: {
              message:
                "Only active administrators may override City disagreements.",
            },
          });
        }

        const reasonValue = payload.override_reason ?? payload.reason;
        const reasonResult = readOverrideReason(reasonValue);
        if (reasonResult.error) {
          throw new ValidationError({
            override_reason: {
              message: `${discrepancy.explanation} ${reasonResult.error}`,
            },
          });
        }
        overrideReason = reasonResult.reason;
      }
    } else {
      // Non-location edit (e.g. imported clinic name/status edit)
      if (payload.city_id) {
        selectedCity = await getCityById(payload.city_id);
        if (!selectedCity || selectedCity.status !== "OFFICIAL") {
          throw new ValidationError({
            city_id: { message: "Must select an existing official City" },
          });
        }
      }

      if (
        !payload.address &&
        (payload.address_english || payload.address_arabic)
      ) {
        payload.address = payload.address_english || payload.address_arabic;
      }
    }

    request._discrepancyMeta = {
      locationChanged,
      selectedCity,
      nearestCity,
      discrepancy,
      overrideReason,
      location,
      existing,
    };

    // Clean up transient fields
    delete payload.location_confirmed;
    delete payload.latitude;
    delete payload.longitude;
    delete payload["coordinates.latitude"];
    delete payload["coordinates.longitude"];
    delete payload.override_reason;
    delete payload.reason;

    request.payload = payload;
    return request;
  }

    const properties = {
      id: { isTitle: false, isDisabled: true },
      name_english: { isTitle: true },
      name_arabic: {},
      city_id: {},
      source: enumProperty(ENUMS.vetClinicSource),
      coordinates: {
        components: {
          edit: components.MappedLocationEdit,
          show: components.MappedLocationShow,
        },
        custom: {
          tileUrl:
            process.env.MAP_TILE_URL ||
            "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          attribution:
            process.env.MAP_ATTRIBUTION ||
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          searchAttribution:
            process.env.NOMINATIM_ATTRIBUTION ||
            'Data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ODbL 1.0',
          searchEnabled:
            process.env.NOMINATIM_ENABLED !== "false" &&
            process.env.NOMINATIM_ENABLED !== false,
          minLat: parseFloat(process.env.EGYPT_MIN_LAT || "21.0"),
          maxLat: parseFloat(process.env.EGYPT_MAX_LAT || "32.0"),
          minLng: parseFloat(process.env.EGYPT_MIN_LNG || "24.0"),
          maxLng: parseFloat(process.env.EGYPT_MAX_LNG || "37.5"),
        },
        isVisible: { list: false, show: true, edit: true, filter: false },
      },
      address: {
        isVisible: { list: false, show: true, edit: false, filter: false },
      },
      address_english: {
        isVisible: { list: true, show: true, edit: true, filter: false },
      },
      address_arabic: {
        isVisible: { list: true, show: true, edit: true, filter: false },
      },
      location_provenance: {
        isVisible: { list: false, show: true, edit: false, filter: true },
      },
      location_captured_at: {
        isVisible: { list: false, show: true, edit: false, filter: false },
        isDisabled: true,
      },
      osm_type: {
        isVisible: { list: false, show: true, edit: false, filter: false },
        isDisabled: true,
      },
      osm_id: { isDisabled: true },
      created_at: { isDisabled: true },
      updated_at: { isDisabled: true },
    };

    attachShortUuid(properties, ["id"], components, ["show"]);

    return {
      resource: db.table("vet_clinics"),
      options: {
        navigation: { name: "Reference Data", icon: "Map" },
        properties,
        actions: {
          ...noDeleteActions,
          list: { after: stripPopulatedPasswordHashes },
          show: { after: stripPopulatedPasswordHashes },
          new: {
          before: prepareNewPayload,
          handler: async (request, response, context) => {
            const { resource, currentAdmin, h } = context;
            if (request.method !== "post") {
              const record = resource.build(request.payload || {});
              return { record: record.toJSON(currentAdmin) };
            }

            // If request._discrepancyMeta is already set by before hook, use it; otherwise run prepareNewPayload
            let payload = request.payload;
            let meta = request._discrepancyMeta;
            if (!meta) {
              const preparedReq = await prepareNewPayload(request, context);
              payload = preparedReq.payload;
              meta = preparedReq._discrepancyMeta || {};
            }

            if (pool) {
              const client = await pool.connect();
              try {
                await client.query("BEGIN");

                const insertKeys = Object.keys(payload).filter((k) =>
                  VET_CLINIC_COLUMNS.has(k),
                );
                const insertCols = insertKeys.map((k) => `"${k}"`).join(", ");
                const insertPlaceholders = insertKeys
                  .map((k, i) => {
                    if (k === "coordinates") {
                      return `ST_GeomFromEWKT($${i + 1})`;
                    }
                    return `$${i + 1}`;
                  })
                  .join(", ");
                const insertValues = insertKeys.map((k) => payload[k]);

                const { rows } = await client.query(
                  `INSERT INTO vet_clinics (${insertCols}) VALUES (${insertPlaceholders}) RETURNING *`,
                  insertValues,
                );
                const insertedClinic = rows[0];

                if (meta.discrepancy?.isDiscrepant) {
                  const auditId = crypto.randomUUID();
                  const detailsJson = JSON.stringify({
                    selected_city: meta.discrepancy.selectedCity,
                    nearest_city: meta.discrepancy.nearestCity,
                  });

                  await client.query(
                    `INSERT INTO vet_clinic_location_audits
                       (id, vet_clinic_id, admin_user_id, selected_city_id, nearest_city_id, coordinates, discrepancy_details, reason, created_at)
                     VALUES
                       ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, $9, now())`,
                    [
                      auditId,
                      insertedClinic.id,
                      currentAdmin?.id ?? null,
                      meta.selectedCity.id,
                      meta.nearestCity.id,
                      meta.location.longitude,
                      meta.location.latitude,
                      detailsJson,
                      meta.overrideReason,
                    ],
                  );
                }

                await client.query("COMMIT");
                statsCache?.invalidate();

                const record = resource.build(insertedClinic);
                return {
                  record: record.toJSON(currentAdmin),
                  redirectUrl: h?.resourceUrl
                    ? h.resourceUrl({ resourceId: resource.id() })
                    : undefined,
                  notice: {
                    message: "Successfully created record",
                    type: "success",
                  },
                };
              } catch (err) {
                await client.query("ROLLBACK").catch(() => {});
                throw err;
              } finally {
                client.release();
              }
            }

            // Fallback for knex
            if (knex) {
              const [inserted] = await knex("vet_clinics")
                .insert(payload)
                .returning("*");
              if (meta.discrepancy?.isDiscrepant) {
                await knex("vet_clinic_location_audits").insert({
                  id: crypto.randomUUID(),
                  vet_clinic_id: inserted.id,
                  admin_user_id: currentAdmin?.id ?? null,
                  selected_city_id: meta.selectedCity.id,
                  nearest_city_id: meta.nearestCity.id,
                  coordinates: knex.raw(
                    "ST_SetSRID(ST_MakePoint(?, ?), 4326)",
                    [meta.location.longitude, meta.location.latitude],
                  ),
                  discrepancy_details: JSON.stringify({
                    selected_city: meta.discrepancy.selectedCity,
                    nearest_city: meta.discrepancy.nearestCity,
                  }),
                  reason: meta.overrideReason,
                });
              }
              statsCache?.invalidate();
              const record = resource.build(inserted);
              return {
                record: record.toJSON(currentAdmin),
                redirectUrl: h?.resourceUrl
                  ? h.resourceUrl({ resourceId: resource.id() })
                  : undefined,
                notice: {
                  message: "Successfully created record",
                  type: "success",
                },
              };
            }

            const record = resource.build(payload);
            return {
              record: record.toJSON(currentAdmin),
              notice: {
                message: "Successfully created record",
                type: "success",
              },
            };
          },
        },
        edit: {
          before: prepareEditPayload,
          handler: async (request, response, context) => {
            const { resource, currentAdmin, h } = context;
            const recordId = request.params?.recordId;

            if (request.method !== "post") {
              const record = await resource.findOne(recordId);
              return { record: record?.toJSON(currentAdmin) };
            }

            let payload = request.payload;
            let meta = request._discrepancyMeta;
            if (!meta) {
              const preparedReq = await prepareEditPayload(request, context);
              payload = preparedReq.payload;
              meta = preparedReq._discrepancyMeta || {};
            }

            if (pool) {
              const client = await pool.connect();
              try {
                await client.query("BEGIN");

                const updateKeys = Object.keys(payload).filter(
                  (k) => k !== "id" && VET_CLINIC_COLUMNS.has(k),
                );
                let updatedClinic = meta.existing;

                if (updateKeys.length > 0) {
                  const setClauses = updateKeys
                    .map((k, i) => {
                      if (k === "coordinates") {
                        return `"${k}" = ST_GeomFromEWKT($${i + 2})`;
                      }
                      return `"${k}" = $${i + 2}`;
                    })
                    .join(", ");
                  const updateValues = [
                    recordId,
                    ...updateKeys.map((k) => payload[k]),
                  ];

                  const { rows } = await client.query(
                    `UPDATE vet_clinics SET ${setClauses}, updated_at = now() WHERE id = $1 RETURNING *`,
                    updateValues,
                  );
                  updatedClinic = rows[0] ?? meta.existing;
                }

                if (meta.locationChanged && meta.discrepancy?.isDiscrepant) {
                  const auditId = crypto.randomUUID();
                  const detailsJson = JSON.stringify({
                    selected_city: meta.discrepancy.selectedCity,
                    nearest_city: meta.discrepancy.nearestCity,
                  });

                  await client.query(
                    `INSERT INTO vet_clinic_location_audits
                       (id, vet_clinic_id, admin_user_id, selected_city_id, nearest_city_id, coordinates, discrepancy_details, reason, created_at)
                     VALUES
                       ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, $9, now())`,
                    [
                      auditId,
                      recordId,
                      currentAdmin?.id ?? null,
                      meta.selectedCity.id,
                      meta.nearestCity.id,
                      meta.location.longitude,
                      meta.location.latitude,
                      detailsJson,
                      meta.overrideReason,
                    ],
                  );
                }

                await client.query("COMMIT");
                statsCache?.invalidate();

                const record = resource.build(updatedClinic);
                return {
                  record: record.toJSON(currentAdmin),
                  redirectUrl: h?.resourceUrl
                    ? h.resourceUrl({ resourceId: resource.id() })
                    : undefined,
                  notice: {
                    message: "Successfully updated record",
                    type: "success",
                  },
                };
              } catch (err) {
                await client.query("ROLLBACK").catch(() => {});
                throw err;
              } finally {
                client.release();
              }
            }

            // Fallback for knex
            if (knex) {
              const [updated] = await knex("vet_clinics")
                .where("id", recordId)
                .update(payload)
                .returning("*");
              if (meta.locationChanged && meta.discrepancy?.isDiscrepant) {
                await knex("vet_clinic_location_audits").insert({
                  id: crypto.randomUUID(),
                  vet_clinic_id: recordId,
                  admin_user_id: currentAdmin?.id ?? null,
                  selected_city_id: meta.selectedCity.id,
                  nearest_city_id: meta.nearestCity.id,
                  coordinates: knex.raw(
                    "ST_SetSRID(ST_MakePoint(?, ?), 4326)",
                    [meta.location.longitude, meta.location.latitude],
                  ),
                  discrepancy_details: JSON.stringify({
                    selected_city: meta.discrepancy.selectedCity,
                    nearest_city: meta.discrepancy.nearestCity,
                  }),
                  reason: meta.overrideReason,
                });
              }
              statsCache?.invalidate();
              const record = resource.build(updated || meta.existing);
              return {
                record: record.toJSON(currentAdmin),
                redirectUrl: h?.resourceUrl
                  ? h.resourceUrl({ resourceId: resource.id() })
                  : undefined,
                notice: {
                  message: "Successfully updated record",
                  type: "success",
                },
              };
            }

            const record = resource.build(payload);
            return {
              record: record.toJSON(currentAdmin),
              notice: {
                message: "Successfully updated record",
                type: "success",
              },
            };
          },
        },
        searchAddress: {
          actionType: "resource",
          isVisible: false,
          isAccessible: ({ currentAdmin }) => {
            return !!currentAdmin && currentAdmin.is_active !== false;
          },
          handler: async (request, response, context) => {
            const query =
              request.params?.query ??
              request.query?.query ??
              request.query?.q ??
              request.payload?.query ??
              request.payload?.q ??
              "";

            const result = await searchVetClinicAddress({
              query: String(query),
              pool,
              knex,
              config: {
                url: process.env.NOMINATIM_URL,
                userAgent: process.env.NOMINATIM_USER_AGENT,
                attribution: process.env.NOMINATIM_ATTRIBUTION,
                enabled:
                  process.env.NOMINATIM_ENABLED !== "false" &&
                  process.env.NOMINATIM_ENABLED !== false,
                timeoutMs: parseInt(
                  process.env.NOMINATIM_TIMEOUT_MS || "5000",
                  10,
                ),
                rateLimitMs: parseInt(
                  process.env.NOMINATIM_RATE_LIMIT_MS || "1000",
                  10,
                ),
              },
            });

            return {
              results: result.results,
              source: result.source,
              attribution: result.attribution,
              query: result.query,
              error: result.error,
              message: result.message,
              disabled: result.disabled,
            };
          },
        },
      },
      listProperties: [
        "name_english",
        "name_arabic",
        "city_id",
        "phone_number",
        "address_english",
        "address_arabic",
        "source",
        "is_active",
      ],
      showProperties: [
        "id",
        "name_english",
        "name_arabic",
        "city_id",
        "area_name",
        "address",
        "address_english",
        "address_arabic",
        "phone_number",
        "website",
        "coordinates",
        "source",
        "osm_id",
        "osm_type",
        "location_provenance",
        "location_captured_at",
        "is_active",
        "created_at",
        "updated_at",
      ],
      filterProperties: [
        "name_english",
        "city_id",
        "source",
        "location_provenance",
        "is_active",
      ],
    },
  };
}

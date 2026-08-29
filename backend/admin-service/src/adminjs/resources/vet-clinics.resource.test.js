import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ValidationError } from "adminjs";

import { buildVetClinicsResource } from "./vet-clinics.resource.js";

describe("AdminJS Vet Clinics Resource", () => {
  const citiesMap = new Map([
    [
      "city-official-1",
      {
        id: "city-official-1",
        name_english: "Cairo",
        name_arabic: "القاهرة",
        governorate: "Cairo",
        status: "OFFICIAL",
        distance_km: 0.5,
      },
    ],
    [
      "city-official-2",
      {
        id: "city-official-2",
        name_english: "Giza",
        name_arabic: "الجيزة",
        governorate: "Giza",
        status: "OFFICIAL",
        distance_km: 1.2,
      },
    ],
    ["city-legacy-1", { id: "city-legacy-1", status: "LEGACY" }],
    ["city-retired-1", { id: "city-retired-1", status: "RETIRED" }],
  ]);

  const clinicsMap = new Map([
    [
      "clinic-imported-1",
      {
        id: "clinic-imported-1",
        name_english: "Imported ACE Clinic",
        city_id: "city-official-1",
        source: "OSM",
        location_provenance: "OSM",
        coordinates: "SRID=4326;POINT(32.6537 25.6792)",
        address_english: "Luxor Street",
        address_arabic: "شارع الأقصر",
        address: "Luxor Street",
      },
    ],
  ]);

  let nearestCityToReturn = citiesMap.get("city-official-1");

  const fakeKnex = (tableName) => {
    let whereCol = null;
    let whereVal = null;
    const queryBuilder = {
      select: () => queryBuilder,
      where: (col, val) => {
        whereCol = col;
        whereVal = val;
        return queryBuilder;
      },
      orderByRaw: () => queryBuilder,
      limit: () => queryBuilder,
      then: (resolve, reject) => {
        if (tableName === "cities") {
          if (whereCol === "id" && whereVal) {
            const found = citiesMap.get(whereVal);
            return Promise.resolve(found ? [found] : []).then(resolve, reject);
          }
          if (whereCol === "status") {
            return Promise.resolve(nearestCityToReturn ? [nearestCityToReturn] : []).then(resolve, reject);
          }
          const found = whereVal ? citiesMap.get(whereVal) : null;
          return Promise.resolve(found ? [found] : []).then(resolve, reject);
        }
        if (tableName === "vet_clinics") {
          const found = whereVal ? clinicsMap.get(whereVal) : null;
          return Promise.resolve(found ? [found] : []).then(resolve, reject);
        }
        return Promise.resolve([]).then(resolve, reject);
      },
    };
    return queryBuilder;
  };

  const db = {
    table: (name) => ({
      name,
      knex: fakeKnex,
    }),
  };

  const mockComponents = {
    MappedLocationEdit: "MappedLocationEdit",
    MappedLocationShow: "MappedLocationShow",
  };

  const adminContext = {
    currentAdmin: { id: "admin-1", role: "ADMIN", is_active: true },
  };

  const resource = buildVetClinicsResource(db, mockComponents);

  it("disables delete and bulkDelete actions", () => {
    const actions = resource.options.actions;
    assert.equal(actions.delete.isAccessible, false);
    assert.equal(actions.bulkDelete.isAccessible, false);
  });

  it("exposes bilingual address fields, coordinates component, and runtime config", () => {
    const props = resource.options.properties;
    assert.ok(props.address_english);
    assert.ok(props.address_arabic);
    assert.ok(props.location_provenance);
    assert.ok(props.location_captured_at);
    assert.ok(props.osm_type);
    assert.ok(props.coordinates);

    assert.equal(props.coordinates.components.edit, "MappedLocationEdit");
    assert.equal(props.coordinates.components.show, "MappedLocationShow");
    assert.ok(props.coordinates.custom.tileUrl);
    assert.ok(props.coordinates.custom.attribution);
    assert.equal(props.coordinates.custom.minLat, 21.0);
    assert.equal(props.coordinates.custom.maxLat, 32.0);

    assert.equal(props.address_english.isVisible.list, true);
    assert.equal(props.address_arabic.isVisible.list, true);
    assert.equal(props.coordinates.isVisible.list, false);
    assert.equal(props.coordinates.isVisible.show, true);
    assert.equal(props.coordinates.isVisible.edit, true);

    assert.ok(resource.options.listProperties.includes("address_english"));
    assert.ok(resource.options.listProperties.includes("address_arabic"));
    assert.ok(resource.options.listProperties.includes("city_id"));
    assert.ok(resource.options.showProperties.includes("location_provenance"));
    assert.ok(resource.options.showProperties.includes("location_captured_at"));
    assert.ok(resource.options.showProperties.includes("osm_type"));
  });

  it("new hook sets defaults for MANUAL source, provenance, capture time, and PostGIS coordinates", async () => {
    nearestCityToReturn = citiesMap.get("city-official-1");
    const newBeforeHook = resource.options.actions.new.before;
    assert.equal(typeof newBeforeHook, "function");

    const request = {
      method: "post",
      payload: {
        name_english: "Test Clinic",
        name_arabic: "عيادة تجريبية",
        city_id: "city-official-1",
        address_english: "123 Nile Rd",
        address_arabic: "١٢٣ طريق النيل",
        latitude: 30.0444,
        longitude: 31.2357,
        location_confirmed: true,
      },
    };

    const modified = await newBeforeHook(request, adminContext);
    assert.equal(modified.payload.source, "MANUAL");
    assert.equal(modified.payload.location_provenance, "MANUAL");
    assert.ok(modified.payload.location_captured_at);
    assert.equal(modified.payload.address_english, "123 Nile Rd");
    assert.equal(modified.payload.address_arabic, "١٢٣ طريق النيل");
    assert.equal(modified.payload.address, "123 Nile Rd");
    assert.equal(modified.payload.coordinates, "SRID=4326;POINT(31.2357 30.0444)");
    // Ensure transient form keys are removed
    assert.equal("location_confirmed" in modified.payload, false);
    assert.equal("latitude" in modified.payload, false);
    assert.equal("longitude" in modified.payload, false);
  });

  it("new hook rejects missing or empty city_id with ValidationError", async () => {
    const newBeforeHook = resource.options.actions.new.before;

    const request = {
      method: "post",
      payload: {
        name_english: "No City Clinic",
        city_id: "",
        address_english: "123 Nile Rd",
        address_arabic: "١٢٣ طريق النيل",
        latitude: 30.0444,
        longitude: 31.2357,
        location_confirmed: true,
      },
    };

    await assert.rejects(
      async () => newBeforeHook(request, adminContext),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.ok(err.propertyErrors.city_id);
        return true;
      },
    );
  });

  it("new hook rejects non-official (LEGACY / RETIRED / nonexistent) city_id", async () => {
    const newBeforeHook = resource.options.actions.new.before;

    const basePayload = {
      address_english: "123 Nile Rd",
      address_arabic: "١٢٣ طريق النيل",
      latitude: 30.0444,
      longitude: 31.2357,
      location_confirmed: true,
    };

    // 1. LEGACY city
    await assert.rejects(
      async () =>
        newBeforeHook(
          {
            method: "post",
            payload: { ...basePayload, city_id: "city-legacy-1" },
          },
          adminContext,
        ),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.city_id.message, /official/i);
        return true;
      },
    );

    // 2. RETIRED city
    await assert.rejects(
      async () =>
        newBeforeHook(
          {
            method: "post",
            payload: { ...basePayload, city_id: "city-retired-1" },
          },
          adminContext,
        ),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.city_id.message, /official/i);
        return true;
      },
    );

    // 3. Nonexistent city
    await assert.rejects(
      async () =>
        newBeforeHook(
          {
            method: "post",
            payload: { ...basePayload, city_id: "nonexistent-city-uuid" },
          },
          adminContext,
        ),
      (err) => {
        assert.ok(err instanceof ValidationError);
        return true;
      },
    );
  });

  it("new hook rejects missing confirmation", async () => {
    const newBeforeHook = resource.options.actions.new.before;

    await assert.rejects(
      async () =>
        newBeforeHook(
          {
            method: "post",
            payload: {
              city_id: "city-official-1",
              address_english: "123 Nile Rd",
              address_arabic: "١٢٣ طريق النيل",
              latitude: 30.0444,
              longitude: 31.2357,
              location_confirmed: false,
            },
          },
          adminContext,
        ),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.coordinates.message, /confirmed/i);
        return true;
      },
    );
  });

  it("new hook rejects blank bilingual addresses", async () => {
    const newBeforeHook = resource.options.actions.new.before;

    // Blank English
    await assert.rejects(
      async () =>
        newBeforeHook(
          {
            method: "post",
            payload: {
              city_id: "city-official-1",
              address_english: "   ",
              address_arabic: "١٢٣ طريق النيل",
              latitude: 30.0444,
              longitude: 31.2357,
              location_confirmed: true,
            },
          },
          adminContext,
        ),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.address_english.message, /English address/i);
        return true;
      },
    );

    // Blank Arabic
    await assert.rejects(
      async () =>
        newBeforeHook(
          {
            method: "post",
            payload: {
              city_id: "city-official-1",
              address_english: "123 Nile Rd",
              address_arabic: "",
              latitude: 30.0444,
              longitude: 31.2357,
              location_confirmed: true,
            },
          },
          adminContext,
        ),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.address_arabic.message, /Arabic address/i);
        return true;
      },
    );
  });

  it("new hook rejects out-of-bounds coordinates", async () => {
    const newBeforeHook = resource.options.actions.new.before;

    // Outside Egypt
    await assert.rejects(
      async () =>
        newBeforeHook(
          {
            method: "post",
            payload: {
              city_id: "city-official-1",
              address_english: "123 Nile Rd",
              address_arabic: "١٢٣ طريق النيل",
              latitude: 48.8566, // Paris
              longitude: 2.3522,
              location_confirmed: true,
            },
          },
          adminContext,
        ),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.coordinates.message, /Egypt region/i);
        return true;
      },
    );
  });

  it("discrepancy without override reason is rejected with informative ValidationError", async () => {
    nearestCityToReturn = citiesMap.get("city-official-2"); // Giza, while selected is Cairo
    const newBeforeHook = resource.options.actions.new.before;

    await assert.rejects(
      async () =>
        newBeforeHook(
          {
            method: "post",
            payload: {
              city_id: "city-official-1", // Cairo
              address_english: "Giza Border Clinic",
              address_arabic: "عيادة حدود الجيزة",
              latitude: 30.01,
              longitude: 31.20,
              location_confirmed: true,
            },
          },
          adminContext,
        ),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.ok(err.propertyErrors.override_reason);
        assert.match(err.propertyErrors.override_reason.message, /closest to Giza/);
        assert.match(err.propertyErrors.override_reason.message, /Cairo.*selected/);
        assert.match(err.propertyErrors.override_reason.message, /approximate centroids/);
        return true;
      },
    );
  });

  it("discrepancy with valid reason and active Admin succeeds", async () => {
    nearestCityToReturn = citiesMap.get("city-official-2"); // Giza
    const newBeforeHook = resource.options.actions.new.before;

    const modified = await newBeforeHook(
      {
        method: "post",
        payload: {
          city_id: "city-official-1", // Cairo
          address_english: "Giza Border Clinic",
          address_arabic: "عيادة حدود الجيزة",
          latitude: 30.01,
          longitude: 31.20,
          location_confirmed: true,
          override_reason: "Clinic is right on the border between Cairo and Giza.",
        },
      },
      adminContext,
    );

    assert.equal(modified.payload.city_id, "city-official-1");
    assert.equal(modified._discrepancyMeta.discrepancy.isDiscrepant, true);
    assert.equal(
      modified._discrepancyMeta.overrideReason,
      "Clinic is right on the border between Cairo and Giza.",
    );
  });

  it("discrepancy rejects inactive user or non-admin with permission error", async () => {
    nearestCityToReturn = citiesMap.get("city-official-2");
    const newBeforeHook = resource.options.actions.new.before;

    // Inactive user
    await assert.rejects(
      async () =>
        newBeforeHook(
          {
            method: "post",
            payload: {
              city_id: "city-official-1",
              address_english: "Border Clinic",
              address_arabic: "عيادة الحدود",
              latitude: 30.01,
              longitude: 31.20,
              location_confirmed: true,
              override_reason: "Border case reason",
            },
          },
          { currentAdmin: { id: "admin-inactive", role: "ADMIN", is_active: false } },
        ),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.override_reason.message, /active administrators/i);
        return true;
      },
    );
  });

  it("edit hook allows non-location edits of imported clinics without requiring location confirmation", async () => {
    const editBeforeHook = resource.options.actions.edit.before;
    assert.equal(typeof editBeforeHook, "function");

    const request = {
      method: "post",
      params: { recordId: "clinic-imported-1" },
      payload: {
        name_english: "Updated Imported Clinic Name",
        phone_number: "+201099887766",
        is_active: false,
      },
    };

    const modified = await editBeforeHook(request, adminContext);
    assert.equal(modified.payload.name_english, "Updated Imported Clinic Name");
    assert.equal(modified.payload.phone_number, "+201099887766");
  });

  it("edit hook enforces full Mapped Location confirmation and validation when location is modified", async () => {
    nearestCityToReturn = citiesMap.get("city-official-1");
    const editBeforeHook = resource.options.actions.edit.before;

    // Relocating without confirmation -> throws
    await assert.rejects(
      async () =>
        editBeforeHook(
          {
            method: "post",
            params: { recordId: "clinic-imported-1" },
            payload: {
              latitude: 30.0444,
              longitude: 31.2357,
              address_english: "New Maadi Location",
              address_arabic: "موقع المعادي الجديد",
              location_confirmed: false,
            },
          },
          adminContext,
        ),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.coordinates.message, /confirmed/i);
        return true;
      },
    );

    // Relocating with confirmation and matching city -> succeeds
    const validRelocate = await editBeforeHook(
      {
        method: "post",
        params: { recordId: "clinic-imported-1" },
        payload: {
          latitude: 29.9602,
          longitude: 31.2569,
          address_english: "New Maadi Location",
          address_arabic: "موقع المعادي الجديد",
          location_confirmed: true,
        },
      },
      adminContext,
    );

    assert.equal(validRelocate.payload.coordinates, "SRID=4326;POINT(31.2569 29.9602)");
    assert.equal(validRelocate.payload.location_provenance, "MANUAL");
    assert.ok(validRelocate.payload.location_captured_at);
    assert.equal(validRelocate.payload.address_english, "New Maadi Location");
  });

  it("exposes searchAddress resource action accessible only to active admins", async () => {
    const searchAction = resource.options.actions.searchAddress;
    assert.ok(searchAction, "Expected searchAddress action on vet_clinics resource");
    assert.equal(searchAction.actionType, "resource");
    assert.equal(searchAction.isVisible, false);

    // Active Admin -> accessible
    assert.equal(searchAction.isAccessible({ currentAdmin: { id: "a1", is_active: true } }), true);
    // Inactive Admin -> not accessible
    assert.equal(searchAction.isAccessible({ currentAdmin: { id: "a2", is_active: false } }), false);
    // Unauthenticated -> not accessible
    assert.equal(searchAction.isAccessible({ currentAdmin: null }), false);
  });

  it("new hook preserves location_provenance = NOMINATIM, osm_id, and osm_type from search selection", async () => {
    nearestCityToReturn = citiesMap.get("city-official-1");
    const newBeforeHook = resource.options.actions.new.before;

    const request = {
      method: "post",
      payload: {
        name_english: "Nominatim Sourced Clinic",
        name_arabic: "عيادة من نتائج البحث",
        city_id: "city-official-1",
        address_english: "10 Road 9, Maadi, Cairo",
        address_arabic: "١٠ شارع ٩، المعادي",
        latitude: 29.9602,
        longitude: 31.2569,
        location_confirmed: true,
        location_provenance: "NOMINATIM",
        osm_id: "123456789",
        osm_type: "node",
      },
    };

    const modified = await newBeforeHook(request, adminContext);
    assert.equal(modified.payload.location_provenance, "NOMINATIM");
    assert.equal(modified.payload.osm_id, "123456789");
    assert.equal(modified.payload.osm_type, "node");
  });

  it("enforces privacy boundary: users and posts resources do not expose searchAddress action", async () => {
    // Import other resource builders to verify absence of address search
    const { buildUsersResource } = await import("./users.resource.js");
    const { buildPostsResource } = await import("./posts.resource.js");
    const { buildRescuePostsResource } = await import("./rescue-posts.resource.js");
    const { buildLostPostsResource } = await import("./lost-posts.resource.js");
    const { buildAdoptionPostsResource } = await import("./adoption-posts.resource.js");

    const mockComps = {
      ModerationAction: "ModerationAction",
      ShortUuid: "ShortUuid",
    };
    const usersRes = buildUsersResource(db, null, mockComps);
    const postsRes = buildPostsResource(db, null, mockComps);
    const rescueRes = buildRescuePostsResource(db);
    const lostRes = buildLostPostsResource(db);
    const adoptRes = buildAdoptionPostsResource(db);

    assert.equal("searchAddress" in (usersRes.options.actions || {}), false);
    assert.equal("searchAddress" in (postsRes.options.actions || {}), false);
    assert.equal("searchAddress" in (rescueRes.options.actions || {}), false);
    assert.equal("searchAddress" in (lostRes.options.actions || {}), false);
    assert.equal("searchAddress" in (adoptRes.options.actions || {}), false);
  });
});

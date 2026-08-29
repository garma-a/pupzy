import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCitiesResource,
  formatCityTitle,
  CityRecord,
} from "./cities.resource.js";

const db = { table: (name) => ({ name }) };

describe("AdminJS Cities Resource", () => {
  const resource = buildCitiesResource(db);

  it("formats city titles across full, partial, and minimal parameter sets", () => {
    assert.equal(
      formatCityTitle({
        name_english: "Al Maadi",
        name_arabic: "المعادي",
        governorate: "Cairo",
      }),
      "Al Maadi / المعادي (Cairo)",
    );
    assert.equal(
      formatCityTitle({
        name_english: "Al Maadi",
        name_arabic: "المعادي",
      }),
      "Al Maadi / المعادي",
    );
    assert.equal(
      formatCityTitle({
        name_english: "Al Maadi",
        governorate: "Cairo",
      }),
      "Al Maadi (Cairo)",
    );
    assert.equal(
      formatCityTitle({
        name_english: "Al Maadi",
      }),
      "Al Maadi",
    );
    assert.equal(
      formatCityTitle({
        name_arabic: "المعادي",
      }),
      "المعادي",
    );
    assert.equal(
      formatCityTitle({
        id: "city-123",
      }),
      "city-123",
    );
    assert.equal(formatCityTitle(null), "");
    assert.equal(formatCityTitle(undefined), "");
  });

  it("CityRecord produces bilingual formatted title in title() and toJSON()", () => {
    const mockResource = {
      properties: () => [{ isTitle: () => false, isId: () => true, name: () => "id" }],
      decorate: () => ({
        titleOf: () => "Al Maadi",
        recordActions: () => [],
        bulkActions: () => [],
      }),
    };
    const record = new CityRecord(
      {
        id: "city-cairo-1",
        name_english: "Al Maadi",
        name_arabic: "المعادي",
        governorate: "Cairo",
        status: "OFFICIAL",
      },
      mockResource,
    );

    assert.equal(record.title(), "Al Maadi / المعادي (Cairo)");
    const json = record.toJSON();
    assert.equal(json.title, "Al Maadi / المعادي (Cairo)");
    assert.equal(json.id, "city-cairo-1");
  });

  it("disables all four mutation actions (new, edit, delete, bulkDelete) for every role including super-admin", () => {
    const actions = resource.options.actions;

    assert.equal(actions.new.isAccessible, false);
    assert.equal(actions.edit.isAccessible, false);
    assert.equal(actions.delete.isAccessible, false);
    assert.equal(actions.bulkDelete.isAccessible, false);

    // Verify when accessed by SUPER_ADMIN context, action accessibility remains disabled
    const superAdminContext = { currentAdmin: { role: "SUPER_ADMIN" } };
    assert.equal(typeof actions.new.isAccessible === "function" ? actions.new.isAccessible(superAdminContext) : actions.new.isAccessible, false);
    assert.equal(typeof actions.edit.isAccessible === "function" ? actions.edit.isAccessible(superAdminContext) : actions.edit.isAccessible, false);
    assert.equal(typeof actions.delete.isAccessible === "function" ? actions.delete.isAccessible(superAdminContext) : actions.delete.isAccessible, false);
    assert.equal(typeof actions.bulkDelete.isAccessible === "function" ? actions.bulkDelete.isAccessible(superAdminContext) : actions.bulkDelete.isAccessible, false);
  });

  it("forces list filter to status=OFFICIAL only", async () => {
    const listBeforeHook = resource.options.actions.list.before;
    assert.equal(typeof listBeforeHook, "function");

    const request = { query: { "filters.governorate": "Cairo" } };
    const modifiedRequest = await listBeforeHook(request);

    assert.equal(modifiedRequest.query["filters.status"], "OFFICIAL");
    assert.equal(modifiedRequest.query["filters.governorate"], "Cairo");
  });

  it("restricts show action to OFFICIAL cities only", () => {
    const showIsAccessible = resource.options.actions.show.isAccessible;
    assert.equal(typeof showIsAccessible, "function");

    assert.equal(
      showIsAccessible({ record: { params: { status: "OFFICIAL" } } }),
      true,
    );
    assert.equal(
      showIsAccessible({ record: { params: { status: "LEGACY" } } }),
      false,
    );
    assert.equal(
      showIsAccessible({ record: { params: { status: "RETIRED" } } }),
      false,
    );
  });

  it("exposes internal source information in properties and show views", () => {
    const properties = resource.options.properties;
    assert.ok(properties.source_code);
    assert.ok(properties.source_name_english);
    assert.ok(properties.source_name_arabic);

    assert.equal(properties.source_code.isVisible.show, true);
    assert.equal(properties.source_name_english.isVisible.show, true);
    assert.equal(properties.source_name_arabic.isVisible.show, true);

    assert.ok(resource.options.showProperties.includes("source_code"));
    assert.ok(resource.options.showProperties.includes("source_name_english"));
    assert.ok(resource.options.showProperties.includes("source_name_arabic"));
  });

  it("search action searches OFFICIAL cities and formats title with English, Arabic, and governorate across aliases", async () => {
    const searchHandler = resource.options.actions.search.handler;
    assert.equal(typeof searchHandler, "function");

    const sampleCities = [
      {
        id: "city-cairo-1",
        name_english: "Al Maadi",
        name_arabic: "المعادي",
        governorate: "Cairo",
        status: "OFFICIAL",
      },
    ];

    const capturedCalls = [];
    const fakeKnex = () => {
      const qb = {
        where: (...args) => {
          capturedCalls.push(args);
          if (typeof args[0] === "function") {
            const inner = {
              whereILike: () => inner,
              orWhereILike: () => inner,
            };
            args[0](inner);
          }
          return qb;
        },
        orderBy: () => qb,
        limit: () => Promise.resolve(sampleCities),
      };
      return qb;
    };

    const mockResource = {
      tableName: "cities",
      knex: fakeKnex,
      build: (row) => ({
        params: row,
        toJSON: () => ({ params: row, title: row.name_english, id: row.id }),
      }),
    };

    // 1. Search by params.query
    const result1 = await searchHandler(
      { params: { query: "Maadi" } },
      {},
      { currentAdmin: {}, resource: mockResource },
    );
    assert.equal(capturedCalls[0][0], "status");
    assert.equal(capturedCalls[0][1], "OFFICIAL");
    assert.equal(result1.records.length, 1);
    assert.equal(result1.records[0].title, "Al Maadi / المعادي (Cairo)");
    assert.equal(result1.records[0].params.id, "city-cairo-1");

    // 2. Search by Arabic filter alias
    const result2 = await searchHandler(
      { query: { "filters.name_arabic": "المعادي" } },
      {},
      { currentAdmin: {}, resource: mockResource },
    );
    assert.equal(result2.records.length, 1);
    assert.equal(result2.records[0].title, "Al Maadi / المعادي (Cairo)");

    // 3. Search by governorate filter alias
    const result3 = await searchHandler(
      { query: { "filters.governorate": "Cairo" } },
      {},
      { currentAdmin: {}, resource: mockResource },
    );
    assert.equal(result3.records.length, 1);
    assert.equal(result3.records[0].title, "Al Maadi / المعادي (Cairo)");
  });
});

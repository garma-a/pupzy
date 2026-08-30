import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildCitiesResource, formatCityTitle, CityPresentationWrapper } from './cities.resource.js';

const db = { table: (name) => ({ name }) };

describe('AdminJS Cities Resource', () => {
  const resource = buildCitiesResource(db);

  it('formats city titles across full, partial, and minimal parameter sets', () => {
    assert.equal(
      formatCityTitle({
        name_english: 'Al Maadi',
        name_arabic: 'المعادي',
        governorate: 'Cairo',
      }),
      'Al Maadi / المعادي (Cairo)',
    );
    assert.equal(
      formatCityTitle({
        name_english: 'Al Maadi',
        name_arabic: 'المعادي',
      }),
      'Al Maadi / المعادي',
    );
    assert.equal(
      formatCityTitle({
        name_english: 'Al Maadi',
        governorate: 'Cairo',
      }),
      'Al Maadi (Cairo)',
    );
    assert.equal(
      formatCityTitle({
        name_english: 'Al Maadi',
      }),
      'Al Maadi',
    );
    assert.equal(
      formatCityTitle({
        name_arabic: 'المعادي',
      }),
      'المعادي',
    );
    assert.equal(
      formatCityTitle({
        id: 'city-123',
      }),
      'city-123',
    );
    assert.equal(formatCityTitle(null), '');
    assert.equal(formatCityTitle(undefined), '');
  });

  it('CityPresentationWrapper produces bilingual formatted title in title() and toJSON()', () => {
    const mockResource = {
      properties: () => [{ isTitle: () => false, isId: () => true, name: () => 'id' }],
      decorate: () => ({
        titleOf: () => 'Al Maadi',
        recordActions: () => [],
        bulkActions: () => [],
      }),
    };
    const cityPresentationWrapper = new CityPresentationWrapper(
      {
        id: 'city-cairo-1',
        name_english: 'Al Maadi',
        name_arabic: 'المعادي',
        governorate: 'Cairo',
        status: 'OFFICIAL',
      },
      mockResource,
    );

    assert.equal(cityPresentationWrapper.title(), 'Al Maadi / المعادي (Cairo)');
    const json = cityPresentationWrapper.toJSON();
    assert.equal(json.title, 'Al Maadi / المعادي (Cairo)');
    assert.equal(json.id, 'city-cairo-1');
  });

  it('disables all four mutation actions (new, edit, delete, bulkDelete) for every role including super-admin', () => {
    const actions = resource.options.actions;

    assert.equal(actions.new.isAccessible, false);
    assert.equal(actions.edit.isAccessible, false);
    assert.equal(actions.delete.isAccessible, false);
    assert.equal(actions.bulkDelete.isAccessible, false);

    // Verify when accessed by SUPER_ADMIN context, action accessibility remains disabled
    const superAdminContext = { currentAdmin: { role: 'SUPER_ADMIN' } };
    assert.equal(
      typeof actions.new.isAccessible === 'function'
        ? actions.new.isAccessible(superAdminContext)
        : actions.new.isAccessible,
      false,
    );
    assert.equal(
      typeof actions.edit.isAccessible === 'function'
        ? actions.edit.isAccessible(superAdminContext)
        : actions.edit.isAccessible,
      false,
    );
    assert.equal(
      typeof actions.delete.isAccessible === 'function'
        ? actions.delete.isAccessible(superAdminContext)
        : actions.delete.isAccessible,
      false,
    );
    assert.equal(
      typeof actions.bulkDelete.isAccessible === 'function'
        ? actions.bulkDelete.isAccessible(superAdminContext)
        : actions.bulkDelete.isAccessible,
      false,
    );
  });

  it('forces list filter to status=OFFICIAL only', async () => {
    const listBeforeHook = resource.options.actions.list.before;
    assert.equal(typeof listBeforeHook, 'function');

    const request = { query: { 'filters.governorate': 'Cairo' } };
    const modifiedRequest = await listBeforeHook(request);

    assert.equal(modifiedRequest.query['filters.status'], 'OFFICIAL');
    assert.equal(modifiedRequest.query['filters.governorate'], 'Cairo');
  });

  it('allows show detail action for official, legacy, and retired cities', () => {
    const showIsAccessible = resource.options.actions.show.isAccessible;
    // show.isAccessible is undefined or accessible to all authenticated administrators
    if (typeof showIsAccessible === 'function') {
      assert.equal(showIsAccessible({ record: { params: { status: 'OFFICIAL' } } }), true);
      assert.equal(showIsAccessible({ record: { params: { status: 'LEGACY' } } }), true);
      assert.equal(showIsAccessible({ record: { params: { status: 'RETIRED' } } }), true);
    } else {
      assert.equal(showIsAccessible, undefined);
    }
  });

  it('exposes internal source information in properties and show views', () => {
    const properties = resource.options.properties;
    assert.ok(properties.source_code);
    assert.ok(properties.source_name_english);
    assert.ok(properties.source_name_arabic);

    assert.equal(properties.source_code.isVisible.show, true);
    assert.equal(properties.source_name_english.isVisible.show, true);
    assert.equal(properties.source_name_arabic.isVisible.show, true);

    assert.ok(resource.options.showProperties.includes('source_code'));
    assert.ok(resource.options.showProperties.includes('source_name_english'));
    assert.ok(resource.options.showProperties.includes('source_name_arabic'));
  });

  it('search action searches OFFICIAL cities and formats title with English, Arabic, and governorate across aliases', async () => {
    const searchHandler = resource.options.actions.search.handler;
    assert.equal(typeof searchHandler, 'function');

    const sampleCities = [
      {
        id: 'city-cairo-1',
        name_english: 'Al Maadi',
        name_arabic: 'المعادي',
        governorate: 'Cairo',
        status: 'OFFICIAL',
      },
    ];

    const capturedCalls = [];
    const fakeKnex = () => {
      const qb = {
        where: (...args) => {
          capturedCalls.push(args);
          if (typeof args[0] === 'function') {
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
      tableName: 'cities',
      knex: fakeKnex,
      build: (row) => ({
        params: row,
        toJSON: () => ({ params: row, title: row.name_english, id: row.id }),
      }),
    };

    // 1. Search by params.query
    const result1 = await searchHandler(
      { params: { query: 'Maadi' } },
      {},
      { currentAdmin: {}, resource: mockResource },
    );
    assert.equal(capturedCalls[0][0], 'status');
    assert.equal(capturedCalls[0][1], 'OFFICIAL');
    assert.equal(result1.records.length, 1);
    assert.equal(result1.records[0].title, 'Al Maadi / المعادي (Cairo)');
    assert.equal(result1.records[0].params.id, 'city-cairo-1');

    // 2. Search by Arabic filter alias
    const result2 = await searchHandler(
      { query: { 'filters.name_arabic': 'المعادي' } },
      {},
      { currentAdmin: {}, resource: mockResource },
    );
    assert.equal(result2.records.length, 1);
    assert.equal(result2.records[0].title, 'Al Maadi / المعادي (Cairo)');

    // 3. Search by governorate filter alias
    const result3 = await searchHandler(
      { query: { 'filters.governorate': 'Cairo' } },
      {},
      { currentAdmin: {}, resource: mockResource },
    );
    assert.equal(result3.records.length, 1);
    assert.equal(result3.records[0].title, 'Al Maadi / المعادي (Cairo)');
  });

  it('parseCenterPoint decodes WKT, comma strings, objects, and EWKB hex strings', async () => {
    const { parseCenterPoint } = await import('./cities.resource.js');

    // 1. WKT string
    const wkt = parseCenterPoint('SRID=4326;POINT(31.2357 30.0444)');
    assert.deepEqual(wkt, { lat: 30.0444, lng: 31.2357 });

    const wktPlain = parseCenterPoint('POINT(32.89 24.09)');
    assert.deepEqual(wktPlain, { lat: 24.09, lng: 32.89 });

    // 2. Comma string
    const comma = parseCenterPoint('30.0444, 31.2357');
    assert.deepEqual(comma, { lat: 30.0444, lng: 31.2357 });

    // 3. Object
    const obj = parseCenterPoint({ latitude: 30.0444, longitude: 31.2357 });
    assert.deepEqual(obj, { lat: 30.0444, lng: 31.2357 });

    // 4. EWKB hex string (PostGIS standard point: lng=31.2357, lat=30.0444)
    const hex = '0101000020e6100000ceaacfd5563c3f4041f163cc5d0b3e40';
    const decodedHex = parseCenterPoint(hex);
    assert.ok(decodedHex);
    assert.equal(decodedHex.lat, 30.0444);
    assert.equal(decodedHex.lng, 31.2357);

    // 5. Invalid values
    assert.equal(parseCenterPoint(null), null);
    assert.equal(parseCenterPoint(''), null);
    assert.equal(parseCenterPoint('invalid text'), null);
  });

  it('CityPresentationWrapper.toJSON formats center_point and populates latitude and longitude', () => {
    const mockResource = {
      id: () => 'cities',
      properties: () => [{ isTitle: () => false, isId: () => true, name: () => 'id' }],
      decorate: () => ({ titleOf: () => 'Cairo', recordActions: () => [], bulkActions: () => [] }),
    };

    const cityPresentationWrapper = new CityPresentationWrapper(
      {
        id: 'cairo-1',
        name_english: 'Cairo',
        name_arabic: 'القاهرة',
        governorate: 'Cairo',
        status: 'OFFICIAL',
        center_point: '0101000020e6100000ceaacfd5563c3f4041f163cc5d0b3e40',
      },
      mockResource,
    );

    const json = cityPresentationWrapper.toJSON();
    assert.equal(json.params.center_point, 'POINT(31.2357 30.0444)');
    assert.equal(json.params.latitude, 30.0444);
    assert.equal(json.params.longitude, 31.2357);
  });

  it('show.after hook formats center_point for record view', async () => {
    const showAfterHook = resource.options.actions.show.after;
    assert.equal(typeof showAfterHook, 'function');

    const mockResponse = {
      record: {
        params: {
          id: 'aswan-1',
          name_english: 'Aswan (Kism)',
          status: 'OFFICIAL',
          center_point: 'SRID=4326;POINT(32.89 24.09)',
        },
      },
    };

    const result = await showAfterHook(mockResponse, {}, {});
    assert.equal(result.record.params.center_point, 'POINT(32.89 24.09)');
    assert.equal(result.record.params.latitude, 24.09);
    assert.equal(result.record.params.longitude, 32.89);
  });
});

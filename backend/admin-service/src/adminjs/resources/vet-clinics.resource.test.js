import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError } from 'adminjs';

import { buildVetClinicsResource } from './vet-clinics.resource.js';

describe('AdminJS Vet Clinics Resource', () => {
  const citiesMap = new Map([
    [
      'city-official-1',
      {
        id: 'city-official-1',
        name_english: 'Cairo',
        name_arabic: 'القاهرة',
        governorate: 'Cairo',
        status: 'OFFICIAL',
        distance_km: 0.5,
      },
    ],
    [
      'city-official-2',
      {
        id: 'city-official-2',
        name_english: 'Giza',
        name_arabic: 'الجيزة',
        governorate: 'Giza',
        status: 'OFFICIAL',
        distance_km: 1.2,
      },
    ],
    ['city-legacy-1', { id: 'city-legacy-1', status: 'LEGACY' }],
    ['city-retired-1', { id: 'city-retired-1', status: 'RETIRED' }],
  ]);

  const clinicsMap = new Map([
    [
      'clinic-imported-1',
      {
        id: 'clinic-imported-1',
        name_english: 'Imported ACE Clinic',
        city_id: 'city-official-1',
        source: 'OSM',
        location_provenance: 'OSM',
        coordinates: 'SRID=4326;POINT(32.6537 25.6792)',
        address_english: 'Luxor Street',
        address_arabic: 'شارع الأقصر',
        address: 'Luxor Street',
      },
    ],
    [
      'clinic-imported-legacy-city',
      {
        id: 'clinic-imported-legacy-city',
        name_english: 'Imported Legacy City Clinic',
        city_id: 'city-legacy-1',
        source: 'OSM',
        location_provenance: 'OSM',
        coordinates: 'SRID=4326;POINT(32.6537 25.6792)',
        address_english: 'Luxor Street',
        address_arabic: null,
        address: 'Luxor Street',
      },
    ],
  ]);

  let nearestCityToReturn = citiesMap.get('city-official-1');

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
        if (tableName === 'cities') {
          if (whereCol === 'id' && whereVal) {
            const found = citiesMap.get(whereVal);
            return Promise.resolve(found ? [found] : []).then(resolve, reject);
          }
          if (whereCol === 'status') {
            return Promise.resolve(nearestCityToReturn ? [nearestCityToReturn] : []).then(resolve, reject);
          }
          const found = whereVal ? citiesMap.get(whereVal) : null;
          return Promise.resolve(found ? [found] : []).then(resolve, reject);
        }
        if (tableName === 'vet_clinics') {
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
    MappedLocationEdit: 'MappedLocationEdit',
    MappedLocationShow: 'MappedLocationShow',
  };

  const adminContext = {
    currentAdmin: { id: 'admin-1', role: 'ADMIN', is_active: true },
  };

  const resource = buildVetClinicsResource(db, mockComponents);

  it('disables delete and bulkDelete actions', () => {
    const actions = resource.options.actions;
    assert.equal(actions.delete.isAccessible, false);
    assert.equal(actions.bulkDelete.isAccessible, false);
  });

  it('exposes bilingual address fields, coordinates component, and runtime config', () => {
    const props = resource.options.properties;
    assert.ok(props.address_english);
    assert.ok(props.address_arabic);
    assert.ok(props.location_provenance);
    assert.ok(props.location_captured_at);
    assert.ok(props.osm_type);
    assert.ok(props.coordinates);

    assert.equal(props.coordinates.components.edit, 'MappedLocationEdit');
    assert.equal(props.coordinates.components.show, 'MappedLocationShow');
    assert.ok(props.coordinates.custom.tileUrl);
    assert.ok(props.coordinates.custom.attribution);
    assert.equal(props.coordinates.custom.minLat, 21.0);
    assert.equal(props.coordinates.custom.maxLat, 32.0);

    assert.equal(props.address_english.isVisible.list, true);
    assert.equal(props.address_arabic.isVisible.list, true);
    assert.equal(props.coordinates.isVisible.list, false);
    assert.equal(props.coordinates.isVisible.show, true);
    assert.equal(props.coordinates.isVisible.edit, true);

    assert.ok(resource.options.listProperties.includes('address_english'));
    assert.ok(resource.options.listProperties.includes('address_arabic'));
    assert.ok(resource.options.listProperties.includes('city_id'));
    assert.ok(resource.options.showProperties.includes('location_provenance'));
    assert.ok(resource.options.showProperties.includes('location_captured_at'));
    assert.ok(resource.options.showProperties.includes('osm_type'));
  });

  it('new hook sets defaults for MANUAL source, provenance, capture time, and PostGIS coordinates', async () => {
    nearestCityToReturn = citiesMap.get('city-official-1');
    const newBeforeHook = resource.options.actions.new.before;
    assert.equal(typeof newBeforeHook, 'function');

    const request = {
      method: 'post',
      payload: {
        name_english: 'Test Clinic',
        name_arabic: 'عيادة تجريبية',
        city_id: 'city-official-1',
        address_english: '123 Nile Rd',
        address_arabic: '١٢٣ طريق النيل',
        latitude: 30.0444,
        longitude: 31.2357,
        location_confirmed: true,
      },
    };

    const modified = await newBeforeHook(request, adminContext);
    assert.equal(modified.payload.source, 'MANUAL');
    assert.equal(modified.payload.location_provenance, 'MANUAL');
    assert.ok(modified.payload.location_captured_at);
    assert.equal(modified.payload.address_english, '123 Nile Rd');
    assert.equal(modified.payload.address_arabic, '١٢٣ طريق النيل');
    assert.equal(modified.payload.address, '123 Nile Rd');
    assert.equal(modified.payload.coordinates, 'SRID=4326;POINT(31.2357 30.0444)');
    // Ensure transient form keys are removed
    assert.equal('location_confirmed' in modified.payload, false);
    assert.equal('latitude' in modified.payload, false);
    assert.equal('longitude' in modified.payload, false);
  });

  it('new hook rejects missing or empty city_id with ValidationError', async () => {
    const newBeforeHook = resource.options.actions.new.before;

    const request = {
      method: 'post',
      payload: {
        name_english: 'No City Clinic',
        city_id: '',
        address_english: '123 Nile Rd',
        address_arabic: '١٢٣ طريق النيل',
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

  it('new hook rejects non-official (LEGACY / RETIRED / nonexistent) city_id', async () => {
    const newBeforeHook = resource.options.actions.new.before;

    const basePayload = {
      address_english: '123 Nile Rd',
      address_arabic: '١٢٣ طريق النيل',
      latitude: 30.0444,
      longitude: 31.2357,
      location_confirmed: true,
    };

    // 1. LEGACY city
    await assert.rejects(
      async () =>
        newBeforeHook(
          {
            method: 'post',
            payload: { ...basePayload, city_id: 'city-legacy-1' },
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
            method: 'post',
            payload: { ...basePayload, city_id: 'city-retired-1' },
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
            method: 'post',
            payload: { ...basePayload, city_id: 'nonexistent-city-uuid' },
          },
          adminContext,
        ),
      (err) => {
        assert.ok(err instanceof ValidationError);
        return true;
      },
    );
  });

  it('new hook rejects missing confirmation', async () => {
    const newBeforeHook = resource.options.actions.new.before;

    await assert.rejects(
      async () =>
        newBeforeHook(
          {
            method: 'post',
            payload: {
              city_id: 'city-official-1',
              address_english: '123 Nile Rd',
              address_arabic: '١٢٣ طريق النيل',
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

  it('new hook rejects blank bilingual addresses', async () => {
    const newBeforeHook = resource.options.actions.new.before;

    // Blank English
    await assert.rejects(
      async () =>
        newBeforeHook(
          {
            method: 'post',
            payload: {
              city_id: 'city-official-1',
              address_english: '   ',
              address_arabic: '١٢٣ طريق النيل',
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
            method: 'post',
            payload: {
              city_id: 'city-official-1',
              address_english: '123 Nile Rd',
              address_arabic: '',
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

  it('new hook rejects out-of-bounds coordinates', async () => {
    const newBeforeHook = resource.options.actions.new.before;

    // Outside Egypt
    await assert.rejects(
      async () =>
        newBeforeHook(
          {
            method: 'post',
            payload: {
              city_id: 'city-official-1',
              address_english: '123 Nile Rd',
              address_arabic: '١٢٣ طريق النيل',
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

  it('discrepancy without override reason is rejected with informative ValidationError', async () => {
    nearestCityToReturn = citiesMap.get('city-official-2'); // Giza, while selected is Cairo
    const newBeforeHook = resource.options.actions.new.before;

    await assert.rejects(
      async () =>
        newBeforeHook(
          {
            method: 'post',
            payload: {
              city_id: 'city-official-1', // Cairo
              address_english: 'Giza Border Clinic',
              address_arabic: 'عيادة حدود الجيزة',
              latitude: 30.01,
              longitude: 31.2,
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

  it('discrepancy with valid reason and active Admin succeeds', async () => {
    nearestCityToReturn = citiesMap.get('city-official-2'); // Giza
    const newBeforeHook = resource.options.actions.new.before;

    const modified = await newBeforeHook(
      {
        method: 'post',
        payload: {
          city_id: 'city-official-1', // Cairo
          address_english: 'Giza Border Clinic',
          address_arabic: 'عيادة حدود الجيزة',
          latitude: 30.01,
          longitude: 31.2,
          location_confirmed: true,
          override_reason: 'Clinic is right on the border between Cairo and Giza.',
        },
      },
      adminContext,
    );

    assert.equal(modified.payload.city_id, 'city-official-1');
    assert.equal(modified._discrepancyMeta.discrepancy.isDiscrepant, true);
    assert.equal(modified._discrepancyMeta.overrideReason, 'Clinic is right on the border between Cairo and Giza.');
  });

  it('discrepancy rejects inactive user or non-admin with permission error', async () => {
    nearestCityToReturn = citiesMap.get('city-official-2');
    const newBeforeHook = resource.options.actions.new.before;

    // Inactive user
    await assert.rejects(
      async () =>
        newBeforeHook(
          {
            method: 'post',
            payload: {
              city_id: 'city-official-1',
              address_english: 'Border Clinic',
              address_arabic: 'عيادة الحدود',
              latitude: 30.01,
              longitude: 31.2,
              location_confirmed: true,
              override_reason: 'Border case reason',
            },
          },
          { currentAdmin: { id: 'admin-inactive', role: 'ADMIN', is_active: false } },
        ),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.override_reason.message, /active administrators/i);
        return true;
      },
    );
  });

  it('edit hook allows non-location edits of imported clinics without requiring location confirmation', async () => {
    const editBeforeHook = resource.options.actions.edit.before;
    assert.equal(typeof editBeforeHook, 'function');

    const request = {
      method: 'post',
      params: { recordId: 'clinic-imported-1' },
      payload: {
        name_english: 'Updated Imported Clinic Name',
        phone_number: '+201099887766',
        is_active: false,
      },
    };

    const modified = await editBeforeHook(request, adminContext);
    assert.equal(modified.payload.name_english, 'Updated Imported Clinic Name');
    assert.equal(modified.payload.phone_number, '+201099887766');
    assert.equal(modified.payload.is_active, false);
    assert.equal('coordinates' in modified.payload, false);
  });

  it('edit hook allows non-location edits when form resubmits unchanged location fields (coordinates, city, addresses, unconfirmed checkbox)', async () => {
    const editBeforeHook = resource.options.actions.edit.before;

    const request = {
      method: 'post',
      params: { recordId: 'clinic-imported-1' },
      payload: {
        name_english: 'Updated Imported Clinic Full Form',
        phone_number: '+201011223344',
        city_id: 'city-official-1',
        coordinates: 'SRID=4326;POINT(32.6537 25.6792)',
        latitude: 25.6792,
        longitude: 32.6537,
        address_english: 'Luxor Street',
        address_arabic: 'شارع الأقصر',
        location_confirmed: false,
      },
    };

    const modified = await editBeforeHook(request, adminContext);
    assert.equal(modified.payload.name_english, 'Updated Imported Clinic Full Form');
    assert.equal(modified.payload.phone_number, '+201011223344');
    assert.equal('coordinates' in modified.payload, false);
    assert.equal('city_id' in modified.payload, false);
    assert.equal('address_english' in modified.payload, false);
    assert.equal('address_arabic' in modified.payload, false);
    assert.equal('location_confirmed' in modified.payload, false);
    assert.equal(modified._discrepancyMeta.locationChanged, false);
  });

  it('edit hook allows non-location edits on an imported clinic with a legacy city and missing Arabic address without requiring official city or address entry', async () => {
    const editBeforeHook = resource.options.actions.edit.before;

    const request = {
      method: 'post',
      params: { recordId: 'clinic-imported-legacy-city' },
      payload: {
        name_english: 'Updated Legacy City Clinic Name',
        city_id: 'city-legacy-1',
        coordinates: 'SRID=4326;POINT(32.6537 25.6792)',
        address_english: 'Luxor Street',
        address_arabic: '',
        location_confirmed: false,
      },
    };

    const modified = await editBeforeHook(request, adminContext);
    assert.equal(modified.payload.name_english, 'Updated Legacy City Clinic Name');
    assert.equal('coordinates' in modified.payload, false);
    assert.equal('city_id' in modified.payload, false);
    assert.equal(modified._discrepancyMeta.locationChanged, false);
  });

  it('edit hook enforces full Mapped Location confirmation and validation when location is modified', async () => {
    nearestCityToReturn = citiesMap.get('city-official-1');
    const editBeforeHook = resource.options.actions.edit.before;

    // Relocating without confirmation -> throws
    await assert.rejects(
      async () =>
        editBeforeHook(
          {
            method: 'post',
            params: { recordId: 'clinic-imported-1' },
            payload: {
              latitude: 30.0444,
              longitude: 31.2357,
              address_english: 'New Maadi Location',
              address_arabic: 'موقع المعادي الجديد',
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
        method: 'post',
        params: { recordId: 'clinic-imported-1' },
        payload: {
          latitude: 29.9602,
          longitude: 31.2569,
          address_english: 'New Maadi Location',
          address_arabic: 'موقع المعادي الجديد',
          location_confirmed: true,
        },
      },
      adminContext,
    );

    assert.equal(validRelocate.payload.coordinates, 'SRID=4326;POINT(31.2569 29.9602)');
    assert.equal(validRelocate.payload.location_provenance, 'MANUAL');
    assert.ok(validRelocate.payload.location_captured_at);
    assert.equal(validRelocate.payload.address_english, 'New Maadi Location');
  });

  it('exposes searchAddress resource action accessible only to active admins', async () => {
    const searchAction = resource.options.actions.searchAddress;
    assert.ok(searchAction, 'Expected searchAddress action on vet_clinics resource');
    assert.equal(searchAction.actionType, 'resource');
    assert.equal(searchAction.isVisible, false);

    // Active Admin -> accessible
    assert.equal(searchAction.isAccessible({ currentAdmin: { id: 'a1', is_active: true } }), true);
    // Inactive Admin -> not accessible
    assert.equal(searchAction.isAccessible({ currentAdmin: { id: 'a2', is_active: false } }), false);
    // Unauthenticated -> not accessible
    assert.equal(searchAction.isAccessible({ currentAdmin: null }), false);
  });

  it('new hook preserves location_provenance = NOMINATIM, osm_id, and osm_type from search selection', async () => {
    nearestCityToReturn = citiesMap.get('city-official-1');
    const newBeforeHook = resource.options.actions.new.before;

    const request = {
      method: 'post',
      payload: {
        name_english: 'Nominatim Sourced Clinic',
        name_arabic: 'عيادة من نتائج البحث',
        city_id: 'city-official-1',
        address_english: '10 Road 9, Maadi, Cairo',
        address_arabic: '١٠ شارع ٩، المعادي',
        latitude: 29.9602,
        longitude: 31.2569,
        location_confirmed: true,
        location_provenance: 'NOMINATIM',
        osm_id: '123456789',
        osm_type: 'node',
      },
    };

    const modified = await newBeforeHook(request, adminContext);
    assert.equal(modified.payload.location_provenance, 'NOMINATIM');
    assert.equal(modified.payload.osm_id, '123456789');
    assert.equal(modified.payload.osm_type, 'node');
  });

  it('enforces privacy boundary: users and posts resources do not expose searchAddress action', async () => {
    // Import other resource builders to verify absence of address search
    const { buildUsersResource } = await import('./users.resource.js');
    const { buildPostsResource } = await import('./posts.resource.js');
    const { buildRescuePostsResource } = await import('./rescue-posts.resource.js');
    const { buildLostPostsResource } = await import('./lost-posts.resource.js');
    const { buildAdoptionPostsResource } = await import('./adoption-posts.resource.js');

    const mockComps = {
      ModerationAction: 'ModerationAction',
      ShortUuid: 'ShortUuid',
    };
    const usersRes = buildUsersResource(db, null, mockComps);
    const postsRes = buildPostsResource(db, null, mockComps);
    const rescueRes = buildRescuePostsResource(db);
    const lostRes = buildLostPostsResource(db);
    const adoptRes = buildAdoptionPostsResource(db);

    assert.equal('searchAddress' in (usersRes.options.actions || {}), false);
    assert.equal('searchAddress' in (postsRes.options.actions || {}), false);
    assert.equal('searchAddress' in (rescueRes.options.actions || {}), false);
    assert.equal('searchAddress' in (lostRes.options.actions || {}), false);
    assert.equal('searchAddress' in (adoptRes.options.actions || {}), false);
  });

  describe('Atomic Transactional Validation and Persistence Contracts', () => {
    function makeMockPool({
      cityStatus = 'OFFICIAL',
      nearestCity = {
        id: 'city-official-2',
        name_english: 'Giza',
        governorate: 'Giza',
        status: 'OFFICIAL',
        distance_km: 1.2,
      },
      failOnAudit = false,
      failOnClinic = false,
      initialClinics = [],
    } = {}) {
      const operations = [];
      const clinics = new Map(initialClinics.map((c) => [c.id, { ...c }]));
      const audits = [];

      const client = {
        query: async (sql, params = []) => {
          operations.push({ sql, params });

          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
            return { rows: [] };
          }

          if (sql.includes('FROM cities WHERE id =')) {
            const cityId = params[0];
            if (cityId === 'nonexistent') return { rows: [] };
            return {
              rows: [
                {
                  id: cityId,
                  name_english: 'Cairo',
                  name_arabic: 'القاهرة',
                  governorate: 'Cairo',
                  status: cityStatus,
                },
              ],
            };
          }

          if (sql.includes('FROM cities') && sql.includes('center_point <->')) {
            return {
              rows: nearestCity ? [{ ...nearestCity }] : [],
            };
          }

          if (sql.includes('SELECT * FROM vet_clinics WHERE id =')) {
            const id = params[0];
            const clinic = clinics.get(id);
            return { rows: clinic ? [{ ...clinic }] : [] };
          }

          if (sql.includes('INSERT INTO vet_clinics')) {
            if (failOnClinic) throw new Error('DB Error: insert vet_clinics failed');
            const clinic = {
              id: params[0] || 'clinic-gen-1',
              name_english: params[1],
              name_arabic: params[2],
              city_id: params[3],
              coordinates: params[4],
              address_english: params[6],
              address_arabic: params[7],
              address: params[8],
              source: 'MANUAL',
            };
            clinics.set(clinic.id, clinic);
            return { rows: [clinic] };
          }

          if (sql.includes('UPDATE vet_clinics')) {
            if (failOnClinic) throw new Error('DB Error: update vet_clinics failed');
            const recordId = params[0];
            const clinic = { ...(clinics.get(recordId) || { id: recordId }), updated_at: new Date() };
            clinics.set(recordId, clinic);
            return { rows: [clinic] };
          }

          if (sql.includes('INSERT INTO vet_clinic_location_audits')) {
            if (failOnAudit) throw new Error('DB Error: audit write constraint failure');
            const audit = {
              id: params[0],
              vet_clinic_id: params[1],
              admin_user_id: params[2],
              selected_city_id: params[3],
              nearest_city_id: params[4],
              coordinates: `SRID=4326;POINT(${params[5]} ${params[6]})`,
              discrepancy_details: params[7],
              reason: params[8],
            };
            audits.push(audit);
            return { rows: [audit] };
          }

          return { rows: [] };
        },
        release: () => {
          operations.push({ sql: 'RELEASE' });
        },
      };

      const pool = {
        connect: async () => client,
        query: client.query,
        operations,
        clinics,
        audits,
      };

      return pool;
    }

    function makeMockKnex({
      cityStatus = 'OFFICIAL',
      nearestCity = {
        id: 'city-official-2',
        name_english: 'Giza',
        governorate: 'Giza',
        status: 'OFFICIAL',
        distance_km: 1.2,
      },
      failOnAudit = false,
      failOnClinic = false,
      initialClinics = [],
    } = {}) {
      const operations = [];
      const clinics = new Map(initialClinics.map((c) => [c.id, { ...c }]));
      const audits = [];

      const makeTrx = () => {
        const trx = (tableName) => {
          let whereCol, whereVal;
          const qb = {
            select: () => qb,
            where: (col, val) => {
              whereCol = col;
              whereVal = val;
              return qb;
            },
            forUpdate: () => qb,
            orderByRaw: () => qb,
            limit: () => qb,
            insert: (data) => {
              operations.push({ table: tableName, op: 'insert', data });
              if (tableName === 'vet_clinics') {
                if (failOnClinic) throw new Error('Knex insert vet_clinics failed');
                const inserted = { ...data, id: data.id || 'knex-clinic-1' };
                clinics.set(inserted.id, inserted);
                return {
                  returning: async () => [inserted],
                  then: (res, rej) => Promise.resolve([inserted]).then(res, rej),
                };
              }
              if (tableName === 'vet_clinic_location_audits') {
                if (failOnAudit) throw new Error('Knex insert vet_clinic_location_audits failed');
                audits.push(data);
                return Promise.resolve([data]);
              }
              return Promise.resolve([data]);
            },
            update: (data) => {
              operations.push({ table: tableName, op: 'update', data });
              if (tableName === 'vet_clinics') {
                if (failOnClinic) throw new Error('Knex update vet_clinics failed');
                const updated = { ...(clinics.get(whereVal) || { id: whereVal }), ...data };
                clinics.set(whereVal, updated);
                return {
                  returning: async () => [updated],
                  then: (res, rej) => Promise.resolve([updated]).then(res, rej),
                };
              }
              return Promise.resolve([data]);
            },
            then: (resolve, reject) => {
              if (tableName === 'cities') {
                if (whereCol === 'id') {
                  if (whereVal === 'nonexistent') return Promise.resolve([]).then(resolve, reject);
                  return Promise.resolve([
                    {
                      id: whereVal,
                      name_english: 'Cairo',
                      name_arabic: 'القاهرة',
                      governorate: 'Cairo',
                      status: cityStatus,
                    },
                  ]).then(resolve, reject);
                }
                if (whereCol === 'status') {
                  return Promise.resolve(nearestCity ? [{ ...nearestCity }] : []).then(resolve, reject);
                }
              }
              if (tableName === 'vet_clinics') {
                const clinic = clinics.get(whereVal);
                return Promise.resolve(clinic ? [{ ...clinic }] : []).then(resolve, reject);
              }
              return Promise.resolve([]).then(resolve, reject);
            },
          };
          return qb;
        };

        trx.raw = (sql, bindings) => ({ rawSql: sql, bindings });
        return trx;
      };

      const knex = (tableName) => makeTrx()(tableName);
      knex.raw = (sql, bindings) => ({ rawSql: sql, bindings });
      knex.transaction = async (callback) => {
        const trx = makeTrx();
        operations.push({ op: 'BEGIN_TRANSACTION' });
        try {
          const result = await callback(trx);
          operations.push({ op: 'COMMIT_TRANSACTION' });
          return result;
        } catch (err) {
          operations.push({ op: 'ROLLBACK_TRANSACTION', error: err });
          throw err;
        }
      };

      const mockDb = {
        table: (name) => ({
          name,
          knex,
        }),
      };

      return { db: mockDb, knex, operations, clinics, audits };
    }

    it('new handler with Pool creates clinic and audit atomically inside transaction when discrepant', async () => {
      const mockPool = makeMockPool();
      const res = buildVetClinicsResource(db, mockPool, mockComponents);

      const request = {
        method: 'post',
        payload: {
          name_english: 'Pool Discrepant Clinic',
          city_id: 'city-cairo',
          latitude: 30.01, // Giza is nearest
          longitude: 31.2,
          address_english: 'Giza Border St',
          address_arabic: 'شارع حدود الجيزة',
          location_confirmed: true,
          override_reason: 'Valid pool override reason',
        },
      };

      const context = {
        resource: {
          id: () => 'vet_clinics',
          build: (data) => ({ toJSON: () => ({ ...data }) }),
        },
        currentAdmin: { id: 'admin-super', role: 'SUPER_ADMIN', is_active: true },
      };

      const result = await res.options.actions.new.handler(request, {}, context);
      assert.equal(result.notice.type, 'success');

      // Verify transaction boundary
      const sqlList = mockPool.operations.map((o) => o.sql);
      assert.ok(sqlList.includes('BEGIN'));
      assert.ok(sqlList.includes('COMMIT'));
      assert.equal(sqlList.includes('ROLLBACK'), false);

      // Verify audit written
      assert.equal(mockPool.audits.length, 1);
      const audit = mockPool.audits[0];
      assert.equal(audit.admin_user_id, 'admin-super');
      assert.equal(audit.selected_city_id, 'city-cairo');
      assert.equal(audit.nearest_city_id, 'city-official-2');
      assert.equal(audit.reason, 'Valid pool override reason');
    });

    it('new handler with Pool rolls back transaction when audit write fails, leaving no clinic', async () => {
      const mockPool = makeMockPool({ failOnAudit: true });
      const res = buildVetClinicsResource(db, mockPool, mockComponents);

      const request = {
        method: 'post',
        payload: {
          name_english: 'Failing Audit Clinic',
          city_id: 'city-cairo',
          latitude: 30.01,
          longitude: 31.2,
          address_english: 'Border St',
          address_arabic: 'شارع الحدود',
          location_confirmed: true,
          override_reason: 'Valid reason but audit write will fail',
        },
      };

      const context = {
        resource: {
          id: () => 'vet_clinics',
          build: (data) => ({ toJSON: () => ({ ...data }) }),
        },
        currentAdmin: { id: 'admin-super', role: 'SUPER_ADMIN', is_active: true },
      };

      await assert.rejects(
        () => res.options.actions.new.handler(request, {}, context),
        /audit write constraint failure/,
      );

      const sqlList = mockPool.operations.map((o) => o.sql);
      assert.ok(sqlList.includes('BEGIN'));
      assert.ok(sqlList.includes('ROLLBACK'));
      assert.equal(sqlList.includes('COMMIT'), false);
      assert.equal(mockPool.audits.length, 0);
    });

    it('new handler with Pool rejects and rolls back if city status is non-official inside transaction', async () => {
      const mockPool = makeMockPool({ cityStatus: 'RETIRED' });
      const res = buildVetClinicsResource(db, mockPool, mockComponents);

      const request = {
        method: 'post',
        payload: {
          name_english: 'Retired City Clinic',
          city_id: 'city-retired',
          latitude: 30.04,
          longitude: 31.23,
          address_english: 'Some St',
          address_arabic: 'شارع ما',
          location_confirmed: true,
        },
      };

      const context = {
        resource: {
          id: () => 'vet_clinics',
          build: (data) => ({ toJSON: () => ({ ...data }) }),
        },
        currentAdmin: { id: 'admin-super', role: 'SUPER_ADMIN', is_active: true },
      };

      await assert.rejects(
        () => res.options.actions.new.handler(request, {}, context),
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.match(err.propertyErrors.city_id.message, /official/i);
          return true;
        },
      );

      const sqlList = mockPool.operations.map((o) => o.sql);
      assert.ok(sqlList.includes('BEGIN'));
      assert.ok(sqlList.includes('ROLLBACK'));
      assert.equal(sqlList.includes('COMMIT'), false);
    });

    it('new handler with Knex transaction creates clinic and audit atomically when discrepant', async () => {
      const { db: mockDb, operations, audits } = makeMockKnex();
      const res = buildVetClinicsResource(mockDb, mockComponents);

      const request = {
        method: 'post',
        payload: {
          name_english: 'Knex Discrepant Clinic',
          city_id: 'city-cairo',
          latitude: 30.01, // Giza nearest
          longitude: 31.2,
          address_english: 'Giza Border St',
          address_arabic: 'شارع حدود الجيزة',
          location_confirmed: true,
          override_reason: 'Valid knex override reason',
        },
      };

      const context = {
        resource: {
          id: () => 'vet_clinics',
          build: (data) => ({ toJSON: () => ({ ...data }) }),
        },
        currentAdmin: { id: 'admin-super', role: 'SUPER_ADMIN', is_active: true },
      };

      const result = await res.options.actions.new.handler(request, {}, context);
      assert.equal(result.notice.type, 'success');

      const ops = operations.map((o) => o.op);
      assert.ok(ops.includes('BEGIN_TRANSACTION'));
      assert.ok(ops.includes('COMMIT_TRANSACTION'));
      assert.equal(ops.includes('ROLLBACK_TRANSACTION'), false);

      assert.equal(audits.length, 1);
      const audit = audits[0];
      assert.equal(audit.admin_user_id, 'admin-super');
      assert.equal(audit.selected_city_id, 'city-cairo');
      assert.equal(audit.nearest_city_id, 'city-official-2');
      assert.equal(audit.reason, 'Valid knex override reason');
    });

    it('new handler with Knex transaction rolls back when audit write fails', async () => {
      const { db: mockDb, operations, audits } = makeMockKnex({ failOnAudit: true });
      const res = buildVetClinicsResource(mockDb, mockComponents);

      const request = {
        method: 'post',
        payload: {
          name_english: 'Knex Failing Audit Clinic',
          city_id: 'city-cairo',
          latitude: 30.01,
          longitude: 31.2,
          address_english: 'Border St',
          address_arabic: 'شارع الحدود',
          location_confirmed: true,
          override_reason: 'Will fail audit write in knex',
        },
      };

      const context = {
        resource: {
          id: () => 'vet_clinics',
          build: (data) => ({ toJSON: () => ({ ...data }) }),
        },
        currentAdmin: { id: 'admin-super', role: 'SUPER_ADMIN', is_active: true },
      };

      await assert.rejects(
        () => res.options.actions.new.handler(request, {}, context),
        /Knex insert vet_clinic_location_audits failed/,
      );

      const ops = operations.map((o) => o.op);
      assert.ok(ops.includes('BEGIN_TRANSACTION'));
      assert.ok(ops.includes('ROLLBACK_TRANSACTION'));
      assert.equal(ops.includes('COMMIT_TRANSACTION'), false);
      assert.equal(audits.length, 0);
    });

    it('edit handler with Pool updates clinic and creates audit atomically on discrepant relocation', async () => {
      const existingClinic = {
        id: 'clinic-to-relocate',
        name_english: 'Existing Clinic',
        city_id: 'city-cairo',
        coordinates: 'SRID=4326;POINT(31.23 30.04)',
        address_english: 'Old Cairo Address',
        address_arabic: 'عنوان القاهرة القديم',
        source: 'MANUAL',
      };

      const mockPool = makeMockPool({ initialClinics: [existingClinic] });
      const res = buildVetClinicsResource(db, mockPool, mockComponents);

      const request = {
        method: 'post',
        params: { recordId: 'clinic-to-relocate' },
        payload: {
          name_english: 'Relocated Clinic',
          city_id: 'city-cairo',
          latitude: 30.01, // Giza nearest
          longitude: 31.2,
          address_english: 'New Border Rd',
          address_arabic: 'طريق الحدود الجديد',
          location_confirmed: true,
          override_reason: 'Relocated near border with Giza',
        },
      };

      const context = {
        resource: {
          id: () => 'vet_clinics',
          build: (data) => ({ toJSON: () => ({ ...data }) }),
        },
        currentAdmin: { id: 'admin-super', role: 'SUPER_ADMIN', is_active: true },
      };

      const result = await res.options.actions.edit.handler(request, {}, context);
      assert.equal(result.notice.type, 'success');

      const sqlList = mockPool.operations.map((o) => o.sql);
      assert.ok(sqlList.includes('BEGIN'));
      assert.ok(sqlList.includes('COMMIT'));
      assert.equal(mockPool.audits.length, 1);
      assert.equal(mockPool.audits[0].vet_clinic_id, 'clinic-to-relocate');
      assert.equal(mockPool.audits[0].reason, 'Relocated near border with Giza');
    });

    it('edit handler with Pool rolls back relocation if audit write fails', async () => {
      const existingClinic = {
        id: 'clinic-to-fail-relocate',
        name_english: 'Existing Clinic',
        city_id: 'city-cairo',
        coordinates: 'SRID=4326;POINT(31.23 30.04)',
        address_english: 'Old Cairo Address',
        address_arabic: 'عنوان القاهرة القديم',
      };

      const mockPool = makeMockPool({
        initialClinics: [existingClinic],
        failOnAudit: true,
      });
      const res = buildVetClinicsResource(db, mockPool, mockComponents);

      const request = {
        method: 'post',
        params: { recordId: 'clinic-to-fail-relocate' },
        payload: {
          name_english: 'Relocated Clinic',
          city_id: 'city-cairo',
          latitude: 30.01,
          longitude: 31.2,
          address_english: 'New Border Rd',
          address_arabic: 'طريق الحدود الجديد',
          location_confirmed: true,
          override_reason: 'Will fail audit write in edit',
        },
      };

      const context = {
        resource: {
          id: () => 'vet_clinics',
          build: (data) => ({ toJSON: () => ({ ...data }) }),
        },
        currentAdmin: { id: 'admin-super', role: 'SUPER_ADMIN', is_active: true },
      };

      await assert.rejects(
        () => res.options.actions.edit.handler(request, {}, context),
        /audit write constraint failure/,
      );

      const sqlList = mockPool.operations.map((o) => o.sql);
      assert.ok(sqlList.includes('BEGIN'));
      assert.ok(sqlList.includes('ROLLBACK'));
      assert.equal(sqlList.includes('COMMIT'), false);
      assert.equal(mockPool.audits.length, 0);
    });

    it('edit handler with Knex transaction updates clinic and creates audit atomically on discrepant relocation', async () => {
      const existingClinic = {
        id: 'knex-clinic-relocate',
        name_english: 'Existing Knex Clinic',
        city_id: 'city-cairo',
        coordinates: 'SRID=4326;POINT(31.23 30.04)',
        address_english: 'Old Address',
        address_arabic: 'عنوان قديم',
      };

      const {
        db: mockDb,
        operations,
        audits,
      } = makeMockKnex({
        initialClinics: [existingClinic],
      });
      const res = buildVetClinicsResource(mockDb, mockComponents);

      const request = {
        method: 'post',
        params: { recordId: 'knex-clinic-relocate' },
        payload: {
          name_english: 'Updated Knex Clinic',
          city_id: 'city-cairo',
          latitude: 30.01,
          longitude: 31.2,
          address_english: 'New Address',
          address_arabic: 'عنوان جديد',
          location_confirmed: true,
          override_reason: 'Knex relocation override reason',
        },
      };

      const context = {
        resource: {
          id: () => 'vet_clinics',
          build: (data) => ({ toJSON: () => ({ ...data }) }),
        },
        currentAdmin: { id: 'admin-super', role: 'SUPER_ADMIN', is_active: true },
      };

      const result = await res.options.actions.edit.handler(request, {}, context);
      assert.equal(result.notice.type, 'success');

      const ops = operations.map((o) => o.op);
      assert.ok(ops.includes('BEGIN_TRANSACTION'));
      assert.ok(ops.includes('COMMIT_TRANSACTION'));
      assert.equal(audits.length, 1);
      assert.equal(audits[0].vet_clinic_id, 'knex-clinic-relocate');
      assert.equal(audits[0].reason, 'Knex relocation override reason');
    });
  });
});

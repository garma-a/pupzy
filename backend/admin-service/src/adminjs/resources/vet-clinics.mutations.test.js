import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError } from 'adminjs';

import {
  PostgresVetClinicPersistenceAdapter,
  KnexVetClinicPersistenceAdapter,
  createVetClinicPersistenceAdapter,
  executeVetClinicTransaction,
  createVetClinicCommand,
  updateVetClinicCommand,
  createClinicInTransaction,
  updateClinicInTransaction,
  getCityById,
  getClinicById,
  findAdminUserById,
  acquireCityCatalogRevisionFence,
  isAuthorizedToOverride,
} from './vet-clinics.mutations.js';

describe('Vet Clinic Mutation Boundary & Persistence Adapters', () => {
  const sampleCityCairo = {
    id: 'city-cairo-uuid',
    name_english: 'Cairo',
    name_arabic: 'القاهرة',
    governorate: 'Cairo',
    status: 'OFFICIAL',
    distance_km: 0.2,
  };

  const sampleCityGiza = {
    id: 'city-giza-uuid',
    name_english: 'Giza',
    name_arabic: 'الجيزة',
    governorate: 'Giza',
    status: 'OFFICIAL',
    distance_km: 1.5,
  };

  const sampleCityRetired = {
    id: 'city-retired-uuid',
    name_english: 'Old District',
    name_arabic: 'منطقة قديمة',
    governorate: 'Cairo',
    status: 'RETIRED',
  };

  function createMockPgClient({
    cities = [sampleCityCairo, sampleCityGiza, sampleCityRetired],
    clinics = [],
    admins = [],
    failOnQuery = null,
  } = {}) {
    const executedQueries = [];
    const clinicsMap = new Map(clinics.map((c) => [c.id, { ...c }]));
    const adminsMap = new Map(admins.map((a) => [a.id, { ...a }]));
    const auditsList = [];

    const client = {
      query: async (sql, params = []) => {
        executedQueries.push({ sql, params });

        if (failOnQuery && sql.includes(failOnQuery)) {
          throw new Error(`Simulated PG DB Error on query matching "${failOnQuery}"`);
        }

        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [] };
        }

        if (sql.includes('UPDATE city_catalog_revisions')) {
          return { rows: [{ id: 1, revision: 2 }] };
        }

        if (sql.includes('FROM city_catalog_revisions')) {
          return { rows: [{ id: 1, revision: 1 }] };
        }

        if (sql.includes('FROM admin_users WHERE id =')) {
          const adminId = params[0];
          if (adminsMap.size > 0) {
            const found = adminsMap.get(adminId);
            return { rows: found ? [found] : [] };
          }
          return { rows: [{ id: adminId, email: 'admin@pupzy.app', role: 'ADMIN', is_active: true }] };
        }

        if (sql.includes('FROM cities WHERE id =')) {
          const cityId = params[0];
          const found = cities.find((c) => c.id === cityId);
          return { rows: found ? [found] : [] };
        }

        if (sql.includes('FROM cities') && sql.includes('center_point <->')) {
          const officialCities = cities.filter((c) => c.status === 'OFFICIAL');
          return { rows: officialCities.length > 0 ? [{ ...officialCities[0] }] : [] };
        }

        if (sql.includes('SELECT * FROM vet_clinics WHERE id =')) {
          const id = params[0];
          const found = clinicsMap.get(id);
          return { rows: found ? [{ ...found }] : [] };
        }

        if (sql.includes('INSERT INTO vet_clinics')) {
          const colMatch = sql.match(/INSERT INTO vet_clinics \((.*?)\)/);
          const cols = colMatch ? colMatch[1].split(',').map((c) => c.replace(/"/g, '').trim()) : [];
          const inserted = {
            source: 'MANUAL',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          cols.forEach((col, idx) => {
            inserted[col] = params[idx];
          });
          if (!inserted.id) inserted.id = 'pg-clinic-id-1';
          clinicsMap.set(inserted.id, inserted);
          return { rows: [inserted] };
        }

        if (sql.includes('UPDATE vet_clinics SET')) {
          const recordId = params[0];
          const existing = clinicsMap.get(recordId) || { id: recordId };
          const updated = {
            ...existing,
            updated_at: new Date().toISOString(),
          };
          clinicsMap.set(recordId, updated);
          return { rows: [updated] };
        }

        if (sql.includes('INSERT INTO vet_clinic_location_audits')) {
          const audit = {
            id: `mock-uuidv7-audit-${Date.now()}`,
            vet_clinic_id: params[0],
            admin_user_id: params[1],
            selected_city_id: params[2],
            nearest_city_id: params[3],
            coordinates: `SRID=4326;POINT(${params[4]} ${params[5]})`,
            discrepancy_details: params[6],
            reason: params[7],
            created_at: new Date().toISOString(),
          };
          auditsList.push(audit);
          return { rows: [audit] };
        }

        return { rows: [] };
      },
      release: () => {
        executedQueries.push({ sql: 'RELEASE', params: [] });
      },
    };

    return { client, executedQueries, clinicsMap, auditsList };
  }

  function createMockKnexTrx({
    cities = [sampleCityCairo, sampleCityGiza, sampleCityRetired],
    clinics = [],
    admins = [],
    failOnTable = null,
  } = {}) {
    const executedOps = [];
    const clinicsMap = new Map(clinics.map((c) => [c.id, { ...c }]));
    const adminsMap = new Map(admins.map((a) => [a.id, { ...a }]));
    const auditsList = [];

    const trx = (tableName) => {
      let whereCol, whereVal;
      let forShareCalled = false;
      let forUpdateCalled = false;

      const qb = {
        select: (...cols) => {
          executedOps.push({ op: 'select', table: tableName, cols });
          return qb;
        },
        where: (col, val) => {
          whereCol = col;
          whereVal = val;
          executedOps.push({ op: 'where', table: tableName, col, val });
          return qb;
        },
        forShare: () => {
          forShareCalled = true;
          executedOps.push({ op: 'forShare', table: tableName });
          return qb;
        },
        forUpdate: () => {
          forUpdateCalled = true;
          executedOps.push({ op: 'forUpdate', table: tableName });
          return qb;
        },
        orderByRaw: (rawSql, bindings) => {
          executedOps.push({ op: 'orderByRaw', table: tableName, rawSql, bindings });
          return qb;
        },
        limit: (n) => {
          executedOps.push({ op: 'limit', table: tableName, n });
          return qb;
        },
        insert: (data) => {
          executedOps.push({ op: 'insert', table: tableName, data });
          if (failOnTable === tableName) {
            throw new Error(`Simulated Knex DB Error on table "${tableName}"`);
          }

          if (tableName === 'vet_clinics') {
            const inserted = {
              ...data,
              id: data.id || 'knex-clinic-id-1',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            clinicsMap.set(inserted.id, inserted);
            return {
              returning: async () => [inserted],
              then: (res, rej) => Promise.resolve([inserted]).then(res, rej),
            };
          }

          if (tableName === 'vet_clinic_location_audits') {
            const audit = {
              ...data,
              id: `mock-uuidv7-audit-${Date.now()}`,
              created_at: new Date().toISOString(),
            };
            auditsList.push(audit);
            return {
              returning: async () => [audit],
              then: (res, rej) => Promise.resolve([audit]).then(res, rej),
            };
          }

          return Promise.resolve([data]);
        },
        update: (data) => {
          executedOps.push({ op: 'update', table: tableName, data, whereVal });
          if (failOnTable === tableName) {
            throw new Error(`Simulated Knex DB Error on update table "${tableName}"`);
          }

          if (tableName === 'vet_clinics') {
            const existing = clinicsMap.get(whereVal) || { id: whereVal };
            const updated = { ...existing, ...data, updated_at: new Date().toISOString() };
            clinicsMap.set(whereVal, updated);
            return {
              returning: async () => [updated],
              then: (res, rej) => Promise.resolve([updated]).then(res, rej),
            };
          }

          return Promise.resolve([data]);
        },
        increment: (col, amount) => {
          executedOps.push({ op: 'increment', table: tableName, col, amount });
          return {
            returning: async () => [{ id: 1, revision: 2 }],
            then: (res, rej) => Promise.resolve([{ id: 1, revision: 2 }]).then(res, rej),
          };
        },
        then: (resolve, reject) => {
          if (tableName === 'city_catalog_revisions') {
            return Promise.resolve([{ id: 1, revision: 1 }]).then(resolve, reject);
          }
          if (tableName === 'admin_users') {
            if (adminsMap.size > 0) {
              const found = adminsMap.get(whereVal);
              return Promise.resolve(found ? [found] : []).then(resolve, reject);
            }
            return Promise.resolve([{ id: whereVal, email: 'admin@pupzy.app', role: 'ADMIN', is_active: true }]).then(
              resolve,
              reject,
            );
          }
          if (tableName === 'cities') {
            if (whereCol === 'id') {
              const found = cities.find((c) => c.id === whereVal);
              return Promise.resolve(found ? [found] : []).then(resolve, reject);
            }
            if (whereCol === 'status') {
              const official = cities.filter((c) => c.status === 'OFFICIAL');
              return Promise.resolve(official.length > 0 ? [official[0]] : []).then(resolve, reject);
            }
          }
          if (tableName === 'vet_clinics') {
            const found = clinicsMap.get(whereVal);
            return Promise.resolve(found ? [found] : []).then(resolve, reject);
          }
          return Promise.resolve([]).then(resolve, reject);
        },
      };

      return qb;
    };

    trx.raw = (sql, bindings) => {
      if (sql.includes('UPDATE city_catalog_revisions')) {
        return Promise.resolve({ rows: [{ id: 1, revision: 2 }] });
      }
      return { rawSql: sql, bindings };
    };

    return { trx, executedOps, clinicsMap, auditsList };
  }

  it('adapter factory detects Postgres and Knex handles and creates compliant persistence adapters', () => {
    const { client } = createMockPgClient();
    const { trx } = createMockKnexTrx();

    const pgAdapter = createVetClinicPersistenceAdapter(client, 'pg');
    const knexAdapter = createVetClinicPersistenceAdapter(trx, 'knex');

    assert.ok(pgAdapter instanceof PostgresVetClinicPersistenceAdapter);
    assert.ok(knexAdapter instanceof KnexVetClinicPersistenceAdapter);
    assert.equal(pgAdapter.type, 'pg');
    assert.equal(knexAdapter.type, 'knex');

    // Passing existing adapter returns itself
    assert.equal(createVetClinicPersistenceAdapter(pgAdapter), pgAdapter);
    assert.equal(createVetClinicPersistenceAdapter(knexAdapter), knexAdapter);
  });

  it('createVetClinicCommand validates official City selection and creates clinic with PostGIS geometry', async () => {
    const { client } = createMockPgClient();
    const adapter = new PostgresVetClinicPersistenceAdapter(client);

    const payload = {
      name_english: 'Garden City Vet',
      name_arabic: 'عيادة جاردن سيتي',
      city_id: 'city-cairo-uuid',
      latitude: 30.0444,
      longitude: 31.2357,
      address_english: '10 Nile St, Garden City',
      address_arabic: '١٠ شارع النيل، جاردن سيتي',
      location_confirmed: true,
    };

    const admin = { id: 'admin-1', role: 'ADMIN', is_active: true };
    const created = await createVetClinicCommand(adapter, payload, admin);

    assert.ok(created);
    assert.equal(created.name_english, 'Garden City Vet');
    assert.equal(created.source, 'MANUAL');
  });

  it('createVetClinicCommand rejects non-official (RETIRED) City selection inside transaction', async () => {
    const { client } = createMockPgClient();
    const adapter = new PostgresVetClinicPersistenceAdapter(client);

    const payload = {
      name_english: 'Old District Vet',
      name_arabic: 'عيادة الحي القديم',
      city_id: 'city-retired-uuid',
      latitude: 30.0444,
      longitude: 31.2357,
      address_english: '10 Old St',
      address_arabic: '١٠ شارع قديم',
      location_confirmed: true,
    };

    const admin = { id: 'admin-1', role: 'ADMIN', is_active: true };
    await assert.rejects(
      () => createVetClinicCommand(adapter, payload, admin),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.city_id.message, /official/i);
        return true;
      },
    );
  });

  it('createVetClinicCommand records audit log when City discrepancy is overridden by active administrator', async () => {
    // Nearest city will be Giza, but selected is Cairo
    const { client, auditsList } = createMockPgClient({
      cities: [sampleCityGiza, sampleCityCairo],
    });
    const adapter = new PostgresVetClinicPersistenceAdapter(client);

    const payload = {
      name_english: 'Border Vet',
      name_arabic: 'عيادة الحدود',
      city_id: 'city-cairo-uuid',
      latitude: 30.01,
      longitude: 31.2,
      address_english: 'Border St',
      address_arabic: 'شارع الحدود',
      location_confirmed: true,
      override_reason: 'Clinic is right on the boundary line between Cairo and Giza.',
    };

    const admin = { id: 'admin-1', role: 'SUPER_ADMIN', is_active: true };
    const created = await createVetClinicCommand(adapter, payload, admin);

    assert.ok(created);
    assert.equal(auditsList.length, 1);
    assert.equal(auditsList[0].vet_clinic_id, created.id);
    assert.equal(auditsList[0].admin_user_id, 'admin-1');
    assert.equal(auditsList[0].reason, 'Clinic is right on the boundary line between Cairo and Giza.');
  });

  it('updateVetClinicCommand preserves existing location fields for non-location edits of imported clinics', async () => {
    const existingClinic = {
      id: 'clinic-imported-ace',
      name_english: 'ACE Animal Care',
      city_id: 'city-cairo-uuid',
      source: 'OSM',
      location_provenance: 'OSM',
      coordinates: 'SRID=4326;POINT(32.6537 25.6792)',
      address_english: 'Luxor Road',
      address_arabic: 'طريق الأقصر',
      address: 'Luxor Road',
    };

    const { trx, clinicsMap } = createMockKnexTrx({
      clinics: [existingClinic],
    });
    const adapter = new KnexVetClinicPersistenceAdapter(trx);

    const updatePayload = {
      name_english: 'ACE Animal Care Updated',
      phone_number: '+201001234567',
    };

    const admin = { id: 'admin-1', role: 'ADMIN', is_active: true };
    const updated = await updateVetClinicCommand(adapter, 'clinic-imported-ace', updatePayload, admin);

    assert.ok(updated);
    assert.equal(updated.name_english, 'ACE Animal Care Updated');
    assert.equal(updated.phone_number, '+201001234567');
    // Location attributes remain intact
    assert.equal(updated.coordinates, 'SRID=4326;POINT(32.6537 25.6792)');
  });

  it('updateVetClinicCommand enforces full Mapped Location confirmation and logs audit on discrepant relocation', async () => {
    const existingClinic = {
      id: 'clinic-relocate-1',
      name_english: 'Cairo Clinic',
      city_id: 'city-cairo-uuid',
      coordinates: 'SRID=4326;POINT(31.2357 30.0444)',
      address_english: 'Old Cairo Address',
      address_arabic: 'عنوان القاهرة القديم',
    };

    const { trx, auditsList } = createMockKnexTrx({
      cities: [sampleCityGiza, sampleCityCairo],
      clinics: [existingClinic],
    });
    const adapter = new KnexVetClinicPersistenceAdapter(trx);

    const updatePayload = {
      city_id: 'city-cairo-uuid',
      latitude: 30.01,
      longitude: 31.2,
      address_english: 'New Relocated Address',
      address_arabic: 'عنوان الانتقال الجديد',
      location_confirmed: true,
      override_reason: 'Relocated near border with Giza.',
    };

    const admin = { id: 'admin-1', role: 'ADMIN', is_active: true };
    const updated = await updateVetClinicCommand(adapter, 'clinic-relocate-1', updatePayload, admin);

    assert.ok(updated);
    assert.equal(auditsList.length, 1);
    assert.equal(auditsList[0].vet_clinic_id, 'clinic-relocate-1');
    assert.equal(auditsList[0].reason, 'Relocated near border with Giza.');
  });

  it('executeVetClinicTransaction rolls back and releases connection when persistence fails in PostgreSQL pool', async () => {
    const mockPoolClient = createMockPgClient({ failOnQuery: 'INSERT INTO vet_clinics' });
    const mockPool = {
      connect: async () => mockPoolClient.client,
    };

    const payload = {
      name_english: 'Failing Clinic',
      city_id: 'city-cairo-uuid',
      latitude: 30.0444,
      longitude: 31.2357,
      address_english: '10 Nile St',
      address_arabic: '١٠ شارع النيل',
      location_confirmed: true,
    };

    await assert.rejects(
      () =>
        executeVetClinicTransaction(mockPool, async (adapter) => {
          return await createVetClinicCommand(adapter, payload, { role: 'ADMIN', is_active: true });
        }),
      /Simulated PG DB Error/,
    );

    const queryList = mockPoolClient.executedQueries.map((q) => q.sql);
    assert.ok(queryList.includes('BEGIN'));
    assert.ok(queryList.includes('ROLLBACK'));
    assert.equal(queryList.includes('COMMIT'), false);
    assert.ok(queryList.includes('RELEASE'));
  });

  it('backward-compatible helpers getCityById and getClinicById function equivalently with pool or knex', async () => {
    const existingClinic = {
      id: 'clinic-test-id',
      name_english: 'Test Clinic',
      city_id: 'city-cairo-uuid',
    };

    const { client } = createMockPgClient({ clinics: [existingClinic] });
    const { trx } = createMockKnexTrx({ clinics: [existingClinic] });

    // PG path
    const pgCity = await getCityById(client, 'city-cairo-uuid', true);
    const pgClinic = await getClinicById(client, 'clinic-test-id', true);
    assert.equal(pgCity.id, 'city-cairo-uuid');
    assert.equal(pgClinic.id, 'clinic-test-id');

    // Knex path
    const knexCity = await getCityById(trx, 'city-cairo-uuid', true);
    const knexClinic = await getClinicById(trx, 'clinic-test-id', true);
    assert.equal(knexCity.id, 'city-cairo-uuid');
    assert.equal(knexClinic.id, 'clinic-test-id');
  });

  it('executeVetClinicTransaction commits on success and rolls back on failure with Knex transaction', async () => {
    const { trx, executedOps } = createMockKnexTrx();
    let transactionCommitted = false;
    let transactionRolledBack = false;

    const mockKnex = {
      table: () => ({ knex: mockKnex }),
      transaction: async (callback) => {
        executedOps.push({ op: 'BEGIN_TRX' });
        try {
          const res = await callback(trx);
          executedOps.push({ op: 'COMMIT_TRX' });
          transactionCommitted = true;
          return res;
        } catch (err) {
          executedOps.push({ op: 'ROLLBACK_TRX', error: err });
          transactionRolledBack = true;
          throw err;
        }
      },
    };

    const payload = {
      name_english: 'Successful Knex Clinic',
      city_id: 'city-cairo-uuid',
      latitude: 30.0444,
      longitude: 31.2357,
      address_english: '10 Nile St',
      address_arabic: '١٠ شارع النيل',
      location_confirmed: true,
    };

    // 1. Success case commits
    const created = await executeVetClinicTransaction(mockKnex, async (adapter) => {
      return await createVetClinicCommand(adapter, payload, { role: 'ADMIN', is_active: true });
    });
    assert.ok(created);
    assert.equal(transactionCommitted, true);
    assert.equal(transactionRolledBack, false);

    // 2. Failure case rolls back
    const failingPayload = {
      name_english: 'Failing Knex Clinic',
      city_id: 'city-retired-uuid', // Retired city causes ValidationError
      latitude: 30.0444,
      longitude: 31.2357,
      address_english: '10 Nile St',
      address_arabic: '١٠ شارع النيل',
      location_confirmed: true,
    };

    await assert.rejects(
      () =>
        executeVetClinicTransaction(mockKnex, async (adapter) => {
          return await createVetClinicCommand(adapter, failingPayload, { role: 'ADMIN', is_active: true });
        }),
      (err) => err instanceof ValidationError,
    );

    assert.equal(transactionRolledBack, true);
  });

  it('proves PG and Knex persistence adapters find nearest official City with equivalent fields and distances', async () => {
    const { client } = createMockPgClient();
    const { trx } = createMockKnexTrx();

    const pgAdapter = new PostgresVetClinicPersistenceAdapter(client);
    const knexAdapter = new KnexVetClinicPersistenceAdapter(trx);

    const pgNearest = await pgAdapter.findNearestOfficialCity(30.0444, 31.2357, { forShare: true });
    const knexNearest = await knexAdapter.findNearestOfficialCity(30.0444, 31.2357, { forShare: true });

    assert.ok(pgNearest);
    assert.ok(knexNearest);
    assert.equal(pgNearest.id, knexNearest.id);
    assert.equal(pgNearest.name_english, knexNearest.name_english);
    assert.equal(pgNearest.status, 'OFFICIAL');
    assert.equal(knexNearest.status, 'OFFICIAL');
    assert.equal(typeof pgNearest.distance_km, 'number');
    assert.equal(typeof knexNearest.distance_km, 'number');
  });

  it('updateVetClinicCommand rejects when vet clinic record does not exist', async () => {
    const { client } = createMockPgClient({ clinics: [] });
    const adapter = new PostgresVetClinicPersistenceAdapter(client);

    await assert.rejects(
      () =>
        updateVetClinicCommand(
          adapter,
          'nonexistent-clinic-uuid',
          { name_english: 'Updated Name' },
          { role: 'ADMIN', is_active: true },
        ),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.ok(err.propertyErrors.id);
        assert.match(err.propertyErrors.id.message, /not found/i);
        return true;
      },
    );
  });

  it('createVetClinicCommand rejects missing confirmation, blank addresses, or invalid coordinates', async () => {
    const { client } = createMockPgClient();
    const adapter = new PostgresVetClinicPersistenceAdapter(client);
    const admin = { role: 'ADMIN', is_active: true };

    // 1. Missing confirmation
    await assert.rejects(
      () =>
        createVetClinicCommand(
          adapter,
          {
            city_id: 'city-cairo-uuid',
            latitude: 30.0444,
            longitude: 31.2357,
            address_english: '10 Nile St',
            address_arabic: '١٠ شارع النيل',
            location_confirmed: false,
          },
          admin,
        ),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.coordinates.message, /confirmed/i);
        return true;
      },
    );

    // 2. Blank English address
    await assert.rejects(
      () =>
        createVetClinicCommand(
          adapter,
          {
            city_id: 'city-cairo-uuid',
            latitude: 30.0444,
            longitude: 31.2357,
            address_english: '   ',
            address_arabic: '١٠ شارع النيل',
            location_confirmed: true,
          },
          admin,
        ),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.address_english.message, /English address/i);
        return true;
      },
    );

    // 3. Out-of-bounds coordinates
    await assert.rejects(
      () =>
        createVetClinicCommand(
          adapter,
          {
            city_id: 'city-cairo-uuid',
            latitude: 51.5074, // London
            longitude: -0.1278,
            address_english: '10 London Rd',
            address_arabic: '١٠ شارع لندن',
            location_confirmed: true,
          },
          admin,
        ),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.coordinates.message, /Egypt region/i);
        return true;
      },
    );
  });

  it('discrepancy override rejects inactive administrator or unauthorized role', async () => {
    const { client } = createMockPgClient({ cities: [sampleCityGiza, sampleCityCairo] });
    const adapter = new PostgresVetClinicPersistenceAdapter(client);

    const payload = {
      city_id: 'city-cairo-uuid', // Giza nearest
      latitude: 30.01,
      longitude: 31.2,
      address_english: 'Border St',
      address_arabic: 'شارع الحدود',
      location_confirmed: true,
      override_reason: 'Border reason',
    };

    // Inactive admin in session
    await assert.rejects(
      () => createVetClinicCommand(adapter, payload, { role: 'ADMIN', is_active: false }),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.override_reason.message, /active administrators/i);
        return true;
      },
    );

    // Non-admin role in session (e.g. VIEWER or MODERATOR)
    await assert.rejects(
      () => createVetClinicCommand(adapter, payload, { role: 'VIEWER', is_active: true }),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.override_reason.message, /active administrators/i);
        return true;
      },
    );
  });

  it('adapter methods findAdminUserById and acquireCityCatalogRevisionFence work across PG and Knex', async () => {
    const adminRecord = { id: 'admin-test-id', email: 'staff@pupzy.app', role: 'ADMIN', is_active: true };
    const { client } = createMockPgClient({ admins: [adminRecord] });
    const { trx } = createMockKnexTrx({ admins: [adminRecord] });

    const pgAdapter = new PostgresVetClinicPersistenceAdapter(client);
    const knexAdapter = new KnexVetClinicPersistenceAdapter(trx);

    // 1. acquireCityCatalogRevisionFence
    const pgRevision = await pgAdapter.acquireCityCatalogRevisionFence({ forShare: true });
    const knexRevision = await knexAdapter.acquireCityCatalogRevisionFence({ forShare: true });
    assert.equal(pgRevision.id, 1);
    assert.equal(pgRevision.revision, 1);
    assert.equal(knexRevision.id, 1);
    assert.equal(knexRevision.revision, 1);

    // 2. findAdminUserById
    const pgAdmin = await pgAdapter.findAdminUserById('admin-test-id', { forShare: true });
    const knexAdmin = await knexAdapter.findAdminUserById('admin-test-id', { forShare: true });
    assert.ok(pgAdmin);
    assert.ok(knexAdmin);
    assert.equal(pgAdmin.id, 'admin-test-id');
    assert.equal(knexAdmin.id, 'admin-test-id');
    assert.equal(pgAdmin.role, 'ADMIN');
    assert.equal(knexAdmin.role, 'ADMIN');

    // 3. backward-compatible helper functions
    const helperPgRevision = await acquireCityCatalogRevisionFence(client, true);
    const helperKnexRevision = await acquireCityCatalogRevisionFence(trx, true);
    assert.equal(helperPgRevision.id, 1);
    assert.equal(helperKnexRevision.id, 1);

    const helperPgAdmin = await findAdminUserById(client, 'admin-test-id', true);
    const helperKnexAdmin = await findAdminUserById(trx, 'admin-test-id', true);
    assert.equal(helperPgAdmin.id, 'admin-test-id');
    assert.equal(helperKnexAdmin.id, 'admin-test-id');
  });

  it('discrepancy override queries administrator inside transaction and rejects when DB record is deactivated or demoted', async () => {
    const activeAdmin = { id: 'admin-active', email: 'active@pupzy.app', role: 'ADMIN', is_active: true };
    const deactivatedAdmin = {
      id: 'admin-deactivated',
      email: 'deactivated@pupzy.app',
      role: 'ADMIN',
      is_active: false,
    };
    const demotedAdmin = { id: 'admin-demoted', email: 'demoted@pupzy.app', role: 'VIEWER', is_active: true };

    const { client } = createMockPgClient({
      cities: [sampleCityGiza, sampleCityCairo],
      admins: [activeAdmin, deactivatedAdmin, demotedAdmin],
    });
    const adapter = new PostgresVetClinicPersistenceAdapter(client);

    const payload = {
      city_id: 'city-cairo-uuid', // Giza nearest
      latitude: 30.01,
      longitude: 31.2,
      address_english: 'Border St',
      address_arabic: 'شارع الحدود',
      location_confirmed: true,
      override_reason: 'Border clinic between Cairo and Giza.',
    };

    // 1. Session says active, but DB has deactivated admin -> rejects
    await assert.rejects(
      () => createVetClinicCommand(adapter, payload, { id: 'admin-deactivated', role: 'ADMIN', is_active: true }),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.override_reason.message, /active administrators/i);
        return true;
      },
    );

    // 2. Session says ADMIN, but DB has demoted VIEWER admin -> rejects
    await assert.rejects(
      () => createVetClinicCommand(adapter, payload, { id: 'admin-demoted', role: 'ADMIN', is_active: true }),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.override_reason.message, /active administrators/i);
        return true;
      },
    );

    // 3. Admin does not exist in DB -> rejects
    await assert.rejects(
      () => createVetClinicCommand(adapter, payload, { id: 'nonexistent-admin-id', role: 'ADMIN', is_active: true }),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.override_reason.message, /active administrators/i);
        return true;
      },
    );

    // 4. Admin is active and authorized in DB -> succeeds
    const created = await createVetClinicCommand(adapter, payload, {
      id: 'admin-active',
      role: 'ADMIN',
      is_active: true,
    });
    assert.ok(created);
  });
});

import crypto from 'node:crypto';
import { ValidationError } from 'adminjs';
import { ENUMS } from '../enums.js';
import { attachShortUuid, enumProperty, noDeleteActions, stripPopulatedPasswordHashes } from './resource-helpers.js';
import {
  validateMappedLocation,
  isLocationModified,
  findNearestOfficialCity,
  checkCityDiscrepancy,
  readOverrideReason,
} from './vet-clinics.location.js';
import { searchVetClinicAddress } from './vet-clinics.geocoder.js';

const VET_CLINIC_COLUMNS = new Set([
  'id',
  'name_english',
  'name_arabic',
  'city_id',
  'area_name',
  'coordinates',
  'phone_number',
  'address',
  'address_english',
  'address_arabic',
  'website',
  'location_provenance',
  'location_captured_at',
  'source',
  'osm_id',
  'osm_type',
  'is_active',
  'created_at',
  'updated_at',
]);

export function isAuthorizedToOverride(currentAdmin) {
  if (!currentAdmin) return false;
  const role = currentAdmin.role;
  const isActive = currentAdmin.is_active !== false;
  return (role === 'ADMIN' || role === 'SUPER_ADMIN') && isActive;
}

export async function getCityById(trxOrClient, cityId, forShare = true) {
  if (!cityId || !trxOrClient) return null;
  if (typeof trxOrClient.query === 'function') {
    const lock = forShare ? ' FOR SHARE' : '';
    const { rows } = await trxOrClient.query(
      `SELECT id, name_english, name_arabic, governorate, status FROM cities WHERE id = $1${lock}`,
      [cityId],
    );
    return rows[0] ?? null;
  }
  const queryBuilder =
    typeof trxOrClient === 'function'
      ? trxOrClient('cities')
      : trxOrClient.knex
        ? trxOrClient.knex('cities')
        : trxOrClient;
  let qb = queryBuilder.select('id', 'name_english', 'name_arabic', 'governorate', 'status').where('id', cityId);
  if (forShare && typeof qb.forShare === 'function') {
    qb = qb.forShare();
  }
  const rows = await qb;
  return rows?.[0] ?? null;
}

export async function getClinicById(trxOrClient, recordId, forUpdate = false) {
  if (!recordId || !trxOrClient) return null;
  if (typeof trxOrClient.query === 'function') {
    const sql = forUpdate
      ? `SELECT * FROM vet_clinics WHERE id = $1 FOR UPDATE`
      : `SELECT * FROM vet_clinics WHERE id = $1`;
    const { rows } = await trxOrClient.query(sql, [recordId]);
    return rows[0] ?? null;
  }
  const queryBuilder =
    typeof trxOrClient === 'function'
      ? trxOrClient('vet_clinics')
      : trxOrClient.knex
        ? trxOrClient.knex('vet_clinics')
        : trxOrClient;
  let qb = queryBuilder.where('id', recordId);
  if (forUpdate && typeof qb.forUpdate === 'function') {
    qb = qb.forUpdate();
  }
  const rows = await qb;
  return rows?.[0] ?? null;
}

export async function createClinicInTransaction(trxOrClient, clientType, rawPayload, currentAdmin) {
  // 1. Validate required city selection
  if (!rawPayload.city_id) {
    throw new ValidationError({
      city_id: { message: 'Must select an existing official City' },
    });
  }

  // 2. Query official City inside transaction with row lock
  const city = await getCityById(trxOrClient, rawPayload.city_id, true);
  if (!city || city.status !== 'OFFICIAL') {
    throw new ValidationError({
      city_id: { message: 'Must select an existing official City' },
    });
  }

  // 3. Full Mapped Location validation on create
  const location = validateMappedLocation(rawPayload);

  // 4. Query nearest official City inside transaction with row lock
  const nearestCity = await findNearestOfficialCity(trxOrClient, location.latitude, location.longitude, {
    forShare: true,
  });

  // 5. Check discrepancy inside transaction
  const discrepancy = checkCityDiscrepancy(city, nearestCity);
  let overrideReason = null;

  if (discrepancy.isDiscrepant) {
    if (!isAuthorizedToOverride(currentAdmin)) {
      throw new ValidationError({
        override_reason: {
          message: 'Only active administrators may override City disagreements.',
        },
      });
    }

    const reasonValue = rawPayload.override_reason ?? rawPayload.reason;
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

  // 6. Build clinic insert payload
  const clinicData = {
    ...rawPayload,
    id: rawPayload.id || crypto.randomUUID(),
    source: rawPayload.source || 'MANUAL',
    coordinates: location.coordinatesStr,
    address_english: location.address_english,
    address_arabic: location.address_arabic,
    address: location.address,
    location_provenance: rawPayload.location_provenance === 'NOMINATIM' ? 'NOMINATIM' : 'MANUAL',
    location_captured_at: new Date().toISOString(),
  };

  if (clinicData.is_active !== undefined && typeof clinicData.is_active === 'string') {
    clinicData.is_active =
      clinicData.is_active === 'true' || clinicData.is_active === '1' || clinicData.is_active === 'on';
  }

  if (rawPayload.osm_id !== undefined && rawPayload.osm_id !== null && rawPayload.osm_id !== '') {
    const rawOsm = String(rawPayload.osm_id).trim();
    if (/^\d+$/.test(rawOsm)) {
      clinicData.osm_id = rawOsm;
    }
  }
  if (rawPayload.osm_type !== undefined && rawPayload.osm_type !== null) {
    clinicData.osm_type = String(rawPayload.osm_type).trim();
  }

  let insertedClinic;
  if (clientType === 'pg') {
    const insertKeys = Object.keys(clinicData).filter((k) => VET_CLINIC_COLUMNS.has(k));
    const insertCols = insertKeys.map((k) => `"${k}"`).join(', ');
    const insertPlaceholders = insertKeys
      .map((k, i) => {
        if (k === 'coordinates') {
          return `ST_GeomFromEWKT($${i + 1})`;
        }
        return `$${i + 1}`;
      })
      .join(', ');
    const insertValues = insertKeys.map((k) => clinicData[k]);

    const { rows } = await trxOrClient.query(
      `INSERT INTO vet_clinics (${insertCols}) VALUES (${insertPlaceholders}) RETURNING *`,
      insertValues,
    );
    insertedClinic = rows[0];
  } else {
    const insertKeys = Object.keys(clinicData).filter((k) => VET_CLINIC_COLUMNS.has(k));
    const insertObj = {};
    for (const k of insertKeys) {
      if (k === 'coordinates') {
        insertObj[k] = trxOrClient.raw ? trxOrClient.raw('ST_GeomFromEWKT(?)', [clinicData[k]]) : clinicData[k];
      } else {
        insertObj[k] = clinicData[k];
      }
    }
    const result = await trxOrClient('vet_clinics').insert(insertObj).returning('*');
    insertedClinic = Array.isArray(result) ? result[0] : result;
  }

  // 7. Write audit log atomically inside the same transaction if discrepant
  if (discrepancy.isDiscrepant) {
    const auditId = crypto.randomUUID();
    const detailsJson = JSON.stringify({
      selected_city: discrepancy.selectedCity,
      nearest_city: discrepancy.nearestCity,
    });

    if (clientType === 'pg') {
      await trxOrClient.query(
        `INSERT INTO vet_clinic_location_audits
           (id, vet_clinic_id, admin_user_id, selected_city_id, nearest_city_id, coordinates, discrepancy_details, reason, created_at)
         VALUES
           ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, $9, now())`,
        [
          auditId,
          insertedClinic.id,
          currentAdmin?.id ?? null,
          city.id,
          nearestCity.id,
          location.longitude,
          location.latitude,
          detailsJson,
          overrideReason,
        ],
      );
    } else {
      await trxOrClient('vet_clinic_location_audits').insert({
        id: auditId,
        vet_clinic_id: insertedClinic.id,
        admin_user_id: currentAdmin?.id ?? null,
        selected_city_id: city.id,
        nearest_city_id: nearestCity.id,
        coordinates: trxOrClient.raw
          ? trxOrClient.raw('ST_SetSRID(ST_MakePoint(?, ?), 4326)', [location.longitude, location.latitude])
          : `SRID=4326;POINT(${location.longitude} ${location.latitude})`,
        discrepancy_details: detailsJson,
        reason: overrideReason,
      });
    }
  }

  return insertedClinic;
}

export async function updateClinicInTransaction(trxOrClient, clientType, recordId, rawPayload, currentAdmin) {
  const existing = await getClinicById(trxOrClient, recordId, true);
  if (!existing) {
    throw new ValidationError({
      id: { message: 'Vet clinic record not found' },
    });
  }

  const locationChanged = isLocationModified(rawPayload, existing);
  let selectedCity = null;
  let nearestCity = null;
  let discrepancy = { isDiscrepant: false };
  let overrideReason = null;
  let location = null;
  const updateData = { ...rawPayload };

  if (locationChanged) {
    const targetCityId = rawPayload.city_id || existing?.city_id;
    if (!targetCityId) {
      throw new ValidationError({
        city_id: { message: 'Must select an existing official City' },
      });
    }

    selectedCity = await getCityById(trxOrClient, targetCityId, true);
    if (!selectedCity || selectedCity.status !== 'OFFICIAL') {
      throw new ValidationError({
        city_id: { message: 'Must select an existing official City' },
      });
    }

    location = validateMappedLocation(rawPayload);
    updateData.coordinates = location.coordinatesStr;
    updateData.address_english = location.address_english;
    updateData.address_arabic = location.address_arabic;
    updateData.address = location.address;
    updateData.location_provenance = rawPayload.location_provenance === 'NOMINATIM' ? 'NOMINATIM' : 'MANUAL';
    updateData.location_captured_at = new Date().toISOString();

    if (rawPayload.osm_id !== undefined && rawPayload.osm_id !== null && rawPayload.osm_id !== '') {
      const rawOsm = String(rawPayload.osm_id).trim();
      if (/^\d+$/.test(rawOsm)) {
        updateData.osm_id = rawOsm;
      }
    }
    if (rawPayload.osm_type !== undefined && rawPayload.osm_type !== null) {
      updateData.osm_type = String(rawPayload.osm_type).trim();
    }

    // Nearest official City & Discrepancy check inside transaction with row lock
    nearestCity = await findNearestOfficialCity(trxOrClient, location.latitude, location.longitude, {
      forShare: true,
    });
    discrepancy = checkCityDiscrepancy(selectedCity, nearestCity);

    if (discrepancy.isDiscrepant) {
      if (!isAuthorizedToOverride(currentAdmin)) {
        throw new ValidationError({
          override_reason: {
            message: 'Only active administrators may override City disagreements.',
          },
        });
      }

      const reasonValue = rawPayload.override_reason ?? rawPayload.reason;
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
    // Non-location edit (preserve existing location data as-is)
    delete updateData.coordinates;
    delete updateData.location_provenance;
    delete updateData.location_captured_at;
    delete updateData.osm_id;
    delete updateData.osm_type;

    if (updateData.city_id !== undefined && existing?.city_id !== undefined) {
      if (String(updateData.city_id ?? '').trim() === String(existing.city_id ?? '').trim()) {
        delete updateData.city_id;
      }
    }
    if (updateData.address_english !== undefined && existing?.address_english !== undefined) {
      if (String(updateData.address_english ?? '').trim() === String(existing.address_english ?? '').trim()) {
        delete updateData.address_english;
      }
    }
    if (updateData.address_arabic !== undefined && existing?.address_arabic !== undefined) {
      if (String(updateData.address_arabic ?? '').trim() === String(existing.address_arabic ?? '').trim()) {
        delete updateData.address_arabic;
      }
    }
    if (updateData.address !== undefined && existing?.address !== undefined) {
      if (String(updateData.address ?? '').trim() === String(existing.address ?? '').trim()) {
        delete updateData.address;
      }
    }
  }

  if (updateData.is_active !== undefined && typeof updateData.is_active === 'string') {
    updateData.is_active =
      updateData.is_active === 'true' || updateData.is_active === '1' || updateData.is_active === 'on';
  }

  const updateKeys = Object.keys(updateData).filter((k) => k !== 'id' && VET_CLINIC_COLUMNS.has(k));
  let updatedClinic = existing;

  if (updateKeys.length > 0) {
    if (clientType === 'pg') {
      const setClauses = updateKeys
        .map((k, i) => {
          if (k === 'coordinates') {
            return `"${k}" = ST_GeomFromEWKT($${i + 2})`;
          }
          return `"${k}" = $${i + 2}`;
        })
        .join(', ');
      const updateValues = [recordId, ...updateKeys.map((k) => updateData[k])];

      const { rows } = await trxOrClient.query(
        `UPDATE vet_clinics SET ${setClauses}, updated_at = now() WHERE id = $1 RETURNING *`,
        updateValues,
      );
      updatedClinic = rows[0] ?? existing;
    } else {
      const updatePayload = {};
      for (const k of updateKeys) {
        if (k === 'coordinates') {
          updatePayload[k] = trxOrClient.raw ? trxOrClient.raw('ST_GeomFromEWKT(?)', [updateData[k]]) : updateData[k];
        } else {
          updatePayload[k] = updateData[k];
        }
      }
      if (trxOrClient.raw) {
        updatePayload.updated_at = trxOrClient.raw('now()');
      }
      const result = await trxOrClient('vet_clinics').where('id', recordId).update(updatePayload).returning('*');
      updatedClinic = (Array.isArray(result) ? result[0] : result) || existing;
    }
  }

  if (locationChanged && discrepancy.isDiscrepant) {
    const auditId = crypto.randomUUID();
    const detailsJson = JSON.stringify({
      selected_city: discrepancy.selectedCity,
      nearest_city: discrepancy.nearestCity,
    });

    if (clientType === 'pg') {
      await trxOrClient.query(
        `INSERT INTO vet_clinic_location_audits
           (id, vet_clinic_id, admin_user_id, selected_city_id, nearest_city_id, coordinates, discrepancy_details, reason, created_at)
         VALUES
           ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, $9, now())`,
        [
          auditId,
          recordId,
          currentAdmin?.id ?? null,
          selectedCity.id,
          nearestCity.id,
          location.longitude,
          location.latitude,
          detailsJson,
          overrideReason,
        ],
      );
    } else {
      await trxOrClient('vet_clinic_location_audits').insert({
        id: auditId,
        vet_clinic_id: recordId,
        admin_user_id: currentAdmin?.id ?? null,
        selected_city_id: selectedCity.id,
        nearest_city_id: nearestCity.id,
        coordinates: trxOrClient.raw
          ? trxOrClient.raw('ST_SetSRID(ST_MakePoint(?, ?), 4326)', [location.longitude, location.latitude])
          : `SRID=4326;POINT(${location.longitude} ${location.latitude})`,
        discrepancy_details: detailsJson,
        reason: overrideReason,
      });
    }
  }

  return updatedClinic;
}

export function buildVetClinicsResource(db, poolOrComponents = {}, componentsOrCache = {}, cache = null) {
  let pool = null;
  let components = {};
  let statsCache = null;

  if (
    poolOrComponents &&
    (typeof poolOrComponents.connect === 'function' || typeof poolOrComponents.query === 'function')
  ) {
    pool = poolOrComponents;
    components = componentsOrCache || {};
    statsCache = typeof cache?.invalidate === 'function' ? cache : null;
  } else if (
    poolOrComponents &&
    (poolOrComponents.ShortUuid ||
      poolOrComponents.MappedLocationEdit ||
      poolOrComponents.MappedLocationShow ||
      poolOrComponents.Dashboard)
  ) {
    components = poolOrComponents || {};
    statsCache = typeof componentsOrCache?.invalidate === 'function' ? componentsOrCache : null;
  } else if (
    componentsOrCache &&
    (componentsOrCache.ShortUuid || componentsOrCache.MappedLocationEdit || componentsOrCache.MappedLocationShow)
  ) {
    pool = poolOrComponents;
    components = componentsOrCache;
    statsCache = typeof cache?.invalidate === 'function' ? cache : null;
  } else {
    components = poolOrComponents || {};
    statsCache =
      typeof componentsOrCache?.invalidate === 'function'
        ? componentsOrCache
        : typeof cache?.invalidate === 'function'
          ? cache
          : null;
  }

  const knex = db?.table ? (db.table('cities')?.knex ?? db.table('vet_clinics')?.knex) : (db?.knex ?? db);

  async function executeInTransaction(fn) {
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client, 'pg');
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }

    if (knex) {
      if (typeof knex.transaction === 'function') {
        return await knex.transaction(async (trx) => {
          return await fn(trx, 'knex');
        });
      }
      return await fn(knex, 'knex');
    }

    throw new Error('No database pool or knex connection available');
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
        tileUrl: process.env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution:
          process.env.MAP_ATTRIBUTION ||
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        searchAttribution:
          process.env.NOMINATIM_ATTRIBUTION ||
          'Data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ODbL 1.0',
        searchEnabled: process.env.NOMINATIM_ENABLED !== 'false' && process.env.NOMINATIM_ENABLED !== false,
        minLat: parseFloat(process.env.EGYPT_MIN_LAT || '21.0'),
        maxLat: parseFloat(process.env.EGYPT_MAX_LAT || '32.0'),
        minLng: parseFloat(process.env.EGYPT_MIN_LNG || '24.0'),
        maxLng: parseFloat(process.env.EGYPT_MAX_LNG || '37.5'),
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

  attachShortUuid(properties, ['id'], components, ['show']);

  return {
    resource: db.table('vet_clinics'),
    options: {
      navigation: { name: 'Reference Data', icon: 'Map' },
      properties,
      actions: {
        ...noDeleteActions,
        list: { after: stripPopulatedPasswordHashes },
        show: { after: stripPopulatedPasswordHashes },
        new: {
          handler: async (request, response, context) => {
            const { resource, currentAdmin, h } = context;
            if (request.method !== 'post') {
              const record = resource.build(request.payload || {});
              return { record: record.toJSON(currentAdmin) };
            }

            const rawPayload = {
              ...(request.payload || {}),
            };

            const insertedClinic = await executeInTransaction(async (trxOrClient, clientType) => {
              return await createClinicInTransaction(trxOrClient, clientType, rawPayload, currentAdmin);
            });

            if (typeof statsCache?.invalidate === 'function') {
              statsCache.invalidate();
            }

            const record = resource.build(insertedClinic);
            return {
              record: record.toJSON(currentAdmin),
              redirectUrl: h?.resourceUrl ? h.resourceUrl({ resourceId: resource.id() }) : undefined,
              notice: {
                message: 'Successfully created record',
                type: 'success',
              },
            };
          },
        },
        edit: {
          handler: async (request, response, context) => {
            const { resource, currentAdmin, h } = context;
            const recordId = request.params?.recordId;

            if (request.method !== 'post') {
              const record = await resource.findOne(recordId);
              return { record: record?.toJSON(currentAdmin) };
            }

            const rawPayload = {
              ...(request.payload || {}),
            };

            const updatedClinic = await executeInTransaction(async (trxOrClient, clientType) => {
              return await updateClinicInTransaction(trxOrClient, clientType, recordId, rawPayload, currentAdmin);
            });

            if (typeof statsCache?.invalidate === 'function') {
              statsCache.invalidate();
            }

            const record = resource.build(updatedClinic);
            return {
              record: record.toJSON(currentAdmin),
              redirectUrl: h?.resourceUrl ? h.resourceUrl({ resourceId: resource.id() }) : undefined,
              notice: {
                message: 'Successfully updated record',
                type: 'success',
              },
            };
          },
        },
        searchAddress: {
          actionType: 'resource',
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
              '';

            const result = await searchVetClinicAddress({
              query: String(query),
              pool,
              knex,
              config: {
                url: process.env.NOMINATIM_URL,
                userAgent: process.env.NOMINATIM_USER_AGENT,
                attribution: process.env.NOMINATIM_ATTRIBUTION,
                enabled: process.env.NOMINATIM_ENABLED !== 'false' && process.env.NOMINATIM_ENABLED !== false,
                timeoutMs: parseInt(process.env.NOMINATIM_TIMEOUT_MS || '5000', 10),
                rateLimitMs: parseInt(process.env.NOMINATIM_RATE_LIMIT_MS || '1000', 10),
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
        'name_english',
        'name_arabic',
        'city_id',
        'phone_number',
        'address_english',
        'address_arabic',
        'source',
        'is_active',
      ],
      showProperties: [
        'id',
        'name_english',
        'name_arabic',
        'city_id',
        'area_name',
        'address',
        'address_english',
        'address_arabic',
        'phone_number',
        'website',
        'coordinates',
        'source',
        'osm_id',
        'osm_type',
        'location_provenance',
        'location_captured_at',
        'is_active',
        'created_at',
        'updated_at',
      ],
      filterProperties: ['name_english', 'city_id', 'source', 'location_provenance', 'is_active'],
    },
  };
}

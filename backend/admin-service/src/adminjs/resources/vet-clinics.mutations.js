import { ValidationError } from 'adminjs';
import {
  validateMappedLocation,
  isLocationModified,
  checkCityDiscrepancy,
  readOverrideReason,
} from './vet-clinics.location.js';

export const VET_CLINIC_COLUMNS = new Set([
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

/**
 * Checks whether an administrator has permission to override City disagreements.
 */
export function isAuthorizedToOverride(currentAdmin) {
  if (!currentAdmin) return false;
  const role = currentAdmin.role;
  const isActive = currentAdmin.is_active !== false && currentAdmin.is_active !== 0;
  return (role === 'ADMIN' || role === 'SUPER_ADMIN') && Boolean(isActive);
}

/**
 * PostgreSQL Client / Pool persistence adapter satisfying the Vet Clinic persistence contract.
 */
export class PostgresVetClinicPersistenceAdapter {
  constructor(client) {
    this.client = client;
    this.type = 'pg';
  }

  async acquireCityCatalogRevisionFence({ forShare = false, forUpdate = true } = {}) {
    let lock = '';
    if (forShare) {
      lock = ' FOR SHARE';
    } else if (forUpdate || forShare === false) {
      lock = ' FOR UPDATE';
    }
    const { rows } = await this.client.query(`SELECT id, revision FROM city_catalog_revisions WHERE id = 1${lock}`);
    return rows[0] ?? { id: 1, revision: 1 };
  }

  async advanceCatalogRevision() {
    const { rows } = await this.client.query(
      `UPDATE city_catalog_revisions SET revision = revision + 1 WHERE id = 1 RETURNING revision`,
    );
    return rows[0]?.revision ?? 1;
  }

  async findAdminUserById(adminId, { forShare = true } = {}) {
    if (!adminId) return null;
    const lock = forShare ? ' FOR SHARE' : '';
    const { rows } = await this.client.query(
      `SELECT id, email, role, is_active FROM admin_users WHERE id = $1${lock}`,
      [adminId],
    );
    return rows[0] ?? null;
  }

  async findCityById(cityId, { forShare = true } = {}) {
    if (!cityId) return null;
    const lock = forShare ? ' FOR SHARE' : '';
    const { rows } = await this.client.query(
      `SELECT id, name_english, name_arabic, governorate, status FROM cities WHERE id = $1${lock}`,
      [cityId],
    );
    return rows[0] ?? null;
  }

  async findNearestOfficialCity(lat, lng, { forShare = true } = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const lockClause = forShare ? ' FOR SHARE' : '';
    const { rows } = await this.client.query(
      `SELECT
         id,
         name_english,
         name_arabic,
         governorate,
         status,
         ROUND((ST_Distance(center_point::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0)::numeric, 2) AS distance_km
       FROM cities
       WHERE id = (
         SELECT id
         FROM cities
         WHERE status = 'OFFICIAL'
         ORDER BY center_point <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
         LIMIT 1
       )${lockClause}`,
      [lng, lat],
    );
    if (!rows[0]) return null;
    return {
      ...rows[0],
      distance_km: rows[0].distance_km !== undefined ? Number(rows[0].distance_km) : 0,
    };
  }

  async findClinicById(recordId, { forUpdate = false } = {}) {
    if (!recordId) return null;
    const sql = forUpdate
      ? `SELECT * FROM vet_clinics WHERE id = $1 FOR UPDATE`
      : `SELECT * FROM vet_clinics WHERE id = $1`;
    const { rows } = await this.client.query(sql, [recordId]);
    return rows[0] ?? null;
  }

  async insertClinic(clinicData) {
    const insertKeys = Object.keys(clinicData).filter((k) => VET_CLINIC_COLUMNS.has(k) && clinicData[k] !== undefined);
    const insertCols = insertKeys.map((k) => `"${k}"`).join(', ');
    const insertPlaceholders = insertKeys
      .map((k, i) => (k === 'coordinates' ? `ST_GeomFromEWKT($${i + 1})` : `$${i + 1}`))
      .join(', ');
    const insertValues = insertKeys.map((k) => clinicData[k]);

    const { rows } = await this.client.query(
      `INSERT INTO vet_clinics (${insertCols}) VALUES (${insertPlaceholders}) RETURNING *`,
      insertValues,
    );
    return rows[0];
  }

  async updateClinic(recordId, updateData) {
    const updateKeys = Object.keys(updateData).filter(
      (k) =>
        k !== 'id' &&
        k !== 'updated_at' &&
        k !== 'created_at' &&
        VET_CLINIC_COLUMNS.has(k) &&
        updateData[k] !== undefined,
    );
    if (updateKeys.length === 0) {
      return (await this.findClinicById(recordId)) || { id: recordId };
    }

    const setClauses = updateKeys
      .map((k, i) => (k === 'coordinates' ? `"${k}" = ST_GeomFromEWKT($${i + 2})` : `"${k}" = $${i + 2}`))
      .join(', ');
    const updateValues = [recordId, ...updateKeys.map((k) => updateData[k])];

    const { rows } = await this.client.query(
      `UPDATE vet_clinics SET ${setClauses}, updated_at = now() WHERE id = $1 RETURNING *`,
      updateValues,
    );
    return rows[0] ?? null;
  }

  async insertLocationAudit(auditData) {
    const detailsJson =
      typeof auditData.discrepancy_details === 'string'
        ? auditData.discrepancy_details
        : JSON.stringify(auditData.discrepancy_details);

    const { rows } = await this.client.query(
      `INSERT INTO vet_clinic_location_audits
         (vet_clinic_id, admin_user_id, selected_city_id, nearest_city_id, coordinates, discrepancy_details, reason)
       VALUES
         ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8)
       RETURNING *`,
      [
        auditData.vet_clinic_id,
        auditData.admin_user_id,
        auditData.selected_city_id,
        auditData.nearest_city_id,
        auditData.longitude,
        auditData.latitude,
        detailsJson,
        auditData.reason,
      ],
    );
    return rows?.[0] ?? { ...auditData };
  }
}

/**
 * Knex query builder / transaction persistence adapter satisfying the Vet Clinic persistence contract.
 */
export class KnexVetClinicPersistenceAdapter {
  constructor(knexOrTrx) {
    this.knex = knexOrTrx;
    this.type = 'knex';
  }

  _qb(tableName) {
    if (typeof this.knex === 'function') {
      return this.knex(tableName);
    }
    if (this.knex?.knex && typeof this.knex.knex === 'function') {
      return this.knex.knex(tableName);
    }
    if (this.knex?.table && typeof this.knex.table === 'function') {
      return this.knex.table(tableName);
    }
    return this.knex;
  }

  _raw(sql, bindings) {
    if (typeof this.knex?.raw === 'function') {
      return this.knex.raw(sql, bindings);
    }
    if (typeof this.knex?.client?.raw === 'function') {
      return this.knex.client.raw(sql, bindings);
    }
    return null;
  }

  async acquireCityCatalogRevisionFence({ forShare = false, forUpdate = true } = {}) {
    let qb = this._qb('city_catalog_revisions').select('id', 'revision').where('id', 1);
    if (forShare) {
      if (typeof qb.forShare === 'function') {
        qb = qb.forShare();
      }
    } else if (forUpdate || forShare === false) {
      if (typeof qb.forUpdate === 'function') {
        qb = qb.forUpdate();
      }
    }
    const rows = await qb;
    return rows?.[0] ?? { id: 1, revision: 1 };
  }

  async advanceCatalogRevision() {
    if (typeof this.knex?.raw === 'function') {
      const result = await this.knex.raw(
        'UPDATE city_catalog_revisions SET revision = revision + 1 WHERE id = 1 RETURNING revision',
      );
      const rows = result?.rows || result;
      return rows?.[0]?.revision ?? 1;
    }
    if (typeof this.knex?.client?.raw === 'function') {
      const result = await this.knex.client.raw(
        'UPDATE city_catalog_revisions SET revision = revision + 1 WHERE id = 1 RETURNING revision',
      );
      const rows = result?.rows || result;
      return rows?.[0]?.revision ?? 1;
    }
    const qb = this._qb('city_catalog_revisions').where('id', 1);
    if (typeof qb.increment === 'function') {
      const res = qb.increment('revision', 1);
      if (typeof res?.returning === 'function') {
        const rows = await res.returning('revision');
        return Array.isArray(rows) ? (rows[0]?.revision ?? rows[0]) : (rows?.revision ?? 1);
      }
      await res;
      return 1;
    }
    if (typeof this._raw === 'function') {
      const rawRes = await this._raw(
        'UPDATE city_catalog_revisions SET revision = revision + 1 WHERE id = 1 RETURNING revision',
      );
      return rawRes?.rows?.[0]?.revision ?? 1;
    }
    return 1;
  }

  async findAdminUserById(adminId, { forShare = true } = {}) {
    if (!adminId) return null;
    let qb = this._qb('admin_users').select('id', 'email', 'role', 'is_active').where('id', adminId);
    if (forShare && typeof qb.forShare === 'function') {
      qb = qb.forShare();
    }
    const rows = await qb;
    return rows?.[0] ?? null;
  }

  async findCityById(cityId, { forShare = true } = {}) {
    if (!cityId) return null;
    let qb = this._qb('cities')
      .select('id', 'name_english', 'name_arabic', 'governorate', 'status')
      .where('id', cityId);
    if (forShare && typeof qb.forShare === 'function') {
      qb = qb.forShare();
    }
    const rows = await qb;
    return rows?.[0] ?? null;
  }

  async findNearestOfficialCity(lat, lng, { forShare = true } = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const rawFn = this._raw.bind(this);
    let qb = this._qb('cities')
      .select(
        'id',
        'name_english',
        'name_arabic',
        'governorate',
        'status',
        rawFn(
          'ROUND((ST_Distance(center_point::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography) / 1000.0)::numeric, 2) as distance_km',
          [lng, lat],
        ) || 'id',
      )
      .where('status', 'OFFICIAL');

    if (typeof qb.orderByRaw === 'function') {
      qb = qb.orderByRaw('center_point <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)', [lng, lat]);
    }
    if (typeof qb.limit === 'function') {
      qb = qb.limit(1);
    }
    if (forShare && typeof qb.forShare === 'function') {
      qb = qb.forShare();
    }

    const rows = await qb;
    if (!rows || !rows[0]) return null;
    return {
      ...rows[0],
      distance_km: rows[0].distance_km !== undefined ? Number(rows[0].distance_km) : 0,
    };
  }

  async findClinicById(recordId, { forUpdate = false } = {}) {
    if (!recordId) return null;
    let qb = this._qb('vet_clinics').where('id', recordId);
    if (forUpdate && typeof qb.forUpdate === 'function') {
      qb = qb.forUpdate();
    }
    const rows = await qb;
    return rows?.[0] ?? null;
  }

  async insertClinic(clinicData) {
    const insertKeys = Object.keys(clinicData).filter((k) => VET_CLINIC_COLUMNS.has(k) && clinicData[k] !== undefined);
    const insertObj = {};
    for (const k of insertKeys) {
      if (k === 'coordinates') {
        const raw = this._raw('ST_GeomFromEWKT(?)', [clinicData[k]]);
        insertObj[k] = raw ?? clinicData[k];
      } else {
        insertObj[k] = clinicData[k];
      }
    }
    const qb = this._qb('vet_clinics').insert(insertObj);
    const result = typeof qb?.returning === 'function' ? await qb.returning('*') : await qb;
    return Array.isArray(result) ? result[0] : result;
  }

  async updateClinic(recordId, updateData) {
    const updateKeys = Object.keys(updateData).filter(
      (k) =>
        k !== 'id' &&
        k !== 'updated_at' &&
        k !== 'created_at' &&
        VET_CLINIC_COLUMNS.has(k) &&
        updateData[k] !== undefined,
    );
    if (updateKeys.length === 0) {
      return (await this.findClinicById(recordId)) || { id: recordId };
    }

    const updatePayload = {};
    for (const k of updateKeys) {
      if (k === 'coordinates') {
        const raw = this._raw('ST_GeomFromEWKT(?)', [updateData[k]]);
        updatePayload[k] = raw ?? updateData[k];
      } else {
        updatePayload[k] = updateData[k];
      }
    }
    const rawNow = this._raw('now()');
    if (rawNow) {
      updatePayload.updated_at = rawNow;
    } else {
      updatePayload.updated_at = new Date();
    }

    const qb = this._qb('vet_clinics').where('id', recordId).update(updatePayload);
    const result = typeof qb?.returning === 'function' ? await qb.returning('*') : await qb;
    return (Array.isArray(result) ? result[0] : result) || { id: recordId, ...updatePayload };
  }

  async insertLocationAudit(auditData) {
    const detailsJson =
      typeof auditData.discrepancy_details === 'string'
        ? auditData.discrepancy_details
        : JSON.stringify(auditData.discrepancy_details);

    const rawCoord = this._raw('ST_SetSRID(ST_MakePoint(?, ?), 4326)', [auditData.longitude, auditData.latitude]);

    const auditPayload = {
      vet_clinic_id: auditData.vet_clinic_id,
      admin_user_id: auditData.admin_user_id,
      selected_city_id: auditData.selected_city_id,
      nearest_city_id: auditData.nearest_city_id,
      coordinates: rawCoord ?? `SRID=4326;POINT(${auditData.longitude} ${auditData.latitude})`,
      discrepancy_details: detailsJson,
      reason: auditData.reason,
    };

    const qb = this._qb('vet_clinic_location_audits').insert(auditPayload);
    const result = typeof qb?.returning === 'function' ? await qb.returning('*') : await qb;
    return Array.isArray(result) ? result[0] : (result ?? { ...auditPayload });
  }
}

/**
 * Creates the appropriate persistence adapter for a given database connection context.
 */
export function createVetClinicPersistenceAdapter(trxOrClient, clientType) {
  if (!trxOrClient) {
    throw new Error('Database connection or transaction handle is required');
  }

  if (
    trxOrClient instanceof PostgresVetClinicPersistenceAdapter ||
    trxOrClient instanceof KnexVetClinicPersistenceAdapter
  ) {
    return trxOrClient;
  }

  if (clientType === 'pg' || (typeof trxOrClient.query === 'function' && typeof trxOrClient.select !== 'function')) {
    return new PostgresVetClinicPersistenceAdapter(trxOrClient);
  }

  return new KnexVetClinicPersistenceAdapter(trxOrClient);
}

/**
 * Transaction runner ensuring unified execution across PostgreSQL pools and Knex instances.
 */
export async function executeVetClinicTransaction(connectionOrPool, fn) {
  if (!connectionOrPool) {
    throw new Error('No database pool or knex connection available');
  }

  if (
    connectionOrPool instanceof PostgresVetClinicPersistenceAdapter ||
    connectionOrPool instanceof KnexVetClinicPersistenceAdapter
  ) {
    return await fn(connectionOrPool);
  }

  // pg.Pool
  if (typeof connectionOrPool.connect === 'function') {
    const client = await connectionOrPool.connect();
    try {
      await client.query('BEGIN');
      const adapter = new PostgresVetClinicPersistenceAdapter(client);
      const result = await fn(adapter);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // pg.Client
  if (typeof connectionOrPool.query === 'function' && typeof connectionOrPool.select !== 'function') {
    const adapter = new PostgresVetClinicPersistenceAdapter(connectionOrPool);
    return await fn(adapter);
  }

  // Knex instance with transaction method
  const knex = connectionOrPool.table
    ? (connectionOrPool.table('vet_clinics')?.knex ?? connectionOrPool.table('cities')?.knex ?? connectionOrPool.knex)
    : (connectionOrPool.knex ?? connectionOrPool);

  if (knex && typeof knex.transaction === 'function') {
    return await knex.transaction(async (trx) => {
      const adapter = new KnexVetClinicPersistenceAdapter(trx);
      return await fn(adapter);
    });
  }

  // Knex transaction or query builder directly
  const adapter = new KnexVetClinicPersistenceAdapter(connectionOrPool);
  return await fn(adapter);
}

/**
 * Unified command boundary for creating a Vet Clinic.
 * Owns transaction-scoped validation, persistence, and audit coordination.
 */
export async function createVetClinicCommand(persistence, rawPayload, currentAdmin) {
  const adapter = createVetClinicPersistenceAdapter(persistence);

  // 1. Validate required city selection
  if (!rawPayload.city_id) {
    throw new ValidationError({
      city_id: { message: 'Must select an existing official City' },
    });
  }

  // 2. Hold deterministic exclusive City catalog revision fence for the transaction
  await adapter.acquireCityCatalogRevisionFence({ forUpdate: true });

  // 3. Query official City inside transaction with row lock
  const city = await adapter.findCityById(rawPayload.city_id, { forShare: true });
  if (!city || city.status !== 'OFFICIAL') {
    throw new ValidationError({
      city_id: { message: 'Must select an existing official City' },
    });
  }

  // 4. Full Mapped Location validation on create
  const location = validateMappedLocation(rawPayload);

  // 5. Query nearest official City inside transaction with row lock
  const nearestCity = await adapter.findNearestOfficialCity(location.latitude, location.longitude, {
    forShare: true,
  });

  // 6. Check discrepancy inside transaction
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

    let authorizedAdmin = null;
    if (currentAdmin?.id) {
      authorizedAdmin = await adapter.findAdminUserById(currentAdmin.id, { forShare: true });
    }

    if (!authorizedAdmin || !isAuthorizedToOverride(authorizedAdmin)) {
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

  // 7. Build clinic insert payload
  const clinicData = {
    ...rawPayload,
    source: rawPayload.source || 'MANUAL',
    coordinates: location.coordinatesStr,
    address_english: location.address_english,
    address_arabic: location.address_arabic,
    address: location.address,
    location_provenance: rawPayload.location_provenance === 'NOMINATIM' ? 'NOMINATIM' : 'MANUAL',
    location_captured_at: new Date().toISOString(),
  };

  // Reject any client-supplied protected identity fields
  delete clinicData.id;
  delete clinicData.created_at;
  delete clinicData.updated_at;

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

  const insertedClinic = await adapter.insertClinic(clinicData);

  // 8. Write audit log atomically inside the same transaction if discrepant
  if (discrepancy.isDiscrepant) {
    await adapter.insertLocationAudit({
      vet_clinic_id: insertedClinic.id,
      admin_user_id: currentAdmin.id,
      selected_city_id: city.id,
      nearest_city_id: nearestCity.id,
      longitude: location.longitude,
      latitude: location.latitude,
      discrepancy_details: {
        selected_city: discrepancy.selectedCity,
        nearest_city: discrepancy.nearestCity,
      },
      reason: overrideReason,
    });
  }

  // 9. Advance shared database catalog revision in the same transaction
  await adapter.advanceCatalogRevision();

  return insertedClinic;
}

/**
 * Unified command boundary for updating a Vet Clinic.
 * Owns transaction-scoped validation, persistence, and audit coordination.
 */
export async function updateVetClinicCommand(persistence, recordId, rawPayload, currentAdmin) {
  const adapter = createVetClinicPersistenceAdapter(persistence);

  // 1. Hold deterministic exclusive City catalog revision fence for the transaction
  await adapter.acquireCityCatalogRevisionFence({ forUpdate: true });

  const existing = await adapter.findClinicById(recordId, { forUpdate: true });
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

    selectedCity = await adapter.findCityById(targetCityId, { forShare: true });
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
    nearestCity = await adapter.findNearestOfficialCity(location.latitude, location.longitude, {
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

      let authorizedAdmin = null;
      if (currentAdmin?.id) {
        authorizedAdmin = await adapter.findAdminUserById(currentAdmin.id, { forShare: true });
      }

      if (!authorizedAdmin || !isAuthorizedToOverride(authorizedAdmin)) {
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

  const updatedClinic = await adapter.updateClinic(recordId, updateData);

  if (locationChanged && discrepancy.isDiscrepant) {
    await adapter.insertLocationAudit({
      vet_clinic_id: recordId,
      admin_user_id: currentAdmin.id,
      selected_city_id: selectedCity.id,
      nearest_city_id: nearestCity.id,
      longitude: location.longitude,
      latitude: location.latitude,
      discrepancy_details: {
        selected_city: discrepancy.selectedCity,
        nearest_city: discrepancy.nearestCity,
      },
      reason: overrideReason,
    });
  }

  // Advance shared database catalog revision in the same transaction
  await adapter.advanceCatalogRevision();

  return updatedClinic;
}

// Backward-compatible wrappers
export async function createClinicInTransaction(trxOrClient, clientType, rawPayload, currentAdmin) {
  const adapter = createVetClinicPersistenceAdapter(trxOrClient, clientType);
  return await createVetClinicCommand(adapter, rawPayload, currentAdmin);
}

export async function updateClinicInTransaction(trxOrClient, clientType, recordId, rawPayload, currentAdmin) {
  const adapter = createVetClinicPersistenceAdapter(trxOrClient, clientType);
  return await updateVetClinicCommand(adapter, recordId, rawPayload, currentAdmin);
}

export async function getCityById(trxOrClient, cityId, forShare = true) {
  const adapter = createVetClinicPersistenceAdapter(trxOrClient);
  return await adapter.findCityById(cityId, { forShare });
}

export async function getClinicById(trxOrClient, recordId, forUpdate = false) {
  const adapter = createVetClinicPersistenceAdapter(trxOrClient);
  return await adapter.findClinicById(recordId, { forUpdate });
}

export async function findAdminUserById(trxOrClient, adminId, forShare = true) {
  const adapter = createVetClinicPersistenceAdapter(trxOrClient);
  return await adapter.findAdminUserById(adminId, { forShare });
}

export async function acquireCityCatalogRevisionFence(trxOrClient, forShareOrOptions = { forUpdate: true }) {
  const adapter = createVetClinicPersistenceAdapter(trxOrClient);
  if (typeof forShareOrOptions === 'boolean') {
    return await adapter.acquireCityCatalogRevisionFence({
      forShare: forShareOrOptions,
      forUpdate: !forShareOrOptions,
    });
  }
  return await adapter.acquireCityCatalogRevisionFence(forShareOrOptions);
}

export async function advanceCatalogRevision(trxOrClient) {
  const adapter = createVetClinicPersistenceAdapter(trxOrClient);
  return await adapter.advanceCatalogRevision();
}

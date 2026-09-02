import { ENUMS } from '../enums.js';
import { attachShortUuid, enumProperty, noDeleteActions, stripPopulatedPasswordHashes } from './resource-helpers.js';
import { searchVetClinicAddress } from './vet-clinics.geocoder.js';
import {
  VET_CLINIC_COLUMNS,
  isAuthorizedToOverride,
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
  advanceCatalogRevision,
} from './vet-clinics.mutations.js';

// Re-export domain and persistence symbols for callers and tests
export {
  VET_CLINIC_COLUMNS,
  isAuthorizedToOverride,
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
  advanceCatalogRevision,
};

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
  const connectionContext = pool || knex;

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

            const insertedClinic = await executeVetClinicTransaction(connectionContext, async (adapter) => {
              return await createVetClinicCommand(adapter, rawPayload, currentAdmin);
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

            const updatedClinic = await executeVetClinicTransaction(connectionContext, async (adapter) => {
              return await updateVetClinicCommand(adapter, recordId, rawPayload, currentAdmin);
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

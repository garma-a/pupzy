import { BaseRecord, ResourceDecorator } from 'adminjs';
import { ENUMS, toAvailableValues } from '../enums.js';
import { attachShortUuid, readOnlyActions, stripPopulatedPasswordHashes } from './resource-helpers.js';

export function parseCenterPoint(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') {
    const lat = Number(raw.lat ?? raw.latitude);
    const lng = Number(raw.lng ?? raw.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }
  if (typeof raw === 'string') {
    const str = raw.trim();
    const pointMatch = str.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (pointMatch) {
      return { lng: parseFloat(pointMatch[1]), lat: parseFloat(pointMatch[2]) };
    }
    const commaMatch = str.match(/^\s*([-\d.]+)\s*,\s*([-\d.]+)\s*$/);
    if (commaMatch) {
      return { lat: parseFloat(commaMatch[1]), lng: parseFloat(commaMatch[2]) };
    }
    if (/^[0-9a-fA-F]{42,}$/.test(str)) {
      try {
        const buf = Buffer.from(str, 'hex');
        if (buf.length >= 21) {
          const isLittleEndian = buf[0] === 1;
          const type = isLittleEndian ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
          const hasSrid = (type & 0x20000000) !== 0;
          const coordOffset = hasSrid ? 9 : 5;
          if (buf.length >= coordOffset + 16) {
            const lng = isLittleEndian ? buf.readDoubleLE(coordOffset) : buf.readDoubleBE(coordOffset);
            const lat = isLittleEndian ? buf.readDoubleLE(coordOffset + 8) : buf.readDoubleBE(coordOffset + 8);
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
            }
          }
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function formatCityTitle(city) {
  if (!city) return '';
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
  return name_english || name_arabic || city.id || '';
}

export class CityPresentationWrapper extends BaseRecord {
  title() {
    return formatCityTitle(this.params);
  }

  toJSON(currentAdmin) {
    const json = super.toJSON(currentAdmin);
    json.title = formatCityTitle(this.params);
    if (this.params?.center_point) {
      const coords = parseCenterPoint(this.params.center_point);
      if (coords) {
        json.params.center_point = `POINT(${coords.lng} ${coords.lat})`;
        json.params.latitude = coords.lat;
        json.params.longitude = coords.lng;
      }
    }
    return json;
  }
}

const originalTitleOf = ResourceDecorator.prototype.titleOf;
ResourceDecorator.prototype.titleOf = function (record) {
  if (this._resource?.id() === 'cities' || this.id() === 'cities') {
    return formatCityTitle(record?.params);
  }
  return originalTitleOf.call(this, record);
};

export function buildCitiesResource(db, components = {}) {
  const table = db?.table ? db.table('cities') : db;
  if (table && typeof table === 'object') {
    table.build = function (params) {
      return new CityPresentationWrapper(params, this);
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

  attachShortUuid(properties, ['id'], components, ['show']);

  return {
    resource: table,
    options: {
      navigation: { name: 'Reference Data', icon: 'Map' },
      properties,
      actions: {
        ...readOnlyActions,
        list: {
          after: stripPopulatedPasswordHashes,
          before: async (request) => {
            request.query = {
              ...request.query,
              'filters.status': 'OFFICIAL',
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
              request.query?.['filters.name_english'] ??
              request.query?.['filters.name_arabic'] ??
              request.query?.['filters.governorate'] ??
              '';
            const q = String(queryString).trim();

            const knex = resource.knex(resource.tableName);
            let qb = knex.where('status', 'OFFICIAL');
            if (q) {
              qb = qb.where((builder) => {
                builder
                  .whereILike('name_english', `%${q}%`)
                  .orWhereILike('name_arabic', `%${q}%`)
                  .orWhereILike('governorate', `%${q}%`);
              });
            }
            const rows = await qb.orderBy('name_english', 'asc').limit(50);
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
          after: async (response, request, context) => {
            const res = await stripPopulatedPasswordHashes(response, request, context);
            if (res.record?.params?.center_point) {
              const coords = parseCenterPoint(res.record.params.center_point);
              if (coords) {
                res.record.params.center_point = `POINT(${coords.lng} ${coords.lat})`;
                res.record.params.latitude = coords.lat;
                res.record.params.longitude = coords.lng;
              }
            }
            return res;
          },
        },
      },
      listProperties: ['name_english', 'name_arabic', 'governorate', 'source_code', 'status'],
      showProperties: [
        'id',
        'source_code',
        'name_english',
        'name_arabic',
        'governorate',
        'source_name_english',
        'source_name_arabic',
        'status',
        'center_point',
        'created_at',
      ],
      filterProperties: ['name_english', 'governorate', 'source_code'],
    },
  };
}

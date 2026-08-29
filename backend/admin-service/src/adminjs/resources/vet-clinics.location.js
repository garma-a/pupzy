import { ValidationError } from 'adminjs';

export const DEFAULT_EGYPT_BOUNDS = Object.freeze({
  minLat: parseFloat(process.env.EGYPT_MIN_LAT || '21.0'),
  maxLat: parseFloat(process.env.EGYPT_MAX_LAT || '32.0'),
  minLng: parseFloat(process.env.EGYPT_MIN_LNG || '24.0'),
  maxLng: parseFloat(process.env.EGYPT_MAX_LNG || '37.5'),
});

/**
 * Parses numeric latitude and longitude from various input formats
 * (discrete lat/lng fields, EWKT POINT(lng lat), lat,lng strings, JSON, or PostGIS EWKB hex).
 */
export function parseCoordinates(payload) {
  if (!payload) {
    return { lat: NaN, lng: NaN };
  }

  // 0. Direct string parsing (WKT, EWKT, comma-separated, JSON, or EWKB hex)
  if (typeof payload === 'string') {
    const raw = payload.trim();

    // Check for JSON string
    if (raw.startsWith('{') && raw.endsWith('}')) {
      try {
        const parsed = JSON.parse(raw);
        const lat = Number(parsed.latitude ?? parsed.lat);
        const lng = Number(parsed.longitude ?? parsed.lng);
        return { lat, lng };
      } catch {
        // Fall through to regex
      }
    }

    // PostGIS EWKT / WKT: POINT(longitude latitude) or SRID=4326;POINT(lng lat)
    const pointMatch = raw.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (pointMatch) {
      const lng = Number(pointMatch[1]);
      const lat = Number(pointMatch[2]);
      return { lat, lng };
    }

    // Comma-separated: "lat, lng" or "lat,lng"
    const commaMatch = raw.match(/^\s*([-\d.]+)\s*,\s*([-\d.]+)\s*$/);
    if (commaMatch) {
      const lat = Number(commaMatch[1]);
      const lng = Number(commaMatch[2]);
      return { lat, lng };
    }

    // PostGIS EWKB hex string (e.g. 0101000020E6100000...)
    if (/^[0-9a-fA-F]{42,}$/.test(raw)) {
      try {
        const bytes = new Uint8Array(raw.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
        const view = new DataView(bytes.buffer);
        const isLE = bytes[0] === 1;
        const type = view.getUint32(1, isLE);
        const hasSrid = (type & 0x20000000) !== 0;
        const offset = hasSrid ? 9 : 5;
        const lng = view.getFloat64(offset, isLE);
        const lat = view.getFloat64(offset + 8, isLE);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return {
            lat: Number(lat.toFixed(6)),
            lng: Number(lng.toFixed(6)),
          };
        }
      } catch {
        // Fall through
      }
    }

    return { lat: NaN, lng: NaN };
  }

  if (typeof payload !== 'object') {
    return { lat: NaN, lng: NaN };
  }

  // 1. Discrete latitude & longitude fields
  if (payload.latitude !== undefined && payload.longitude !== undefined) {
    const lat = Number(payload.latitude);
    const lng = Number(payload.longitude);
    return { lat, lng };
  }

  // 2. Nested coordinates properties (e.g. coordinates.latitude / coordinates.longitude)
  if (payload['coordinates.latitude'] !== undefined && payload['coordinates.longitude'] !== undefined) {
    const lat = Number(payload['coordinates.latitude']);
    const lng = Number(payload['coordinates.longitude']);
    return { lat, lng };
  }

  // 3. coordinates object
  if (typeof payload.coordinates === 'object' && payload.coordinates !== null) {
    const lat = Number(payload.coordinates.latitude ?? payload.coordinates.lat);
    const lng = Number(payload.coordinates.longitude ?? payload.coordinates.lng);
    return { lat, lng };
  }

  // 4. coordinates string
  if (typeof payload.coordinates === 'string') {
    return parseCoordinates(payload.coordinates);
  }

  return { lat: NaN, lng: NaN };
}

/**
 * Builds the canonical zero-key Google Maps search URL from stored coordinates.
 */
export function buildGoogleMapsUrl(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error(`Invalid WGS84 coordinates: latitude=${latitude}, longitude=${longitude}`);
  }
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', `${lat},${lng}`);
  return url.toString();
}

/**
 * Determines whether location-specific properties were modified in an edit payload
 * compared to the existing database record.
 *
 * Distinguishes unchanged submitted form values from an actual location change.
 */
export function isLocationModified(payload, existingRecord) {
  if (!payload || typeof payload !== 'object') return false;

  // If no existing record is provided (e.g. create / new), check if any location field is present
  if (!existingRecord || typeof existingRecord !== 'object') {
    const locationKeys = [
      'coordinates',
      'latitude',
      'longitude',
      'coordinates.latitude',
      'coordinates.longitude',
      'address_english',
      'address_arabic',
      'location_confirmed',
    ];

    for (const key of locationKeys) {
      if (payload[key] !== undefined && payload[key] !== '') {
        return true;
      }
    }

    if (payload.city_id !== undefined && payload.city_id !== '') {
      return true;
    }

    return false;
  }

  // 1. Explicit confirmation flag
  const isConfirmed =
    payload.location_confirmed === true ||
    payload.location_confirmed === 'true' ||
    payload.location_confirmed === 'on' ||
    payload.location_confirmed === 1 ||
    payload.location_confirmed === '1';

  if (isConfirmed) {
    return true;
  }

  // 2. City change check
  if (payload.city_id !== undefined) {
    const payloadCity = String(payload.city_id ?? '').trim();
    const existingCity = String(existingRecord.city_id ?? '').trim();
    if (payloadCity !== existingCity) {
      return true;
    }
  }

  // 3. Address (English) change check
  if (payload.address_english !== undefined) {
    const payloadEnglish = String(payload.address_english ?? '').trim();
    const existingEnglish = String(existingRecord.address_english ?? '').trim();
    if (payloadEnglish !== existingEnglish) {
      return true;
    }
  }

  // 4. Address (Arabic) change check
  if (payload.address_arabic !== undefined) {
    const payloadArabic = String(payload.address_arabic ?? '').trim();
    const existingArabic = String(existingRecord.address_arabic ?? '').trim();
    if (payloadArabic !== existingArabic) {
      return true;
    }
  }

  // 5. Legacy/general address change check
  if (payload.address !== undefined) {
    const payloadAddr = String(payload.address ?? '').trim();
    const existingAddr = String(existingRecord.address ?? '').trim();
    if (payloadAddr !== existingAddr) {
      return true;
    }
  }

  // 6. Coordinates change check
  const hasCoordFields =
    payload.latitude !== undefined ||
    payload.longitude !== undefined ||
    payload['coordinates.latitude'] !== undefined ||
    payload['coordinates.longitude'] !== undefined ||
    payload.coordinates !== undefined;

  if (hasCoordFields) {
    const payloadCoords = parseCoordinates(payload);
    const existingCoords = parseCoordinates(
      existingRecord.coordinates !== undefined ? { coordinates: existingRecord.coordinates } : existingRecord,
    );

    const hasPayloadCoords = Number.isFinite(payloadCoords.lat) && Number.isFinite(payloadCoords.lng);
    const hasExistingCoords = Number.isFinite(existingCoords.lat) && Number.isFinite(existingCoords.lng);

    if (hasPayloadCoords !== hasExistingCoords) {
      const rawPayload = typeof payload.coordinates === 'string' ? payload.coordinates.trim() : '';
      if (rawPayload !== '' || hasPayloadCoords) {
        return true;
      }
    } else if (hasPayloadCoords && hasExistingCoords) {
      const latDiff = Math.abs(payloadCoords.lat - existingCoords.lat);
      const lngDiff = Math.abs(payloadCoords.lng - existingCoords.lng);
      if (latDiff >= 1e-6 || lngDiff >= 1e-6) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Resolves the nearest official City to a given (latitude, longitude) coordinate point.
 * Uses PostGIS KNN indexing on center_point for high performance.
 */
export async function findNearestOfficialCity(clientOrKnex, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  // If using pg Client / Pool directly:
  if (typeof clientOrKnex?.query === 'function') {
    const { rows } = await clientOrKnex.query(
      `SELECT
         id,
         name_english,
         name_arabic,
         governorate,
         status,
         ROUND((ST_Distance(center_point::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0)::numeric, 2) AS distance_km
       FROM cities
       WHERE status = 'OFFICIAL'
       ORDER BY center_point <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
       LIMIT 1`,
      [lng, lat],
    );
    if (!rows[0]) return null;
    return {
      ...rows[0],
      distance_km: Number(rows[0].distance_km),
    };
  }

  // If using Knex:
  if (typeof clientOrKnex === 'function' || (clientOrKnex && typeof clientOrKnex.select === 'function')) {
    const knex = typeof clientOrKnex === 'function' ? clientOrKnex : clientOrKnex.knex || clientOrKnex;
    const queryBuilder = typeof knex === 'function' ? knex('cities') : knex;
    const rawFn = queryBuilder.client?.raw || queryBuilder.knex?.raw || queryBuilder.raw;

    let qb = queryBuilder
      .select(
        'id',
        'name_english',
        'name_arabic',
        'governorate',
        'status',
        rawFn
          ? rawFn(
              'ROUND((ST_Distance(center_point::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography) / 1000.0)::numeric, 2) as distance_km',
              [lng, lat],
            )
          : 'id',
      )
      .where('status', 'OFFICIAL');

    if (typeof qb.orderByRaw === 'function') {
      qb = qb.orderByRaw('center_point <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)', [lng, lat]);
    }
    if (typeof qb.limit === 'function') {
      qb = qb.limit(1);
    }

    const rows = await qb;
    if (!rows || !rows[0]) return null;
    return {
      ...rows[0],
      distance_km: rows[0].distance_km !== undefined ? Number(rows[0].distance_km) : 0,
    };
  }

  return null;
}

/**
 * Checks whether the selected City matches the nearest official City.
 * If they differ, returns discrepancy details and formatted explanation.
 */
export function checkCityDiscrepancy(selectedCity, nearestCity) {
  if (!selectedCity || !nearestCity) {
    return { isDiscrepant: false };
  }

  const isDiscrepant = selectedCity.id !== nearestCity.id;
  if (!isDiscrepant) {
    return { isDiscrepant: false };
  }

  const selectedName = selectedCity.name_english || selectedCity.name_arabic || 'Selected City';
  const selectedGov = selectedCity.governorate ? ` (${selectedCity.governorate})` : '';
  const nearestName = nearestCity.name_english || nearestCity.name_arabic || 'Nearest City';
  const nearestGov = nearestCity.governorate ? ` (${nearestCity.governorate})` : '';
  const distanceStr =
    nearestCity.distance_km !== undefined && !Number.isNaN(nearestCity.distance_km)
      ? ` (~${nearestCity.distance_km} km away)`
      : '';

  const explanation =
    `The selected point is closest to ${nearestName}${nearestGov}${distanceStr}, but ${selectedName}${selectedGov} was selected. ` +
    `City representative points are approximate centroids used for distance discovery, not exact administrative boundaries. ` +
    `To proceed with this selection, an active administrator must provide a nonblank override reason.`;

  return {
    isDiscrepant: true,
    selectedCity: {
      id: selectedCity.id,
      name_english: selectedCity.name_english,
      name_arabic: selectedCity.name_arabic,
      governorate: selectedCity.governorate,
    },
    nearestCity: {
      id: nearestCity.id,
      name_english: nearestCity.name_english,
      name_arabic: nearestCity.name_arabic,
      governorate: nearestCity.governorate,
      distance_km: nearestCity.distance_km,
    },
    explanation,
  };
}

/**
 * Validates and bounds an override reason string.
 */
export function readOverrideReason(value) {
  const reason = String(value ?? '').trim();
  if (!reason) {
    return { error: 'An override reason is required.' };
  }
  if (reason.length > 500) {
    return { error: 'Override reason must be at most 500 characters.' };
  }
  return { reason };
}

/**
 * Validates that an administrator confirmed a valid point and bilingual address.
 * Rejects missing confirmation, non-finite coordinates, invalid WGS84 ranges,
 * coordinates outside the configured Egypt region, and blank localized addresses.
 */
export function validateMappedLocation(payload, options = {}) {
  const bounds = { ...DEFAULT_EGYPT_BOUNDS, ...options };

  // 1. Explicit administrator confirmation
  const confirmed =
    payload.location_confirmed === true ||
    payload.location_confirmed === 'true' ||
    payload.location_confirmed === 'on' ||
    payload.location_confirmed === 1 ||
    payload.location_confirmed === '1';

  if (!confirmed) {
    throw new ValidationError({
      coordinates: { message: 'Location must be explicitly confirmed' },
    });
  }

  // 2. Bilingual addresses (non-blank after trimming)
  const addressEnglish = typeof payload.address_english === 'string' ? payload.address_english.trim() : '';
  if (!addressEnglish) {
    throw new ValidationError({
      address_english: { message: 'English address is required' },
    });
  }

  const addressArabic = typeof payload.address_arabic === 'string' ? payload.address_arabic.trim() : '';
  if (!addressArabic) {
    throw new ValidationError({
      address_arabic: { message: 'Arabic address is required' },
    });
  }

  // 3. Parse coordinates
  const { lat, lng } = parseCoordinates(payload);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ValidationError({
      coordinates: { message: 'Valid coordinates are required' },
    });
  }

  // 4. WGS84 bounds
  if (lat < -90 || lat > 90) {
    throw new ValidationError({
      coordinates: { message: 'Latitude must be between -90 and 90 degrees' },
    });
  }
  if (lng < -180 || lng > 180) {
    throw new ValidationError({
      coordinates: { message: 'Longitude must be between -180 and 180 degrees' },
    });
  }

  // 5. Configured Egypt region
  if (lat < bounds.minLat || lat > bounds.maxLat || lng < bounds.minLng || lng > bounds.maxLng) {
    throw new ValidationError({
      coordinates: {
        message: 'Coordinates are outside the configured Egypt region',
      },
    });
  }

  return {
    latitude: lat,
    longitude: lng,
    address_english: addressEnglish,
    address_arabic: addressArabic,
    address: addressEnglish || addressArabic,
    coordinatesStr: `SRID=4326;POINT(${lng} ${lat})`,
  };
}

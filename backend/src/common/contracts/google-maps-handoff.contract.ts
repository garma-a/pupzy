/**
 * Canonical Google Maps handoff contract.
 *
 * Validates finite WGS84 coordinates and builds the canonical zero-key
 * Google Maps search URL: https://www.google.com/maps/search/?api=1&query=${lat}%2C${lng}
 *
 * Shared between main GraphQL API (Vet Clinics resolver / service) and AdminJS.
 */

export const GOOGLE_MAPS_SEARCH_BASE_URL = 'https://www.google.com/maps/search/';

export const WGS84_BOUNDS = Object.freeze({
  minLat: -90,
  maxLat: 90,
  minLng: -180,
  maxLng: 180,
});

function formatCoordinateForError(coord: unknown): string {
  if (coord === null) return 'null';
  if (coord === undefined) return 'undefined';
  if (
    typeof coord === 'string' ||
    typeof coord === 'number' ||
    typeof coord === 'boolean' ||
    typeof coord === 'bigint'
  ) {
    return String(coord);
  }
  if (typeof coord === 'symbol') {
    return coord.toString();
  }
  return typeof coord;
}

/**
 * Validates that the provided latitude and longitude are finite numbers
 * within valid WGS84 bounds ([-90, 90] for latitude, [-180, 180] for longitude).
 *
 * Rejects null, undefined, boolean, symbols, objects, empty strings,
 * non-numeric strings, NaN, Infinity, -Infinity, and out-of-range values.
 *
 * @param latitude - Latitude coordinate (number or numeric string)
 * @param longitude - Longitude coordinate (number or numeric string)
 * @returns Validated numeric coordinates { latitude: number, longitude: number }
 * @throws {Error} If coordinates are invalid or out of WGS84 bounds
 */
export function validateWgs84Coordinates(
  latitude: unknown,
  longitude: unknown,
): { latitude: number; longitude: number } {
  if (
    latitude === null ||
    latitude === undefined ||
    longitude === null ||
    longitude === undefined ||
    typeof latitude === 'boolean' ||
    typeof longitude === 'boolean' ||
    typeof latitude === 'symbol' ||
    typeof longitude === 'symbol' ||
    typeof latitude === 'object' ||
    typeof longitude === 'object'
  ) {
    throw new Error(
      `Invalid WGS84 coordinates: latitude=${formatCoordinateForError(latitude)}, longitude=${formatCoordinateForError(longitude)}`,
    );
  }

  const latStr =
    typeof latitude === 'string'
      ? latitude.trim()
      : typeof latitude === 'number' || typeof latitude === 'bigint'
        ? String(latitude)
        : '';
  const lngStr =
    typeof longitude === 'string'
      ? longitude.trim()
      : typeof longitude === 'number' || typeof longitude === 'bigint'
        ? String(longitude)
        : '';

  if (latStr === '' || lngStr === '') {
    throw new Error(
      `Invalid WGS84 coordinates: latitude=${formatCoordinateForError(latitude)}, longitude=${formatCoordinateForError(longitude)}`,
    );
  }

  const lat = Number(latitude);
  const lng = Number(longitude);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < WGS84_BOUNDS.minLat ||
    lat > WGS84_BOUNDS.maxLat ||
    lng < WGS84_BOUNDS.minLng ||
    lng > WGS84_BOUNDS.maxLng
  ) {
    throw new Error(
      `Invalid WGS84 coordinates: latitude=${formatCoordinateForError(latitude)}, longitude=${formatCoordinateForError(longitude)}`,
    );
  }

  return { latitude: lat, longitude: lng };
}

/**
 * Checks whether coordinates are valid WGS84 coordinates without throwing.
 *
 * @param latitude - Latitude coordinate
 * @param longitude - Longitude coordinate
 * @returns true if valid finite WGS84 coordinates, false otherwise
 */
export function isValidWgs84Coordinates(latitude: unknown, longitude: unknown): boolean {
  try {
    validateWgs84Coordinates(latitude, longitude);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the canonical zero-key Google Maps search URL from validated coordinates.
 *
 * Coordinates are formatted in latitude,longitude order with standard URL-encoded
 * comma (%2C) under the ?api=1&query=${lat}%2C${lng} search schema.
 *
 * @param latitude - WGS84 latitude (-90 to 90)
 * @param longitude - WGS84 longitude (-180 to 180)
 * @returns Canonical Google Maps URL string
 * @throws {Error} If coordinates are invalid or out of bounds
 */
export function buildGoogleMapsUrl(latitude: unknown, longitude: unknown): string {
  const { latitude: lat, longitude: lng } = validateWgs84Coordinates(latitude, longitude);

  const url = new URL(GOOGLE_MAPS_SEARCH_BASE_URL);
  url.searchParams.set('api', '1');
  url.searchParams.set('query', `${lat},${lng}`);
  return url.toString();
}

/**
 * Safe variant of buildGoogleMapsUrl that returns null instead of throwing
 * when coordinates are invalid or missing.
 *
 * @param latitude - WGS84 latitude
 * @param longitude - WGS84 longitude
 * @returns Canonical Google Maps URL string or null
 */
export function tryBuildGoogleMapsUrl(latitude: unknown, longitude: unknown): string | null {
  try {
    return buildGoogleMapsUrl(latitude, longitude);
  } catch {
    return null;
  }
}

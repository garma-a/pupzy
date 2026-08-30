import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOGLE_MAPS_SEARCH_BASE_URL,
  WGS84_BOUNDS,
  validateWgs84Coordinates,
  isValidWgs84Coordinates,
  buildGoogleMapsUrl,
  tryBuildGoogleMapsUrl,
} from './google-maps-handoff.contract.js';

describe('AdminJS Google Maps Handoff Contract (Canonical Zero-Key Contract)', () => {
  describe('WGS84_BOUNDS and Constants', () => {
    it('defines standard WGS84 coordinate boundaries and search base URL', () => {
      assert.equal(GOOGLE_MAPS_SEARCH_BASE_URL, 'https://www.google.com/maps/search/');
      assert.equal(WGS84_BOUNDS.minLat, -90);
      assert.equal(WGS84_BOUNDS.maxLat, 90);
      assert.equal(WGS84_BOUNDS.minLng, -180);
      assert.equal(WGS84_BOUNDS.maxLng, 180);
      assert.equal(Object.isFrozen(WGS84_BOUNDS), true);
    });
  });

  describe('validateWgs84Coordinates', () => {
    it('accepts valid numeric coordinates within WGS84 bounds', () => {
      assert.deepEqual(validateWgs84Coordinates(30.0444, 31.2357), { latitude: 30.0444, longitude: 31.2357 });
      assert.deepEqual(validateWgs84Coordinates(-29.9602, -31.2569), { latitude: -29.9602, longitude: -31.2569 });
      assert.deepEqual(validateWgs84Coordinates(0, 0), { latitude: 0, longitude: 0 });
    });

    it('accepts valid numeric string coordinates within WGS84 bounds', () => {
      assert.deepEqual(validateWgs84Coordinates('30.0444', '31.2357'), { latitude: 30.0444, longitude: 31.2357 });
      assert.deepEqual(validateWgs84Coordinates('  29.9602  ', '  31.2569  '), {
        latitude: 29.9602,
        longitude: 31.2569,
      });
    });

    it('rejects invalid coordinates', () => {
      assert.throws(() => validateWgs84Coordinates(null, 31.2357), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(30.0444, null), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(true, 31.2357), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates('', 31.2357), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(91.0, 31.2357), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(30.0444, 181.0), /Invalid WGS84 coordinates/);
    });
  });

  describe('isValidWgs84Coordinates', () => {
    it('returns boolean safely without throwing', () => {
      assert.equal(isValidWgs84Coordinates(30.0444, 31.2357), true);
      assert.equal(isValidWgs84Coordinates(null, 31.2357), false);
      assert.equal(isValidWgs84Coordinates(91.0, 31.2357), false);
    });
  });

  describe('buildGoogleMapsUrl and tryBuildGoogleMapsUrl', () => {
    it('generates canonical zero-key search URL with %2C encoded comma', () => {
      const url = buildGoogleMapsUrl(30.0444, 31.2357);
      assert.equal(url, 'https://www.google.com/maps/search/?api=1&query=30.0444%2C31.2357');
    });

    it('tryBuildGoogleMapsUrl returns string or null', () => {
      assert.equal(
        tryBuildGoogleMapsUrl(30.0444, 31.2357),
        'https://www.google.com/maps/search/?api=1&query=30.0444%2C31.2357',
      );
      assert.equal(tryBuildGoogleMapsUrl(null, 31.2357), null);
    });
  });
});

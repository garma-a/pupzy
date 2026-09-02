import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOGLE_MAPS_SEARCH_BASE_URL,
  WGS84_BOUNDS,
  validateWgs84Coordinates,
  isValidWgs84Coordinates,
  buildGoogleMapsUrl,
  tryBuildGoogleMapsUrl,
} from '../../../../src/common/contracts/google-maps-handoff.contract.ts';

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

    it('accepts exact WGS84 boundary limits', () => {
      assert.deepEqual(validateWgs84Coordinates(90, 180), { latitude: 90, longitude: 180 });
      assert.deepEqual(validateWgs84Coordinates(-90, -180), { latitude: -90, longitude: -180 });
      assert.deepEqual(validateWgs84Coordinates(90, -180), { latitude: 90, longitude: -180 });
      assert.deepEqual(validateWgs84Coordinates(-90, 180), { latitude: -90, longitude: 180 });
    });

    it('rejects null and undefined coordinates', () => {
      assert.throws(() => validateWgs84Coordinates(null, 31.2357), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(30.0444, null), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(undefined, 31.2357), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(30.0444, undefined), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(null, null), /Invalid WGS84 coordinates/);
    });

    it('rejects boolean values', () => {
      assert.throws(() => validateWgs84Coordinates(true, 31.2357), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(30.0444, false), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(false, true), /Invalid WGS84 coordinates/);
    });

    it('rejects empty, blank, and whitespace strings', () => {
      assert.throws(() => validateWgs84Coordinates('', 31.2357), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(30.0444, '   '), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates('\t\n', '\n'), /Invalid WGS84 coordinates/);
    });

    it('rejects non-numeric strings and invalid number representations', () => {
      assert.throws(() => validateWgs84Coordinates('abc', 31.2357), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(30.0444, '31.23.57'), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates('NaN', 31.2357), /Invalid WGS84 coordinates/);
    });

    it('rejects NaN and non-finite Infinity numbers', () => {
      assert.throws(() => validateWgs84Coordinates(NaN, 31.2357), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(30.0444, Infinity), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(-Infinity, 31.2357), /Invalid WGS84 coordinates/);
    });

    it('rejects objects, arrays, and symbols', () => {
      assert.throws(() => validateWgs84Coordinates({}, 31.2357), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(30.0444, []), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(Symbol('lat'), 31.2357), /Invalid WGS84 coordinates/);
    });

    it('rejects coordinates outside WGS84 latitude boundaries ([-90, 90])', () => {
      assert.throws(() => validateWgs84Coordinates(90.0001, 31.2357), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(91.0, 31.2357), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(-90.0001, 31.2357), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(-91.0, 31.2357), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(1000, 31.2357), /Invalid WGS84 coordinates/);
    });

    it('rejects coordinates outside WGS84 longitude boundaries ([-180, 180])', () => {
      assert.throws(() => validateWgs84Coordinates(30.0444, 180.0001), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(30.0444, 181.0), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(30.0444, -180.0001), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(30.0444, -181.0), /Invalid WGS84 coordinates/);
      assert.throws(() => validateWgs84Coordinates(30.0444, 360), /Invalid WGS84 coordinates/);
    });
  });

  describe('isValidWgs84Coordinates', () => {
    it('returns true for valid coordinates', () => {
      assert.equal(isValidWgs84Coordinates(30.0444, 31.2357), true);
      assert.equal(isValidWgs84Coordinates('29.9602', '31.2569'), true);
      assert.equal(isValidWgs84Coordinates(0, 0), true);
      assert.equal(isValidWgs84Coordinates(90, 180), true);
    });

    it('returns false for invalid coordinates without throwing', () => {
      assert.equal(isValidWgs84Coordinates(null, 31.2357), false);
      assert.equal(isValidWgs84Coordinates(undefined, 31.2357), false);
      assert.equal(isValidWgs84Coordinates(true, false), false);
      assert.equal(isValidWgs84Coordinates('', '31.2357'), false);
      assert.equal(isValidWgs84Coordinates(NaN, 31.2357), false);
      assert.equal(isValidWgs84Coordinates(30.0444, Infinity), false);
      assert.equal(isValidWgs84Coordinates(91.0, 31.2357), false);
      assert.equal(isValidWgs84Coordinates(30.0444, 181.0), false);
    });
  });

  describe('buildGoogleMapsUrl', () => {
    it('generates canonical zero-key search URL with %2C encoded comma in latitude,longitude order', () => {
      const url = buildGoogleMapsUrl(30.0444, 31.2357);
      assert.equal(url, 'https://www.google.com/maps/search/?api=1&query=30.0444%2C31.2357');
    });

    it('preserves exact byte-for-byte compatibility with published Flutter-facing contract', () => {
      const cairoUrl = buildGoogleMapsUrl(30.0444, 31.2357);
      assert.equal(cairoUrl, 'https://www.google.com/maps/search/?api=1&query=30.0444%2C31.2357');

      const maadiUrl = buildGoogleMapsUrl(29.9602, 31.2569);
      assert.equal(maadiUrl, 'https://www.google.com/maps/search/?api=1&query=29.9602%2C31.2569');

      const alexUrl = buildGoogleMapsUrl(31.2001, 29.9187);
      assert.equal(alexUrl, 'https://www.google.com/maps/search/?api=1&query=31.2001%2C29.9187');
    });

    it('contains no API key, token, or billing parameters', () => {
      const url = buildGoogleMapsUrl(30.0444, 31.2357);
      const parsed = new URL(url);

      assert.equal(parsed.origin, 'https://www.google.com');
      assert.equal(parsed.pathname, '/maps/search/');
      assert.equal(parsed.searchParams.get('api'), '1');
      assert.equal(parsed.searchParams.get('query'), '30.0444,31.2357');
      assert.equal(parsed.searchParams.get('key'), null);
      assert.equal(parsed.searchParams.get('api_key'), null);
      assert.equal(parsed.searchParams.get('token'), null);
    });

    it('throws consistently for invalid coordinates', () => {
      assert.throws(() => buildGoogleMapsUrl(null, 31.2357), /Invalid WGS84 coordinates/);
      assert.throws(() => buildGoogleMapsUrl(false, true), /Invalid WGS84 coordinates/);
      assert.throws(() => buildGoogleMapsUrl(95.0, 31.2357), /Invalid WGS84 coordinates/);
      assert.throws(() => buildGoogleMapsUrl(30.0, 195.0), /Invalid WGS84 coordinates/);
    });
  });

  describe('tryBuildGoogleMapsUrl', () => {
    it('returns canonical URL for valid coordinates', () => {
      assert.equal(
        tryBuildGoogleMapsUrl(30.0444, 31.2357),
        'https://www.google.com/maps/search/?api=1&query=30.0444%2C31.2357',
      );
      assert.equal(
        tryBuildGoogleMapsUrl('29.9602', '31.2569'),
        'https://www.google.com/maps/search/?api=1&query=29.9602%2C31.2569',
      );
    });

    it('returns null for invalid, null, undefined, boolean, or out-of-range coordinates without throwing', () => {
      assert.equal(tryBuildGoogleMapsUrl(null, 31.2357), null);
      assert.equal(tryBuildGoogleMapsUrl(undefined, 31.2357), null);
      assert.equal(tryBuildGoogleMapsUrl(true, false), null);
      assert.equal(tryBuildGoogleMapsUrl('', ''), null);
      assert.equal(tryBuildGoogleMapsUrl('abc', 'def'), null);
      assert.equal(tryBuildGoogleMapsUrl(NaN, 31.2357), null);
      assert.equal(tryBuildGoogleMapsUrl(91.0, 31.2357), null);
      assert.equal(tryBuildGoogleMapsUrl(30.0, 185.0), null);
    });
  });
});

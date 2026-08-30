import {
  GOOGLE_MAPS_SEARCH_BASE_URL,
  WGS84_BOUNDS,
  validateWgs84Coordinates,
  isValidWgs84Coordinates,
  buildGoogleMapsUrl,
  tryBuildGoogleMapsUrl,
} from './google-maps-handoff.contract';

describe('Google Maps Handoff Contract (Canonical Zero-Key Contract)', () => {
  describe('WGS84_BOUNDS and Constants', () => {
    it('defines standard WGS84 coordinate boundaries and search base URL', () => {
      expect(GOOGLE_MAPS_SEARCH_BASE_URL).toBe('https://www.google.com/maps/search/');
      expect(WGS84_BOUNDS.minLat).toBe(-90);
      expect(WGS84_BOUNDS.maxLat).toBe(90);
      expect(WGS84_BOUNDS.minLng).toBe(-180);
      expect(WGS84_BOUNDS.maxLng).toBe(180);
      expect(Object.isFrozen(WGS84_BOUNDS)).toBe(true);
    });
  });

  describe('validateWgs84Coordinates', () => {
    it('accepts valid numeric coordinates within WGS84 bounds', () => {
      expect(validateWgs84Coordinates(30.0444, 31.2357)).toEqual({ latitude: 30.0444, longitude: 31.2357 });
      expect(validateWgs84Coordinates(-29.9602, -31.2569)).toEqual({ latitude: -29.9602, longitude: -31.2569 });
      expect(validateWgs84Coordinates(0, 0)).toEqual({ latitude: 0, longitude: 0 });
    });

    it('accepts valid numeric string coordinates within WGS84 bounds', () => {
      expect(validateWgs84Coordinates('30.0444', '31.2357')).toEqual({ latitude: 30.0444, longitude: 31.2357 });
      expect(validateWgs84Coordinates('  29.9602  ', '  31.2569  ')).toEqual({
        latitude: 29.9602,
        longitude: 31.2569,
      });
    });

    it('accepts exact WGS84 boundary limits', () => {
      expect(validateWgs84Coordinates(90, 180)).toEqual({ latitude: 90, longitude: 180 });
      expect(validateWgs84Coordinates(-90, -180)).toEqual({ latitude: -90, longitude: -180 });
      expect(validateWgs84Coordinates(90, -180)).toEqual({ latitude: 90, longitude: -180 });
      expect(validateWgs84Coordinates(-90, 180)).toEqual({ latitude: -90, longitude: 180 });
    });

    it('rejects null and undefined coordinates', () => {
      expect(() => validateWgs84Coordinates(null, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(30.0444, null)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(undefined, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(30.0444, undefined)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(null, null)).toThrow(/Invalid WGS84 coordinates/);
    });

    it('rejects boolean values', () => {
      expect(() => validateWgs84Coordinates(true, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(30.0444, false)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(false, true)).toThrow(/Invalid WGS84 coordinates/);
    });

    it('rejects empty, blank, and whitespace strings', () => {
      expect(() => validateWgs84Coordinates('', 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(30.0444, '   ')).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates('\t\n', '\n')).toThrow(/Invalid WGS84 coordinates/);
    });

    it('rejects non-numeric strings and invalid number representations', () => {
      expect(() => validateWgs84Coordinates('abc', 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(30.0444, '31.23.57')).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates('NaN', 31.2357)).toThrow(/Invalid WGS84 coordinates/);
    });

    it('rejects NaN and non-finite Infinity numbers', () => {
      expect(() => validateWgs84Coordinates(NaN, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(30.0444, Infinity)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(-Infinity, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
    });

    it('rejects objects, arrays, and symbols', () => {
      expect(() => validateWgs84Coordinates({}, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(30.0444, [])).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(Symbol('lat'), 31.2357)).toThrow(/Invalid WGS84 coordinates/);
    });

    it('rejects coordinates outside WGS84 latitude boundaries ([-90, 90])', () => {
      expect(() => validateWgs84Coordinates(90.0001, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(91.0, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(-90.0001, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(-91.0, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(1000, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
    });

    it('rejects coordinates outside WGS84 longitude boundaries ([-180, 180])', () => {
      expect(() => validateWgs84Coordinates(30.0444, 180.0001)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(30.0444, 181.0)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(30.0444, -180.0001)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(30.0444, -181.0)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => validateWgs84Coordinates(30.0444, 360)).toThrow(/Invalid WGS84 coordinates/);
    });
  });

  describe('isValidWgs84Coordinates', () => {
    it('returns true for valid coordinates', () => {
      expect(isValidWgs84Coordinates(30.0444, 31.2357)).toBe(true);
      expect(isValidWgs84Coordinates('29.9602', '31.2569')).toBe(true);
      expect(isValidWgs84Coordinates(0, 0)).toBe(true);
      expect(isValidWgs84Coordinates(90, 180)).toBe(true);
    });

    it('returns false for invalid coordinates without throwing', () => {
      expect(isValidWgs84Coordinates(null, 31.2357)).toBe(false);
      expect(isValidWgs84Coordinates(undefined, 31.2357)).toBe(false);
      expect(isValidWgs84Coordinates(true, false)).toBe(false);
      expect(isValidWgs84Coordinates('', '31.2357')).toBe(false);
      expect(isValidWgs84Coordinates(NaN, 31.2357)).toBe(false);
      expect(isValidWgs84Coordinates(30.0444, Infinity)).toBe(false);
      expect(isValidWgs84Coordinates(91.0, 31.2357)).toBe(false);
      expect(isValidWgs84Coordinates(30.0444, 181.0)).toBe(false);
    });
  });

  describe('buildGoogleMapsUrl', () => {
    it('generates canonical zero-key search URL with %2C encoded comma in latitude,longitude order', () => {
      const url = buildGoogleMapsUrl(30.0444, 31.2357);
      expect(url).toBe('https://www.google.com/maps/search/?api=1&query=30.0444%2C31.2357');
    });

    it('preserves exact byte-for-byte compatibility with published Flutter-facing contract', () => {
      const cairoUrl = buildGoogleMapsUrl(30.0444, 31.2357);
      expect(cairoUrl).toBe('https://www.google.com/maps/search/?api=1&query=30.0444%2C31.2357');

      const maadiUrl = buildGoogleMapsUrl(29.9602, 31.2569);
      expect(maadiUrl).toBe('https://www.google.com/maps/search/?api=1&query=29.9602%2C31.2569');

      const alexUrl = buildGoogleMapsUrl(31.2001, 29.9187);
      expect(alexUrl).toBe('https://www.google.com/maps/search/?api=1&query=31.2001%2C29.9187');
    });

    it('contains no API key, token, or billing parameters', () => {
      const url = buildGoogleMapsUrl(30.0444, 31.2357);
      const parsed = new URL(url);

      expect(parsed.origin).toBe('https://www.google.com');
      expect(parsed.pathname).toBe('/maps/search/');
      expect(parsed.searchParams.get('api')).toBe('1');
      expect(parsed.searchParams.get('query')).toBe('30.0444,31.2357');
      expect(parsed.searchParams.get('key')).toBeNull();
      expect(parsed.searchParams.get('api_key')).toBeNull();
      expect(parsed.searchParams.get('token')).toBeNull();
    });

    it('throws consistently for invalid coordinates', () => {
      expect(() => buildGoogleMapsUrl(null, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl(false, true)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl(95.0, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl(30.0, 195.0)).toThrow(/Invalid WGS84 coordinates/);
    });
  });

  describe('tryBuildGoogleMapsUrl', () => {
    it('returns canonical URL for valid coordinates', () => {
      expect(tryBuildGoogleMapsUrl(30.0444, 31.2357)).toBe(
        'https://www.google.com/maps/search/?api=1&query=30.0444%2C31.2357',
      );
      expect(tryBuildGoogleMapsUrl('29.9602', '31.2569')).toBe(
        'https://www.google.com/maps/search/?api=1&query=29.9602%2C31.2569',
      );
    });

    it('returns null for invalid, null, undefined, boolean, or out-of-range coordinates without throwing', () => {
      expect(tryBuildGoogleMapsUrl(null, 31.2357)).toBeNull();
      expect(tryBuildGoogleMapsUrl(undefined, 31.2357)).toBeNull();
      expect(tryBuildGoogleMapsUrl(true, false)).toBeNull();
      expect(tryBuildGoogleMapsUrl('', '')).toBeNull();
      expect(tryBuildGoogleMapsUrl('abc', 'def')).toBeNull();
      expect(tryBuildGoogleMapsUrl(NaN, 31.2357)).toBeNull();
      expect(tryBuildGoogleMapsUrl(91.0, 31.2357)).toBeNull();
      expect(tryBuildGoogleMapsUrl(30.0, 185.0)).toBeNull();
    });
  });
});

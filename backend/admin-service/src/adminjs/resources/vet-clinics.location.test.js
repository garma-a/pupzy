import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError } from 'adminjs';

import {
  parseCoordinates,
  buildGoogleMapsUrl,
  tryBuildGoogleMapsUrl,
  validateWgs84Coordinates,
  isValidWgs84Coordinates,
  GOOGLE_MAPS_SEARCH_BASE_URL,
  WGS84_BOUNDS,
  isLocationModified,
  validateMappedLocation,
  findNearestOfficialCity,
  checkCityDiscrepancy,
  readOverrideReason,
  DEFAULT_EGYPT_BOUNDS,
} from './vet-clinics.location.js';

describe('Vet Clinics Location Helpers & Validation', () => {
  describe('parseCoordinates', () => {
    it('parses discrete latitude and longitude numbers or strings', () => {
      const parsed1 = parseCoordinates({ latitude: 30.0444, longitude: 31.2357 });
      assert.equal(parsed1.lat, 30.0444);
      assert.equal(parsed1.lng, 31.2357);

      const parsed2 = parseCoordinates({ latitude: '29.9731', longitude: '31.2804' });
      assert.equal(parsed2.lat, 29.9731);
      assert.equal(parsed2.lng, 31.2804);
    });

    it('parses dotted property notation (coordinates.latitude / coordinates.longitude)', () => {
      const parsed = parseCoordinates({
        'coordinates.latitude': '30.05',
        'coordinates.longitude': '31.30',
      });
      assert.equal(parsed.lat, 30.05);
      assert.equal(parsed.lng, 31.3);
    });

    it('parses coordinates object', () => {
      const parsed = parseCoordinates({
        coordinates: { latitude: 30.05, longitude: 31.3 },
      });
      assert.equal(parsed.lat, 30.05);
      assert.equal(parsed.lng, 31.3);
    });

    it('parses PostGIS WKT and EWKT POINT(longitude latitude) strings', () => {
      const parsed1 = parseCoordinates({
        coordinates: 'SRID=4326;POINT(31.2357 30.0444)',
      });
      assert.equal(parsed1.lat, 30.0444);
      assert.equal(parsed1.lng, 31.2357);

      const parsed2 = parseCoordinates({
        coordinates: 'POINT(32.6537 25.6792)',
      });
      assert.equal(parsed2.lat, 25.6792);
      assert.equal(parsed2.lng, 32.6537);
    });

    it('parses comma-separated lat, lng strings', () => {
      const parsed = parseCoordinates({ coordinates: '30.0444, 31.2357' });
      assert.equal(parsed.lat, 30.0444);
      assert.equal(parsed.lng, 31.2357);
    });

    it('parses JSON coordinates strings', () => {
      const parsed = parseCoordinates({
        coordinates: JSON.stringify({ latitude: 30.0444, longitude: 31.2357 }),
      });
      assert.equal(parsed.lat, 30.0444);
      assert.equal(parsed.lng, 31.2357);
    });

    it('parses PostGIS EWKB hex strings', () => {
      const buf = Buffer.alloc(25);
      buf.writeUInt8(1, 0); // Little Endian
      buf.writeUInt32LE(0x20000001, 1); // 2D Point with SRID
      buf.writeUInt32LE(4326, 5); // SRID 4326
      buf.writeDoubleLE(31.2357, 9); // Longitude
      buf.writeDoubleLE(30.0444, 17); // Latitude
      const ewkbHex = buf.toString('hex');

      const parsed = parseCoordinates({ coordinates: ewkbHex });
      assert.equal(parsed.lat, 30.0444);
      assert.equal(parsed.lng, 31.2357);
    });

    it('parses direct string inputs without payload wrapper', () => {
      const parsed1 = parseCoordinates('SRID=4326;POINT(31.2357 30.0444)');
      assert.equal(parsed1.lat, 30.0444);
      assert.equal(parsed1.lng, 31.2357);

      const parsed2 = parseCoordinates('30.0444, 31.2357');
      assert.equal(parsed2.lat, 30.0444);
      assert.equal(parsed2.lng, 31.2357);
    });

    it('parses City objects with center_point property and record params wrappers', () => {
      const cityObject = {
        id: 'city-cairo',
        name_english: 'Cairo',
        center_point: 'SRID=4326;POINT(31.2357 30.0444)',
      };
      const parsedCity = parseCoordinates(cityObject);
      assert.equal(parsedCity.lat, 30.0444);
      assert.equal(parsedCity.lng, 31.2357);

      const recordWrapper = {
        params: {
          coordinates: 'SRID=4326;POINT(31.2569 29.9602)',
        },
      };
      const parsedRecord = parseCoordinates(recordWrapper);
      assert.equal(parsedRecord.lat, 29.9602);
      assert.equal(parsedRecord.lng, 31.2569);
    });

    it('returns NaN for invalid or empty inputs', () => {
      assert.equal(Number.isNaN(parseCoordinates(null).lat), true);
      assert.equal(Number.isNaN(parseCoordinates({}).lat), true);
      assert.equal(Number.isNaN(parseCoordinates('   ').lat), true);
      assert.equal(Number.isNaN(parseCoordinates({ coordinates: 'gibberish' }).lat), true);
    });
  });

  describe('Google Maps Handoff Contract & buildGoogleMapsUrl', () => {
    it('generates canonical zero-key search URL with %2C encoded comma', () => {
      const url = buildGoogleMapsUrl(30.0444, 31.2357);
      assert.equal(url, 'https://www.google.com/maps/search/?api=1&query=30.0444%2C31.2357');
      assert.equal(url.includes('key='), false);
      assert.equal(url.includes('api_key='), false);
      assert.equal(GOOGLE_MAPS_SEARCH_BASE_URL, 'https://www.google.com/maps/search/');
    });

    it('rejects non-finite coordinates', () => {
      assert.throws(() => buildGoogleMapsUrl(NaN, 31.2357), /Invalid WGS84/);
      assert.throws(() => buildGoogleMapsUrl(30.0444, Infinity), /Invalid WGS84/);
    });

    it('rejects null, undefined, empty, or boolean coordinates', () => {
      assert.throws(() => buildGoogleMapsUrl(null, 31.2357), /Invalid WGS84/);
      assert.throws(() => buildGoogleMapsUrl(30.0444, null), /Invalid WGS84/);
      assert.throws(() => buildGoogleMapsUrl(undefined, 31.2357), /Invalid WGS84/);
      assert.throws(() => buildGoogleMapsUrl(30.0444, undefined), /Invalid WGS84/);
      assert.throws(() => buildGoogleMapsUrl('', 31.2357), /Invalid WGS84/);
      assert.throws(() => buildGoogleMapsUrl(30.0444, '   '), /Invalid WGS84/);
      assert.throws(() => buildGoogleMapsUrl(false, 31.2357), /Invalid WGS84/);
      assert.throws(() => buildGoogleMapsUrl(30.0444, true), /Invalid WGS84/);
    });

    it('rejects coordinates outside WGS84 ranges', () => {
      assert.throws(() => buildGoogleMapsUrl(91.0, 31.2357), /Invalid WGS84/);
      assert.throws(() => buildGoogleMapsUrl(-90.1, 31.2357), /Invalid WGS84/);
      assert.throws(() => buildGoogleMapsUrl(30.0, 180.1), /Invalid WGS84/);
      assert.throws(() => buildGoogleMapsUrl(30.0, -180.1), /Invalid WGS84/);
    });

    it('validates WGS84 coordinates accurately', () => {
      assert.deepEqual(validateWgs84Coordinates(30.0444, 31.2357), { latitude: 30.0444, longitude: 31.2357 });
      assert.deepEqual(validateWgs84Coordinates('29.9602', '31.2569'), { latitude: 29.9602, longitude: 31.2569 });
      assert.equal(isValidWgs84Coordinates(30.0444, 31.2357), true);
      assert.equal(isValidWgs84Coordinates(null, 31.2357), false);
      assert.equal(isValidWgs84Coordinates(95.0, 31.2357), false);
      assert.equal(WGS84_BOUNDS.minLat, -90);
      assert.equal(WGS84_BOUNDS.maxLat, 90);
    });

    it('tryBuildGoogleMapsUrl returns URL on valid coordinates and null on invalid coordinates without throwing', () => {
      assert.equal(
        tryBuildGoogleMapsUrl(30.0444, 31.2357),
        'https://www.google.com/maps/search/?api=1&query=30.0444%2C31.2357',
      );
      assert.equal(tryBuildGoogleMapsUrl(null, 31.2357), null);
      assert.equal(tryBuildGoogleMapsUrl(NaN, 31.2357), null);
      assert.equal(tryBuildGoogleMapsUrl(95.0, 31.2357), null);
      assert.equal(tryBuildGoogleMapsUrl('', ''), null);
    });
  });

  describe('isLocationModified', () => {
    it('returns true when coordinates, address, or confirmation fields are present on create without existing record', () => {
      assert.equal(isLocationModified({ coordinates: 'POINT(31 30)' }), true);
      assert.equal(isLocationModified({ latitude: 30, longitude: 31 }), true);
      assert.equal(isLocationModified({ address_english: '123 Nile St' }), true);
      assert.equal(isLocationModified({ address_arabic: 'شارع النيل' }), true);
      assert.equal(isLocationModified({ location_confirmed: 'true' }), true);
      assert.equal(isLocationModified({ city_id: 'city-1' }), true);
    });

    it('returns false for non-location edits (e.g. name, phone, is_active)', () => {
      assert.equal(
        isLocationModified(
          { name_english: 'Updated Clinic', phone_number: '+201012345678', is_active: false },
          { city_id: 'city-1' },
        ),
        false,
      );
    });

    it('returns false when edit form resubmits unchanged location fields (coordinates, city, addresses)', () => {
      const existing = {
        city_id: 'city-1',
        coordinates: 'SRID=4326;POINT(31.2569 29.9602)',
        address_english: '10 Road 9, Maadi',
        address_arabic: '١٠ شارع ٩، المعادي',
      };

      const submittedForm = {
        name_english: 'Updated Clinic Name',
        phone_number: '+201099887766',
        city_id: 'city-1',
        coordinates: 'SRID=4326;POINT(31.2569 29.9602)',
        latitude: 29.9602,
        longitude: 31.2569,
        address_english: '10 Road 9, Maadi',
        address_arabic: '١٠ شارع ٩، المعادي',
        location_confirmed: false,
      };

      assert.equal(isLocationModified(submittedForm, existing), false);
    });

    it('returns false when unchanged fields have equivalent coordinates or whitespace', () => {
      const existing = {
        city_id: 'city-1',
        coordinates: 'SRID=4326;POINT(31.256900 29.960200)',
        address_english: '10 Road 9, Maadi',
        address_arabic: '١٠ شارع ٩، المعادي',
      };

      const payload = {
        name_english: 'Updated Name',
        city_id: 'city-1',
        latitude: '29.9602',
        longitude: '31.2569',
        address_english: '  10 Road 9, Maadi  ',
        address_arabic: '  ١٠ شارع ٩، المعادي  ',
      };

      assert.equal(isLocationModified(payload, existing), false);
    });

    it('returns false when existing record has null/empty location properties and payload submits empty string', () => {
      const existing = {
        city_id: null,
        address_arabic: null,
        address_english: 'Some St',
      };

      const payload = {
        name_english: 'Updated Name',
        city_id: '',
        address_arabic: '',
        address_english: 'Some St',
      };

      assert.equal(isLocationModified(payload, existing), false);
    });

    it('returns true when city_id is changed from existing record', () => {
      assert.equal(isLocationModified({ city_id: 'new-city' }, { city_id: 'old-city' }), true);
      assert.equal(isLocationModified({ city_id: 'new-city' }, { city_id: null }), true);
    });

    it('returns true when coordinates are changed from existing record', () => {
      const existing = {
        coordinates: 'SRID=4326;POINT(31.2569 29.9602)',
      };

      assert.equal(isLocationModified({ latitude: 30.0444, longitude: 31.2357 }, existing), true);
      assert.equal(isLocationModified({ coordinates: 'POINT(31.30 30.05)' }, existing), true);
    });

    it('returns true when address_english or address_arabic is changed', () => {
      const existing = {
        address_english: '10 Road 9',
        address_arabic: '١٠ شارع ٩',
      };

      assert.equal(isLocationModified({ address_english: '20 Road 9' }, existing), true);
      assert.equal(isLocationModified({ address_arabic: '٢٠ شارع ٩' }, existing), true);
    });

    it('returns true when location_confirmed is explicitly set to true', () => {
      const existing = {
        city_id: 'city-1',
        coordinates: 'SRID=4326;POINT(31.2569 29.9602)',
        address_english: '10 Road 9',
        address_arabic: '١٠ شارع ٩',
      };

      assert.equal(isLocationModified({ location_confirmed: true }, existing), true);
      assert.equal(isLocationModified({ location_confirmed: 'true' }, existing), true);
    });
  });

  describe('validateMappedLocation', () => {
    const validPayload = {
      location_confirmed: true,
      address_english: '10 Road 9, Maadi',
      address_arabic: '١٠ شارع ٩، المعادي',
      latitude: 29.9602,
      longitude: 31.2569,
    };

    it('accepts valid Egyptian coordinates and confirmed bilingual address', () => {
      const result = validateMappedLocation(validPayload);
      assert.equal(result.latitude, 29.9602);
      assert.equal(result.longitude, 31.2569);
      assert.equal(result.address_english, '10 Road 9, Maadi');
      assert.equal(result.address_arabic, '١٠ شارع ٩، المعادي');
      assert.equal(result.address, '10 Road 9, Maadi');
      assert.equal(result.coordinatesStr, 'SRID=4326;POINT(31.2569 29.9602)');
    });

    it('rejects unconfirmed location', () => {
      assert.throws(
        () => validateMappedLocation({ ...validPayload, location_confirmed: false }),
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.match(err.propertyErrors.coordinates.message, /confirmed/i);
          return true;
        },
      );
    });

    it('rejects blank English address', () => {
      assert.throws(
        () => validateMappedLocation({ ...validPayload, address_english: '   ' }),
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.match(err.propertyErrors.address_english.message, /English address is required/i);
          return true;
        },
      );
    });

    it('rejects blank Arabic address', () => {
      assert.throws(
        () => validateMappedLocation({ ...validPayload, address_arabic: '' }),
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.match(err.propertyErrors.address_arabic.message, /Arabic address is required/i);
          return true;
        },
      );
    });

    it('rejects non-finite coordinates', () => {
      assert.throws(
        () => validateMappedLocation({ ...validPayload, latitude: NaN }),
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.match(err.propertyErrors.coordinates.message, /Valid coordinates/i);
          return true;
        },
      );
    });

    it('rejects coordinates outside WGS84 range', () => {
      assert.throws(
        () => validateMappedLocation({ ...validPayload, latitude: 95.0 }),
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.match(err.propertyErrors.coordinates.message, /between -90 and 90/i);
          return true;
        },
      );
    });

    it('rejects coordinates outside configured Egypt bounding region', () => {
      // Latitude 51.5 (London) is outside Egypt [21.0, 32.0]
      assert.throws(
        () => validateMappedLocation({ ...validPayload, latitude: 51.5074, longitude: -0.1278 }),
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.match(err.propertyErrors.coordinates.message, /Egypt region/i);
          return true;
        },
      );

      // Longitude 45.0 (Saudi Arabia / Iraq) is outside Egypt [24.0, 37.5]
      assert.throws(
        () => validateMappedLocation({ ...validPayload, latitude: 30.0, longitude: 45.0 }),
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.match(err.propertyErrors.coordinates.message, /Egypt region/i);
          return true;
        },
      );
    });
  });

  describe('checkCityDiscrepancy', () => {
    it('returns isDiscrepant = false when selected city matches nearest city', () => {
      const city = { id: 'city-1', name_english: 'Maadi', governorate: 'Cairo' };
      const nearest = { id: 'city-1', name_english: 'Maadi', governorate: 'Cairo', distance_km: 0.5 };
      const res = checkCityDiscrepancy(city, nearest);
      assert.equal(res.isDiscrepant, false);
    });

    it('returns isDiscrepant = true with explanation when cities differ', () => {
      const selected = { id: 'city-1', name_english: 'Maadi', name_arabic: 'المعادي', governorate: 'Cairo' };
      const nearest = {
        id: 'city-2',
        name_english: 'El Basatin',
        name_arabic: 'البساتين',
        governorate: 'Cairo',
        distance_km: 1.5,
      };
      const res = checkCityDiscrepancy(selected, nearest);
      assert.equal(res.isDiscrepant, true);
      assert.equal(res.selectedCity.id, 'city-1');
      assert.equal(res.nearestCity.id, 'city-2');
      assert.match(res.explanation, /closest to El Basatin/);
      assert.match(res.explanation, /Maadi.*was selected/);
      assert.match(res.explanation, /approximate centroids/);
      assert.match(res.explanation, /override reason/);
    });

    it('handles null or undefined inputs gracefully', () => {
      assert.equal(checkCityDiscrepancy(null, null).isDiscrepant, false);
      assert.equal(checkCityDiscrepancy({ id: '1' }, null).isDiscrepant, false);
    });
  });

  describe('readOverrideReason', () => {
    it('accepts a nonblank reason within 500 characters', () => {
      const res = readOverrideReason('  Clinic is on the border between Maadi and Basatin.  ');
      assert.equal(res.error, undefined);
      assert.equal(res.reason, 'Clinic is on the border between Maadi and Basatin.');
    });

    it('rejects missing or empty reason', () => {
      assert.equal(readOverrideReason('').error, 'An override reason is required.');
      assert.equal(readOverrideReason('   ').error, 'An override reason is required.');
      assert.equal(readOverrideReason(null).error, 'An override reason is required.');
      assert.equal(readOverrideReason(undefined).error, 'An override reason is required.');
    });

    it('rejects reason exceeding 500 characters', () => {
      const longReason = 'a'.repeat(501);
      const res = readOverrideReason(longReason);
      assert.equal(res.error, 'Override reason must be at most 500 characters.');
    });
  });

  describe('findNearestOfficialCity', () => {
    it('returns null for non-finite coordinates', async () => {
      const res = await findNearestOfficialCity(null, NaN, 31.2);
      assert.equal(res, null);
    });

    it('queries pg pool/client directly with ST_Distance and KNN sort', async () => {
      const fakeClient = {
        query: async (sqlStr, params) => {
          assert.match(sqlStr, /center_point <->/);
          assert.match(sqlStr, /ST_Distance/);
          assert.equal(params[0], 31.25);
          assert.equal(params[1], 29.96);
          return {
            rows: [
              {
                id: 'city-maadi',
                name_english: 'Maadi',
                name_arabic: 'المعادي',
                governorate: 'Cairo',
                status: 'OFFICIAL',
                distance_km: '1.23',
              },
            ],
          };
        },
      };

      const result = await findNearestOfficialCity(fakeClient, 29.96, 31.25);
      assert.ok(result);
      assert.equal(result.id, 'city-maadi');
      assert.equal(result.distance_km, 1.23);
    });
  });
});

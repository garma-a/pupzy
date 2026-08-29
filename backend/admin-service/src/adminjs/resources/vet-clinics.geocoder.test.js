import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  normalizeQuery,
  sanitizeNominatimResults,
  UpstreamRateLimiter,
  fetchFromNominatim,
  searchVetClinicAddress,
  getCachedGeocode,
  setCachedGeocode,
  DEFAULT_NOMINATIM_CONFIG,
} from './vet-clinics.geocoder.js';
import { DEFAULT_EGYPT_BOUNDS } from './vet-clinics.location.js';

describe('Vet Clinics Geocoder & Address Search', () => {
  describe('normalizeQuery', () => {
    it('trims leading and trailing whitespace and collapses consecutive spaces', () => {
      assert.equal(normalizeQuery('   Maadi   Degla   '), 'maadi degla');
      assert.equal(normalizeQuery('Cairo\n\tCity'), 'cairo city');
    });

    it('lowercases ASCII and applies unicode NFC normalization', () => {
      assert.equal(normalizeQuery('ALEXANDRIA'), 'alexandria');
      assert.equal(normalizeQuery('المعادي'), 'المعادي');
    });

    it('returns empty string for non-string, null, or empty inputs', () => {
      assert.equal(normalizeQuery(''), '');
      assert.equal(normalizeQuery('   '), '');
      assert.equal(normalizeQuery(null), '');
      assert.equal(normalizeQuery(undefined), '');
      assert.equal(normalizeQuery(123), '');
    });
  });

  describe('sanitizeNominatimResults', () => {
    const validRawResults = [
      {
        place_id: 123456,
        licence: 'Data © OpenStreetMap contributors',
        osm_type: 'node',
        osm_id: 987654321,
        lat: '30.044420',
        lon: '31.235712',
        class: 'amenity',
        type: 'veterinary',
        place_rank: 30,
        importance: 0.5,
        display_name: 'Pupzy Vet Clinic, 10 Road 9, Maadi, Cairo, Egypt',
        address: {
          road: 'Road 9',
          suburb: 'Maadi',
          city: 'Cairo',
          state: 'Cairo Governorate',
          country: 'Egypt',
          postcode: '11728',
        },
        boundingbox: ['30.04', '30.05', '31.23', '31.24'],
        extra_internal_debug_info: 'secret_leak',
      },
    ];

    it('allow-lists output fields and strips unneeded or internal properties', () => {
      const sanitized = sanitizeNominatimResults(validRawResults);
      assert.equal(sanitized.length, 1);
      const item = sanitized[0];

      assert.equal(item.displayName, 'Pupzy Vet Clinic, 10 Road 9, Maadi, Cairo, Egypt');
      assert.equal(item.latitude, 30.04442);
      assert.equal(item.longitude, 31.235712);
      assert.equal(item.osmId, '987654321');
      assert.equal(item.osmType, 'node');
      assert.equal(item.category, 'amenity');
      assert.equal(item.type, 'veterinary');
      assert.equal(item.address.road, 'Road 9');
      assert.equal(item.address.suburb, 'Maadi');
      assert.equal(item.address.city, 'Cairo');
      assert.equal(item.address.state, 'Cairo Governorate');

      // Internal properties stripped
      assert.equal('place_id' in item, false);
      assert.equal('licence' in item, false);
      assert.equal('boundingbox' in item, false);
      assert.equal('extra_internal_debug_info' in item, false);
    });

    it('filters out non-finite or out-of-bounds coordinates', () => {
      const invalidResults = [
        { display_name: '', lat: '30.04', lon: '31.23' },
        { lat: '30.04', lon: '31.23' },
      ];
      const sanitized = sanitizeNominatimResults(invalidResults);
      assert.equal(sanitized.length, 0);
    });

    it('caps output results at 5 items', () => {
      const manyResults = Array.from({ length: 10 }, (_, i) => ({
        display_name: `Clinic ${i}`,
        lat: '30.04',
        lon: '31.23',
        osm_id: i,
      }));
      const sanitized = sanitizeNominatimResults(manyResults);
      assert.equal(sanitized.length, 5);
    });
  });

  describe('UpstreamRateLimiter', () => {
    it('enforces minIntervalMs between consecutive upstream invocations', async () => {
      const limiter = new UpstreamRateLimiter({ minIntervalMs: 50 });
      const timestamps = [];

      const p1 = limiter.schedule(async () => {
        timestamps.push(Date.now());
        return 'first';
      });
      const p2 = limiter.schedule(async () => {
        timestamps.push(Date.now());
        return 'second';
      });
      const p3 = limiter.schedule(async () => {
        timestamps.push(Date.now());
        return 'third';
      });

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      assert.equal(r1, 'first');
      assert.equal(r2, 'second');
      assert.equal(r3, 'third');
      assert.equal(timestamps.length, 3);
      assert.ok(
        timestamps[1] - timestamps[0] >= 40,
        `Expected >=40ms elapsed between 1 and 2, got ${timestamps[1] - timestamps[0]}`,
      );
      assert.ok(
        timestamps[2] - timestamps[1] >= 40,
        `Expected >=40ms elapsed between 2 and 3, got ${timestamps[2] - timestamps[1]}`,
      );
    });

    it('continues processing subsequent requests if a scheduled call throws', async () => {
      const limiter = new UpstreamRateLimiter({ minIntervalMs: 10 });
      await assert.rejects(
        () =>
          limiter.schedule(async () => {
            throw new Error('Boom');
          }),
        /Boom/,
      );

      const next = await limiter.schedule(async () => 'recovered');
      assert.equal(next, 'recovered');
    });
  });

  describe('fetchFromNominatim', () => {
    it('sends identifying User-Agent and Egypt search parameters to upstream', async () => {
      let interceptedUrl = null;
      let interceptedHeaders = null;

      const fakeFetch = async (url, options) => {
        interceptedUrl = new URL(url);
        interceptedHeaders = options.headers;
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              display_name: 'Maadi Clinic',
              lat: '29.96',
              lon: '31.25',
              osm_id: '123',
            },
          ],
        };
      };

      const results = await fetchFromNominatim({
        query: 'maadi clinic',
        endpoint: 'https://test-nominatim.local/search',
        userAgent: 'PupzyTest/1.0 (test@pupzy.app)',
        timeoutMs: 3000,
        fetchFn: fakeFetch,
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].displayName, 'Maadi Clinic');
      assert.equal(interceptedUrl.origin, 'https://test-nominatim.local');
      assert.equal(interceptedUrl.searchParams.get('q'), 'maadi clinic');
      assert.equal(interceptedUrl.searchParams.get('format'), 'jsonv2');
      assert.equal(interceptedUrl.searchParams.get('countrycodes'), 'eg');
      assert.equal(interceptedUrl.searchParams.get('limit'), '5');
      assert.equal(interceptedUrl.searchParams.get('addressdetails'), '1');
      assert.equal(interceptedHeaders['User-Agent'], 'PupzyTest/1.0 (test@pupzy.app)');
    });

    it('handles upstream HTTP error responses by throwing descriptive error', async () => {
      const fakeFetch = async () => ({
        ok: false,
        status: 503,
      });

      await assert.rejects(
        () =>
          fetchFromNominatim({
            query: 'cairo',
            endpoint: 'https://test-nominatim.local/search',
            fetchFn: fakeFetch,
          }),
        /HTTP 503/,
      );
    });

    it('handles upstream timeout by aborting with timeout error', async () => {
      const slowFetch = async (url, options) => {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            reject(new Error('Nominatim request timed out after 50ms'));
          });
        });
      };

      await assert.rejects(
        () =>
          fetchFromNominatim({
            query: 'cairo',
            endpoint: 'https://test-nominatim.local/search',
            timeoutMs: 50,
            fetchFn: slowFetch,
          }),
        /timed out/,
      );
    });
  });

  describe('searchVetClinicAddress workflow', () => {
    it('returns empty result for queries shorter than 2 characters without network or DB call', async () => {
      const result = await searchVetClinicAddress({
        query: 'a',
        fetchFn: async () => {
          throw new Error('Should not be called');
        },
      });
      assert.equal(result.source, 'EMPTY');
      assert.deepEqual(result.results, []);
    });

    it('returns disabled result when search is disabled via config', async () => {
      const result = await searchVetClinicAddress({
        query: 'maadi clinic',
        config: { enabled: false },
        fetchFn: async () => {
          throw new Error('Should not be called');
        },
      });
      assert.equal(result.source, 'DISABLED');
      assert.equal(result.disabled, true);
      assert.deepEqual(result.results, []);
      assert.match(result.message, /disabled/i);
    });

    it('checks database cache and returns cached results on cache hit without calling upstream', async () => {
      const fakeClient = {
        query: async (sqlStr, params) => {
          assert.match(sqlStr, /SELECT results FROM address_search_cache/);
          assert.equal(params[0], 'maadi vet');
          return {
            rows: [
              {
                results: [
                  {
                    displayName: 'Cached Maadi Vet',
                    latitude: 29.96,
                    longitude: 31.25,
                    osmId: '999',
                  },
                ],
              },
            ],
          };
        },
      };

      const result = await searchVetClinicAddress({
        query: '  Maadi   Vet  ',
        pool: fakeClient,
        fetchFn: async () => {
          throw new Error('Upstream must not be called on cache hit');
        },
      });

      assert.equal(result.source, 'CACHE');
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].displayName, 'Cached Maadi Vet');
    });

    it('fetches upstream on cache miss, caches results in DB, and returns results', async () => {
      let insertedQuery = null;
      let insertedResults = null;

      const fakeClient = {
        query: async (sqlStr, params) => {
          if (sqlStr.includes('SELECT')) {
            return { rows: [] }; // Cache miss
          }
          if (sqlStr.includes('INSERT INTO address_search_cache')) {
            insertedQuery = params[0];
            insertedResults = JSON.parse(params[1]);
            return { rows: [] };
          }
          return { rows: [] };
        },
      };

      const fakeFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => [
          {
            display_name: 'Zamalek Vet Clinic, 26th July St, Cairo',
            lat: '30.06',
            lon: '31.22',
            osm_id: '888',
          },
        ],
      });

      const limiter = new UpstreamRateLimiter({ minIntervalMs: 0 });

      const result = await searchVetClinicAddress({
        query: 'Zamalek Vet Clinic',
        pool: fakeClient,
        fetchFn: fakeFetch,
        rateLimiter: limiter,
      });

      assert.equal(result.source, 'UPSTREAM');
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].displayName, 'Zamalek Vet Clinic, 26th July St, Cairo');
      assert.equal(insertedQuery, 'zamalek vet clinic');
      assert.equal(insertedResults.length, 1);
      assert.equal(insertedResults[0].osmId, '888');
    });

    it('gracefully degrades on upstream failure and returns error notice with manual map guidance', async () => {
      const fakeClient = {
        query: async () => ({ rows: [] }),
      };

      const failingFetch = async () => ({
        ok: false,
        status: 500,
      });

      const limiter = new UpstreamRateLimiter({ minIntervalMs: 0 });

      const result = await searchVetClinicAddress({
        query: 'Failing Search',
        pool: fakeClient,
        fetchFn: failingFetch,
        rateLimiter: limiter,
      });

      assert.equal(result.source, 'ERROR');
      assert.deepEqual(result.results, []);
      assert.ok(result.error);
      assert.match(result.message, /pin the clinic location manually/i);
    });
  });
});

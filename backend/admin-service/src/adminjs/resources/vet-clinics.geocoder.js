import { DEFAULT_EGYPT_BOUNDS } from './vet-clinics.location.js';

export const DEFAULT_NOMINATIM_CONFIG = Object.freeze({
  url: process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search',
  userAgent: process.env.NOMINATIM_USER_AGENT || 'PupzyAdmin/1.0 (contact@pupzy.app)',
  attribution:
    process.env.NOMINATIM_ATTRIBUTION ||
    'Data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ODbL 1.0',
  enabled: process.env.NOMINATIM_ENABLED !== 'false' && process.env.NOMINATIM_ENABLED !== false,
  timeoutMs: parseInt(process.env.NOMINATIM_TIMEOUT_MS || '5000', 10),
  rateLimitMs: parseInt(process.env.NOMINATIM_RATE_LIMIT_MS || '1000', 10),
});

/**
 * Normalizes query string for caching and upstream querying.
 * Trims whitespace, lowercases, NFC normalizes, and collapses spaces.
 */
export function normalizeQuery(query) {
  if (typeof query !== 'string') return '';
  const trimmed = query.trim();
  if (!trimmed) return '';
  return trimmed
    .toLowerCase()
    .normalize('NFC')
    .replace(/\s+/g, ' ');
}

/**
 * Serializes upstream requests so at most one request is made per minIntervalMs.
 */
export class UpstreamRateLimiter {
  constructor({ minIntervalMs = 1000 } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.lastRequestTimestamp = 0;
    this.queue = Promise.resolve();
  }

  async schedule(fn) {
    const run = async () => {
      const now = Date.now();
      const elapsed = now - this.lastRequestTimestamp;
      if (this.lastRequestTimestamp > 0 && elapsed < this.minIntervalMs) {
        const waitMs = this.minIntervalMs - elapsed;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      this.lastRequestTimestamp = Date.now();
      return fn();
    };

    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  reset() {
    this.lastRequestTimestamp = 0;
    this.queue = Promise.resolve();
  }
}

export const defaultRateLimiter = new UpstreamRateLimiter({ minIntervalMs: 1000 });

/**
 * Sanitizes and bounds results from Nominatim.
 * Allow-lists output fields and filters out coordinates outside Egypt.
 */
export function sanitizeNominatimResults(rawList, bounds = DEFAULT_EGYPT_BOUNDS) {
  if (!Array.isArray(rawList)) return [];

  const sanitized = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;

    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    if (
      lat < bounds.minLat ||
      lat > bounds.maxLat ||
      lng < bounds.minLng ||
      lng > bounds.maxLng
    ) {
      continue;
    }

    const displayName = typeof item.display_name === 'string' ? item.display_name.trim() : '';
    if (!displayName) continue;

    const osmId = item.osm_id != null ? String(item.osm_id) : null;
    const osmType = typeof item.osm_type === 'string' ? item.osm_type : null;
    const category =
      typeof item.category === 'string'
        ? item.category
        : typeof item.class === 'string'
          ? item.class
          : null;
    const type = typeof item.type === 'string' ? item.type : null;

    const addr = item.address && typeof item.address === 'object' ? item.address : {};
    const road = addr.road || addr.street || addr.pedestrian || null;
    const suburb = addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district || null;
    const city = addr.city || addr.town || addr.municipality || addr.village || null;
    const state = addr.state || addr.governorate || null;

    sanitized.push({
      displayName,
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lng.toFixed(6)),
      osmId,
      osmType,
      category,
      type,
      address: {
        road: road ? String(road).trim() : null,
        suburb: suburb ? String(suburb).trim() : null,
        city: city ? String(city).trim() : null,
        state: state ? String(state).trim() : null,
      },
    });

    if (sanitized.length >= 5) break;
  }

  return sanitized;
}

/**
 * Retrieves cached geocoding results for a normalized query from PostgreSQL.
 */
export async function getCachedGeocode(clientOrKnex, normalizedQuery) {
  if (!clientOrKnex || !normalizedQuery) return null;

  if (typeof clientOrKnex.query === 'function') {
    try {
      const { rows } = await clientOrKnex.query(
        `SELECT results FROM address_search_cache WHERE normalized_query = $1 LIMIT 1`,
        [normalizedQuery],
      );
      return rows[0]?.results ?? null;
    } catch {
      return null;
    }
  }

  if (typeof clientOrKnex === 'function' || (clientOrKnex && typeof clientOrKnex.select === 'function')) {
    try {
      const knex = typeof clientOrKnex === 'function' ? clientOrKnex : clientOrKnex.knex || clientOrKnex;
      const qb = typeof knex === 'function' ? knex('address_search_cache') : knex;
      const rows = await qb.select('results').where('normalized_query', normalizedQuery).limit(1);
      return rows[0]?.results ?? null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Stores geocoding results in the durable PostgreSQL cache.
 */
export async function setCachedGeocode(clientOrKnex, normalizedQuery, results) {
  if (!clientOrKnex || !normalizedQuery || !Array.isArray(results)) return;
  const resultsJson = JSON.stringify(results);

  if (typeof clientOrKnex.query === 'function') {
    try {
      await clientOrKnex.query(
        `INSERT INTO address_search_cache (id, normalized_query, results, created_at, updated_at)
         VALUES (uuidv7(), $1, $2::jsonb, now(), now())
         ON CONFLICT (normalized_query) DO UPDATE
           SET results = EXCLUDED.results, updated_at = now()`,
        [normalizedQuery, resultsJson],
      );
    } catch {
      // Non-blocking on cache write error
    }
    return;
  }

  if (typeof clientOrKnex === 'function' || (clientOrKnex && typeof clientOrKnex.select === 'function')) {
    try {
      const knex = typeof clientOrKnex === 'function' ? clientOrKnex : clientOrKnex.knex || clientOrKnex;
      const rawFn = knex.raw || (typeof knex === 'function' ? knex.client?.raw : null);
      if (rawFn) {
        await knex.raw(
          `INSERT INTO address_search_cache (id, normalized_query, results, created_at, updated_at)
           VALUES (uuidv7(), ?, ?::jsonb, now(), now())
           ON CONFLICT (normalized_query) DO UPDATE
             SET results = EXCLUDED.results, updated_at = now()`,
          [normalizedQuery, resultsJson],
        );
      }
    } catch {
      // Non-blocking on cache write error
    }
  }
}

/**
 * Executes an upstream request to Nominatim with identifying headers,
 * bounds, and timeout.
 */
export async function fetchFromNominatim({
  query,
  endpoint = 'https://nominatim.openstreetmap.org/search',
  userAgent = 'PupzyAdmin/1.0 (contact@pupzy.app)',
  timeoutMs = 5000,
  bounds = DEFAULT_EGYPT_BOUNDS,
  fetchFn = globalThis.fetch,
}) {
  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('countrycodes', 'eg');
  url.searchParams.set('limit', '5');
  url.searchParams.set('addressdetails', '1');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Nominatim request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    const response = await fetchFn(url.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        Accept: 'application/json',
        'Accept-Language': 'en,ar;q=0.9',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Nominatim upstream error: HTTP ${response.status}`);
    }

    const json = await response.json();
    return sanitizeNominatimResults(json, bounds);
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Public search entry point for Vet Clinic address search.
 * Checks normalization, cache, rate limits upstream, and degrades gracefully on failure.
 */
export async function searchVetClinicAddress({
  query,
  pool = null,
  knex = null,
  config = {},
  fetchFn = globalThis.fetch,
  rateLimiter = defaultRateLimiter,
}) {
  const mergedConfig = {
    url: config.url || DEFAULT_NOMINATIM_CONFIG.url,
    userAgent: config.userAgent || DEFAULT_NOMINATIM_CONFIG.userAgent,
    attribution: config.attribution || DEFAULT_NOMINATIM_CONFIG.attribution,
    enabled:
      config.enabled !== undefined
        ? config.enabled
        : DEFAULT_NOMINATIM_CONFIG.enabled,
    timeoutMs: config.timeoutMs || DEFAULT_NOMINATIM_CONFIG.timeoutMs,
    rateLimitMs: config.rateLimitMs || DEFAULT_NOMINATIM_CONFIG.rateLimitMs,
  };

  const normalized = normalizeQuery(query);
  if (!normalized || normalized.length < 2) {
    return {
      results: [],
      source: 'EMPTY',
      query: normalized,
      attribution: mergedConfig.attribution,
    };
  }

  const enabled =
    mergedConfig.enabled !== false &&
    mergedConfig.enabled !== 'false' &&
    mergedConfig.enabled !== 0 &&
    mergedConfig.enabled !== '0';

  if (!enabled) {
    return {
      results: [],
      source: 'DISABLED',
      disabled: true,
      query: normalized,
      attribution: mergedConfig.attribution,
      message: 'Address search is currently disabled.',
    };
  }

  const dbClient = pool || knex;

  // 1. Check PostgreSQL durable cache
  if (dbClient) {
    const cached = await getCachedGeocode(dbClient, normalized);
    if (cached && Array.isArray(cached)) {
      return {
        results: cached,
        source: 'CACHE',
        query: normalized,
        attribution: mergedConfig.attribution,
      };
    }
  }

  // 2. Fetch from upstream with application-wide rate limiter
  try {
    const results = await rateLimiter.schedule(() =>
      fetchFromNominatim({
        query: normalized,
        endpoint: mergedConfig.url,
        userAgent: mergedConfig.userAgent,
        timeoutMs: mergedConfig.timeoutMs,
        bounds: DEFAULT_EGYPT_BOUNDS,
        fetchFn,
      }),
    );

    // 3. Cache results in database
    if (dbClient) {
      await setCachedGeocode(dbClient, normalized, results);
    }

    return {
      results,
      source: 'UPSTREAM',
      query: normalized,
      attribution: mergedConfig.attribution,
    };
  } catch (err) {
    return {
      results: [],
      source: 'ERROR',
      error: err.message || 'Geocoding upstream failed',
      query: normalized,
      attribution: mergedConfig.attribution,
      message:
        'Address search is currently unavailable. You can click on the map to pin the clinic location manually.',
    };
  }
}

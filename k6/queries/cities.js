// k6/queries/cities.js
// Public query — returns all Egyptian cities.
// No auth token required. Response is cached in-process after the first call.

import { gqlPublic } from '../lib/gql.js';

const CITIES_QUERY = `
  query Cities {
    cities {
      id
      nameEnglish
      nameArabic
      governorate
    }
  }
`;

/**
 * Fetch all cities (unauthenticated, cached on server).
 * @returns {{ data: any, errors: any[], ok: boolean, status: number }}
 */
export function getCities() {
  return gqlPublic(CITIES_QUERY, {}, 'cities');
}

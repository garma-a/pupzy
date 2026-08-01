// k6/queries/me.js
// Authenticated `me` query — returns the current user's profile.

import { gql } from '../lib/gql.js';

const ME_QUERY = `
  query Me {
    me {
      id
      fullName
      email
      profileComplete
      homeCityId
      isVerified
      postCount
    }
  }
`;

/**
 * Fetch the authenticated user's own profile.
 *
 * @param {string} token - Firebase ID token
 * @returns {{ data: any, errors: any[], ok: boolean, status: number }}
 */
export function getMe(token) {
  return gql(ME_QUERY, {}, token, 'me');
}

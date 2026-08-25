// k6/queries/mutations.js
// Mutation helpers: recordView, toggleUpvote, toggleSave,
// createRescuePost, createAdoptionPost.
//
// Also re-exports getMe and getCities here so test orchestrators can import
// everything from a single mutations module.

import { gql } from '../lib/gql.js';
import { gqlPublic } from '../lib/gql.js';

// ─── Mutation / query strings ─────────────────────────────────────────────────

const RECORD_VIEW = `
  mutation RecordView($postId: ID!) {
    recordView(postId: $postId)
  }
`;

const TOGGLE_UPVOTE = `
  mutation ToggleUpvote($postId: ID!) {
    toggleUpvote(postId: $postId) {
      id
      upvoteCount
      isUpvotedByMe
      effectiveScore
    }
  }
`;

const TOGGLE_SAVE = `
  mutation ToggleSave($postId: ID!) {
    toggleSave(postId: $postId) {
      id
      saveCount
      isSavedByMe
      effectiveScore
    }
  }
`;

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

const UPDATE_MY_LOCATION = `
  mutation UpdateMyLocation($location: LocationInput!) {
    updateMyLocation(location: $location) {
      id
    }
  }
`;

const CREATE_RESCUE_POST = `
  mutation CreateRescuePost($input: CreateRescuePostInput!) {
    createRescuePost(input: $input) {
      id
      title
      status
      postType
      createdAt
      city { nameEnglish }
    }
  }
`;

const CREATE_ADOPTION_POST = `
  mutation CreateAdoptionPost($input: CreateAdoptionPostInput!) {
    createAdoptionPost(input: $input) {
      id
      title
      status
      postType
      createdAt
    }
  }
`;

const UPDATE_POST_STATUS = `
  mutation UpdatePostStatus($postId: ID!, $status: PostStatus!) {
    updatePostStatus(postId: $postId, status: $status) {
      id
      status
    }
  }
`;

const DELETE_POST = `
  mutation DeletePost($id: ID!) {
    deletePost(id: $id)
  }
`;

// ─── Exported helpers ─────────────────────────────────────────────────────────

/**
 * recordView — fire-and-forget; writes to an in-memory buffer only.
 * The ViewFlushCron persists the buffer to DB every 3 minutes.
 *
 * @param {string} token
 * @param {string} postId
 */
export function recordView(token, postId) {
  return gql(RECORD_VIEW, { postId }, token, 'recordView');
}

/**
 * toggleUpvote — 5-query DB transaction (the heaviest write path).
 *
 * @param {string} token
 * @param {string} postId
 */
export function toggleUpvote(token, postId) {
  return gql(TOGGLE_UPVOTE, { postId }, token, 'toggleUpvote');
}

/**
 * toggleSave — 5-query DB transaction.
 *
 * @param {string} token
 * @param {string} postId
 */
export function toggleSave(token, postId) {
  return gql(TOGGLE_SAVE, { postId }, token, 'toggleSave');
}

/**
 * Fetch the authenticated user's own profile.
 *
 * @param {string} token
 */
export function getMe(token) {
  return gql(ME_QUERY, {}, token, 'me');
}

/**
 * Fetch all cities (public, cached on server).
 */
export function getCities() {
  return gqlPublic(CITIES_QUERY, {}, 'cities');
}

/**
 * Update the current user's live location.
 *
 * @param {string} token
 * @param {{ latitude: number, longitude: number }} location
 */
export function updateMyLocation(token, location) {
  return gql(UPDATE_MY_LOCATION, { location }, token, 'me');
}

/**
 * Create a RESCUE post. Inserts into 3 tables (posts, rescue_post_details, post_media).
 *
 * @param {string} token
 * @param {{ cityId: string, latitude: number, longitude: number }} params
 */
export function createRescuePost(token, { cityId, latitude, longitude }) {
  return gql(
    CREATE_RESCUE_POST,
    {
      input: {
        title:            'K6 Test — Injured Cat Near School',
        description:      'Load test post. Small orange cat with injury on right leg near the school gate. Please ignore.',
        cityId,
        coordinates:      { latitude, longitude },
        urgency:          'URGENT',
        species:          'CAT',
        conditionSummary: 'Right leg injury, alert and responsive',
        reporterRole:     'ON_SITE',
      },
    },
    token,
    'createPost',
  );
}

/**
 * Create an ADOPTION post. Inserts into 3 tables.
 *
 * @param {string} token
 * @param {{ cityId: string, latitude: number, longitude: number }} params
 */
export function createAdoptionPost(token, { cityId, latitude, longitude }) {
  return gql(
    CREATE_ADOPTION_POST,
    {
      input: {
        title:                       'K6 Test — Adult Dog Needs Home',
        description:                 'Load test post. Friendly adult male dog looking for a loving home. Please ignore.',
        cityId,
        coordinates:                 { latitude, longitude },
        petName:                     'Rex',
        species:                     'DOG',
        gender:                      'MALE',
        vaccinated:                  true,
        neutered:                    false,
        priorPetExperienceRequired:  false,
      },
    },
    token,
    'createPost',
  );
}

/**
 * Update the status of a post owned by the current user.
 *
 * @param {string} token
 * @param {string} postId
 * @param {string} status - 'ACTIVE' | 'RESOLVED' | 'EXPIRED'
 */
export function updatePostStatus(token, postId, status) {
  return gql(UPDATE_POST_STATUS, { postId, status }, token, 'createPost');
}

/**
 * Delete a post owned by the current user.
 *
 * @param {string} token
 * @param {string} id
 */
export function deletePost(token, id) {
  return gql(DELETE_POST, { id }, token, 'createPost');
}

// k6/queries/feeds.js
// Feed query helpers: helpFeed, adoptFeed, marketFeed, homeFeed.
//
// These are the heaviest endpoints in the system — all hit PostGIS.
// helpFeedWithGeo additionally uses ST_DWithin + ST_Distance on the coordinates column.
//
// Tag mapping (used for per-endpoint threshold breakdown in config.js):
//   helpFeedNoGeo  → endpoint: 'helpFeed'
//   helpFeedWithGeo→ endpoint: 'helpFeed_geo'
//   adoptFeed*     → endpoint: 'adoptFeed'
//   marketFeed*    → endpoint: 'marketFeed'
//   homeFeed       → endpoint: 'homeFeed'

import { gql } from '../lib/gql.js';

// ─── Query strings ────────────────────────────────────────────────────────────
// Raw template literals — no gql tag (k6 has no GraphQL client).

const HELP_FEED_QUERY = `
  query HelpFeed(
    $governorate: String!
    $cityId: ID
    $viewerLocation: ViewerLocationInput
    $radiusKm: Float
    $first: Int
    $after: String
  ) {
    helpFeed(
      governorate: $governorate
      cityId: $cityId
      viewerLocation: $viewerLocation
      radiusKm: $radiusKm
      first: $first
      after: $after
    ) {
      edges {
        node {
          id
          title
          postType
          urgency
          status
          upvoteCount
          viewCount
          createdAt
          creator { id fullName }
          city { id nameEnglish }
          media { publicUrl displayOrder }
          coordinates { latitude longitude }
        }
        cursor
        distanceKm
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const ADOPT_FEED_QUERY = `
  query AdoptFeed(
    $governorate: String!
    $cityId: ID
    $viewerLocation: ViewerLocationInput
    $radiusKm: Float
    $sort: AdoptFeedSort
    $first: Int
    $after: String
  ) {
    adoptFeed(
      governorate: $governorate
      cityId: $cityId
      viewerLocation: $viewerLocation
      radiusKm: $radiusKm
      sort: $sort
      first: $first
      after: $after
    ) {
      edges {
        node {
          id
          title
          postType
          effectiveScore
          upvoteCount
          saveCount
          viewCount
          createdAt
          creator { id fullName }
          city { id nameEnglish }
          media { publicUrl displayOrder }
          isUpvotedByMe
          isSavedByMe
        }
        cursor
        distanceKm
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const MARKET_FEED_QUERY = `
  query MarketFeed(
    $governorate: String!
    $cityId: ID
    $viewerLocation: ViewerLocationInput
    $radiusKm: Float
    $category: ProductCategory
    $sort: MarketFeedSort
    $first: Int
    $after: String
  ) {
    marketFeed(
      governorate: $governorate
      cityId: $cityId
      viewerLocation: $viewerLocation
      radiusKm: $radiusKm
      category: $category
      sort: $sort
      first: $first
      after: $after
    ) {
      edges {
        node {
          id
          title
          postType
          marketCategory
          effectiveScore
          viewCount
          saveCount
          createdAt
          creator { id fullName }
          city { id nameEnglish }
          media { publicUrl displayOrder }
          isSavedByMe
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const HOME_FEED_QUERY = `
  query HomeFeed(
    $governorate: String!
    $cityId: ID
    $viewerLocation: ViewerLocationInput
    $radiusKm: Float
    $first: Int
    $after: String
  ) {
    homeFeed(
      governorate: $governorate
      cityId: $cityId
      viewerLocation: $viewerLocation
      radiusKm: $radiusKm
      first: $first
      after: $after
    ) {
      edges {
        node {
          id
          title
          postType
          urgency
          effectiveScore
          upvoteCount
          viewCount
          saveCount
          createdAt
          creator { id fullName }
          city { id nameEnglish }
          media { publicUrl displayOrder }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// ─── Exported helpers ─────────────────────────────────────────────────────────

/**
 * helpFeed WITHOUT viewer location.
 * Filters by governorate only — no ST_DWithin.
 * Fastest variant; use to establish the baseline latency.
 *
 * @param {string} token
 * @param {string} governorate
 * @param {number} [first=20]
 */
export function helpFeedNoGeo(token, governorate, first = 20) {
  return gql(HELP_FEED_QUERY, { governorate, first }, token, 'helpFeed');
}

/**
 * helpFeed WITH viewer location.
 * Triggers ST_DWithin + ST_Distance on the PostGIS coordinates column.
 * This is the most expensive read path.
 *
 * @param {string} token
 * @param {string} governorate
 * @param {{ latitude: number, longitude: number }} viewerLocation
 * @param {number} [radiusKm=25]
 * @param {number} [first=20]
 */
export function helpFeedWithGeo(token, governorate, viewerLocation, radiusKm = 25, first = 20) {
  return gql(
    HELP_FEED_QUERY,
    { governorate, viewerLocation, radiusKm, first },
    token,
    'helpFeed_geo',
  );
}

/**
 * helpFeed — next page via cursor.
 *
 * @param {string} token
 * @param {string} governorate
 * @param {string} after - endCursor from previous page
 * @param {number} [first=20]
 */
export function helpFeedNextPage(token, governorate, after, first = 20) {
  return gql(HELP_FEED_QUERY, { governorate, first, after }, token, 'helpFeed');
}

/**
 * adoptFeed sorted by HOT (effectiveScore DESC).
 *
 * @param {string} token
 * @param {string} governorate
 * @param {number} [first=20]
 */
export function adoptFeedHot(token, governorate, first = 20) {
  return gql(ADOPT_FEED_QUERY, { governorate, sort: 'HOT', first }, token, 'adoptFeed');
}

/**
 * adoptFeed sorted by NEWEST (createdAt DESC).
 *
 * @param {string} token
 * @param {string} governorate
 * @param {number} [first=20]
 */
export function adoptFeedNewest(token, governorate, first = 20) {
  return gql(ADOPT_FEED_QUERY, { governorate, sort: 'NEWEST', first }, token, 'adoptFeed');
}

/**
 * adoptFeed with a cursor (pagination).
 *
 * @param {string} token
 * @param {string} governorate
 * @param {string} sort - 'HOT' | 'NEWEST'
 * @param {string} after - endCursor
 * @param {number} [first=20]
 */
export function adoptFeedPage(token, governorate, sort, after, first = 20) {
  return gql(ADOPT_FEED_QUERY, { governorate, sort, first, after }, token, 'adoptFeed');
}

/**
 * marketFeed with optional category filter.
 *
 * @param {string}      token
 * @param {string}      governorate
 * @param {string|null} [category=null] - ProductCategory enum value or null for all
 * @param {string}      [sort='HOT']
 * @param {number}      [first=20]
 */
export function marketFeedHot(token, governorate, category = null, sort = 'HOT', first = 20) {
  return gql(MARKET_FEED_QUERY, { governorate, category, sort, first }, token, 'marketFeed');
}

/**
 * marketFeed paginated.
 *
 * @param {string}      token
 * @param {string}      governorate
 * @param {string}      after
 * @param {string|null} [category=null]
 * @param {string}      [sort='HOT']
 * @param {number}      [first=20]
 */
export function marketFeedPage(token, governorate, after, category = null, sort = 'HOT', first = 20) {
  return gql(MARKET_FEED_QUERY, { governorate, category, sort, first, after }, token, 'marketFeed');
}

/**
 * homeFeed — mixed feed across all post types.
 *
 * @param {string} token
 * @param {string} governorate
 * @param {number} [first=20]
 */
export function homeFeed(token, governorate, first = 20) {
  return gql(HOME_FEED_QUERY, { governorate, first }, token, 'homeFeed');
}

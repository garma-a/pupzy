// k6/queries/post-detail.js
// Post detail query helpers: post (generic), rescuePostDetail, lostPostDetail,
// adoptionPostDetail, productPostDetail.
//
// All require authentication. The `post` query is the heavier variant —
// it includes virtually all fields. The type-specific `*Detail` queries fetch
// only the polymorphic fields for the given post type.

import { gql } from '../lib/gql.js';

// ─── Query strings ─────────────────────────────────────────────────────────────

const POST_QUERY = `
  query Post($id: ID!) {
    post(id: $id) {
      id
      title
      description
      postType
      status
      urgency
      upvoteCount
      saveCount
      viewCount
      effectiveScore
      areaName
      coordinates { latitude longitude }
      creator {
        id
        fullName
        profilePictureUrl
        isVerified
      }
      city {
        id
        nameEnglish
        governorate
      }
      media {
        publicUrl
        displayOrder
        width
        height
      }
      isUpvotedByMe
      isSavedByMe
      createdAt
      updatedAt
    }
  }
`;

const RESCUE_DETAIL_QUERY = `
  query RescueDetail($postId: ID!) {
    rescuePostDetail(postId: $postId) {
      postId
      species
      conditionSummary
      reporterRole
    }
  }
`;

const LOST_DETAIL_QUERY = `
  query LostDetail($postId: ID!) {
    lostPostDetail(postId: $postId) {
      postId
      petName
      species
      breed
      lastSeenAt
      lastSeenAddress
    }
  }
`;

const ADOPTION_DETAIL_QUERY = `
  query AdoptionDetail($postId: ID!) {
    adoptionPostDetail(postId: $postId) {
      postId
      petName
      species
      breed
      ageValue
      ageUnit
      gender
      vaccinated
      neutered
      healthNotes
      personalityTags
      spaceRequirement
      priorPetExperienceRequired
      additionalRequirements
      currentlyWith
    }
  }
`;

const PRODUCT_DETAIL_QUERY = `
  query ProductDetail($postId: ID!) {
    productPostDetail(postId: $postId) {
      postId
      category
      condition
      priceAmount
      priceCurrency
      isFree
      openToOffers
    }
  }
`;

// ─── Exported helpers ─────────────────────────────────────────────────────────

/**
 * Generic post query — fetches all shared fields + relationships.
 *
 * @param {string} token
 * @param {string} id - Post UUID
 */
export function getPost(token, id) {
  return gql(POST_QUERY, { id }, token, 'post');
}

/**
 * Rescue-post-specific detail fields.
 *
 * @param {string} token
 * @param {string} postId
 */
export function getRescueDetail(token, postId) {
  return gql(RESCUE_DETAIL_QUERY, { postId }, token, 'postDetail');
}

/**
 * Lost-post-specific detail fields.
 *
 * @param {string} token
 * @param {string} postId
 */
export function getLostDetail(token, postId) {
  return gql(LOST_DETAIL_QUERY, { postId }, token, 'postDetail');
}

/**
 * Adoption-post-specific detail fields.
 *
 * @param {string} token
 * @param {string} postId
 */
export function getAdoptionDetail(token, postId) {
  return gql(ADOPTION_DETAIL_QUERY, { postId }, token, 'postDetail');
}

/**
 * Product-post-specific detail fields.
 *
 * @param {string} token
 * @param {string} postId
 */
export function getProductDetail(token, postId) {
  return gql(PRODUCT_DETAIL_QUERY, { postId }, token, 'postDetail');
}

# Pet Mating (تزاوج) Feature & Hardening — Frontend Handoff Pack

> **Audience:** Frontend / Flutter Engineers (Matheo and team)  
> **Backend Version:** Pupzy Backend v2.0  
> **Status:** Production-Ready (Verified with comprehensive test suite, zero type errors)

---

## 1. Overview

**Pet Mating (تزاوج)** enables pet owners to publish listings searching for a suitable mating partner (same species, matching breed, opposite gender) while keeping their own pet.

### Core Architectural Principles
1. **Naming & Identity:** The domain keyword is `Mating` (`mating_posts`, `createMatingPost`, `matingFeed`, `matingPostDetail`).
2. **Class Table Inheritance (CTI):** The parent `Post` entity holds common metadata (`id`, `title`, `description`, `city`, `media`, `status`, etc.). Specific mating attributes (`petName`, `species`, `breed`, `gender`, `ageValue`, `ageUnit`, `isPurebred`, `hasPedigreeCertificate`, `vaccinated`, `dewormed`, `termsSummary`, `matingConditions`) are retrieved via the `matingPostDetail` query on detail screens.
3. **Coordinate Privacy:** Exact GPS coordinates are **never** returned for `MATING` posts (same privacy model as `ADOPTION` and `PRODUCT`). The `Post.coordinates` field resolves to `null`.
4. **Contact Flow:** Reuses the existing WhatsApp contact request pipeline (`requestContact`, `approveContactRequest`, `getWhatsAppLink`).

---

## 2. GraphQL SDL Contract

### Types & Enums

```graphql
enum PostType {
  RESCUE
  LOST
  ADOPTION
  PRODUCT
  MATING
}

type MatingDetails {
  petName: String!
  species: SpeciesType!
  breed: String!
  gender: GenderType!
  ageValue: Int!
  ageUnit: AgeUnit!
  isPurebred: Boolean!
  hasPedigreeCertificate: Boolean!
  vaccinated: Boolean!
  dewormed: Boolean!
  termsSummary: String
  matingConditions: String
}

type MatingPostEdge {
  node: Post!
  cursor: String!
}

type MatingPostConnection {
  edges: [MatingPostEdge!]!
  pageInfo: PageInfo!
}

input MatingFeedFilter {
  species: SpeciesType
  """The gender being searched FOR (opposite of the searcher's pet). MALE or FEMALE only."""
  gender: GenderType
  """Case-insensitive partial match on breed."""
  breed: String
  cityId: ID
}

input CreateMatingPostInput {
  petName: String!
  species: SpeciesType!
  breed: String!
  """MALE or FEMALE only — UNKNOWN is rejected."""
  gender: GenderType!
  ageValue: Int!
  ageUnit: AgeUnit!
  isPurebred: Boolean!
  hasPedigreeCertificate: Boolean
  vaccinated: Boolean
  dewormed: Boolean
  termsSummary: String
  matingConditions: String
  cityId: ID!
  mediaIds: [ID!]!
}
```

### Queries & Mutations

```graphql
extend type Query {
  """Feed of ACTIVE mating posts, newest first, keyset-paginated."""
  matingFeed(filter: MatingFeedFilter, first: Int, after: String): MatingPostConnection!

  """Fetches MATING extension data for the single-post detail screen."""
  matingPostDetail(postId: ID!): MatingDetails
}

extend type Mutation {
  """Creates a MATING post (parent posts row + mating_posts extension row, atomically)."""
  createMatingPost(input: CreateMatingPostInput!): Post!
}
```

---

## 3. Operations & Examples

### 3.1 Creating a Mating Post

#### Mutation
```graphql
mutation CreateMatingPost($input: CreateMatingPostInput!) {
  createMatingPost(input: $input) {
    id
    postType
    title
    description
    status
    city {
      id
      nameEnglish
      nameArabic
    }
    media {
      id
      publicUrl
      displayOrder
    }
    createdAt
  }
}
```

#### Variables Example
```json
{
  "input": {
    "petName": "Rocky",
    "species": "DOG",
    "breed": "German Shepherd",
    "gender": "MALE",
    "ageValue": 2,
    "ageUnit": "YEARS",
    "isPurebred": true,
    "hasPedigreeCertificate": true,
    "vaccinated": true,
    "dewormed": true,
    "termsSummary": "First pick of the litter (جرو من البطن)",
    "matingConditions": "Female must be fully vaccinated with health record. Meeting in Maadi.",
    "cityId": "01916327-0000-7000-8000-000000000001",
    "mediaIds": ["01916327-0000-7000-8000-000000000002"]
  }
}
```

---

### 3.2 Browsing the Mating Feed

#### Query
```graphql
query GetMatingFeed($filter: MatingFeedFilter, $first: Int, $after: String) {
  matingFeed(filter: $filter, first: $first, after: $after) {
    edges {
      cursor
      node {
        id
        title
        description
        postType
        status
        city {
          nameEnglish
          nameArabic
          governorate
        }
        media {
          publicUrl
          width
          height
        }
        upvoteCount
        saveCount
        isUpvotedByMe
        isSavedByMe
        createdAt
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

#### Filter Example (Looking for a Female German Shepherd in Cairo)
```json
{
  "filter": {
    "species": "DOG",
    "gender": "FEMALE",
    "breed": "Shepherd",
    "cityId": "01916327-0000-7000-8000-000000000001"
  },
  "first": 20,
  "after": null
}
```

---

### 3.3 Fetching Mating Post Details

On the listing detail screen, fetch the base `post` (or retrieve from client cache) and call `matingPostDetail` and `nearestVetClinics`:

```graphql
query GetMatingPostDetail($postId: ID!) {
  post(id: $postId) {
    id
    title
    description
    creator {
      id
      displayName
      avatarUrl
    }
    city {
      nameEnglish
      nameArabic
    }
    media {
      id
      publicUrl
    }
    nearestVetClinics {
      id
      nameEnglish
      nameArabic
      distanceKm
      googleMapsUrl
      whatsappPhoneUrl
    }
  }
  matingPostDetail(postId: $postId) {
    petName
    species
    breed
    gender
    ageValue
    ageUnit
    isPurebred
    hasPedigreeCertificate
    vaccinated
    dewormed
    termsSummary
    matingConditions
  }
}
```

---

### 3.4 Requesting Contact & Approval Flow

Mating partner communications use the standard, secure 2-step contact handshake:

1. **Viewer submits contact request:**
   ```graphql
   mutation RequestContact($postId: ID!, $message: String!) {
     requestContact(postId: $postId, message: $message) {
       id
       status
       createdAt
     }
   }
   ```
2. **Owner approves contact request:**
   ```graphql
   mutation ApproveContactRequest($requestId: ID!) {
     approveContactRequest(requestId: $requestId) {
       id
       status
       whatsappLink
     }
   }
   ```
3. **Viewer receives push notification** (`CONTACT_REQUEST_APPROVED`) and opens `whatsappLink` (`https://wa.me/...`) in WhatsApp via `url_launcher`.

---

## 4. Error Codes & Client Handling

| GraphQL Error Code | Scenario | UI Guidance |
|--------------------|----------|-------------|
| `VALIDATION_ERROR` | `gender: UNKNOWN` provided, `mediaIds` empty or `> 4`, or invalid UUID | Highlight invalid form fields. |
| `CONFLICT_ERROR`   | User already submitted a pending/active contact request for this post | Show message: "You have already contacted the owner for this listing." |
| `NOT_FOUND`        | Listing or detail not found / removed | Show 404 listing removed placeholder. |
| `FORBIDDEN`        | Owner attempting to contact their own post | Disable "Contact Owner" button on user's own listings. |
| `THROTTLED`        | User exceeded rate limits (e.g. max 5 mating posts per hour, max 20 contact requests per hour) | Display retry countdown timer. |

---

## 5. Summary of Backend Hardening (Phase 1)

1. **Pagination Clamping (`clampFirst`):**
   - All `first` arguments across `contacts`, `notifications`, `adoptions`, and `mating` are strictly clamped: `1 <= first <= 50` (default: 20).
2. **Atomic Status Guards:**
   - Concurrent `approveContactRequest` and `approveAdoptionApplication` race conditions are fully eliminated via atomic DB conditional updates (`WHERE status = 'PENDING'`). Lost races return `CONFLICT_ERROR`.
3. **Duplicate Request Protection:**
   - PostgreSQL unique violation error code `23505` (`uq_contact_request`, `uq_adoption_application`) is translated to standard `CONFLICT_ERROR`.
4. **Post Status Guards:**
   - Actions on posts (`requestContact`, `submitAdoptionApplication`, approvals) require the post to be `ACTIVE` and non-`REMOVED`.
5. **Hardened Keyset Cursors:**
   - Base64URL cursor decoding validates timestamp validity and UUID format; corrupted cursors return `VALIDATION_ERROR` instead of 500 crashes.

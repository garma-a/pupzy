# Flutter Integration Contract: Comments & Discussion Images

This document specifies the authoritative client-facing contract for integrating the Comments & Images discussion feature in the Pupzy Flutter mobile application.

---

## 1. Overview & Architectural Principles

- **Durable Client Request IDs:** All mutating operations (`createComment`, `createReply`) require a client-generated UUID `clientRequestId`. Identical retries return the original canonical Comment without duplicate database rows or duplicate notifications.
- **Community Evidence attachment restriction:** Image Comments are published only beneath `RESCUE` and `LOST` Posts (both `LOST_PET` and `FOUND_STRAY`). Text Comments remain available on every otherwise accessible Post type. Existing image Comments are never purged when this restriction is enforced.
- **Direct-to-Storage Staged Uploads:** The mobile client never sends binary image payloads through the NestJS API GraphQL endpoint. Instead, the client requests an upload ticket, uploads directly to Cloudflare R2 via presigned HTTPS PUT, and provides the returned `mediaId` to `createComment`.
- **Zero-Key Handoff:** Public media URLs are served from Cloudflare CDN (`https://cdn.pupzy.net` or configured override).
- **Graceful Failure & Tombstones:** Discussions preserve conversational context using neutral tombstones (`[Deleted]`, `[Hidden]`, `[Removed]`) with `author: null` when comments with replies are deleted or moderated.

---

## 2. Shortest Supported Workflows

### 2.1 Text-Only Comment Creation

1. Generate a UUIDv4/UUIDv7 for `clientRequestId`.
2. Call `createComment` mutation:
```graphql
mutation CreateComment($input: CreateCommentInput!) {
  createComment(input: $input) {
    id
    postId
    text
    createdAt
    author {
      id
      fullName
      avatarUrl
    }
    replyCount
    boostCount
    isBoostedByMe
    isPinned
    media {
      id
      publicUrl
      width
      height
      displayOrder
    }
  }
}
```
**Variables:**
```json
{
  "input": {
    "postId": "01916327-0000-7000-8000-000000000010",
    "text": "Hello, is this dog still available for adoption?",
    "clientRequestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
  }
}
```

### 2.2 Image Comment Creation (1 or 2 Images)

> **Post type restriction.** Only hide/enable the attachment action for `RESCUE` and `LOST` Posts. The backend rejects disallowed image publication with the stable `COMMENT_MEDIA_NOT_ALLOWED` error before any staged upload is finalized, so the rejected `mediaId` stays retryable until ticket expiry. `requestCommentImageUploadUrl` itself has no Post context and is not restricted; eligibility is enforced when the ticket is attached by `createComment`. Text Comments keep working everywhere.

1. User selects 1 or 2 images from the device gallery.
2. For each image:
   - Strip EXIF/XMP metadata.
   - Resize maintaining aspect ratio so longest edge <= 480 px.
   - Encode as static WebP.
   - Progressively adjust quality until file size <= 100,000 bytes (100 KB).
3. Request upload tickets:
```graphql
mutation RequestUpload($input: RequestCommentImageUploadInput!) {
  requestCommentImageUploadUrl(input: $input) {
    mediaId
    uploadUrl
    expiresAt
    maxSizeBytes
    maxWidth
    maxHeight
    allowedContentType
  }
}
```
4. Upload binary WebP directly to R2 using HTTPS PUT:
   - Method: `PUT`
   - URL: `uploadUrl`
   - Headers: `Content-Type: image/webp`
   - Body: Raw WebP bytes
5. Commit Comment with attached media IDs:
```graphql
mutation CreateCommentWithMedia($input: CreateCommentInput!) {
  createComment(input: $input) {
    id
    text
    media {
      id
      publicUrl
      width
      height
      displayOrder
    }
  }
}
```
**Variables:**
```json
{
  "input": {
    "postId": "01916327-0000-7000-8000-000000000010",
    "text": "Here is a photo of the foster space!",
    "mediaIds": ["01916327-0000-7000-8000-000000000050"],
    "clientRequestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6e"
  }
}
```

---

## 3. Constraints & Validation Rules

| Dimension | Constraint | Client Action on Breach |
|---|---|---|
| **Text Length** | 1 to 1,000 Unicode characters (Comments)<br>1 to 500 Unicode characters (Replies) | Trim whitespace; enforce local character counter in UI |
| **Post Type** | Image attachments only on `RESCUE` and `LOST` Posts | Hide the attachment action on `ADOPTION`, `PRODUCT` and `MATING` discussions; text Comments stay available |
| **Image Count** | Maximum 2 images per Comment (Replies cannot have images) | Disable add-image button when 2 images are attached |
| **Image Format** | Static WebP (`image/webp`) only | Convert all client selections to WebP; reject GIFs / animations |
| **File Size** | <= 100,000 bytes per image | Downsample quality locally; if still > 100 KB, prompt user to choose another image |
| **Dimensions** | Max 480 px width and 480 px height | Downscale before upload |
| **Metadata** | Zero EXIF, XMP, or ICC profiles | Strip metadata during local transcoding |
| **Animation** | Single frame only (no animated WebP) | Enforce static encoding |
| **Ticket Expiry** | Presigned PUT: 10 minutes<br>Durable ticket: 15 minutes | If upload fails due to expiry, request a fresh upload ticket |

### 3.1 Post Type Eligibility Matrix

| Post Type | Text Comments | Image Comments | Notes |
|---|---|---|---|
| `RESCUE` | Supported | Supported | Community Evidence; Post never expires automatically |
| `LOST` (`LOST_PET`) | Supported | Supported | Community Evidence; Post never expires automatically |
| `LOST` (`FOUND_STRAY`) | Supported | Supported | Community Evidence; Post never expires automatically |
| `ADOPTION` | Supported | Rejected with `COMMENT_MEDIA_NOT_ALLOWED` | Text discussion remains available |
| `PRODUCT` | Supported | Rejected with `COMMENT_MEDIA_NOT_ALLOWED` | Text discussion remains available on an `EXPIRED` listing too |
| `MATING` | Supported | Rejected with `COMMENT_MEDIA_NOT_ALLOWED` | Text discussion remains available |

Completed and `EXPIRED` Posts keep their existing discussion rules: text Comments stay available while the Post is not `REMOVED`. The restriction is applied when publishing new images only; historical image Comments (including on now-restricted Post types) remain readable and replayable.

---

## 4. Stable Error Codes & Mappings

The backend returns standardized `extensions.code` values. Flutter maps these to localized user feedback:

| Error Code | Meaning | User Message / Client Behavior |
|---|---|---|
| `COMMENT_MEDIA_INVALID_FORMAT` | Object is not a valid RIFF WebP or contains multiple animation frames | "Only static WebP images are supported. Please choose another image." |
| `COMMENT_MEDIA_TOO_LARGE` | Uploaded byte length exceeds 100,000 bytes | "Image exceeds the 100 KB limit. Compressing..." |
| `COMMENT_MEDIA_DIMENSIONS_EXCEEDED` | Dimensions exceed 480x480 pixels | "Image dimensions exceed 480x480 pixels." |
| `COMMENT_MEDIA_METADATA_FORBIDDEN` | EXIF or XMP metadata detected | "Image contains embedded metadata. Please re-select." |
| `COMMENT_MEDIA_NOT_READY` | R2 upload not completed before calling `createComment` | Retry after short backoff or notify user to wait for upload |
| `COMMENT_MEDIA_BLOCKED` | Image SHA-256 hash matches administrative blocklist | "This image cannot be uploaded as it violates platform guidelines." |
| `COMMENT_MEDIA_CLAIM_CONFLICT` | Staged upload belongs to another user or wrong purpose | "Upload ticket is invalid. Please select the image again." |
| `COMMENT_IMAGES_DISABLED` | Operational kill-switch active (`COMMENT_IMAGES_ENABLED=false`) | "Image attachments are temporarily disabled. You can still post text comments." |
| `COMMENT_MEDIA_NOT_ALLOWED` | Image publication attempted beneath a Post type other than `RESCUE`/`LOST`, or a concurrent commit recheck found the Post ineligible | "Photos can only be added to rescue and lost/found posts. You can still comment without a photo." The staged upload is not finalized and remains retryable until ticket expiry |
| `CONFLICT` | Reusing `clientRequestId` with different parameters | Generate a new `clientRequestId` for distinct comments |
| `RATE_LIMITED` | Exceeded 10 creations/min or 100/day | "You are commenting too fast. Please wait a moment." |

---

## 5. Listing, Sorting, and Keyset Pagination

### 5.1 Query Contract
```graphql
query GetComments($postId: ID!, $first: Int, $after: String, $sort: CommentSort) {
  comments(postId: $postId, first: $first, after: $after, sort: $sort) {
    edges {
      cursor
      node {
        id
        postId
        parentId
        text
        status
        replyCount
        boostCount
        isBoostedByMe
        isPinned
        createdAt
        author {
          id
          fullName
          avatarUrl
        }
        media {
          id
          publicUrl
          width
          height
          displayOrder
        }
      }
    }
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
    totalCount
  }
}
```

### 5.2 Parameters
- `first`: Default `20`, maximum `50`. Values > 50 are rejected with `ValidationError`.
- `sort`:
  - `TOP`: Ordered by `boost_count DESC, created_at DESC, id DESC`.
  - `NEWEST`: Ordered by `created_at DESC, id DESC`.
- `after`: Opaque base64 cursor. Flutter must treat cursors as opaque tokens.

### 5.3 Pinned Comments Behavior
- If a Comment is pinned by the Post author, it appears as the **very first item** on page 1 regardless of sort order (`TOP` or `NEWEST`).
- It is excluded from subsequent pages to eliminate duplicate entries.
- The `isPinned: true` boolean indicates pinned status in UI.

---

## 6. Replies & Threading

- Discussions have a **strict 1-level nesting maximum** (Post -> Comment -> Reply).
- Replies cannot receive replies; attempting to reply to a reply is rejected.
- Replies cannot contain images (`mediaIds` is rejected on `createReply`).
- Replies are listed oldest-first (`created_at ASC, id ASC`) using `replies(commentId: ID!, first: Int, after: String)`.

---

## 7. Moderation States in Client UI

| `CommentStatus` | Text Display | Author Display | Media Display | User Interaction |
|---|---|---|---|---|
| `ACTIVE` | Canonical text | Author details | Full media list | Boost, Reply, Pin, Report, Delete (if author) |
| `IMAGE_HIDDEN` | Canonical text | Author details | `[]` (empty) | Boost, Reply, Pin, Report, Delete (if author) |
| `HIDDEN` | `[Hidden]` | `null` (Anonymous) | `[]` (empty) | Actions disabled |
| `DELETED` | `[Deleted]` | `null` (Anonymous) | `[]` (empty) | Actions disabled |
| `REMOVED` | `[Removed]` | `null` (Anonymous) | `[]` (empty) | Actions disabled |

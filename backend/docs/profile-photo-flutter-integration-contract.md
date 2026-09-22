# Profile Photo Lifecycle Contract

This document is the authoritative client and deployment contract for owned profile photos: setting, replacing and removing the authenticated user's avatar through the durable staged-upload pipeline. It covers the GraphQL operations added by ticket 17, their inputs, outputs, error codes, removal semantics and cleanup guarantees.

The `User.profilePictureUrl` field is unchanged: it always carries the effective picture URL and is `null` when the account has no picture (clients render initials).

---

## 1. Model

| State | `profilePictureUrl` | Owned storage key | Provider sync may overwrite |
| ----- | ------------------- | ----------------- | --------------------------- |
| Initial provider picture | provider URL | none | yes — until the user changes it |
| Owned avatar | `https://cdn.pupzy.net/avatars/{userId}/{mediaId}.webp` | `avatars/{userId}/{mediaId}.webp` | no |
| Explicitly removed / no picture | `null` | none | no |

- **Initial provider photos are preserved until an explicit user change.** A Google/Facebook Firebase picture may still be synchronized while the account has never made an avatar choice.
- **An explicit set or removal is permanent with respect to provider synchronization.** Once the user has chosen, a later Firebase re-link can never restore a removed picture or overwrite an owned one.
- **Only owned objects are ever deleted.** A third-party provider URL is never treated as owned media and is never passed to storage cleanup, including Account Deletion.

## 2. Operations

### 2.1 Request an upload ticket

```graphql
mutation RequestProfilePhotoUploadUrl($input: RequestProfilePhotoUploadInput!) {
  requestProfilePhotoUploadUrl(input: $input) {
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

Input:

| Field | Type | Rules |
| ----- | ---- | ----- |
| `contentType` | `String!` | Must be `image/webp`. |
| `fileSizeBytes` | `Int!` | Positive integer, at most `100000`. |

Output: a durable, owner-bound, single-use ticket (`mediaId`), a presigned PUT URL (`uploadUrl`), and the accepted constraints (`maxSizeBytes = 100000`, `maxWidth = maxHeight = 480`, `allowedContentType = image/webp`). Upload the bytes with HTTP `PUT` to `uploadUrl` (declared `Content-Length` must match `fileSizeBytes`), then call `setProfilePhoto`.

The ticket is committed to PostgreSQL before the URL is returned and expires after 15 minutes. Ticket issuance participates in the Account Deletion grace window: deletion waits for outstanding upload URLs to expire before sweeping storage.

### 2.2 Set or replace the photo

```graphql
mutation SetProfilePhoto($mediaId: ID!) {
  setProfilePhoto(mediaId: $mediaId) {
    id
    profilePictureUrl
  }
}
```

- Input: `mediaId` from `requestProfilePhotoUploadUrl`, owned by the caller, unconsumed and unexpired.
- Output: the updated `User`; `profilePictureUrl` is the new permanent URL.
- On success the previous owned object is queued for deletion. Replacing a provider picture queues nothing (it is not owned).
- Retrying the same `mediaId` after a successful set is idempotent and returns the current user unchanged.

### 2.3 Remove the photo

```graphql
mutation {
  removeProfilePhoto {
    id
    profilePictureUrl
  }
}
```

- No input. Returns the user with `profilePictureUrl: null` (clients render initials).
- The removed owned object is queued for deletion in the same transaction.
- Idempotent: repeating removal is safe and queues nothing new.
- The removal decision suppresses all later provider synchronization.

## 3. Image protections

`setProfilePhoto` reuses the established verified-image publication pipeline:

- Ownership, purpose (`PROFILE_PHOTO`), single-use claim and ticket expiry are enforced without leaking whether another account's media exists.
- Static WebP only, at most 100,000 bytes, at most 480x480 pixels, exactly one decoded frame.
- Embedded EXIF/XMP chunks and animation chunks are rejected; the exact bytes are re-validated and republished, so verified bytes are the published bytes.
- The SHA-256 hash is checked against the blocked-media denylist before any permanent object is created. A blocked hash returns the generic invalid-format error and never reveals moderation state.
- Staging replacement between download and publication is detected (ETag mismatch) and never published.

## 4. Error codes

| Code | Meaning | Retryable |
| ---- | ------- | --------- |
| `PROFILE_PHOTO_INVALID_FORMAT` | Not static WebP, malformed/truncated, animated, or blocked. | no |
| `PROFILE_PHOTO_TOO_LARGE` | Declared or actual bytes exceed 100,000. | no |
| `PROFILE_PHOTO_DIMENSIONS_EXCEEDED` | Wider or taller than 480 px. | no |
| `PROFILE_PHOTO_METADATA_FORBIDDEN` | Embedded EXIF/XMP metadata. | no |
| `PROFILE_PHOTO_NOT_AVAILABLE` | Ticket missing, not owned by the caller, wrong purpose, expired, or object absent from staging. | no |
| `PROFILE_PHOTO_ALREADY_USED` | Ticket already consumed by a successful finalization. | no |
| `PROFILE_PHOTO_PROCESSING_FAILED` | Transient storage or verification failure; the ticket stays retryable. | yes |
| `PROFILE_PHOTO_REPLACED` | A concurrent set or removal won the race, or reconciliation reclaimed the finalized ticket; refresh and retry. | yes (with the new state) |
| `ACCOUNT_DELETED` | Account is banned or deletion is pending/completed. | no |

## 5. Replacement, concurrency and compensation

- Setting or removing takes a row lock on the account. Both the current owned storage key and the current change marker (`profile_photo_changed_at`) are compared against the values observed before finalization:
  - Sequential replacement succeeds and queues the previous owned object for deletion.
  - A concurrent replacement or an explicit removal wins: the losing request receives `PROFILE_PHOTO_REPLACED`, its newly finalized object is deleted (or queued for the deletion worker) and its ticket is marked `FAILED`. No orphaned finalized media or dangling reference survives. Because the change marker is compared too, an explicit removal wins even when the previous picture was provider-owned or empty and the owned key stays `NULL` on both sides.
- If permanent publication fails, the ticket returns to a retryable state and no profile change occurs. If the account update fails after publication, the finalized object is compensated away durably.
- Periodic reconciliation reclaims a finalized avatar whose account no longer references it (for example after a crash between publication and the account update) and never deletes the active avatar. Recovery locks the account row with the same lock activation takes and, in that transaction, re-checks the owned key and marks the ticket terminal (`EXPIRED`) before any storage deletion; the permanent object is deleted only after that commit, with a durable `media_deletion_work` row as the retry path. An activation that was still in flight when the ticket was reclaimed is rejected with `PROFILE_PHOTO_REPLACED` and compensates its object, so the profile can never reference deleted bytes. Staging objects are removed after successful publication.
- Activation re-verifies, under the account row lock, that its staged-upload ticket is still `FINALIZED` with the same permanent key; otherwise it loses with `PROFILE_PHOTO_REPLACED`.

## 6. Account Deletion

- Account Deletion captures the owned `profile_photo_storage_key`, if any, into its durable media cleanup scope and deletes that object with the rest of the account's media.
- Provider-only pictures leave nothing to delete; the provider URL is not an owned object and is never sent to storage deletion.
- A profile-photo finalization racing Account Deletion either commits before the capture (and its object is deleted) or loses the account row lock, receives `ACCOUNT_DELETED`, and compensates its own object.

## 7. Migration and rollout

- Migration `0055_add_profile_photo_lifecycle` adds the `PROFILE_PHOTO` staged-upload purpose and the `users.profile_photo_storage_key` / `users.profile_photo_changed_at` columns. It is additive and leaves existing provider pictures and Post/Comment media untouched.
- Deploy migration before serving the new operations; old clients are unaffected because `User.profilePictureUrl` keeps its shape and meaning.

## 8. Flutter integration notes

1. Use `requestProfilePhotoUploadUrl` (not `requestMediaUploadUrl`) for avatars; a Post media ticket is rejected with `PROFILE_PHOTO_NOT_AVAILABLE`.
2. Strip metadata, resize the longest edge to at most 480 px and encode static WebP until the payload is at most 100 KB before uploading.
3. Treat `profilePictureUrl: null` after `removeProfilePhoto` as the initials state. Do not fall back to a cached provider picture.
4. On `PROFILE_PHOTO_REPLACED`, refresh `me` and re-apply the user's intent with a fresh ticket.
5. On `PROFILE_PHOTO_PROCESSING_FAILED` the same `mediaId` remains retryable until ticket expiry; do not discard it immediately.

## 9. Verification evidence

- `src/users/profile-photo-lifecycle.integration.spec.ts`: complete set/replace/remove workflow, foreign/consumed/wrong-purpose uploads, idempotent retry, provider-photo preservation and removal suppression, concurrent replacement compensation, invalid/oversized/metadata/blocked uploads, PutObject and activation failure compensation, staging replacement rejection, and obsolete-media recovery over a real Postgres test container with a controllable R2 adapter.
- `src/users/account-deletion.integration.spec.ts`: owned avatar capture and provider URL exclusion during Account Deletion.
- `src/users/users.service.spec.ts`: provider synchronization only while the account has never made an avatar choice.

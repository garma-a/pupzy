# Pupzy MVP Backend & Admin — Final Flutter Integration Handoff

Status: **final** — the backend/admin implementation is complete in this branch and the integrated release verification is recorded in `docs/integrated-mvp-release-evidence.md`. This document is the single client-facing entry point; it lists the exact operations, states, errors, routing and rollout ordering for every delivered feature, and states the external launch dependencies that backend tests cannot prove.

This document does not modify or prescribe Flutter code. No frontend file, test or asset was changed by this effort; implementing the screens, permissions, navigation and token handling is separate client work.

Related authoritative contracts (full detail per feature):

| Feature | Contract |
|---|---|
| Approved adoption contact | `docs/adoption-contact-flutter-integration-contract.md` |
| Post lifecycle transitions and side effects | `docs/post-lifecycle-transition-contract.md` |
| Expiry, reminders and renewal | `docs/post-expiry-and-renewal-contract.md` |
| Comments, images and Community Evidence | `docs/comments-flutter-integration-contract.md` |
| Versioned Terms Acceptance | `docs/terms-acceptance-flutter-integration-contract.md` |
| Notification language and templates | `docs/notification-language-flutter-integration-contract.md` |
| Device push delivery | `docs/device-push-delivery-flutter-integration-contract.md` |
| Feed search | `docs/feed-search-flutter-integration-contract.md` |
| Profile photo lifecycle | `docs/profile-photo-flutter-integration-contract.md` |
| Reporting and account blocking (pre-existing) | `docs/ugc-reporting-and-account-blocking-flutter-integration-contract.md` |
| Admin work queues | `docs/admin-work-queues.md` |
| Admin Post review workspace | `docs/admin-post-review-workspace.md` |
| Admin case resolution and reopening | `docs/admin-case-resolution-contract.md` |
| Saved-search retirement ordering | `docs/adr/0007-retire-saved-search-runtime-before-storage-contraction.md` |

---

## 1. Scope and compatibility summary

Everything here is backend or AdminJS work. There is **no Flutter change in the repository**, and no operation requires a client library upgrade beyond handling the added enum values and operations below.

- **Existing operations keep their names, arguments, input shapes, output shapes, enum values and nullability.** The only schema removal in the whole effort is the orphan `SavedSearch` GraphQL type (see §7). No `Query` or `Mutation` field ever referenced it, so no existing client operation changes.
- **Additive operations (11):** `getAdoptionWhatsAppLink`, `terms`, `acceptTerms`, `updateMyLanguagePreference`, `updateMyNotificationPreferences`, `registerDevice`, `unregisterDevice`, `renewPost`, `requestProfilePhotoUploadUrl`, `setProfilePhoto`, `removeProfilePhoto`.
- **Additive arguments (5):** optional `search: String` on `homeFeed`, `helpFeed`, `adoptFeed`, `marketFeed`, `matingFeed`.
- **Additive input field (1):** optional `CompleteProfileInput.languagePreference: Language`. Onboarding stays compatible; there is no required terms field.
- **Additive enum values:** `PostStatus.EXPIRED`, `NotificationType.POST_RESOLVED_BY_ADMIN`, `NotificationType.POST_REOPENED_BY_ADMIN`.
- **Additive enums/types:** `Language`, `DevicePlatform`, `DeviceRegistration`, `TermsInfo`, `AcceptTermsInput`, `RegisterDeviceInput`, `RequestProfilePhotoUploadInput`, `ProfilePhotoUploadTicket`.
- **No phone verification of any kind.** Phones stay self-entered and existing contact flows are unchanged.

---

## 2. Global conventions

### 2.1 Authentication

All operations below are authenticated unless explicitly noted. Send `Authorization: Bearer <Firebase ID token>`; the global guard resolves the Pupzy Account and rejects missing/invalid sessions, banned accounts and accounts in the Account Deletion window. `acceptTerms`, `terms`, device registration and profile-photo operations are all caller-owned: no operation accepts another account's user id.

### 2.2 Error envelope

Errors arrive as standard GraphQL `errors[]` entries with the stable machine code in `extensions.code`:

| `extensions.code` | Meaning | Client action |
|---|---|---|
| `UNAUTHENTICATED` | No valid session | Re-authenticate |
| `FORBIDDEN` | Caller lacks authority over the resource | Hide the action; indicates a UI bug |
| `NOT_FOUND` | Missing, removed, expired-by-access or Block-isolated resource | Render the neutral unavailable state; never infer a Block |
| `VALIDATION_ERROR` | Business/input validation failed | Show the feature-specific message |
| `CONFLICT` | Duplicate/retried conflicting state (includes idempotency misuse) | Refresh state; retry only where documented |
| `RATE_LIMITED` | Comment creation quota exceeded | Back off and inform the user |
| `TERMS_ACCEPTANCE_REQUIRED` | Protected operation without current acceptance; extensions carry `currentVersion`, `termsUrl` | Prompt for acceptance, then retry once |
| `TERMS_VERSION_MISMATCH` | `acceptTerms` submitted a non-current version; extensions carry `currentVersion`, `termsUrl` | Re-read the version and re-present |
| `COMMENT_MEDIA_NOT_ALLOWED` | Image Comment attempted on a Post type other than RESCUE/LOST | Keep text commenting; the staged upload stays retryable |
| `COMMENT_MEDIA_INVALID_FORMAT`, `COMMENT_MEDIA_TOO_LARGE`, `COMMENT_MEDIA_DIMENSIONS_EXCEEDED`, `COMMENT_MEDIA_METADATA_FORBIDDEN`, `COMMENT_MEDIA_NOT_AVAILABLE`, `COMMENT_MEDIA_ALREADY_USED`, `COMMENT_MEDIA_PROCESSING_FAILED`, `COMMENT_IMAGES_DISABLED` | Comment image pipeline failures/operational switch (`NOT_AVAILABLE`/`ALREADY_USED` are non-retryable; `PROCESSING_FAILED` is retryable) | See `docs/comments-flutter-integration-contract.md` §4 |
| `PROFILE_PHOTO_INVALID_FORMAT`, `PROFILE_PHOTO_TOO_LARGE`, `PROFILE_PHOTO_DIMENSIONS_EXCEEDED`, `PROFILE_PHOTO_METADATA_FORBIDDEN`, `PROFILE_PHOTO_NOT_AVAILABLE`, `PROFILE_PHOTO_ALREADY_USED`, `PROFILE_PHOTO_PROCESSING_FAILED`, `PROFILE_PHOTO_REPLACED` | Profile photo pipeline failures/races | See §3.9 and the profile photo contract §4 |
| `RENEWAL_COOLDOWN` | Same listing renewed within the last 7 days | Show “try again later”; no timestamp is exposed |
| `ACCOUNT_DELETED` | Account is banned or deletion is pending/completed | Sign-out state |

The comment-image contract §4 also records `COMMENT_MEDIA_NOT_READY`, `COMMENT_MEDIA_BLOCKED` and `COMMENT_MEDIA_CLAIM_CONFLICT` as documented names that no code path emits; if one of them is ever observed, treat it as `COMMENT_MEDIA_NOT_AVAILABLE`, `COMMENT_MEDIA_INVALID_FORMAT` and `COMMENT_MEDIA_NOT_AVAILABLE` respectively.

### 2.3 New enum values the client must decode

- **`PostStatus.EXPIRED`** — an inactivity state, not a resolution and not a removal. Any exhaustive `switch`/`when` over `PostStatus` must add the value or decoding fails for expired listings.
- **`NotificationType.POST_RESOLVED_BY_ADMIN`** and **`NotificationType.POST_REOPENED_BY_ADMIN`** — owner inbox entries for administrator resolution/correction.
- **`NotificationType.SYSTEM_ANNOUNCEMENT`** — retained for historical rows; no creation site exists (saved-search alerts removed).
- **`Language { ar, en }`**, **`DevicePlatform { ANDROID, IOS }`**.

### 2.4 Pagination, dates and cursors

All connections keep their existing opaque base64 keyset cursors and ordering; search and lifecycle changes never re-rank. `DateTime` remains the existing ISO-8601 UTC scalar.

### 2.5 Block isolation is universal

Every new workflow — approved adoption contact, comments and images, expiry reads/renewal, search, notifications and push — preserves the existing directional Block isolation. Isolated resources answer with the ordinary neutral `NOT_FOUND` (or are omitted from feeds) and never disclose the Block. Administrators keep their moderation visibility regardless of personal Blocks. Reporting/Block operations remain available regardless of terms acceptance. See `docs/ugc-reporting-and-account-blocking-flutter-integration-contract.md`.

---

## 3. Feature contracts

### 3.1 Approved adoption contact — `getAdoptionWhatsAppLink`

| Operation | Kind | Signature |
|---|---|---|
| `getAdoptionWhatsAppLink` | Query | `getAdoptionWhatsAppLink(applicationId: ID!): String!` |

Returns the owner's current `https://wa.me/<digits>` link for the caller's own `APPROVED` application; built at read time from the owner's stored phone. Existing adoption operations are unchanged.

```graphql
query GetAdoptionWhatsApp($applicationId: ID!) {
  getAdoptionWhatsAppLink(applicationId: $applicationId)
}
```

- **States:** only the original applicant of an `APPROVED` application may retrieve it. `PENDING`/`REJECTED` → `VALIDATION_ERROR`; another account → `FORBIDDEN`; unknown application, removed Post, isolated pair or unavailable owner contact → neutral `NOT_FOUND`.
- **Availability without terms acceptance:** yes (see §3.4).
- **Closed listings keep approved access:** the link stays retrievable after `ADOPTED`; only administrative removal hides it. Expiry does not revoke it.

### 3.2 Post lifecycle outcomes (owner closure)

No new client operation. `updatePostStatus(postId: ID!, status: PostStatus!): Post!` gains:

| Post type | Direction (`report_type`) | Owner closure outcome |
|---|---|---|
| `RESCUE` | — | `RESOLVED` (unchanged) |
| `LOST` | `LOST_PET` | `REUNITED` (unchanged) |
| `LOST` | `FOUND_STRAY` | `RESOLVED` **and** `REUNITED` (both accepted) |
| `ADOPTION` | — | `ADOPTED` (unchanged) |
| `PRODUCT` | — | `SOLD` (unchanged) |
| `MATING` | — | `RESOLVED` (**new**) |

- Closing a listing moves still-`PENDING` Contact Requests and Adoption Applications to the terminal `REJECTED` state in the same transaction; records are preserved and approved access keeps its restrictions. Reopening/renewal never revives closed interactions.
- `EXPIRED` is **not** a valid `updatePostStatus` target (`VALIDATION_ERROR`); renew first. Owners cannot reopen completed Posts; only administrators can (§5).
- Boosts remain engagement, never resolution votes; a photo Comment does not create a report or resolve anything.

### 3.3 Community Evidence — comments and images

Existing operations keep their contract (`createComment`, `createReply`, `deleteComment`, `pinComment`/`unpinComment`, boosting, quoting/cursor pagination); `clientRequestId` stays required for mutating creates and retried calls stay idempotent.

| Post type | Text Comments | New image Comments |
|---|---|---|
| `RESCUE` | Supported | Supported |
| `LOST` (`LOST_PET`) | Supported | Supported |
| `LOST` (`FOUND_STRAY`) | Supported | Supported |
| `ADOPTION` | Supported | Rejected `COMMENT_MEDIA_NOT_ALLOWED` |
| `PRODUCT` | Supported | Rejected `COMMENT_MEDIA_NOT_ALLOWED` |
| `MATING` | Supported | Rejected `COMMENT_MEDIA_NOT_ALLOWED` |

- Up to two static WebP images per Comment (≤100,000 bytes, ≤480×480, metadata stripped); Replies stay text-only. A rejected image publication is rejected **before** media finalization, so the `mediaId` stays retryable until ticket expiry.
- Completed and `EXPIRED` Posts keep text discussion. Historical image Comments on now-restricted types remain readable and replayable.
- **Omitted:** the PDF Rescue Proof form, proof entities, review states, quotas and proof-specific WhatsApp unlock stay disabled — evidence is the existing Comment workflow.

### 3.4 Versioned Terms Acceptance

The gate is configuration-driven. While the release owner has not set `TERMS_URL`/`TERMS_VERSION` together, `terms.currentVersion`/`termsUrl` are `null`, `acceptanceRequired` is `false`, and nothing is gated.

```graphql
type TermsInfo {
  currentVersion: String
  termsUrl: String
  acceptedVersion: String
  acceptedAt: DateTime
  acceptanceRequired: Boolean!
}

query Terms { terms { currentVersion termsUrl acceptedVersion acceptedAt acceptanceRequired } }

mutation AcceptTerms($input: AcceptTermsInput!) {
  acceptTerms(input: $input) { currentVersion termsUrl acceptedVersion acceptedAt acceptanceRequired }
}
# AcceptTermsInput { version: String! }
```

- Idempotent for the same version (original `acceptedAt` preserved); a new published version makes every earlier acceptance insufficient; unknown/stale versions return `TERMS_VERSION_MISMATCH` with the version to accept.
- **Protected operations (9):** `createRescuePost`, `createLostPost`, `createAdoptionPost`, `createProductPost`, `createMatingPost`, `createComment`, `createReply`, `requestContact`, `submitAdoptionApplication`. A blocked call must be answered with the acceptance prompt, not a generic failure.
- **Intentionally available without acceptance:** browsing (`me`, feeds, detail queries, `comments`, `replies`, `myPosts`, `mySavedPosts`, `notifications`, `terms`), account controls (`completeProfile`, `updateProfile`, `updateMyLocation`, `updateMyLanguagePreference`, `updateMyNotificationPreferences`, `registerDevice`, `unregisterDevice`, `deleteMyAccount`), safety/reporting/Block actions, engagement, approvals, contact retrieval, `renewPost`, `updatePostStatus`, `deletePost`, `deleteComment`, upload-ticket requests.
- Onboarding input did not gain a terms field; never block profile completion on acceptance.

### 3.5 Notification language

- `CompleteProfileInput.languagePreference: Language` (optional) and `updateMyLanguagePreference(languagePreference: Language!): User!` synchronize `ar`/`en`; callers do not resend other profile fields.
- `User.languagePreference` is `"ar"`, `"en"` or `null`. `null` means **unsynchronized** and renders English; the historic database default no longer silently selects Arabic.
- In-app `title`/`body` and push text render through the same stored bilingual columns; changing the preference re-renders existing inbox rows, and legacy rows without Arabic keep their English text.
- Templates exist for every notification type in §4; unsupported/legacy values fall back to English.

### 3.6 Device push delivery

| Operation | Signature |
|---|---|
| `registerDevice` | `registerDevice(input: RegisterDeviceInput!): DeviceRegistration!` |
| `unregisterDevice` | `unregisterDevice(token: String!): Boolean!` |
| `updateMyNotificationPreferences` | `updateMyNotificationPreferences(notificationsEnabled: Boolean!): User!` |

- `RegisterDeviceInput { token: String! (1–512 chars), platform: DevicePlatform! }`; `DeviceRegistration { id, platform, createdAt, updatedAt }` — the token is never returned.
- One token has one owner: re-registering transfers ownership and cancels the previous owner's queued pushes for that device. Sign-out must call `unregisterDevice`; `false` is an idempotent success and never reveals another account's registration. Opt-out suppresses pushes (pending intents become terminal `SUPPRESSED`) but **keeps the in-app inbox**; re-enabling only affects future notifications.
- Delivery rechecks preference, account availability, device ownership and Block isolation at send time; deduplicated per `(notification, device)`; bounded retries (5 attempts, exponential backoff) then terminal `FAILED`; dead tokens are cleaned. Push is never exactly-once, and the backend only guarantees handing the message to FCM.
- Message `data` keys: `notificationId` and `type` always; plus `relatedPostId`, `relatedCommentId`, `relatedContactRequestId`, `relatedApplicationId` when present. Collapse keys are opaque `sha256(type + ":" + target).slice(0, 32)`.

### 3.7 Expiry and renewal

- Additive `PostStatus.EXPIRED`: leaves active discovery (feeds and search), keeps direct detail, owner history, media, engagement and discussion, and rejects new contact/application/seller-contact submissions. Viewing and commenting do not reactivate it.
- Policy: `PRODUCT` expires after 14 inactive days with a reminder at 11; `ADOPTION` after 30 with a reminder at 27; `RESCUE`/`LOST` never expire and receive one stand-alone reminder after 60 inactive days; `MATING` expiry and reminders stay disabled.
- `renewPost(postId: ID!): Post!` — owner-only; `ACTIVE`/`EXPIRED` product/adoption listings; at most once per 7 days (`RENEWAL_COOLDOWN`); returns the listing to `ACTIVE` with a fresh inactivity window. `SOLD`/`ADOPTED` and non-renewable types (RESCUE, LOST, MATING) → `VALIDATION_ERROR`; missing or `REMOVED` → `NOT_FOUND`; non-owner of an existing non-removed listing → `FORBIDDEN`. Renewal never reopens terminated interactions.
- The reminder is `POST_INACTIVITY_NUDGE` (inbox + push), localized through §3.5.

### 3.8 Server-side feed search

Optional `search: String` on `homeFeed`, `helpFeed`, `adoptFeed`, `marketFeed`, `matingFeed`:

```graphql
query HomeFeed($governorate: String, $cityId: ID, $viewerLocation: ViewerLocationInput,
              $radiusKm: Float, $search: String, $first: Int, $after: String) {
  homeFeed(governorate: $governorate, cityId: $cityId, viewerLocation: $viewerLocation,
           radiusKm: $radiusKm, search: $search, first: $first, after: $after) {
    edges { node { id } cursor distanceKm }
    pageInfo { hasNextPage endCursor }
  }
}
```

- Matches title, description, market category, area and City names (English and Arabic) with one normalization (lowercase; Arabic diacritics/tatweel removed; alef/yeh/waw-hamza/teh-marbuta variants unified; whitespace collapsed). `%`, `_`, `\` match literally.
- Omitted/null/blank/whitespace-only text means no search; a query normalizing to fewer than 2 characters or exceeding 100 characters after trimming returns `VALIDATION_ERROR`. Existing filters, ordering, cursors, `ACTIVE`-only discovery and Block isolation are retained; there is no new relevance ranking.

### 3.9 Profile photo lifecycle

| Operation | Signature |
|---|---|
| `requestProfilePhotoUploadUrl` | `requestProfilePhotoUploadUrl(input: RequestProfilePhotoUploadInput!): ProfilePhotoUploadTicket!` |
| `setProfilePhoto` | `setProfilePhoto(mediaId: ID!): User!` |
| `removeProfilePhoto` | `removeProfilePhoto(): User!` |

- Input `{ contentType: "image/webp", fileSizeBytes: ≤100000 }`; upload the static WebP (≤480×480, metadata-free) directly to the returned presigned `uploadUrl`, then call `setProfilePhoto`.
- Setting/replacing/removing is owner-bound, idempotent and race-safe (`PROFILE_PHOTO_REPLACED` on a lost race). Replacing queues the previous owned object for deletion; removal returns `profilePictureUrl: null` and **must render initials**, never a cached provider picture.
- Initial Firebase/provider pictures are preserved only until the user makes an explicit choice; after that, provider synchronization can never restore or overwrite. Account Deletion includes owned avatars.

### 3.10 Reporting and account blocking

Delivered previously and unchanged; see `docs/ugc-reporting-and-account-blocking-flutter-integration-contract.md`. Every new workflow in this handoff preserves the same isolation boundary and neutral error behavior.

---

## 4. Notification routing and copy

`data` always carries `notificationId` and `type`; routing columns list the additional keys. Title/body are localized per §3.5; Arabic comes from the same template registry.

| Type | Trigger | Recipient | Routing keys | English title / body |
|---|---|---|---|---|
| `NEW_UPVOTE` | Post upvoted | Post owner | `relatedPostId` | `New upvote` / `${actorName} upvoted your post "${postTitle}"` |
| `POST_SAVED` | Post saved | Post owner | `relatedPostId` | `Post saved` / `${actorName} saved your post "${postTitle}"` |
| `CONTACT_REQUEST_RECEIVED` | Contact requested | Post owner | `relatedPostId`, `relatedContactRequestId` | `New contact request` / `${actorName} wants to contact you about "${postTitle}"` |
| `CONTACT_REQUEST_APPROVED` | Request approved | Requester | `relatedPostId`, `relatedContactRequestId` | `Contact request approved` / `You can now contact the owner via WhatsApp about "${postTitle}"` |
| `CONTACT_REQUEST_REJECTED` | Request rejected | Requester | `relatedPostId`, `relatedContactRequestId` | `Contact request update` / `Your contact request about "${postTitle}" was not approved` |
| `ADOPTION_APPLICATION_RECEIVED` | Application submitted | Post owner | `relatedPostId`, `relatedApplicationId` | `New adoption application` / `${actorName} applied to adopt from "${postTitle}"` |
| `ADOPTION_APPLICATION_APPROVED` | Application approved | Applicant | `relatedPostId`, `relatedApplicationId` | `Adoption application approved!` / `Your adoption application for "${postTitle}" has been approved. You can now contact the owner.` |
| `ADOPTION_APPLICATION_REJECTED` | Application rejected | Applicant | `relatedPostId`, `relatedApplicationId` | `Adoption application update` / `Your adoption application for "${postTitle}" was not approved at this time` |
| `POST_REMOVED_BY_ADMIN` | Admin removal or ban cascade | Post owner / banned account | `relatedPostId` (single Post only) | `Your post was removed` / `${reason}`; ban cascade: `Your posts were removed` |
| `POST_RESOLVED_BY_ADMIN` | Admin records an outcome | Post owner | `relatedPostId` | `Post outcome recorded` / `An administrator marked your post "${postTitle}" as ${outcome}.` |
| `POST_REOPENED_BY_ADMIN` | Admin corrects an outcome | Post owner | `relatedPostId` | `Post reopened` / `An administrator reopened your post "${postTitle}".` |
| `POST_INACTIVITY_NUDGE` | Expiry worker reminder | Post owner | `relatedPostId` | `Is your post still active?` / `Your post "${postTitle}" has had no recent activity. Review it to keep it active.` |
| `NEW_COMMENT` | Comment on a Post | Post owner | `relatedPostId`, `relatedCommentId` | `New comment` / `${actorName} commented on your post "${postTitle}"` |
| `NEW_REPLY` | Reply to a Comment | Parent author | `relatedPostId`, `relatedCommentId` | `New reply` / `${actorName} replied to your comment` |
| `COMMENT_BOOSTED` | Comment/Reply boosted | Author | `relatedPostId`, `relatedCommentId` | `Comment boosted` / `${actorName} boosted your comment` (reply: `${actorName} boosted your reply`) |
| `COMMENT_PINNED` | Comment pinned | Comment author | `relatedPostId`, `relatedCommentId` | `Comment pinned` / `Your comment was pinned on "${postTitle}"` |

`SYSTEM_ANNOUNCEMENT` (retired saved-search alert) is inbox-only with no creation site. No nearby-rescue broadcast type exists.

---

## 5. Admin service surfaces (no Flutter dashboard work)

English AdminJS only; `ADMIN`/`SUPER_ADMIN` retain access; the secondary technical resources remain available.

- **Work queues:** Needs review (`Flagged — needs review`, `Pending moderation`, open Post/Comment/Account Reports), Rescue, Lost & found (with Lost pet / Found stray), Listings (Adoption/Products/Mating), History (Completed/Expired/Removed). Counts and result pages share predicates; an expired listing is not outstanding review work.
- **Post review workspace:** header with readable type/subtype/outcome/moderation/urgency/City context, original Post photos and paginated discussion images in aligned thumbnail grids with full-image previews, Reports, and append-only action history. Filters survive returning from a Post.
- **Actions:** type-specific `markRescued` / `markReunited` / `markResolved` / `markAdopted` / `markSold` (with internal reason) and administrator-only `reopenPost` for completed outcomes whose owner is not banned. Resolution/reopening write audit rows, localized owner notifications and pending-interaction cleanup transactionally; reopening leaves closed interactions closed; removal/restoration keep their existing paths, and expired listings expose no removal/reopen action.
- **Terms and device state:** the Users resource shows read-only `terms_accepted_version`/`terms_accepted_at`; expired listings are filterable; `renewed_at`/`reminder_sent_at` are read-only.

---

## 6. Migration and rollout ordering

Apply migrations only through the Main API pre-deploy step (`node dist/database/migrate.js`); AdminJS never runs migrations. All of the following are additive except `0053`.

| Migration | Purpose | Safe with old runtime? |
|---|---|---|
| `0045_add_bilingual_notification_content` | nullable Arabic columns; clears legacy `ar` defaults | yes |
| `0046_add_expired_post_status` | adds `PostStatus.EXPIRED` | yes (additive enum value) |
| `0047_add_post_expiry_state` | nullable `renewed_at`, `reminder_sent_at` | yes |
| `0048_add_post_status_filter_operators` | AdminJS enum filter operators | yes |
| `0049_add_device_push_delivery` | `device_registrations`, `push_deliveries` | yes |
| `0050_add_admin_post_resolution` / `0051_add_admin_post_reopen` | audit + notification enum values | yes |
| `0052_add_normalized_feed_search` | `pg_trgm`, `pupzy_search_normalize`, trigram indexes | yes |
| `0053_drop_saved_searches` | **destructive** saved-search storage contraction | **NO — see below** |
| `0054_add_terms_acceptance` | nullable `terms_accepted_version`/`terms_accepted_at`, no backfill | yes |
| `0055_add_profile_photo_lifecycle` | `PROFILE_PHOTO` upload purpose + owned avatar columns | yes |
| `0056_cover_reminder_post_types` | widens `idx_posts_last_engaged` to RESCUE/LOST reminder types | yes (rebuilds one index; see note) |

**Note on `0056`:** the migration drops and recreates `idx_posts_last_engaged` non-concurrently (the repository's migration convention), which holds an `ACCESS EXCLUSIVE` lock on `posts` for the duration of the index build. Schedule the release for a low-traffic window on large tables.

**Release sequence:**

1. Deploy the retired saved-search runtime (ticket 18) to the API and admin service.
2. Confirm the rolling deployment has fully drained — no previous API/admin revision still queries `saved_searches`.
3. Apply `0053_drop_saved_searches` from the sole migration owner (Main API pre-deploy).
4. Deploy the API/admin code for this release; then set `TERMS_URL`/`TERMS_VERSION` only when the actual Terms document is published and the client acceptance UI ships.
5. Enable push only after FCM credentials and the Flutter device integration are in place.

---

## 7. Explicitly omitted or unchanged flows

- **The separate Rescue Proof form stays disabled.** No proof entities, submission/review operations, proof-specific reporting/admin resources or proof-specific WhatsApp unlock exist. Community Evidence is the existing Comment workflow.
- **Comment attachments are restricted** to `RESCUE` and `LOST` (both subtypes); text Comments remain available on every accessible Post type. Existing image Comments are never purged.
- **No SMS/OTP phone verification** and no phone-verification gate; contact flows keep self-entered phones. No operation claims a phone is verified.
- **Expiry retains content and permits renewal.** `EXPIRED` is not removal; completed/removed Posts cannot be renewed and owners cannot reopen completed Posts (administrator-only correction).
- **Saved searches are removed entirely**, including storage, the admin resource and the orphan GraphQL type; no saved-search alerts. `SYSTEM_ANNOUNCEMENT` remains only as inbox history.
- **No nearby-rescue broadcast pushes**, no automatic community-vote resolution, no automatic rescue/lost/mating expiry, no destructive inactivity cleanup, no Arabic AdminJS localization, no case-assignment product, no unrestricted status editing.

---

## 8. External release dependencies

These are **not** backend-automated checks; they require another teammate or platform configuration and must be evidenced separately before launch.

1. **Actual Terms document and client acceptance readiness.** The Flutter developer writes the Terms and the team publishes them under `https://pupzy.net/`; the exact public path/version is not confirmed by this repository. `TERMS_URL` and `TERMS_VERSION` must be set together only after publication and after the client can display/accept them. Until then the gate stays inactive by design. Changing `TERMS_VERSION` immediately makes earlier acceptances insufficient. Backend acceptance recording, gating and admin inspection are implemented and verified; the URL/version values and published text are not.
2. **Flutter, APNs/FCM and device integration.** The app must request notification permission, register/unregister tokens, handle foreground/background messages and route taps from the `data` identifiers in §4. FCM credentials (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`) and the APNs configuration in the Firebase project are platform work. **Real-device receipt and tap routing are not proven by automated tests** (which use a controlled provider); iOS/Android permission and delivery evidence is required on real devices.
3. **Deployment ordering for the destructive saved-search migration.** `0053_drop_saved_searches` must not run before the retired runtime is deployed everywhere and the rolling deployment has drained; a previous revision still querying the dropped table would fail.
4. **Client media encoding work.** Comment and avatar uploads require client-side static-WebP conversion ≤100 KB and ≤480 px with metadata stripped before using the existing direct-to-R2 upload tickets.
5. **Legal/compliance review** of the published Terms and store UGC compliance remains outside backend code; acceptance records and admin inspection do not by themselves certify them.

---

## 9. Verification pointers

- Integrated verification evidence: `docs/integrated-mvp-release-evidence.md`.
- Per-feature acceptance suites are listed in each contract document above; the release evidence records the executed suites, counts and any unavailable infrastructure.
- Cross-feature addition: `src/terms/terms-gate-comment-media.integration.spec.ts` proves the Terms gate rejects image-comment publication before any media work and that the same staged upload is either rejected by the image-eligibility rule or finalized on an eligible Post after acceptance.
- No file under `frontend/` was changed: `git diff --name-only <base>...HEAD -- frontend/` is empty.

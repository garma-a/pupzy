# Flutter Integration Contract: Device Push Delivery

This document is the authoritative client-facing contract for authenticated device push registration and durable, localized push delivery. It covers the additive GraphQL operations, device lifecycle rules (registration, takeover, sign-out, Account Deletion), the durable delivery model and its bounds, the provider payload shape and routing data, and the external device/platform work that backend tests do **not** prove.

> **Compatibility:** every existing GraphQL operation keeps its name, arguments, input shape, output shape, enum values, and nullability. This work is additive only. **Implementing the Flutter UI is a separate effort; this backend effort does not modify Flutter source or add Flutter tests.**

> **Delivery coverage in this slice:** durable push is enabled for every existing notification workflow — contacts, discussion, moderation, administrator outcomes and reopening, expiry/reminders, engagement and adoption — each rendered bilingually from the same stored columns as the inbox. The retired saved-search `SYSTEM_ANNOUNCEMENT` is inbox-only because that feature is out of scope; nearby-rescue broadcasts do not exist. See Section 5.2 for the per-type routing table.

---

## 1. Overview

- **One token, one owner.** A provider token belongs to at most one Pupzy Account at a time. The account that most recently registered it owns it.
- **Push follows the notification.** A notification row is written first; its push intents are written in the same database transaction. A notification that never commits can never be pushed.
- **Send-time rechecks.** Before every provider call the worker rechecks the recipient's push preference, account availability, current Block isolation and device ownership. A queued push can therefore be suppressed without removing the in-app notification.
- **Bounded and deduplicated.** Each invocation handles a bounded batch; each intent is attempted a bounded number of times with backoff; one intent exists per notification per device; a delivered intent is never sent again.
- **Localization uses the same stored text as the inbox.** Push title/body are rendered from the notification's English/Arabic columns using the recipient's explicitly synchronized language, so push and inbox cannot drift.
- **No exactly-once promise.** A crash between provider acceptance and the durable `DELIVERED` write may repeat one send. The backend never claims provider-level exactly-once delivery.

---

## 2. GraphQL Surface

### 2.1 New enum and types

```graphql
enum DevicePlatform {
  ANDROID
  IOS
}

type DeviceRegistration {
  id: ID!
  platform: DevicePlatform!
  createdAt: DateTime!
  updatedAt: DateTime!
}
```

`DeviceRegistration` deliberately does **not** return the token: the client already holds it. The token value never appears in responses or logs.

### 2.2 `registerDevice` (new mutation)

| Operation | Kind | Authentication | Signature |
|---|---|---|---|
| `registerDevice` | Mutation | Required | `registerDevice(input: RegisterDeviceInput!): DeviceRegistration!` |

`RegisterDeviceInput`:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `token` | `String!` | Yes | Opaque provider token (FCM registration token), trimmed, 1–512 characters. |
| `platform` | `DevicePlatform!` | Yes | Platform that issued the token. |

Behavior:

- **Idempotent for the current owner.** Re-registering the same token for the same account returns the same registration and refreshes `updatedAt`. Register after every token rotation or app install.
- **Takeover.** Registering a token currently owned by another account transfers ownership to the caller in one transaction and cancels the previous owner's queued push intents for that device.
- **No other account's data.** The target account is always the authenticated caller.

**Example:**

```graphql
mutation RegisterDevice($input: RegisterDeviceInput!) {
  registerDevice(input: $input) {
    id
    platform
  }
}
```

```json
{ "input": { "token": "fcm-registration-token", "platform": "ANDROID" } }
```

```json
{
  "data": {
    "registerDevice": {
      "id": "01916327-0000-7000-8000-000000000050",
      "platform": "ANDROID"
    }
  }
}
```

### 2.3 `unregisterDevice` (new mutation)

| Operation | Kind | Authentication | Signature |
|---|---|---|---|
| `unregisterDevice` | Mutation | Required | `unregisterDevice(token: String!): Boolean!` |

- Call on **sign-out** (and whenever push should stop for this device).
- Deletes only the caller's own registration and cascades its queued push intents. The in-app inbox is not affected.
- Returns `true` when a caller-owned registration was removed.
- Returns `false` when the caller has no registration for the token — **including when another account owns the token**. Another account's registration is never changed, and no existence information about that other registration is disclosed.
- Unknown or already-removed tokens are an idempotent `false`, so retrying sign-out is safe.

**Example:**

```graphql
mutation UnregisterDevice($token: String!) {
  unregisterDevice(token: $token)
}
```

### 2.4 `updateMyNotificationPreferences` (new mutation)

| Operation | Kind | Authentication | Signature |
|---|---|---|---|
| `updateMyNotificationPreferences` | Mutation | Required | `updateMyNotificationPreferences(notificationsEnabled: Boolean!): User!` |

- Requires only the boolean; no unrelated profile field is required or touched.
- `notificationsEnabled = false` suppresses push delivery. **The in-app notification inbox and history are fully retained**; opt-out is a delivery choice, not an inbox reset.
- Suppression applies to work already queued: a disabled recipient's pending intents become terminal `SUPPRESSED` on the next worker run and are not re-sent when push is re-enabled.
- `notificationsEnabled = true` restores delivery for **future** notifications only. It never resurrects terminally suppressed work.

**Example:**

```graphql
mutation UpdatePushPreference($notificationsEnabled: Boolean!) {
  updateMyNotificationPreferences(notificationsEnabled: $notificationsEnabled) {
    id
    notificationsEnabled
  }
}
```

### 2.5 Error behavior

| Situation | Result |
|---|---|
| Unauthenticated call | Standard authentication error (global guard). |
| Empty/oversized `token` | `VALIDATION_ERROR` (`token must not be empty`, `token cannot exceed 512 characters`). |
| `platform` not `ANDROID`/`IOS` | GraphQL enum validation error. |
| `unregisterDevice` for an unknown or foreign token | Successful response with `false`; no cross-account effect. |
| `registerDevice` with a token owned by another account | Success; ownership transfers and the previous owner's queued intents for that device are cancelled. |

---

## 3. Device Lifecycle Rules

1. **Owned registration.** Registration always targets the authenticated caller. There is no operation that accepts another account's user ID.
2. **Token rotation.** When the provider rotates a token, the app registers the new token. The old registration remains until the app unregisters it or the provider reports it not registered; the delivery worker then deletes the dead token and its pending intents.
3. **Token reassignment / shared devices.** If a token is registered by a different account, ownership moves and the previous owner's queued pushes for that device are cancelled. The worker additionally rechecks device ownership immediately before sending, so even an out-of-band reassignment cannot deliver the previous account's notification.
4. **Sign-out.** The app calls `unregisterDevice` for its current token; the registration and its queued intents are deleted. The account's inbox is untouched.
5. **Account Deletion.** Device registrations cascade with the account, queued intents are deleted, and the worker suppresses any in-flight work for a banned/deleted account. No push is sent after deletion is accepted.
6. **Isolation.** If an active Block exists between the notification's actor and the recipient when the intent is queued, no notification (and no intent) is written. If a Block commits after the intent was queued, the worker terminally suppresses the push; the already-persisted inbox row remains.

---

## 4. Durable Delivery Model

| Step | Behavior |
|---|---|
| Intent creation | One `push_deliveries` intent per registered device, inserted in the same transaction as the notification. Nothing is sent for a notification that did not commit. |
| Claiming | The worker claims due intents with a database lease (`FOR UPDATE SKIP LOCKED`), so multiple API processes cannot send the same intent concurrently. An interrupted `PROCESSING` intent is reclaimable after its lease expires only while its attempt bound is not exhausted; an exhausted interrupted intent is terminalized `FAILED` without another send. |
| Rechecks | Preference (`notificationsEnabled`), account existence/ban state, device ownership and Block isolation are rechecked in the claim transaction. Failed rechecks set terminal `SUPPRESSED` and never remove the inbox row. |
| Sending | The provider call happens outside database transactions. |
| Success | The intent is set to `DELIVERED` with a lease-guarded write. |
| Retryable failure | `PENDING` with exponential backoff (2s doubling, capped at 5 minutes). |
| Attempt bound | After 5 failed attempts the intent is terminal `FAILED` and is visible for operator intervention. An interrupted `PROCESSING` intent that already reached the bound is terminalized `FAILED` as well, never reclaimed for a sixth send. |
| Dead token | `registration-token-not-registered` / `invalid-registration-token` deletes the device registration, which cascades its pending intents. No further sends are attempted. |
| Bounds | At most 50 intents per worker invocation. |
| Deduplication | Unique `(notification_id, device_id)`: repeated enqueue or recovery creates at most one intent per notification per device; a `DELIVERED` intent is never sent again. |
| Collapse | Each message carries a stable collapse key derived from notification type and routing target, so a platform may collapse repetitive alerts instead of stacking them. |
| Localization | Title/body come from the notification's stored English/Arabic columns and the recipient's explicit `languagePreference`; unsynchronized accounts and legacy rows fall back to English. |

Internal states: `PENDING`, `PROCESSING`, `DELIVERED`, `SUPPRESSED`, `FAILED` (the last three are terminal for a given intent).

---

## 5. Push Payload and Routing Data

Messages are sent through Firebase Cloud Messaging (the existing `firebase-admin` dependency). FCM relays to APNs for iOS, so no second provider integration exists in the backend.

### 5.1 Message shape

- `notification.title` / `notification.body` — localized text (see Section 5.3).
- `data` — tap-routing metadata; every value is a string. Present keys depend on the notification:

| Key | Meaning |
|---|---|
| `notificationId` | The inbox notification ID (use it to mark read / deep link). Always present. |
| `type` | Notification type enum value, e.g. `ADOPTION_APPLICATION_APPROVED`. Always present. |
| `relatedPostId` | Related Post, when present. |
| `relatedCommentId` | Related Comment/Reply, when present. |
| `relatedContactRequestId` | Related Contact Request, when present. |
| `relatedApplicationId` | Related Adoption Application, when present. |

- Collapse controls: Android `collapseKey` and APNs `apns-collapse-id` carry the same bounded key: `sha256(type + ":" + target).slice(0, 32)`, where `target` is `relatedPostId ?? relatedCommentId ?? notificationId`. Repeated alerts of the same type for the same Post/Comment share a key, so the platform may collapse them instead of stacking. The backend never merges or drops intents itself: one intent exists per notification per device.

### 5.2 Per-type routing table

Every notification type below has durable push coverage. `data` always contains `notificationId` and `type`; the routing column lists the additional keys. Title/body show the English template (Arabic is supplied by the same template registry); `${...}` values come from the triggering workflow.

| Type | When it is sent | Recipient | Additional routing keys | English title | English body template |
|---|---|---|---|---|---|
| `NEW_UPVOTE` | A user upvotes a Post | Post owner | `relatedPostId` | `New upvote` | `${actorName} upvoted your post "${postTitle}"` |
| `POST_SAVED` | A user saves a Post | Post owner | `relatedPostId` | `Post saved` | `${actorName} saved your post "${postTitle}"` |
| `CONTACT_REQUEST_RECEIVED` | A user requests the owner's contact | Post owner | `relatedPostId`, `relatedContactRequestId` | `New contact request` | `${actorName} wants to contact you about "${postTitle}"` |
| `CONTACT_REQUEST_APPROVED` | The owner approves a request | Requester | `relatedPostId`, `relatedContactRequestId` | `Contact request approved` | `You can now contact the owner via WhatsApp about "${postTitle}"` |
| `CONTACT_REQUEST_REJECTED` | The owner rejects a request | Requester | `relatedPostId`, `relatedContactRequestId` | `Contact request update` | `Your contact request about "${postTitle}" was not approved` |
| `ADOPTION_APPLICATION_RECEIVED` | A user submits an application | Post owner | `relatedPostId`, `relatedApplicationId` | `New adoption application` | `${actorName} applied to adopt from "${postTitle}"` |
| `ADOPTION_APPLICATION_APPROVED` | The owner approves an application | Applicant | `relatedPostId`, `relatedApplicationId` | `Adoption application approved!` | `Your adoption application for "${postTitle}" has been approved. You can now contact the owner.` |
| `ADOPTION_APPLICATION_REJECTED` | The owner rejects an application | Applicant | `relatedPostId`, `relatedApplicationId` | `Adoption application update` | `Your adoption application for "${postTitle}" was not approved at this time` |
| `POST_REMOVED_BY_ADMIN` | An administrator removes a Post, or a ban cascade removes the account's active Posts | Post owner / banned account | `relatedPostId` (single Post only; the ban cascade carries none) | `Your post was removed` / `Your posts were removed` (cascade) | `${reason}` / `Your account was banned (${reason}) and your active posts were removed.` |
| `POST_RESOLVED_BY_ADMIN` | An administrator records a Post outcome | Post owner | `relatedPostId` | `Post outcome recorded` | `An administrator marked your post "${postTitle}" as ${outcome}.` (`resolved`, `reunited`, `adopted`, `sold`) |
| `POST_REOPENED_BY_ADMIN` | An administrator corrects a mistaken outcome | Post owner | `relatedPostId` | `Post reopened` | `An administrator reopened your post "${postTitle}".` |
| `POST_INACTIVITY_NUDGE` | The expiry worker sends the one reminder allowed per inactivity cycle | Post owner | `relatedPostId` | `Is your post still active?` | `Your post "${postTitle}" has had no recent activity. Review it to keep it active.` |
| `NEW_COMMENT` | A user comments on a Post | Post owner | `relatedPostId`, `relatedCommentId` | `New comment` | `${actorName} commented on your post "${postTitle}"` |
| `NEW_REPLY` | A user replies to a Comment | Parent Comment author | `relatedPostId`, `relatedCommentId` | `New reply` | `${actorName} replied to your comment` |
| `COMMENT_BOOSTED` | A user boosts a Comment or Reply | Comment/Reply author | `relatedPostId`, `relatedCommentId` | `Comment boosted` | `${actorName} boosted your comment` / `...your reply` |
| `COMMENT_PINNED` | The Post owner pins a Comment | Comment author | `relatedPostId`, `relatedCommentId` | `Comment pinned` | `Your comment was pinned on "${postTitle}"` |

Not pushed:

- `SYSTEM_ANNOUNCEMENT` — the retired saved-search alert. It remains inbox-only and has no creation site.
- Nearby-rescue broadcasts — no such notification type exists; nearby rescue activity is excluded from this MVP.

### 5.3 Localization

Title/body come from the notification's stored `title`/`body` and `title_arabic`/`body_arabic` columns and the recipient's explicit `languagePreference`: explicit `ar` renders Arabic, while explicit `en`, NULL/unsynchronized accounts and unknown values render English. Legacy rows without Arabic columns keep their stored English text. The inbox renders through the exact same columns and helper, so push and inbox cannot drift.

**Adoption-approval example:**

```json
{
  "notification": {
    "title": "تمت الموافقة على طلب التبني!",
    "body": "تمت الموافقة على طلب التبني الخاص بك لـ \"Lovely puppy\". يمكنك الآن التواصل مع صاحب المنشور."
  },
  "data": {
    "notificationId": "01916327-0000-7000-8000-000000000060",
    "type": "ADOPTION_APPLICATION_APPROVED",
    "relatedPostId": "01916327-0000-7000-8000-000000000010",
    "relatedApplicationId": "01916327-0000-7000-8000-000000000020"
  },
  "android": { "collapseKey": "b1f2..." },
  "apns": { "headers": { "apns-collapse-id": "b1f2..." } }
}
```

The Flutter app is responsible for requesting notification permission, listening for foreground/background messages, and routing taps from these identifiers. The backend guarantees only that the message is handed to the provider with this payload.

---

## 6. What Backend Tests Prove — and What They Do Not

Automated backend tests use a **controlled provider** at the external boundary with a real PostgreSQL database. They prove registration/unregistration ownership, takeovers, opt-out with inbox preservation, sign-out, Account Deletion cleanup, send-time Block/account/ownership suppression, retry bounds, dead-token cleanup, per-invocation bounds, deduplication, lease recovery and localized payload construction.

Across the push-enabled workflows they additionally prove, through real workflow entry points (contact requests, the durable discussion outbox, the inactivity-expiry worker, the ban cascade, administrator AdminJS actions and engagement toggles), that:

- **every** push-enabled type enqueues its durable intent in the same transaction as its notification, carrying the correct recipient, source actor and routing identifiers;
- for representative types across the covered workflows the provider receives the type-specific payload documented in Section 5.2, localized from the same stored columns as the inbox;
- queued work is terminally suppressed after opt-out, a Block, a ban, Account Deletion or token reassignment, without removing the inbox row;
- repeated worker runs never duplicate an intent or a send.

They do **not** prove:

- **Real-device receipt.** No physical device receives a notification in automated tests.
- **APNs configuration and delivery.** Apple credentials, provisioning, and iOS background modes are platform work; FCM accepts messages in tests but APNs forwarding is not exercised.
- **Flutter listeners and tap routing.** Foreground/background handlers, permission prompts, notification channels and deep-link/tap navigation are Flutter work.
- **Provider-level exactly-once delivery.** See Section 1.

These remain **external release dependencies** requiring separate app/platform evidence before launch.

---

## 7. Migration and Rollout Notes

Migration `0049_add_device_push_delivery` adds:

1. `device_registrations` — one row per provider token with a global unique token constraint and `CASCADE` from `users`.
2. `push_deliveries` — the durable intent outbox with `CASCADE` from `notifications`, `users` and `device_registrations`, a `SET NULL` actor reference, the unique `(notification_id, device_id)` key, and due/lease indexes.

Rollout order:

- Apply the migration before deploying API code that registers devices or writes intents.
- Old API code is unaffected: it neither reads nor writes the new tables, and the new GraphQL fields are additive.
- The worker runs inside the main API topology alongside the existing durable processors; no new service is deployed.

Full workflow coverage changed no schema: later API code extends the push type allowlist and enqueues intents at every direct notification-insert site (discussion outbox, inactivity reminder, ban cascade and the AdminJS moderation actions). Deploy that code only after `0049` is applied. No backfill is required; historical notifications simply have no push intent.

---

## 8. Out of Scope

- `SYSTEM_ANNOUNCEMENT` (retired saved-search alerts) stays inbox-only.
- Nearby-rescue broadcast pushes.
- Flutter screens, permission flows, token storage and tap navigation.
- APNs/FCM console configuration and production credential provisioning.
- Real-device receipt, tap-routing and iOS/Android permission evidence (external release dependencies; see Section 6).

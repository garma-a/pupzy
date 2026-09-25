# Flutter Integration Contract: Notification Language

This document is the authoritative client-facing contract for explicit `ar`/`en` language synchronization and localized in-app notifications. It covers the additive GraphQL operations, the meaning of a null preference, rendering behavior, the centralized template contract that later notification features must follow, and migration/rollout notes.

> **Compatibility:** every existing GraphQL operation keeps its name, arguments, input shape, output shape, enum values, and nullability. This work is additive only. **Implementing the Flutter UI is a separate effort; this backend effort does not modify Flutter source or add Flutter tests.**

> **No Arabic admin localization:** the AdminJS interface stays English. Only the notification content delivered to end users is bilingual.

---

## 1. Overview

- **Explicit choice, not a default.** The historic `language_preference` column defaulted to `ar`, but that default was never a user decision. It has been removed, legacy `ar` values were cleared, and the column is now nullable. An account that has never synchronized a language is **unsynchronized** and receives English.
- **One optional field at onboarding, one small mutation later.** `completeProfile` accepts an optional `languagePreference`; `updateMyLanguagePreference` changes it afterwards and requires no other profile field.
- **Rendering follows the current preference.** In-app notification `title`/`body` are returned in the recipient's explicitly synchronized language at read time, so changing the preference re-renders existing inbox rows.
- **Legacy rows are safe.** Notification rows created before this work have no Arabic content and keep their stored English text.
- **Suppression and cleanup are unchanged.** Block isolation still suppresses immediate and delayed notifications, and Account Deletion redacts the new Arabic content with the same guarantees as English.

---

## 2. GraphQL Surface

### 2.1 New enum

```graphql
enum Language {
  ar
  en
}
```

`ar` and `en` are the only accepted values. Any other value is rejected by GraphQL enum validation, and the resolver additionally validates the value.

### 2.2 `CompleteProfileInput` (existing input, one additive optional field)

| Field | Type | Required | Meaning |
|---|---|---|---|
| `fullName` | `String!` | Yes | Unchanged. |
| `phoneNumber` | `String!` | Yes | Unchanged. |
| `cityId` | `ID` | No | Unchanged. |
| `location` | `GeoLocationInput` | No | Unchanged. |
| `languagePreference` | `Language` | No | Optional explicit language synchronized during onboarding. Omitting it leaves the account unsynchronized (English). |

No existing onboarding input became required. Existing clients that never send `languagePreference` keep working and receive English notifications.

### 2.3 `updateMyLanguagePreference` (new mutation)

| Operation | Kind | Authentication | Signature |
|---|---|---|---|
| `updateMyLanguagePreference` | Mutation | Required | `updateMyLanguagePreference(languagePreference: Language!): User!` |

- The target account is always the authenticated caller.
- Only the language preference is written. **No unrelated profile field is required or touched** — callers do not need to resend `fullName` or `phoneNumber`.
- The existing `updateProfile(input: UpdateProfileInput!)` mutation is unchanged and still requires `fullName`; use `updateMyLanguagePreference` for a language-only change.

**Example — synchronize Arabic:**

```graphql
mutation UpdateMyLanguagePreference($languagePreference: Language!) {
  updateMyLanguagePreference(languagePreference: $languagePreference) {
    id
    languagePreference
  }
}
```

```json
{ "languagePreference": "ar" }
```

**Example — switch back to English:**

```json
{ "languagePreference": "en" }
```

**Response:**

```json
{
  "data": {
    "updateMyLanguagePreference": {
      "id": "01916327-0000-7000-8000-000000000001",
      "languagePreference": "ar"
    }
  }
}
```

### 2.4 `User.languagePreference` (existing field, clarified semantics)

| Value | Meaning |
|---|---|
| `"ar"` | The account explicitly synchronized Arabic. Arabic notification content is rendered when available. |
| `"en"` | The account explicitly synchronized English. |
| `null` | The account has never synchronized a language. Clients must treat this as English. |

The field stays `String` (nullable); its type did not change. There is no separate "unsynchronized" boolean to inspect.

---

## 3. Notification Rendering

`Notification.title` and `Notification.body` are rendered in the recipient's explicitly synchronized language:

- `languagePreference = "ar"` returns the Arabic content produced by the centralized templates.
- `languagePreference = "en"` or `null` returns the English content.
- A legacy row that has no Arabic content returns its stored English text even when the preference is `"ar"`.
- Changing the preference re-renders rows that were created earlier — no re-creation or migration of the inbox is required.

This applies to both `myNotifications` and the notification returned by `markNotificationRead`. Routing identifiers (`relatedPostId`, `relatedCommentId`, `type`, `isRead`, `createdAt`) are unchanged.

**Example:**

```graphql
query MyNotifications {
  myNotifications(first: 20) {
    unreadCount
    edges { node { id type title body relatedPostId relatedCommentId isRead } }
  }
}
```

For an Arabic recipient, a new comment notification returns:

```json
{
  "type": "NEW_COMMENT",
  "title": "تعليق جديد",
  "body": "علّق Ahmed على منشورك \"قطة مفقودة\"",
  "relatedPostId": "01916327-0000-7000-8000-000000000010",
  "relatedCommentId": "01916327-0000-7000-8000-000000000030"
}
```

### 3.1 Existing notification types covered

Every type persisted by the `notification_type` enum has English and Arabic definitions: `NEW_UPVOTE`, `POST_SAVED`, `CONTACT_REQUEST_RECEIVED`, `CONTACT_REQUEST_APPROVED`, `CONTACT_REQUEST_REJECTED`, `ADOPTION_APPLICATION_RECEIVED`, `ADOPTION_APPLICATION_APPROVED`, `ADOPTION_APPLICATION_REJECTED`, `POST_REMOVED_BY_ADMIN` (single-post and account-ban cascade variants), `POST_RESOLVED_BY_ADMIN`, `POST_REOPENED_BY_ADMIN`, `POST_INACTIVITY_NUDGE`, `SYSTEM_ANNOUNCEMENT`, `NEW_COMMENT`, `NEW_REPLY`, `COMMENT_BOOSTED`, `COMMENT_PINNED`.

Administrative notifications written directly by the AdminJS service (`POST_REMOVED_BY_ADMIN`, `POST_RESOLVED_BY_ADMIN` from the administrator case-resolution work and `POST_REOPENED_BY_ADMIN` from the administrator reopening correction) now carry both languages. Rows that predate this work keep the English fallback. `POST_RESOLVED_BY_ADMIN` routes through `related_post_id` and states the recorded outcome (`RESOLVED`, `REUNITED`, `ADOPTED`, `SOLD` or `ANIMAL_DECEASED`, the last rendered as "closed (animal deceased)" / "تم الإغلاق (وفاة الحيوان)" and never as rescued); `POST_REOPENED_BY_ADMIN` routes through `related_post_id` and states that the Post was reopened to Active. In both cases the administrator's internal reason is not disclosed in the notification.

### 3.2 Participant completion notifications

Closure-time participants (Boost/save, Comment/Reply, Contact Request and Adoption Application participation) receive the durable completion notification types as bilingual rows routed through `related_post_id`; `related_comment_id` is null. Every adoption applicant counts regardless of application status (`PENDING`, `APPROVED`, `REJECTED`), and overlapping membership across participation types produces one recipient. The copy is outcome-specific:

| Type | Outcome | English | Arabic |
|---|---|---|---|
| `POST_COMPLETED` | `REUNITED` | "Pet reunited" — `The post "…" was marked as reunited.` | "تم لمّ الشمل" |
| `POST_COMPLETED` | `ADOPTED` | "Pet adopted" — `The post "…" was marked as adopted.` | "تم التبني" |
| `POST_COMPLETED` | `SOLD` | "Item sold" — `The post "…" was marked as sold.` | "تم البيع" |
| `POST_COMPLETED` | `RESOLVED` | "Post resolved" — `The post "…" was marked as resolved.` | "تم حل المنشور" |
| `RESCUE_COMPLETED` | `RESOLVED` | "Rescue resolved" — `The rescue "…" was marked as rescued.` | "تم حل حالة الإنقاذ" |
| `RESCUE_COMPLETED` | `ANIMAL_DECEASED` | "Rescue closed" — `The rescue "…" was closed (animal deceased).` | "تم إغلاق حالة الإنقاذ" — `تم إغلاق حالة الإنقاذ "…" (وفاة الحيوان).` |

`ANIMAL_DECEASED` is a completed outcome but not a success: it closes a RESCUE whose animal died, so its English and Arabic copy states the death explicitly and never contains the successful-rescue wording ("rescued" / "تم إنقاذها"). Clients must not fall back to the `RESOLVED` copy for an unrecognized outcome; treat the outcome as deceased only when the stored status/outcome is `ANIMAL_DECEASED`, and otherwise render the stored notification text as-is (the durable row already carries the correct localized copy).

The completion row for an adoption (`POST_COMPLETED`/`ADOPTED`) carries the same `relatedPostId` routing: opening it navigates to the adoption Post detail screen exactly like every other completed outcome. Implementing that navigation in Flutter is a separate effort; this backend contract only guarantees the routing identifier, the bilingual copy and the notification type. A re-opened outcome sends the correction `POST_REOPENED` ("Post reopened") or `RESCUE_REOPENED` ("Rescue reopened") through the same `related_post_id`. Removal, moderation takedown and inactivity expiry never send a completion or correction notification.

---

## 4. Template Contract for Later Notification Features

Notification types added by later work (for example admin outcome notifications and expiry reminders) must supply both languages through the existing registry in `backend/src/notifications/notification-templates.ts`:

1. Add the type to the `notification_type` persistence enum.
2. Add its parameters to `NotificationTemplateParamsMap`.
3. Add an entry with both `en` and `ar` renderers to `NOTIFICATION_TEMPLATES`.

The registry is typed with a mapped type over the persistence enum, so the backend **does not compile** until a new type has both languages. Creation sites must call `buildNotificationContent(type, params)` and persist the returned `title`, `body`, `titleArabic` and `bodyArabic` columns; the durable discussion outbox stores the same four columns. Push delivery (a later ticket) must read the same stored content and render it through the recipient's preference using `localizeNotification`, so in-app display and push cannot drift.

The English copy of every existing type was preserved byte-for-byte.

---

## 5. Isolation and Cleanup Guarantees

- **Block suppression is unchanged.** Immediate notifications still pass the canonical account-pair lock and recheck in `NotificationsRepository.createIfNotIsolated`; delayed discussion events are terminally `SUPPRESSED` by the processor. An Arabic preference does not weaken either boundary.
- **Self-notification suppression is unchanged.**
- **Account Deletion** redacts the deleted account's `fullName` and `fullNameArabic` from surviving notifications' English **and** Arabic columns, and redacts email/phone from both bodies. The deleted account's own notifications are still removed.
- **Administrative and system notifications** keep their existing no-actor persistence rules.

---

## 6. Migration and Rollout Notes

Migration `0045_add_bilingual_notification_content`:

1. Drops the historic `ar` default from `users.language_preference`, drops `NOT NULL`, and clears legacy `ar` values to `NULL`. Every pre-existing `ar` value was the database default because no explicit preference API existed, so clearing them is what makes "unsynchronized" distinguishable.
2. Adds nullable `title_arabic`/`body_arabic` columns to `notifications` and `discussion_notification_events`.

Rollout order:

- Apply the migration before deploying the API/admin code that writes the Arabic columns.
- Old API code that only reads `title`/`body` keeps working after the migration because the Arabic columns are nullable and the preference column accepts `NULL`.
- The AdminJS image copies the shared template module (`admin-service/Dockerfile`), exactly as it already copies the shared Post lifecycle contract, so both services render from one definition.
- No backfill of fabricated consent or language choices is performed. Accounts synchronize explicitly from the app.

### Additive Post status rollout (ticket 06)

Migration `0058_add_animal_deceased_post_status` appends the `ANIMAL_DECEASED` value to the `post_status`
enum; it changes no existing row or outcome. Rollout order:

1. Apply the migration and deploy the API/admin code that can record the outcome.
2. The Flutter client adds `ANIMAL_DECEASED` to its local `PostStatus` mapping, its status labels and the
   completed-outcome navigation, and treats `RESCUE_COMPLETED` rows as the durable localized copy already
   stored on the notification (no client-side re-rendering is needed).
3. Old clients that do not know the value keep working: it only ever appears on a RESCUE the viewer is
   already entitled to read, and an unknown enum value must be ignored/rendered defensively rather than
   mapped to `RESOLVED`/Rescued.
4. Notification types did not change, so no notification-enum rollout is required; only the copy of the
   existing `RESCUE_COMPLETED` type is outcome-specific.

---

## 7. Out of Scope

- Flutter screens, state, storage and token handling.
- Arabic AdminJS localization.
- Push provider delivery (device registration, APNs/FCM sending and real-device evidence) — a later ticket uses these templates and columns.
- Translating administrator-entered free text such as a removal reason; the reason is stored as provided in both bodies.

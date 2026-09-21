# Post Expiry and Renewal Contract

This document is the authoritative client, admin and deployment contract for the `EXPIRED` lifecycle state and explicit owner renewal introduced by ticket 12. The machine-readable transition tables live in `src/common/contracts/post-lifecycle.contract.ts`, which the API, the expiry processor and the AdminJS service all import. Ticket 13 (ADOPTION window) and ticket 14 (RESCUE/LOST reminder) reuse the same machinery; they change policy data and tests only.

Ticket 12 enables the PRODUCT policy only. ADOPTION, RESCUE, LOST and MATING policy entries already exist but are disabled (`expiryAfterDays: null`, `reminderAfterDays: null`), so those types keep their established behavior until their tickets land.

---

## 1. Post statuses

| Status                     | Meaning                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ACTIVE`                   | Discoverable and accepting interactions.                                                                             |
| `RESOLVED`/`REUNITED`/`ADOPTED`/`SOLD` | A Post Resolution decided by the owner or an administrator.                                                |
| `REMOVED`                  | Administrative takedown or owner deletion. Inaccessible to clients, restorable by an administrator.                  |
| `EXPIRED`                  | Inactivity state of a renewable listing. **Not** resolved, **not** moderation-removed, **not** deletable state.      |

`EXPIRED` must never be conflated with `REMOVED`:

- Direct detail (`post`, and the type-specific `productPostDetail`/`adoptionPostDetail`) and the discussion remain readable with the expired label.
- Owner history (`myPosts`) keeps the listing.
- Media, details, upvotes/saves and Comments are retained.
- Active discovery (`homeFeed`, `marketFeed`, `adoptFeed`, `helpFeed`, and post search) excludes it because every discovery predicate is `status = 'ACTIVE'`.
- New contact requests, adoption applications and PRODUCT seller-contact disclosures are rejected because those paths already require `ACTIVE`.
- Reading (`recordView`) and commenting do **not** change the status or reset the inactivity window; only an explicit owner renewal does.

## 2. Policy table

Source of truth: `POST_EXPIRY_POLICIES` in `src/common/contracts/post-lifecycle.contract.ts`.

| Post type  | Expiry after | Reminder after | Renewable | Ticket 12 behavior                                   |
| ---------- | ------------ | -------------- | --------- | ---------------------------------------------------- |
| `PRODUCT`  | 14 days      | 11 days        | yes       | Enabled.                                             |
| `ADOPTION` | disabled     | disabled       | no        | Machinery ready; ticket 13 enables 30/27 days.       |
| `RESCUE`   | never        | disabled       | no        | Reserved for ticket 14's 60-day reminder.            |
| `LOST`     | never        | disabled       | no        | Reserved for ticket 14's 60-day reminder.            |
| `MATING`   | never        | disabled       | no        | Expiry deliberately stays disabled.                  |

"Inactivity" is measured from `posts.last_engaged_at`, preserving the existing activity signals: owner creating the Post, upvotes, saves, and (for PRODUCT) viewed flushes. Comments and views on non-PRODUCT types never reset the window.

- A reminder is sent once per inactivity cycle: a new reminder requires activity that moves `last_engaged_at` past the stored `posts.reminder_sent_at`.
- A Post already past its expiry window is expired without a late reminder.
- Renewal sets `last_engaged_at = now()` and `renewed_at = now()`, starting a fresh window and reminder cycle.

## 3. Owner renewal operation

```graphql
"""
Explicitly renew an ACTIVE or EXPIRED product listing. Renewal resets the
inactivity window, returns an EXPIRED listing to ACTIVE, and is limited to
once every seven days per Post. Completed (SOLD) and Removed Posts cannot be
renewed, and renewal never revives interactions terminated by expiry.
Only the post creator can renew their own post.
"""
renewPost(postId: ID!): Post!
```

- Input: `postId: ID!` (UUID, `assertUuid`).
- Output: the updated `Post` node. `status` is `ACTIVE`; `lastEngagedAt`/`updatedAt` advance. `renewedAt` is internal persisted state and is not part of the current GraphQL `Post` shape; clients learn the cooldown only from the `RENEWAL_COOLDOWN` error.
- Rejection matrix:

| Situation                                              | GraphQL error                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| Missing Post or `REMOVED` Post                         | `NOT_FOUND`                                                     |
| Caller is not the creator                              | `FORBIDDEN`                                                     |
| Type/status not renewable (e.g. ADOPTION, SOLD, MATING)| `VALIDATION_ERROR`                                              |
| Same Post renewed within the last 7 days                | `RENEWAL_COOLDOWN` (a `ConflictError` code, HTTP-409 semantics) |

- Renewal is transactional under the shared Post lifecycle locks (advisory `comment_discussion:<postId>`, then `FOR UPDATE` on the Post row). Concurrent renewals settle in exactly one serial order: one succeeds and the other receives `RENEWAL_COOLDOWN`.
- Renewal does **not** touch pending, rejected or approved direct interactions, and does **not** reopen them. Interactions terminated by expiry stay `REJECTED`; approved interactions keep their existing account, visibility and Block restrictions.
- Completed (`SOLD`) and `REMOVED` Posts cannot be renewed. An `EXPIRED` listing must be renewed before it can be closed into `SOLD`; `updatePostStatus` keeps its existing `ACTIVE`-only rule.
- `EXPIRED` is a valid GraphQL `PostStatus` value for reads, but is **not** a valid `updatePostStatus` target. Sending it to `updatePostStatus` returns `VALIDATION_ERROR` (the request validator accepts only owner closure outcomes).

## 4. Inactivity processing

Entry point: `PostsRepository.expireInactivePost` / `PostsRepository.recordInactivityReminder`, driven by `PostExpiryProcessor` in the always-on API scheduler.

- One invocation handles at most one bounded batch per phase (`POST_EXPIRY_CANDIDATE_BATCH_SIZE = 100` candidates), with expiries applied before reminders. A larger backlog is drained by the following scheduled runs.
- Each candidate is applied in its own transaction that takes the shared lifecycle locks in the canonical order and re-reads the Post. The expiry `UPDATE` rechecks `status = 'ACTIVE'` and the inactivity window in its `WHERE` clause; the reminder transaction rechecks the whole reminder window and inserts the notification plus `reminder_sent_at` atomically.
- Consequences:
  - A stale job candidate can never expire a Post that was renewed, closed, removed or re-engaged after selection.
  - Retries and multiple API instances create at most one reminder per inactivity cycle, and exactly one expiry.
  - Expiry terminates still-`PENDING` Contact Requests and Adoption Applications (`REJECTED`, `responded_at` set, rows preserved) in the same transaction as the status change. Approved interactions are untouched.
  - Expiry writes no moderation audit row, closes no Post Reports, sends no notification (the pre-expiry reminder is the owner notice) and leaves the owner's Post counters unchanged.
- The reminder notification is `POST_INACTIVITY_NUDGE`, persisted through the centralized bilingual templates (`notification-templates.ts`) with English and Arabic columns. It follows the recipient's explicit language preference at read time (ticket 07 contract: `notification-language-flutter-integration-contract.md`).

## 5. Admin behavior

- AdminJS `ENUMS.postStatus` includes `EXPIRED`, so the Posts list status filter (the History entry point added by ticket 05 reuses the same predicate) can filter expired listings, and staff see the stored status. Migration 0048 registers the `~~*`/`~~` `post_status` operators the AdminJS SQL adapter needs for enum-column filters, matching migration 0017's `city_lifecycle_status` precedent.
- `renewed_at` and `reminder_sent_at` are shown read-only on the Post record next to `last_engaged_at`; they are protected fields and cannot be edited through AdminJS.
- Administrative removal and restoration keep their existing `ACTIVE`-only / `REMOVED`-only rules in this slice; expired listings are not taken down through `removePost`.

## 6. Flutter integration notes

1. Handle the additive `PostStatus.EXPIRED` enum value everywhere `status` is rendered. An exhausted switch will fail decoding for expired listings.
2. Show the expired label on detail screens and in owner history; details, media and discussion remain available.
3. Hide or disable "contact / apply / WhatsApp" actions for expired listings; the backend rejects them.
4. Offer explicit renewal for `ACTIVE` and `EXPIRED` product listings. Do not offer it for `SOLD`/`REMOVED` or non-product types.
5. Surface `RENEWAL_COOLDOWN` as a friendly "try again later" state; no renewal timestamp is currently exposed.
6. Renewal does not restore previously closed interactions; do not optimistically reopen old contact requests/applications in the UI.

## 7. Migration and rollout ordering

| Order | Change                                                                 | Notes                                                                                                                             |
| ----- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `0046_add_expired_post_status.sql` — adds `EXPIRED` to `post_status`   | Additive enum value; old runtime code keeps working because it never writes or expects that value.                                 |
| 2     | `0047_add_post_expiry_state.sql` — adds `renewed_at`, `reminder_sent_at` | Nullable, no default and no backfill; existing rows keep their behavior.                                                           |
| 3     | `0048_add_post_status_filter_operators.sql` — enum filter operators    | AdminJS can filter the Posts list by lifecycle status once applied; harmless to older services.                                    |
| 4     | Deploy the API including `PostExpiryProcessor` and `renewPost`         | The processor is safe to run on a database where older API instances are still serving: it only touches `ACTIVE` renewable listings. |
| 5     | AdminJS with `EXPIRED` enum support                                    | Required for staff to see and filter expired listings.                                                                          |
| 6     | Flutter handles `EXPIRED` and offers renewal                           | Required before the feature is user-visible; an unhandled enum value breaks affected responses.                                    |

No data backfill is performed: listings only become `EXPIRED` when the processor observes their inactivity window. Rollback of the application code is safe (expired rows remain readable), but the `post_status` enum value cannot be removed in place.

## 8. Verification

| Boundary                                                                                                       | Evidence                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Policy, renewal predicate, transition side effects                                                             | `src/common/contracts/post-lifecycle.contract.spec.ts`, `admin-service/src/common/contracts/post-lifecycle.contract.test.js` |
| 14-day expiry, 11-day reminder, boundaries, durable reminder state, multi-worker runs, renewal cooldown/race, reactivation, media/discussion retention, interaction cleanup, exempt types and stale-candidate rechecks | `src/posts/post-expiry.integration.spec.ts`                                                   |
| Admin expired filtering over authenticated AdminJS HTTP                                                        | `admin-service/test/admin-http.test.js`                                                       |
| Enum value and columns created by migrations                                                                   | `src/database/migrate.integration.spec.ts`                                                    |

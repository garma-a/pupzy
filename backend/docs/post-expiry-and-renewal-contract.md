# Post Expiry and Renewal Contract

This document is the authoritative client, admin and deployment contract for the `EXPIRED` lifecycle state, explicit owner renewal and the inactivity reminders introduced by tickets 12, 13 and 14. The machine-readable transition tables live in `src/common/contracts/post-lifecycle.contract.ts`, which the API, the expiry processor and the AdminJS service all import.

Tickets 12 and 13 enable the PRODUCT (14/11-day) and ADOPTION (30/27-day) windows with explicit owner renewal; ticket 14 enables the stand-alone 60-day reminder for RESCUE and LOST. MATING's expiry and reminder deliberately stay disabled.

---

## 1. Post statuses

| Status                     | Meaning                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ACTIVE`                   | Discoverable and accepting interactions.                                                                             |
| `RESOLVED`/`REUNITED`/`ADOPTED`/`SOLD` | A Post Resolution decided by the owner or an administrator.                                                |
| `ANIMAL_DECEASED`          | A completed RESCUE Post Resolution recording that the animal died. Not a success; never renewable and never labelled rescued. |
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

| Post type  | Expiry after | Reminder after | Renewable | Behavior                                              |
| ---------- | ------------ | -------------- | --------- | ----------------------------------------------------- |
| `PRODUCT`  | 14 days      | 11 days        | yes       | Enabled: reminder three days before expiry.           |
| `ADOPTION` | 30 days      | 27 days        | yes       | Enabled: reminder three days before expiry.           |
| `RESCUE`   | never        | 60 days        | no        | Enabled: one stand-alone reminder, **never** expires. |
| `LOST`     | never        | 60 days        | no        | Enabled for both subtypes, **never** expires.         |
| `MATING`   | never        | none           | no        | Expiry and reminders deliberately stay disabled.      |

"Inactivity" is measured from `posts.last_engaged_at`, preserving the existing activity signals: owner creating the Post, upvotes, saves, and (for PRODUCT) viewed flushes. Comments and views on non-PRODUCT types never reset the window. Upvotes and saves restart the ADOPTION window; views do not.

- A reminder is sent once per inactivity cycle: a new reminder requires activity that moves `last_engaged_at` past the stored `posts.reminder_sent_at`.
- A Post already past its expiry window is expired without a late reminder.
- Renewal sets `last_engaged_at = now()` and `renewed_at = now()`, starting a fresh window and reminder cycle.
- RESCUE and LOST have no expiry window (`expiryAfterDays: null`), so their 60-day reminder is stand-alone: it notifies the owner and persists `reminder_sent_at`, and never changes the Post status, discovery eligibility, media or discussion. A second reminder needs new upvote/save activity that opens a new inactivity cycle. MATING receives neither expiry nor a reminder.

## 3. Owner renewal operation

```graphql
"""
Explicitly renew an ACTIVE or EXPIRED product or adoption listing. Renewal
resets the inactivity window, returns an EXPIRED listing to ACTIVE, and is
limited to once every seven days per Post. Completed (SOLD/ADOPTED) and
Removed Posts cannot be renewed, and renewal never revives interactions
terminated by expiry. Only the post creator can renew their own post.
"""
renewPost(postId: ID!): Post!
```

- Input: `postId: ID!` (UUID, `assertUuid`).
- Output: the updated `Post` node. `status` is `ACTIVE`; `lastEngagedAt`/`updatedAt` advance. `renewedAt` is internal persisted state and is not part of the current GraphQL `Post` shape; clients learn the cooldown only from the `RENEWAL_COOLDOWN` error.
- Rejection matrix:

| Situation                                                        | GraphQL error                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Missing Post or `REMOVED` Post                                   | `NOT_FOUND`                                                     |
| Caller is not the creator                                        | `FORBIDDEN`                                                     |
| Type/status not renewable (e.g. RESCUE, LOST, MATING, SOLD, ADOPTED) | `VALIDATION_ERROR`                                          |
| Same Post renewed within the last 7 days                         | `RENEWAL_COOLDOWN` (a `ConflictError` code, HTTP-409 semantics) |

- Renewal is transactional under the shared Post lifecycle locks (advisory `comment_discussion:<postId>`, then `FOR UPDATE` on the Post row). Concurrent renewals settle in exactly one serial order: one succeeds and the other receives `RENEWAL_COOLDOWN`.
- Renewal does **not** touch pending, rejected or approved direct interactions, and does **not** reopen them. Interactions terminated by expiry stay `REJECTED`; approved interactions keep their existing account, visibility and Block restrictions.
- Completed (`SOLD`/`ADOPTED`) and `REMOVED` Posts cannot be renewed. An `EXPIRED` listing must be renewed before it can be closed into its outcome; `updatePostStatus` keeps its existing `ACTIVE`-only rule.
- The same rules apply to adoption applications. Expiry moves every still-`PENDING` adoption application on the listing to `REJECTED` with `responded_at` set in the same transaction as the status change, and renewal leaves it `REJECTED`. Existing application uniqueness/resubmission rules are unchanged: an applicant who already has any application row on the listing still cannot submit another, while a fresh applicant can apply to the renewed listing. An already-`APPROVED` applicant keeps the owner's WhatsApp link (`getAdoptionWhatsAppLink`) through expiry and renewal, subject to the existing active-account and Block checks, because the listing is not Removed.
- `EXPIRED` is a valid GraphQL `PostStatus` value for reads, but is **not** a valid `updatePostStatus` target. Sending it to `updatePostStatus` returns `VALIDATION_ERROR` (the request validator accepts only owner closure outcomes).

## 4. Inactivity processing

Entry point: `PostsRepository.expireInactivePost` / `PostsRepository.recordInactivityReminder`, driven by `PostExpiryProcessor` in the always-on API scheduler. Both enabled policies (PRODUCT 14/11 days, ADOPTION 30/27 days) run through the same type-independent boundary.

- One invocation handles at most one bounded batch per phase (`POST_EXPIRY_CANDIDATE_BATCH_SIZE = 100` candidates), with expiries applied before reminders. A larger backlog is drained by the following scheduled runs.
- Each candidate is applied in its own transaction that takes the shared lifecycle locks in the canonical order and re-reads the Post. The expiry `UPDATE` rechecks `status = 'ACTIVE'` and the inactivity window in its `WHERE` clause; the reminder transaction rechecks the whole reminder window and inserts the notification plus `reminder_sent_at` atomically.
- Consequences:
  - A stale job candidate can never expire a Post that was renewed, closed, removed or re-engaged after selection.
  - Retries and multiple API instances create at most one reminder per inactivity cycle, and exactly one expiry.
  - Expiry terminates still-`PENDING` Contact Requests and Adoption Applications (`REJECTED`, `responded_at` set, rows preserved) in the same transaction as the status change. Approved interactions are untouched.
  - Expiry writes no moderation audit row, closes no Post Reports, sends no notification (the pre-expiry reminder is the owner notice) and leaves the owner's Post counters unchanged.
- RESCUE and LOST candidates use the same reminder path with `reminderAfterDays = 60` and no expiry window: the reminder commits its notification and `reminder_sent_at`, and leaves status, discovery, media and discussion untouched. Closed (`RESOLVED`/`REUNITED`), `REMOVED` and `EXPIRED` Posts are never reminder candidates, and delayed work re-checks these conditions inside the transaction.
- The reminder notification is `POST_INACTIVITY_NUDGE`, persisted through the centralized bilingual templates (`notification-templates.ts`) with English and Arabic columns. It follows the recipient's explicit language preference at read time (ticket 07 contract: `notification-language-flutter-integration-contract.md`).

## 5. Admin behavior

- AdminJS `ENUMS.postStatus` includes `EXPIRED`, so the Posts list status filter (the History entry point added by ticket 05 reuses the same predicate) can filter expired listings, and staff see the stored status. Migration 0048 registers the `~~*`/`~~` `post_status` operators the AdminJS SQL adapter needs for enum-column filters, matching migration 0017's `city_lifecycle_status` precedent.
- `renewed_at` and `reminder_sent_at` are shown read-only on the Post record next to `last_engaged_at`; they are protected fields and cannot be edited through AdminJS.
- Administrative removal and restoration keep their existing `ACTIVE`-only / `REMOVED`-only rules in this slice; expired listings are not taken down through `removePost`.

## 6. Flutter integration notes

1. Handle the additive `PostStatus.EXPIRED` enum value everywhere `status` is rendered. An exhausted switch will fail decoding for expired listings.
2. Show the expired label on detail screens and in owner history; details, media and discussion remain available.
3. Hide or disable "contact / apply / WhatsApp" actions for expired listings; the backend rejects them.
4. Offer explicit renewal for `ACTIVE` and `EXPIRED` product and adoption listings. Do not offer it for `SOLD`/`ADOPTED`/`REMOVED` or non-renewable types (RESCUE, LOST, MATING).
5. Surface `RENEWAL_COOLDOWN` as a friendly "try again later" state; no renewal timestamp is currently exposed.
6. Renewal does not restore previously closed interactions; do not optimistically reopen old contact requests/applications in the UI.
7. RESCUE and LOST cases never become `EXPIRED` and are never renewable. Their owners receive a single `POST_INACTIVITY_NUDGE` after 60 inactive days (and one more only if new upvote/save activity starts another inactivity cycle); no new client operation or label is required, and the existing inbox/push handling covers it.

## 7. Migration and rollout ordering

| Order | Change                                                                 | Notes                                                                                                                             |
| ----- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `0046_add_expired_post_status.sql` — adds `EXPIRED` to `post_status`   | Additive enum value; old runtime code keeps working because it never writes or expects that value.                                 |
| 2     | `0047_add_post_expiry_state.sql` — adds `renewed_at`, `reminder_sent_at` | Nullable, no default and no backfill; existing rows keep their behavior.                                                           |
| 3     | `0048_add_post_status_filter_operators.sql` — enum filter operators    | AdminJS can filter the Posts list by lifecycle status once applied; harmless to older services.                                    |
| 4     | Deploy the API including `PostExpiryProcessor` and `renewPost`         | The processor is safe to run on a database where older API instances are still serving: it only touches `ACTIVE` renewable listings. |
| 5     | AdminJS with `EXPIRED` enum support                                    | Required for staff to see and filter expired listings.                                                                          |
| 6     | Flutter handles `EXPIRED` and offers renewal                           | Required before the feature is user-visible; an unhandled enum value breaks affected responses.                                    |

Tickets 13 and 14 add no policy migration: `EXPIRED`, `renewed_at`, `reminder_sent_at` and the `(post_type, last_engaged_at)` partial index already cover ADOPTION, and the 60-day RESCUE/LOST reminder reuses `reminder_sent_at` from migration 0047. Both are pure policy data, so they deploy with the API version that enables them and roll back by restoring the previous policy values. The follow-up standards fix `0056_cover_reminder_post_types.sql` drops and recreates that partial index with the predicate widened from `('ADOPTION','PRODUCT')` to `('ADOPTION','PRODUCT','RESCUE','LOST')`, so the stand-alone RESCUE/LOST candidate query is served by the index instead of scanning every active Post. The index name and key columns are unchanged, the index is transparent to older application code, and it can be applied before or after the application deploy.

No data backfill is performed: listings only become `EXPIRED` when the processor observes their inactivity window. Rollback of the application code is safe (expired rows remain readable), but the `post_status` enum value cannot be removed in place.

## 8. Verification

| Boundary                                                                                                       | Evidence                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Policy, renewal predicate, transition side effects                                                             | `src/common/contracts/post-lifecycle.contract.spec.ts`, `admin-service/src/common/contracts/post-lifecycle.contract.test.js` |
| 14-day PRODUCT expiry, 11-day reminder, 30/27-day ADOPTION window, 60-day RESCUE/LOST reminder (both LOST subtypes), boundaries, durable reminder state, multi-worker runs, changed activity, closure/deletion/delayed work, renewal cooldown/race, reactivation, media/discussion retention, interaction cleanup, exempt types, owner/admin visibility, pending-application cleanup, uniqueness preservation, approved-contact retention, application races and stale-candidate rechecks | `src/posts/post-expiry.integration.spec.ts`                                                   |
| Admin expired filtering over authenticated AdminJS HTTP                                                        | `admin-service/test/admin-http.test.js`                                                       |
| Reminder candidate query plan uses the widened `idx_posts_last_engaged` (RESCUE and LOST)                       | `src/posts/post-expiry-index.integration.spec.ts`                                             |
| Enum value and columns created by migrations                                                                   | `src/database/migrate.integration.spec.ts`                                                    |

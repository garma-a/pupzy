# Post Lifecycle Transition & Side-Effect Contract

This document is the authoritative contract for every Post lifecycle status change made by the NestJS GraphQL API and the AdminJS service. The machine-readable half of the contract lives in `src/common/contracts/post-lifecycle.contract.ts`, which both services import, so the transition rules and lock namespace cannot drift between them.

This document covers the shared lifecycle statuses. Earlier slices were preparatory; owner closure (ticket 03) adds MATING and FOUND_STRAY outcomes and terminates pending direct interactions when a listing closes, and ticket 12 adds `EXPIRED` plus explicit owner renewal. Ticket 08 adds administrator resolution (`ADMIN_RESOLVE`); administrative reopening remains for the ticket that builds on it. Inactivity expiry has its own authoritative contract: `post-expiry-and-renewal-contract.md`. Administrative resolution has its own staff contract: `admin-case-resolution-contract.md`.

---

## 1. Actors and entry points

| Transition      | Actor                                 | Entry point                                  | Allowed type/status                                  |
| --------------- | ------------------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| `OWNER_CLOSE`   | Post owner                            | GraphQL `updatePostStatus`                   | `ACTIVE` → the successful outcome of the Post's type |
| `OWNER_REMOVE`  | Post owner                            | GraphQL `deletePost`                         | any non-Removed status → `REMOVED`                   |
| `OWNER_RENEW`   | Post owner                            | GraphQL `renewPost`                          | `ACTIVE`/`EXPIRED` → `ACTIVE` under the type policy  |
| `EXPIRE`        | System job (`PostExpiryProcessor`)    | shared inactivity boundary                   | `ACTIVE` → `EXPIRED` under the type policy           |
| `ADMIN_RESOLVE` | Administrator (`ADMIN`/`SUPER_ADMIN`) | AdminJS type-specific resolution actions     | `ACTIVE` → the successful outcome of the Post's type |
| `ADMIN_REMOVE`  | Administrator (`ADMIN`/`SUPER_ADMIN`) | AdminJS `removePost`, ban Post cascade       | `ACTIVE` → `REMOVED`                                 |
| `ADMIN_RESTORE` | Administrator (`ADMIN`/`SUPER_ADMIN`) | AdminJS `restorePost`                        | `REMOVED` → `ACTIVE`                                 |

Owner closure targets (`OWNER_CLOSURE_TRANSITIONS` and, for LOST Posts, `LOST_SUBTYPE_CLOSURE_TRANSITIONS` in the contract):

| Post type  | Direction (`report_type`) | Owner closure outcomes |
| ---------- | ------------------------- | ---------------------- |
| `RESCUE`   | —                         | `RESOLVED`             |
| `LOST`     | `LOST_PET`                | `REUNITED`             |
| `LOST`     | `FOUND_STRAY`             | `RESOLVED`, `REUNITED` |
| `ADOPTION` | —                         | `ADOPTED`              |
| `PRODUCT`  | —                         | `SOLD`                 |
| `MATING`   | —                         | `RESOLVED`             |

A Post owner can close only their own `ACTIVE` Post and only into an outcome that belongs to its type (and, for LOST, its direction); every other target returns a `VALIDATION_ERROR`. FOUND_STRAY retains `REUNITED` so existing clients that already send it keep working. A Post already in a successful outcome returns the same invalid-transition error. A non-owner receives `FORBIDDEN`, and a missing or Removed Post resolves to `NOT_FOUND`.

Administrative removal applies only to `ACTIVE` Posts. It can never overwrite a recorded successful outcome; administrators who need to take down a closed Post will use the explicit outcome controls introduced by later lifecycle work rather than an unrestricted status edit.

## 2. Status meaning stays distinct

`RESOLVED`, `REUNITED`, `ADOPTED` and `SOLD` are **Post Resolutions** decided by the owner (or, later, by an administrator). `REMOVED` is the administrative/owner takedown soft delete: a moderation action carries a reason, audit row and owner notification. `EXPIRED` is the inactivity state of a renewable listing: it leaves active discovery but keeps direct detail, owner history, media and discussion, is **not** a resolution and does **not** reuse `REMOVED`.

Successful outcomes, owner removal, administrative takedown and inactivity expiry are distinguishable by the stored status, who performed the change, the recorded reason/audit metadata, and the resulting `moderation_status`. See `post-expiry-and-renewal-contract.md` for the full expiry/renewal contract.

## 3. Transaction, locking and side effects

Every transition runs inside one database transaction and takes the shared locks in this order:

1. the transaction-scoped advisory key `comment_discussion:<postId>` (`POST_DISCUSSION_LOCK_NAMESPACE`), then
2. the canonical `posts` row with `SELECT ... FOR UPDATE`.

The Post row is re-read and revalidated after both locks. This is the same order used by Comment discussion mutations, so a competing Comment write, owner transition, administrator action, ban cascade or Block cannot interleave or deadlock. Both services keep their existing retry policy around this boundary (`withDbRetry` on the API side, `runModerationAction` on the admin side).

The status write commits together with its database-side effects; cache invalidation and other external effects run only after commit.

| Side effect                                      | `OWNER_CLOSE`                              | `OWNER_REMOVE` | `OWNER_RENEW`  | `EXPIRE`                                   | `ADMIN_RESOLVE`                            | `ADMIN_REMOVE`          | `ADMIN_RESTORE` |
| ------------------------------------------------ | ------------------------------------------ | -------------- | -------------- | ------------------------------------------ | ------------------------------------------ | ----------------------- | --------------- |
| `trg_sync_user_post_counts` delta                | none                                       | decrement      | none           | none                                       | none                                       | decrement               | increment       |
| Pending Contact Requests / Adoption Applications | terminated (`REJECTED`, records preserved) | unchanged      | unchanged      | terminated (`REJECTED`, records preserved) | terminated (`REJECTED`, records preserved) | unchanged               | unchanged       |
| API `user_resolve` cache invalidated             | yes                                        | yes            | yes            | no                                         | no                                         | no                      | no              |
| AdminJS dashboard cache invalidated              | no                                         | no             | no             | no                                         | yes                                        | yes                     | yes             |
| `moderation_actions` audit row                   | no                                         | no             | no             | no                                         | yes (`POST_RESOLVED`, internal reason)     | yes                     | yes             |
| Owner notification                               | none                                       | none           | none           | none (pre-expiry reminder already sent)    | `POST_RESOLVED_BY_ADMIN` (localized)       | `POST_REMOVED_BY_ADMIN` | none            |
| Open Post Reports closed                         | no                                         | no             | no             | no                                         | no                                         | yes                     | yes             |
| Moderation fields (`moderation_*`)               | unchanged                                  | unchanged      | unchanged      | unchanged                                  | unchanged                                  | updated                 | updated         |
| Media, discussion and engagement rows            | retained                                   | retained       | retained       | retained                                   | retained                                   | retained                | unchanged       |

Notes:

- Closing a listing (`OWNER_CLOSE`, the successful outcome) moves every still-PENDING Contact Request and Adoption Application targeting that Post to the established terminal `REJECTED` state with `responded_at` set, inside the same transaction as the status write. Rows are preserved, never deleted, and the existing uniqueness rules still prevent the participant from re-applying to the same Post. `ADMIN_RESOLVE` performs the same cleanup from the admin boundary.
- `ADMIN_RESOLVE` records a type-specific successful outcome for an `ACTIVE` Post, writes the append-only audit row with the actor, internal reason and outcome, inserts the localized `POST_RESOLVED_BY_ADMIN` owner notification and terminates pending interactions in the same transaction. It leaves `moderation_*` fields and open Post Reports untouched and does not change the owner's counters: a Post Resolution is neither a moderation takedown nor a counter event. See `admin-case-resolution-contract.md`.
- Previously **approved** Contact Requests and Adoption Applications are never touched by a closure. Their existing account-availability, visibility and Block restrictions continue to apply, and the approved participant can still retrieve the owner's WhatsApp link for a Post that is no longer Active (the link is only lost when the Post is Removed).
- Owner removal keeps its established behavior: it does not terminate pending interactions, and approved disclosure is denied because the Post is Removed. Administrative removal, restoration, Account Deletion and bans also keep their existing (stronger) access and cleanup behavior; the contract records them as not terminating pending interactions in this slice.
- The counter delta is applied by the existing `trg_sync_user_post_counts` database trigger, not by application code. A closure from `ACTIVE` to a successful outcome does not change the owner's counters; removal decrements them and restoration restores them.
- Administrative removal records the actor and reason, closes every still-open Post Report in the same transaction, and inserts the owner notification. Restoration preserves the prior `moderation_status` (Clean, Flagged or Pending auto review).
- Administrative resolution never overwrites a recorded outcome: it is offered only while the Post is `ACTIVE`. Correcting a completed outcome is the explicit reopening transition (ticket 09), which must not bypass removal, moderation or bans.
- Removal is not destructive: Post media rows, discussion Comments, and upvote/save relationships are retained. Restoration makes them reachable again. Media finalization, deletion and compensation keep their existing durable Staged Upload behavior and are untouched by this contract.
- Expiry is not destructive either: `EXPIRED` retains media, discussion and engagement, stays directly readable, and is left only by `OWNER_RENEW`. Renewal never revives interactions that expiry terminated, and it is rate-limited by the stored `renewed_at` cooldown under the same locks.
- Owner actions never write moderation audit rows or owner notifications; the API invalidates the owner's cached profile after the transaction commits so the refreshed Post counters are served.
- New direct interactions cannot be created after a closure: the creation transaction re-reads the Post under a share lock, so a request or application racing an owner closure settles in exactly one serial order and never leaves a PENDING row on a closed listing. An approval racing a closure likewise settles in one order: approved-before-closure is retained, and a closure that wins leaves the row REJECTED and the approval fails with the established conflict error.

## 4. Isolation and access behavior

The contract preserves the established directional Block isolation:

- A lifecycle transition never crosses account-pair isolation checks, because it only ever changes the state of an existing Post.
- A viewer isolated from a Post's creator (in either Block direction) continues to see the ordinary neutral `NOT_FOUND` for that Post and its type-specific detail queries — both before and after a lifecycle change.
- Administrators retain their moderation visibility and may remove or restore a Post regardless of personal Blocks.
- Owner actions remain owner-only; isolation never grants a third party lifecycle authority.

## 5. What this contract deliberately does not do

The following remain for the tickets that depend on this boundary and must extend the contract rather than duplicate it:

- Administrator reopening with its audited reason and owner notification (ticket 09). Administrative removal/restoration keep their existing behavior and do not terminate pending interactions in this slice.
- The ADOPTION inactivity window and the RESCUE/LOST inactivity reminder (tickets 13–14). Ticket 12 ships the shared machinery with those policy entries disabled; those tickets only enable policy data and add tests.
- Termination of pending interactions on owner removal, Account Deletion or bans: those paths keep their existing (stronger) access and cleanup behavior.

## 6. Verification

| Boundary                                                                                                                                                                                                                            | Evidence                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract rules and lock namespace                                                                                                                                                                                                   | `src/common/contracts/post-lifecycle.contract.spec.ts` (API) and `admin-service/src/common/contracts/post-lifecycle.contract.test.js` (AdminJS loads the same module)                                                                                                                                                                                                             |
| Owner closure, owner removal, counters, cache and isolation through the executable GraphQL schema on real Postgres                                                                                                                  | `src/posts/post-lifecycle.integration.spec.ts`                                                                                                                                                                                                                                                                                                                                    |
| MATING and FOUND_STRAY closure, mating owner history, pending-interaction termination, approved-access retention, roles, Block directions and closure/request/approval races through the executable GraphQL schema on real Postgres | `src/posts/owner-post-closure.integration.spec.ts`                                                                                                                                                                                                                                                                                                                                |
| Administrator resolution through real authenticated AdminJS HTTP actions, handler-level state, audit, localized notification, pending cleanup, atomicity and concurrency | `admin-service/test/admin-case-resolution.test.js`, `admin-service/test/moderation-actions.test.js` (`administrator post resolution`) and the browser journey in `admin-service/test/post-review-workspace-browser.test.js` |
| Administrator removal/restoration through real authenticated AdminJS HTTP actions                                                                                   | `admin-service/test/admin-http.test.js` (`removes and restores a Post over authenticated AdminJS HTTP with audited, notified, counter-synced lifecycle effects`), supported by the handler-level state, audit and notification assertions in `admin-service/test/moderation-actions.test.js` and the cache invalidation assertions in `admin-service/test/dashboard-http.test.js` |
| Expiry, reminders, renewal cooldown, renewal/reactivation and interaction cleanup through the executable GraphQL schema and the real expiry processor on Postgres                                      | `src/posts/post-expiry.integration.spec.ts`                                                                                                                                                                                                                                                                                                                                        |
| Contract expiry policy, renewal predicate and side-effect tables                                                                                                                                    | `src/common/contracts/post-lifecycle.contract.spec.ts` (API) and `admin-service/src/common/contracts/post-lifecycle.contract.test.js` (AdminJS loads the same module)                                                                                                                                                                                                                |

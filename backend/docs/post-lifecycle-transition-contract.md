# Post Lifecycle Transition & Side-Effect Contract

This document is the authoritative contract for every Post lifecycle status change made by the NestJS GraphQL API and the AdminJS service. The machine-readable half of the contract lives in `src/common/contracts/post-lifecycle.contract.ts`, which both services import, so the transition rules and lock namespace cannot drift between them.

This slice is deliberately preparatory and behavior-preserving. It introduces **no new statuses and no new cleanup behavior**; it names the boundary that later owner-closure, administrative outcome, reopening and expiry work extends.

---

## 1. Actors and entry points

| Transition | Actor | Entry point | Allowed type/status |
| --- | --- | --- | --- |
| `OWNER_CLOSE` | Post owner | GraphQL `updatePostStatus` | `ACTIVE` → the successful outcome of the Post's type |
| `OWNER_REMOVE` | Post owner | GraphQL `deletePost` | any non-Removed status → `REMOVED` |
| `ADMIN_REMOVE` | Administrator (`ADMIN`/`SUPER_ADMIN`) | AdminJS `removePost`, ban Post cascade | `ACTIVE` → `REMOVED` |
| `ADMIN_RESTORE` | Administrator (`ADMIN`/`SUPER_ADMIN`) | AdminJS `restorePost` | `REMOVED` → `ACTIVE` |

Owner closure targets (`OWNER_CLOSURE_TRANSITIONS` in the contract):

| Post type | Owner closure outcome |
| --- | --- |
| `RESCUE` | `RESOLVED` |
| `LOST` | `REUNITED` |
| `ADOPTION` | `ADOPTED` |
| `PRODUCT` | `SOLD` |
| `MATING` | none in this slice |

A Post owner can close only their own `ACTIVE` Post and only into its own outcome; every other target returns a `VALIDATION_ERROR`. A Post already in a successful outcome returns the same invalid-transition error. A non-owner receives `FORBIDDEN`, and a missing or Removed Post resolves to `NOT_FOUND`.

Administrative removal applies only to `ACTIVE` Posts. It can never overwrite a recorded successful outcome; administrators who need to take down a closed Post will use the explicit outcome controls introduced by later lifecycle work rather than an unrestricted status edit.

## 2. Status meaning stays distinct

`RESOLVED`, `REUNITED`, `ADOPTED` and `SOLD` are **Post Resolutions** decided by the owner (or, later, by an administrator). `REMOVED` is storage reused by two conceptually different events:

- **administrative takedown** — a moderation action with a reason, audit row and owner notification; and
- **inactivity expiry** — not implemented in this slice.

Successful outcomes, owner removal, administrative takedown and expiry remain distinguishable through who performed the change, the recorded reason and audit metadata, and the resulting `moderation_status`. No new status value is added here.

## 3. Transaction, locking and side effects

Every transition runs inside one database transaction and takes the shared locks in this order:

1. the transaction-scoped advisory key `comment_discussion:<postId>` (`POST_DISCUSSION_LOCK_NAMESPACE`), then
2. the canonical `posts` row with `SELECT ... FOR UPDATE`.

The Post row is re-read and revalidated after both locks. This is the same order used by Comment discussion mutations, so a competing Comment write, owner transition, administrator action, ban cascade or Block cannot interleave or deadlock. Both services keep their existing retry policy around this boundary (`withDbRetry` on the API side, `runModerationAction` on the admin side).

The status write commits together with its database-side effects; cache invalidation and other external effects run only after commit.

| Side effect | `OWNER_CLOSE` | `OWNER_REMOVE` | `ADMIN_REMOVE` | `ADMIN_RESTORE` |
| --- | --- | --- | --- | --- |
| `trg_sync_user_post_counts` delta | none | decrement | decrement | increment |
| API `user_resolve` cache invalidated | yes | yes | no | no |
| AdminJS dashboard cache invalidated | no | no | yes | yes |
| `moderation_actions` audit row | no | no | yes | yes |
| Owner notification | none | none | `POST_REMOVED_BY_ADMIN` | none |
| Open Post Reports closed | no | no | yes | yes |
| Media, discussion and engagement rows | retained | retained | retained | unchanged |

Notes:

- The counter delta is applied by the existing `trg_sync_user_post_counts` database trigger, not by application code. A closure from `ACTIVE` to a successful outcome does not change the owner's counters; removal decrements them and restoration restores them.
- Administrative removal records the actor and reason, closes every still-open Post Report in the same transaction, and inserts the owner notification. Restoration preserves the prior `moderation_status` (Clean, Flagged or Pending auto review).
- Removal is not destructive: Post media rows, discussion Comments, and upvote/save relationships are retained. Restoration makes them reachable again. Media finalization, deletion and compensation keep their existing durable Staged Upload behavior and are untouched by this contract.
- Owner actions never write moderation audit rows or owner notifications; the API invalidates the owner's cached profile after the transaction commits so the refreshed Post counters are served.

## 4. Isolation and access behavior

The contract preserves the established directional Block isolation:

- A lifecycle transition never crosses account-pair isolation checks, because it only ever changes the state of an existing Post.
- A viewer isolated from a Post's creator (in either Block direction) continues to see the ordinary neutral `NOT_FOUND` for that Post and its type-specific detail queries — both before and after a lifecycle change.
- Administrators retain their moderation visibility and may remove or restore a Post regardless of personal Blocks.
- Owner actions remain owner-only; isolation never grants a third party lifecycle authority.

## 5. What this slice deliberately does not do

The following remain for the tickets that depend on this boundary and must extend the contract rather than duplicate it:

- MATING and FOUND_STRAY owner closure, and termination of pending Contact Requests / Adoption Applications when a listing closes (ticket 03).
- Administrator resolution, reopening and owner outcome notifications with localized delivery (tickets 08–09).
- `EXPIRED` persistence, reminders, renewal cooldown and the inactivity jobs for ADOPTION/PRODUCT/RESCUE/LOST (tickets 12–14).

## 6. Verification

| Boundary | Evidence |
| --- | --- |
| Contract rules and lock namespace | `src/common/contracts/post-lifecycle.contract.spec.ts` (API) and `admin-service/src/common/contracts/post-lifecycle.contract.test.js` (AdminJS loads the same module) |
| Owner closure, owner removal, counters, cache and isolation through the executable GraphQL schema on real Postgres | `src/posts/post-lifecycle.integration.spec.ts` |
| Administrator removal/restoration through real authenticated AdminJS HTTP actions | `admin-service/test/admin-http.test.js` (`removes and restores a Post over authenticated AdminJS HTTP with audited, notified, counter-synced lifecycle effects`), supported by the handler-level state, audit and notification assertions in `admin-service/test/moderation-actions.test.js` and the cache invalidation assertions in `admin-service/test/dashboard-http.test.js` |

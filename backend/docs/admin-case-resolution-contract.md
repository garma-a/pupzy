# Administrator Post Resolution contract

Status: implemented (ticket 08 — Resolve a case from the admin workspace; ticket 09 — Correct a mistaken
resolution; ticket 06 — Animal deceased rescue outcome).

This document is the authoritative staff-facing contract for recording and correcting a Post Resolution
from the AdminJS Post review workspace. It is an internal admin contract; it adds no client-facing
GraphQL operation or argument. The owner's inbox is the one client-visible surface: `myNotifications` can
return the additive `POST_RESOLVED_BY_ADMIN` and `POST_REOPENED_BY_ADMIN` enum values (see
`notification-language-flutter-integration-contract.md`). The shared transition rules and lock order live
in `src/common/contracts/post-lifecycle.contract.ts` and `post-lifecycle-transition-contract.md`.

---

## 1. Audience and permissions

- `ADMIN` and `SUPER_ADMIN` only, through the existing authenticated AdminJS session and CSRF boundary.
  No new role, resource or navigation entry is introduced.
- The actions are record actions on the existing Posts resource and are reachable from the Post review
  workspace (`admin-post-review-workspace.md`). The secondary technical resources remain available.
- Administrators keep their established moderation visibility regardless of personal Blocks. Resolution
  only changes the state of an existing Post, so it never crosses account-pair isolation.

## 2. Actions

Only the completed outcomes of the Post's type (and, for LOST, direction) are offered, and only while the
Post is `ACTIVE`. An uncertain case can simply be left alone: nothing forces a decision, so a flagged or
pending Post stays active. RESCUE is the one type with two outcomes: a successful rescue and a rescue
closed because the animal died.

| Action              | Label                | Visible when                                              | Recorded outcome  |
| ------------------- | -------------------- | --------------------------------------------------------- | ----------------- |
| `markRescued`       | Mark rescued         | `RESCUE` + `ACTIVE`                                       | `RESOLVED`        |
| `markAnimalDeceased` | Mark animal deceased | `RESCUE` + `ACTIVE`                                       | `ANIMAL_DECEASED` |
| `markReunited`      | Mark reunited        | `LOST` + `ACTIVE` (`LOST_PET`, `FOUND_STRAY` or unknown)  | `REUNITED`        |
| `markResolved`      | Mark resolved        | `MATING` + `ACTIVE`, or `LOST`/`FOUND_STRAY` + `ACTIVE`   | `RESOLVED`        |
| `markAdopted`       | Mark adopted         | `ADOPTION` + `ACTIVE`                                     | `ADOPTED`         |
| `markSold`          | Mark sold            | `PRODUCT` + `ACTIVE`                                      | `SOLD`            |

- `markAnimalDeceased` records a completed outcome, not a success. Its guard reads "Close this rescue
  because the animal died?", and every notification and label for the outcome states the death explicitly
  and never says "rescued" (English or Arabic). Only RESCUE permits the outcome; every other type rejects a
  direct attempt with the usual cross-type error and no writes.

- A LOST Post's direction discriminator is read server-side before the action list is rendered. A missing
  discriminator keeps the conservative reunited-only rule, exactly like owner closure.
- The outcome is revalidated under the lifecycle locks against the shared contract before anything is
  written, so a direct request for a cross-type, cross-direction or non-`ACTIVE` outcome is rejected even
  if the action was invoked outside the rendered UI.
- Resolution is deliberately distinct from **Remove Post** (`REMOVED`, the moderation takedown), from
  **Restore** (which returns a `REMOVED` Post only) and from **Reopen** (the correction below).
  Resolution never overwrites a recorded outcome and never bypasses removal, moderation or bans.

### Reopening a mistaken resolution

| Action       | Label       | Visible when                                                                              | Recorded change     |
| ------------ | ----------- | ----------------------------------------------------------------------------------------- | ------------------- |
| `reopenPost` | Reopen Post | `RESOLVED`, `REUNITED`, `ADOPTED`, `SOLD` or `ANIMAL_DECEASED`, and the owner is not banned | `ACTIVE`            |

- Reopening is the administrator-only correction of a completed outcome. `ACTIVE`, `REMOVED`, `EXPIRED`
  and unknown states offer no Reopen action, so it can never overwrite an active case, bypass the
  dedicated **Restore** path for removed content or the owner renewal path for an expired listing.
- The action is revalidated under the lifecycle locks: the current status must still be a completed
  outcome and the owner account must still exist and not be banned. A banned owner's Post is rejected
  even if the action is invoked directly outside the rendered UI, so no administrator reopening can put
  a banned account's content back into active discovery.
- Reopening does not revive interactions: previously closed Contact Requests and Adoption Applications
  stay `REJECTED`, approved access keeps its existing account, visibility and Block restrictions, and
  pending interactions are never touched or recreated. The existing application uniqueness rules and
  resubmission policy are unchanged.
- Reopening is not a moderation decision: `moderation_*` fields, open Post Reports, media, discussion and
  engagement rows stay exactly as they were. An open Report is still reviewed on its own path.

## 3. Input

| Field    | Required | Rules                                                                                       |
| -------- | -------- | ------------------------------------------------------------------------------------------- |
| `reason` | Yes      | Trimmed plain text, at most 500 characters. Stored on the audit row as an internal reason.  |

The reason is **internal**: it is recorded in the append-only moderation history for staff review and is
not disclosed in the owner notification. The same input rule applies to resolution and reopening.

## 4. Transaction and side effects

Every resolution runs inside one database transaction using the shared lifecycle locks
(`comment_discussion:<postId>` advisory key, then the `posts` row `FOR UPDATE`) and the existing
`runModerationAction` retry policy. The following commit together:

1. `posts.status` moves to the type-specific completed outcome (`ANIMAL_DECEASED` for a rescue whose
   animal died). The counter trigger delta is `NONE`: the owner's Post counters are unchanged, and
   `moderation_status`, `moderation_reason`, `moderated_at` and `moderated_by_admin_id` are untouched
   because a resolution is not a moderation decision.
2. One append-only `moderation_actions` row (`action_type = POST_RESOLVED`) records the actor, the
   internal reason and metadata (`outcome`, terminated Contact Request count and terminated Adoption
   Application count).
3. One `notifications` row (`POST_RESOLVED_BY_ADMIN`) is inserted for the Post owner with both language
   columns, committed with the state change so notification intent cannot be lost.
4. Every still-`PENDING` Contact Request and Adoption Application targeting the Post moves to the
   established terminal `REJECTED` state with `responded_at` set. Rows are preserved and previously
   **approved** interactions are never touched, so approved contact access keeps its existing account,
   visibility and Block restrictions.
5. A durable participant completion event is captured for **every** recorded outcome, not only RESCUE:
   `POST_COMPLETED` for LOST/ADOPTION/PRODUCT/MATING and `RESCUE_COMPLETED` for RESCUE. The event
   snapshots the closure-time audience (Boost/save, Comment/Reply, Contact Request and Adoption
   Application participation, every application status, deduplicated) with outcome-specific English/Arabic
   copy; Comment/Reply authors are eligible unless their contribution is `DELETED` or `REMOVED`, so
   `HIDDEN`/`IMAGE_HIDDEN` authors remain eligible; the Post creator is always excluded. AdminJS
   administrators are `admin_users` rows with no application-user identity, while the event's `closing_actor_id`
   references `users`, so an administrator-recorded event stores no closing actor and the
   `moderation_actions` audit row names the administrator instead. Delivery happens later through the
   API's bounded completion worker, which rechecks the Post state, account availability and Blocks
   against the Post creator (and the stored closing actor when one exists); its push intents carry the
   Post creator as the send-time isolation actor.

Deliberately untouched: open Post Reports stay open (a Post Resolution is not a moderation review),
media and discussion are retained, and engagement rows are unchanged. After commit, the AdminJS
dashboard statistics cache is invalidated; the API's owner cache is not reachable from the admin
service and is not touched, matching administrative removal.

Reopening uses the same transaction boundary and locks, and commits together:

1. `posts.status` returns to `ACTIVE`. The counter trigger delta is `NONE`: reopening does not change the
   owner's Post counters because a completed outcome and an active Post are both counted, and
   `moderation_status`, `moderation_reason`, `moderated_at` and `moderated_by_admin_id` are untouched.
2. One append-only `moderation_actions` row (`action_type = POST_REOPENED`) records the actor, the
   internal reason and metadata (`previousOutcome`, the corrected outcome).
3. One `notifications` row (`POST_REOPENED_BY_ADMIN`) is inserted for the Post owner with both language
   columns, committed with the state change so notification intent cannot be lost.
4. Pending participant completion events for the Post are superseded, and already-delivered
   participants receive the localized `POST_REOPENED` (or `RESCUE_REOPENED` for RESCUE) correction
   through `reopenPostCompletion`, the AdminJS duplicate that mirrors the API repository's supersession
   and correction behavior over the same durable tables. Corrections apply the same current access
   checks as delivery: a recipient whose account is banned, or who is isolated from the Post creator by
   an active Block in either direction, keeps the delivered closure row and is not corrected, and the
   correction push intents store the Post creator as their send-time Block actor.

Deliberately untouched: every Contact Request and Adoption Application row keeps its current status
(closed stays closed, approved stays approved), open Post Reports stay open, and media, discussion and
engagement are retained. After commit, the AdminJS dashboard statistics cache is invalidated so the
queue counts reflect the Post's return to active discovery.

## 5. Owner notification

| Property      | Value                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------- |
| Type          | `POST_RESOLVED_BY_ADMIN` (resolution) or `POST_REOPENED_BY_ADMIN` (reopening)              |
| Recipient     | The Post owner (`posts.creator_id`)                                                       |
| Routing       | `related_post_id` = the Post; `related_comment_id` is null                                |
| Content       | English and Arabic `title`/`body` from the centralized template registry                  |
| Disclosure    | The internal reason is not included; the notification states the recorded or corrected outcome |

Examples (English):

- Resolution: `An administrator marked your post "Found stray near the market" as resolved.`
- Resolution (animal deceased): `An administrator marked your post "Injured puppy" as closed (animal deceased).`
- Reopening: `An administrator reopened your post "Found stray near the market".`

### Participant completion notification

The closure-time audience (always excluding the Post creator) receives the durable completion event; it
is delivered through the API's bounded worker, not by the AdminJS service. The audience is the union of
Boost/save, Comment/Reply, Contact Request and Adoption Application participation (every
application status), deduplicated. Comment/Reply authors are eligible unless their contribution is
`DELETED` or `REMOVED`; `HIDDEN`/`IMAGE_HIDDEN` authors remain eligible. An administrator-recorded event
stores no closing actor (AdminJS administrators have no application-user identity) and the audit row names
the administrator; the worker's push intents carry the Post creator as the send-time isolation actor.

| Property   | Value                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| Type       | `POST_COMPLETED` for LOST/ADOPTION/PRODUCT/MATING, `RESCUE_COMPLETED` for RESCUE                           |
| Outcome    | The recorded outcome; copy is outcome-specific: `REUNITED` → "Pet reunited" / "تم لمّ الشمل", `ADOPTED` → "Pet adopted" / "تم التبني", `SOLD` → "Item sold" / "تم البيع", `RESOLVED` → "Post resolved" / "تم حل المنشور", `ANIMAL_DECEASED` → "Rescue closed" / "تم إغلاق حالة الإنقاذ" with the death stated in both bodies and never the word "rescued" |
| Correction | `POST_REOPENED` (or `RESCUE_REOPENED`) on a later reopening, delivered to already-notified participants  |
| Routing    | `related_post_id` = the Post; `related_comment_id` is null                                                |
| Content    | English and Arabic `title`/`body` from the centralized template registry                                  |

## 6. Errors and transport behavior

| Situation                                                        | Result                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| Missing, blank or over-500-character reason                      | Error notice, no state/audit/notification writes              |
| Cross-type or cross-direction outcome, or unknown type           | Error notice, no writes                                       |
| Post is not `ACTIVE` (resolution)                                | Error notice, no writes                                       |
| Post is not a completed outcome (reopening: `ACTIVE`, `REMOVED`, `EXPIRED` or unknown) | Error notice, no writes          |
| Post owner is missing or banned (reopening)                      | Error notice, no state/audit/notification writes              |
| Post row no longer exists                                        | Error notice, no writes                                       |
| Caller is not `ADMIN`/`SUPER_ADMIN`                              | Redirected to `/admin/login` (unauthenticated) or forbidden   |
| Missing/invalid CSRF token or cross-origin request               | `403 Forbidden` before any action runs                        |

The result state is visible after the action: the review workspace header shows the new lifecycle badge
and the action history shows the recorded outcome, correction (with the corrected-from outcome), actor
and reason.

## 7. Out of scope for this contract

- Owner reopening of completed Posts (not planned): owners keep only `updatePostStatus`, `deletePost` and
  `renewPost`.
- Unrestricted status editing, a case-assignment product and Arabic admin localization.
- Queue navigation, cross-screen polish and the remaining admin experience work (tickets 05 and 21).
- Any client-facing GraphQL operation change: the only client-visible addition is the additive
  `POST_RESOLVED_BY_ADMIN` and `POST_REOPENED_BY_ADMIN` values served by `myNotifications`; no operation,
  argument or output field changes.

## 8. Verification

```
cd backend/admin-service
npm test
npm run test:integration
npm run test:browser
npm run check:glossary
npm run format:check
```

| Boundary                                                                                          | Evidence                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract rules (type-specific targets, ACTIVE-only source, completed-outcome-only reopening, side effects) | `backend/src/common/contracts/post-lifecycle.contract.spec.ts` and `admin-service/src/common/contracts/post-lifecycle.contract.test.js`                                                                                |
| Resolution action visibility matrix, audit, notification, pending cleanup, atomicity, cache and concurrency | `admin-service/test/moderation-actions.test.js` (`administrator post resolution`)                                                                                                                                      |
| Reopening visibility, banned-owner rejection (including the `ANIMAL_DECEASED` outcome), preserved closed interactions, audit, notification, atomicity and concurrency | `admin-service/test/moderation-actions.test.js` (`administrator post reopening`)                                                                                                                            |
| Authenticated AdminJS HTTP actions, type-specific action lists, roles, reason enforcement and races | `admin-service/test/admin-case-resolution.test.js` (`Administrator case resolution HTTP boundary` and `Administrator case reopening HTTP boundary`)                                                                        |
| Participant completion event capture, outcome/audience/localized copy (including the deceased copy that never says "rescued") and no event on removal through authenticated AdminJS HTTP actions | `admin-service/test/admin-case-resolution.test.js` (`records an audited animal-deceased resolution for an ACTIVE RESCUE only and never labels it as rescued`; `captures and localizes the participant completion event for a non-rescue outcome, and never on removal`; `captures adoption applicants of every status in the ADOPTED completion audience over authenticated HTTP`) |
| Participant completion delivery for every completed outcome, reopen corrections, stale-event suppression and creator-isolation recheck on real Postgres | `backend/src/notifications/post-completion-notification.integration.spec.ts` |
| Real browser resolution and reopening correction journey, result state, action bar and history      | `admin-service/test/post-review-workspace-browser.test.js` (evidence in `BWG08_EVIDENCE_DIR` and `BWG09_EVIDENCE_DIR`)                                                                                                        |
| Migration enum values (resolution 0050, reopening 0051, animal deceased 0058)                      | `backend/src/database/migrate.integration.spec.ts`                                                                                                                                                                            |
| Notification template completeness and bilingual copy                                             | `backend/src/notifications/notification-templates.spec.ts`                                                                                                                                                                    |
| Client-visible `NotificationType` enum covers every persisted value                               | `backend/src/common/graphql/notification-type-enum-consistency.spec.ts`                                                                                                                                                        |
| Owner inbox serializes and localizes the persisted admin notifications through the executable schema | `backend/src/notifications/notification-language.integration.spec.ts`                                                                                                                                                         |

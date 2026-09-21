# Administrator Post Resolution contract

Status: implemented (ticket 08 — Resolve a case from the admin workspace).

This document is the authoritative staff-facing contract for recording a Post Resolution from the AdminJS
Post review workspace. It is an internal admin contract; it adds no client-facing GraphQL operation or
argument. The owner's inbox is the one client-visible surface: `myNotifications` can now return the
additive `POST_RESOLVED_BY_ADMIN` enum value (see
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

Only the successful outcome of the Post's type (and, for LOST, direction) is offered, and only while the
Post is `ACTIVE`. An uncertain case can simply be left alone: nothing forces a decision, so a flagged or
pending Post stays active.

| Action         | Label          | Visible when                                              | Recorded outcome |
| -------------- | -------------- | --------------------------------------------------------- | ---------------- |
| `markRescued`  | Mark rescued   | `RESCUE` + `ACTIVE`                                       | `RESOLVED`       |
| `markReunited` | Mark reunited  | `LOST` + `ACTIVE` (`LOST_PET`, `FOUND_STRAY` or unknown)  | `REUNITED`       |
| `markResolved` | Mark resolved  | `MATING` + `ACTIVE`, or `LOST`/`FOUND_STRAY` + `ACTIVE`   | `RESOLVED`       |
| `markAdopted`  | Mark adopted   | `ADOPTION` + `ACTIVE`                                     | `ADOPTED`        |
| `markSold`     | Mark sold      | `PRODUCT` + `ACTIVE`                                      | `SOLD`           |

- A LOST Post's direction discriminator is read server-side before the action list is rendered. A missing
  discriminator keeps the conservative reunited-only rule, exactly like owner closure.
- The outcome is revalidated under the lifecycle locks against the shared contract before anything is
  written, so a direct request for a cross-type, cross-direction or non-`ACTIVE` outcome is rejected even
  if the action was invoked outside the rendered UI.
- Resolution is deliberately distinct from **Remove Post** (`REMOVED`, the moderation takedown) and from
  **Reopen** (ticket 09, which corrects a recorded outcome). Resolution never overwrites a recorded
  outcome and never bypasses removal, moderation or bans.

## 3. Input

| Field    | Required | Rules                                                                                       |
| -------- | -------- | ------------------------------------------------------------------------------------------- |
| `reason` | Yes      | Trimmed plain text, at most 500 characters. Stored on the audit row as an internal reason.  |

The reason is **internal**: it is recorded in the append-only moderation history for staff review and is
not disclosed in the owner notification.

## 4. Transaction and side effects

Every resolution runs inside one database transaction using the shared lifecycle locks
(`comment_discussion:<postId>` advisory key, then the `posts` row `FOR UPDATE`) and the existing
`runModerationAction` retry policy. The following commit together:

1. `posts.status` moves to the type-specific successful outcome. The counter trigger delta is `NONE`:
   the owner's Post counters are unchanged, and `moderation_status`, `moderation_reason`,
   `moderated_at` and `moderated_by_admin_id` are untouched because a resolution is not a moderation
   decision.
2. One append-only `moderation_actions` row (`action_type = POST_RESOLVED`) records the actor, the
   internal reason and metadata (`outcome`, terminated Contact Request count and terminated Adoption
   Application count).
3. One `notifications` row (`POST_RESOLVED_BY_ADMIN`) is inserted for the Post owner with both language
   columns, committed with the state change so notification intent cannot be lost.
4. Every still-`PENDING` Contact Request and Adoption Application targeting the Post moves to the
   established terminal `REJECTED` state with `responded_at` set. Rows are preserved and previously
   **approved** interactions are never touched, so approved contact access keeps its existing account,
   visibility and Block restrictions.

Deliberately untouched: open Post Reports stay open (a Post Resolution is not a moderation review),
media and discussion are retained, and engagement rows are unchanged. After commit, the AdminJS
dashboard statistics cache is invalidated; the API's owner cache is not reachable from the admin
service and is not touched, matching administrative removal.

## 5. Owner notification

| Property      | Value                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------- |
| Type          | `POST_RESOLVED_BY_ADMIN`                                                                  |
| Recipient     | The Post owner (`posts.creator_id`)                                                       |
| Routing       | `related_post_id` = the Post; `related_comment_id` is null                                |
| Content       | English and Arabic `title`/`body` from the centralized template registry                  |
| Disclosure    | The internal reason is not included; the notification states the recorded outcome          |

Example (English): `An administrator marked your post "Found stray near the market" as resolved.`

## 6. Errors and transport behavior

| Situation                                                        | Result                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| Missing, blank or over-500-character reason                      | Error notice, no state/audit/notification writes              |
| Cross-type or cross-direction outcome, or unknown type           | Error notice, no writes                                       |
| Post is not `ACTIVE` (outcome already recorded, `REMOVED`, `EXPIRED`) | Error notice, no writes                                  |
| Post row no longer exists                                        | Error notice, no writes                                       |
| Caller is not `ADMIN`/`SUPER_ADMIN`                              | Redirected to `/admin/login` (unauthenticated) or forbidden   |
| Missing/invalid CSRF token or cross-origin request               | `403 Forbidden` before any action runs                        |

The result state is visible after the action: the review workspace header shows the new lifecycle badge
and the action history shows the recorded outcome, actor and reason.

## 7. Out of scope for this contract

- Reopening a recorded outcome (ticket 09) and owner reopening (not planned).
- Unrestricted status editing, a case-assignment product and Arabic admin localization.
- Queue navigation, cross-screen polish and the remaining admin experience work (tickets 05 and 21).
- Any client-facing GraphQL operation change: owners keep `updatePostStatus`, `deletePost` and `renewPost`
  as before. The only client-visible addition is the `POST_RESOLVED_BY_ADMIN` value now served by
  `myNotifications`; no operation, argument or output field changes.

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
| Contract rules (type-specific targets, ACTIVE-only source, side effects)                           | `backend/src/common/contracts/post-lifecycle.contract.spec.ts` and `admin-service/src/common/contracts/post-lifecycle.contract.test.js`                                                                                       |
| Action visibility matrix, audit, notification, pending cleanup, atomicity, cache and concurrency   | `admin-service/test/moderation-actions.test.js` (`administrator post resolution`)                                                                                                                                             |
| Authenticated AdminJS HTTP actions, type-specific action lists, roles, reason enforcement, races  | `admin-service/test/admin-case-resolution.test.js`                                                                                                                                                                            |
| Real browser confirmation, result state, type-specific action bar and resolution/removal contrast  | `admin-service/test/post-review-workspace-browser.test.js` (evidence in `BWG08_EVIDENCE_DIR`)                                                                                                                                 |
| Migration 0049 enum values                                                                        | `backend/src/database/migrate.integration.spec.ts`                                                                                                                                                                            |
| Notification template completeness and bilingual copy                                             | `backend/src/notifications/notification-templates.spec.ts`                                                                                                                                                                    |
| Client-visible `NotificationType` enum covers every persisted value                               | `backend/src/common/graphql/notification-type-enum-consistency.spec.ts`                                                                                                                                                        |
| Owner inbox serializes and localizes the persisted admin notification through the executable schema | `backend/src/notifications/notification-language.integration.spec.ts`                                                                                                                                                          |

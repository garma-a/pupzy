# Admin Post review workspace contract

Status: implemented (ticket 06 — Review Post and Comment photos together).

This document describes the admin-only Post review workspace in the AdminJS service. It is an internal
staff contract; it does not change any client-facing GraphQL operation.

## Audience and permissions

- English interface for administrators only. `ADMIN` and `SUPER_ADMIN` roles retain full access; an
  unauthenticated request is redirected to `/admin/login`, and a disabled staff account loses access
  immediately through the existing session revocation.
- The workspace is rendered on the existing Posts resource record page (`show`). No new AdminJS
  resource, navigation entry or role is introduced, and the secondary technical resources remain
  available.

## Workspace contents

Opening one Post shows, in this order:

1. **Header** — title, readable Post type and lost/found subtype, lifecycle outcome, moderation state,
   urgency, City and area, age and owner context (name and email, matching existing Users resource
   visibility rules), plus the recorded moderation reason.
2. **Original photos** — the Post's own `post_media` rows as an aligned thumbnail grid. Each thumbnail
   opens a full-image preview that scales the complete image (`object-fit: contain`); the preview
   navigates across the Post's photos.
3. **Community discussion** — one bounded page of top-level Comments with their Replies, each with
   author, time, readable moderation state (Active, Image hidden, Hidden, Deleted, Removed), Boost
   count and attached-image thumbnails with their own previews.
4. **Reports** — Post Reports and Comment Reports for this Post, open items first, each labeled
   `Open` or `Reviewed` (with the recorded review outcome where one exists) and linked to the existing
   report review screens.
5. **Action history** — administrator actions recorded for the Post and its Comments, newest first,
   with action label, target type, actor, time and reason. A recorded resolution reads
   `Post marked <outcome>` from its audit metadata, and a correction reads
   `Post reopened (was <outcome>)`.

## Resolution and reopening actions

The workspace exposes only the lifecycle actions valid for the current record, alongside the existing
moderation actions:

- `markRescued` and `markAnimalDeceased` for an active rescue (`markAnimalDeceased` closes the rescue
  because the animal died and is never described as rescued); `markReunited` for an active lost/found
  case; `markResolved` for an active mating listing or found stray; `markAdopted` for an active adoption;
  `markSold` for an active product listing. A recorded outcome, removal or expiry exposes none of them.
- `reopenPost` for a completed outcome (`RESOLVED`, `REUNITED`, `ADOPTED`, `SOLD` or `ANIMAL_DECEASED`)
  whose owner is not banned. Active, removed and expired Posts expose no Reopen action: removal and
  expiry keep their own dedicated paths.
- Both confirmations state the consequence, require an internal reason, and use a primary
  (non-destructive) button so outcome changes are visibly distinct from **Remove Post**. The
  confirmation is a filled primary action, **Remove Post** keeps the filled danger treatment, and
  hover, pressed, disabled and loading feedback comes from the shared admin theme; the submit stays
  disabled and unmistakably inactive until the reason is valid.
- The action commits the outcome or correction, audit row, localized owner notification and (for
  resolution only) pending-interaction cleanup together; see `admin-case-resolution-contract.md`.
  Reopening leaves closed requests and applications closed.

## Expired listings

- An `EXPIRED` listing reads `Expired` in the lifecycle badge and exposes no resolution, reopening,
  removal or restoration action: expiry keeps its own owner-renewal path, so the workspace only
  reports state. This matches `post-expiry-and-renewal-contract.md`.
- Expired listings keep the workspace context: original photos, paginated discussion with attached
  images, Reports and action history stay visible for staff.
- The History → Expired queue (see `admin-work-queues.md`) opens these listings, and **Back to
  filtered list** returns to the same `filters.status=EXPIRED` list.

## Cross-screen review experience

The dashboard, Posts list, record action windows, workspace and full-image preview share one
interaction language (ticket 21):

- Outcome confirmations are filled primary actions and removal keeps its filled danger treatment, so
  the two are visibly distinct; both expose hover, pressed, disabled and loading states and a
  `role="status"` message while submitting. A disabled confirmation is unmistakably inactive.
- Buttons that carry no Pupzy variant (the AdminJS action bar and dialog controls) gain the same
  hover and pressed feedback from the shared theme.
- Focus is visible on every control; the full-image preview traps focus, dismisses with Escape and
  returns focus to the thumbnail that opened it; `prefers-reduced-motion` collapses every shared
  transition and pressed translation.
- Narrow screens keep the workspace, thumbnail grid, preview and long list titles inside the
  viewport; list titles truncate instead of colliding.
- Filter preservation is verified end to end for the flagged and expired queues, including Browser
  Back.

## Discussion pagination API

The discussion is paginated server-side so a Post with a long discussion does not load unbounded data
into the record page. The workspace uses a hidden, read-only record action:

```
GET /admin/api/resources/posts/records/:recordId/postReviewDiscussion?page=:page
```

- `page` is optional and defaults to `1`; invalid or non-positive values fall back to `1`, and a page
  beyond the last page is clamped to the last page.
- Page size is 10 top-level Comments. Replies are returned with their parent Comment; pagination never
  splits a Comment from its Replies.
- The action is available to `ADMIN` and `SUPER_ADMIN` only, is not rendered as an action button, and
  performs no writes. It returns the page payload on
  `record.params.post_review_discussion`, mirroring the initial `show` payload on
  `record.params.post_review_workspace`.

## Media and retention

- Comment image URLs are derived from the immutable storage key and the configured delivery base
  (`COMMENT_MEDIA_CDN_BASE`, then `R2_PUBLIC_URL`, then `https://cdn.pupzy.net`), matching the
  client-facing comment media contract.
- Missing, deleted or blank media never breaks the record page: a photo without a usable URL renders as
  an explicit unavailable cell, and an image whose bytes fail to load degrades to the same fallback in
  both the thumbnail grid and the full preview.
- Every Comment moderation state stays visible to staff with its readable label, so existing staff
  retention visibility is preserved. The workspace does not delete or alter any media, Comment,
  Report or audit record.
- If the workspace data cannot be loaded at all, the record page still renders the standard record
  fields with a warning instead of failing.

## Bounds

- Reports: up to 50 Post Reports and 50 Comment Reports per page payload.
- History: up to 50 administrator action rows.
- Discussion: 10 top-level Comments with all their Replies.

## Returning to the queue

Opening a Post from a filtered Posts list remembers that list's filters for the browser tab, and the
workspace header offers **Back to filtered list** (or **Back to Posts list** when no filters were
used). Browser Back also preserves the filtered list. See `admin-work-queues.md`.

## Out of scope for this workspace

Owner reopening of completed Posts and unrestricted status editing are not exposed (administrators use
the audited `reopenPost` correction). Cross-screen polish is contracted in the section above.

## Verification

```
cd backend/admin-service
npm test
npm run test:integration
npm run test:browser
npm run check:glossary
npm run format:check
```

`test/post-review-workspace.test.js` exercises the authenticated admin HTTP boundary against a real
database (workspace payload, pagination, permissions, retention, missing media, cross-Post isolation).
`test/admin-case-resolution.test.js` covers the authenticated resolution and reopening actions,
type/state-specific action lists, reason enforcement, banned-owner rejection, audit/notification/cleanup
atomicity and concurrency. `test/post-review-workspace-browser.test.js` drives the real AdminJS UI in
Chrome (aligned thumbnails, full-image previews preserving aspect ratio, keyboard focus return, reduced
motion, narrow screens, a plain `ADMIN` session and the resolution/reopening correction journeys).
`test/admin-review-experience-browser.test.js` is the ticket 21 cross-screen acceptance suite: shared
dashboard and confirmation control states (hover, pressed, disabled, loading, error/retry), the
History → Expired → workspace → filtered-list return journey, keyboard/reduced-motion/narrow-screen
journeys and long-title handling, with screenshots recorded under `BWG21_EVIDENCE_DIR` (default
`/tmp/opencode/bwg-21-evidence`).

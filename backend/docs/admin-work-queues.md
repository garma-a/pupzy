# Admin work queues contract

Status: implemented (ticket 05 — Navigate admin work queues and flagged Posts).

This document is the authoritative staff-facing contract for the dashboard work-queue navigation
introduced in the AdminJS service. It is an internal admin contract; it adds no client-facing GraphQL
operation or argument and changes no existing API behavior.

## Audience and permissions

- English interface for administrators only. `ADMIN` and `SUPER_ADMIN` roles retain access; an
  unauthenticated request is redirected to `/admin/login` and the existing session revocation applies.
- The queues are presets over the existing AdminJS resources (Posts, Post Reports, Comment Reports,
  Account Reports). No new resource, role or permission is introduced, and the secondary technical
  resources remain available under their existing navigation groups.

## Queue entries

Each queue links to the resource list page with explicit AdminJS filter parameters, so the same
existing type, lifecycle, moderation, urgency, City and date filters remain visible and adjustable.
Counts are computed with the SQL predicate shown below; the filtered list page uses the equivalent
AdminJS filter, so a queue's count and its result page always agree.

| Group        | Entry                  | Resource        | AdminJS filter parameters                                    | Count predicate                                                           |
| ------------ | ---------------------- | --------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Needs review | Flagged — needs review | Posts           | `moderation_status=FLAGGED`, `status=ACTIVE`                 | `moderation_status = 'FLAGGED' AND status = 'ACTIVE'`                     |
| Needs review | Pending moderation     | Posts           | `moderation_status=PENDING_AUTO_REVIEW`, `status=ACTIVE`     | `moderation_status = 'PENDING_AUTO_REVIEW' AND status = 'ACTIVE'`         |
| Needs review | Open Post Reports      | Post Reports    | `review_state=OPEN`                                          | `reviewed_at IS NULL`                                                     |
| Needs review | Open Comment Reports   | Comment Reports | `review_state=OPEN`                                          | `reviewed_at IS NULL`                                                     |
| Needs review | Open Account Reports   | Account Reports | `review_state=OPEN`                                          | `reviewed_at IS NULL`                                                     |
| Rescue       | Active rescue          | Posts           | `post_type=RESCUE`, `status=ACTIVE`                          | `post_type = 'RESCUE' AND status = 'ACTIVE'`                              |
| Lost & found | All lost & found       | Posts           | `post_type=LOST`, `status=ACTIVE`                            | `post_type = 'LOST' AND status = 'ACTIVE'`                                |
| Lost & found | Lost pet               | Posts           | `post_type=LOST`, `status=ACTIVE`, `report_type=LOST_PET`    | active `LOST` with a `lost_posts` row whose `report_type = 'LOST_PET'`    |
| Lost & found | Found stray            | Posts           | `post_type=LOST`, `status=ACTIVE`, `report_type=FOUND_STRAY` | active `LOST` with a `lost_posts` row whose `report_type = 'FOUND_STRAY'` |
| Listings     | Adoption               | Posts           | `post_type=ADOPTION`, `status=ACTIVE`                        | `post_type = 'ADOPTION' AND status = 'ACTIVE'`                            |
| Listings     | Products               | Posts           | `post_type=PRODUCT`, `status=ACTIVE`                         | `post_type = 'PRODUCT' AND status = 'ACTIVE'`                             |
| Listings     | Mating                 | Posts           | `post_type=MATING`, `status=ACTIVE`                          | `post_type = 'MATING' AND status = 'ACTIVE'`                              |
| History      | Completed              | Posts           | `queue=completed`                                            | `status IN ('RESOLVED', 'REUNITED', 'ADOPTED', 'SOLD')`                   |
| History      | Expired                | Posts           | `status=EXPIRED`                                             | `status = 'EXPIRED'`                                                      |
| History      | Removed                | Posts           | `status=REMOVED`                                             | `status = 'REMOVED'`                                                      |

### Predicate notes

- **Moderation flags, pending moderation and open Reports are distinct.** A `FLAGGED` Post is
  outstanding moderation work; a `PENDING_AUTO_REVIEW` Post has not been reviewed yet; an open Report
  is an unreviewed Post, Comment or Account Report row. A Post with `moderation_status = 'CLEAN'` and
  an open Report appears in the open-Report queue and not in the flagged queue, and a flagged Post
  with no Reports shows `Open reports` `0` in the dashboard review table.
- **Open Reports use `reviewed_at IS NULL`,** never the historical `posts.report_count` counter. The
  dashboard review table shows the live unreviewed Report count per Post.
- **A flagged Post that already reached an outcome** (`RESOLVED`, `REUNITED`, `ADOPTED`, `SOLD`,
  `REMOVED`, `EXPIRED`) is not outstanding review work, matching the pre-existing dashboard
  statistics predicate.
- **History preserves meaning.** `Completed` is a recorded successful outcome, `Expired` is an
  inactivity state of a renewable listing and `Removed` is an administrative takedown; they are never
  merged.
- **Photo Comments alone** do not create a review queue. There is no claimed "disputed case" queue.

## Virtual filter properties

`report_type`, `queue` and `review_state` are read-only virtual filter columns provided by the admin
SQL adapter; they are not table columns. They only exist as list filters and translate to the
predicates above. Unknown values are ignored rather than emitted as column predicates. The
`review_state=REVIEWED` counterpart is also available on the Report resources.

The Posts enum filters (`post_type`, `status`, `moderation_status`, `urgency`) are declared as value
selectors on the adapter property, so they compile to equality predicates against the PostgreSQL
enums instead of an unsupported `ILIKE`.

## Returning from review

- Opening a Post from a filtered list records that list query string for the Posts resource in
  session storage (per browser tab). The Post review workspace then offers **Back to filtered list**,
  which returns to the same filtered queue. Browser Back keeps the same filters as well.
- The dashboard review table links to the Post workspace and offers **Flagged — needs review** as a
  direct link to the flagged queue.

## Presentation and interaction

- Queue entries are labeled links with a live count badge; the flagged queue is highlighted when
  outstanding work exists. Buttons expose hover, focus-visible, pressed and reduced-motion states
  from the shared Pupzy theme.
- The dashboard **Refresh now** control is a filled primary action: it disables itself, announces
  `aria-busy` while loading and holds its width so the header does not jump. A failed refresh keeps
  the last good dashboard visible with an alert and a **Retry** action; the queue grid is never
  replaced by the error state.
- The queue grid and the review table are responsive; on narrow screens the entries stack and the
  table scrolls horizontally without breaking the page layout. Long titles truncate inside their
  cells instead of widening the page.
- Loading, empty and request-error states remain on the dashboard as before.

## Verification

```
cd backend/admin-service
npm test
npm run test:integration
npm run test:browser
npm run check:glossary
npm run format:check
```

| Boundary                                                                                                         | Evidence                                                                          |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Queue definitions, predicates, count SQL and link building                                                       | `src/adminjs/dashboard/work-queues.test.js`                                       |
| Virtual filter translation and enum filter properties                                                            | `src/adminjs/queue-filters.test.js`, `src/adminjs/sql-adapter.test.js`            |
| Dashboard handler returns live queue counts and unreviewed Report counts                                         | `src/adminjs/dashboard/dashboard-handler.test.js`                                 |
| Counts equal filtered list totals, flagged vs open Reports, pagination, subtypes, history views                  | `test/admin-work-queues.test.js`                                                  |
| One labeled action reaches flagged Posts, filters survive return, narrow screens and button states               | `test/admin-work-queues-browser.test.js` (evidence in `BWG05_EVIDENCE_DIR`)       |
| Cross-screen keyboard/reduced-motion/narrow journeys, expired-history return and shared dashboard control states | `test/admin-review-experience-browser.test.js` (evidence in `BWG21_EVIDENCE_DIR`) |

## Out of scope for this contract

- Cross-screen interaction detail, previews and action-window feedback are contracted in
  `admin-post-review-workspace.md` (Cross-screen review experience).
- The audited resolution/reopen actions themselves (tickets 08 and 09); the queues only navigate to
  the existing Post review workspace.
- Arabic admin localization, a case-assignment product and unrestricted status editing.

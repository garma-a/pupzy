# Flutter UI completion handoff

Reverified 2026-09-25 after running `git fetch origin main`.

- **Flutter baseline:** latest fetched `origin/main`, commit `e5c616287a29eef2950c0f53c3339402f8f05cdd` — `feat: implement contact request handling and terms acceptance flow`.
- **Comparison:** `git diff origin/main HEAD -- frontend` is empty. Both branches have the same Flutter tree (`8be84118eef48e8339ff0a75396239a760316cef`). This handoff includes the Flutter developer's latest committed work available on origin/main at the time of verification.
- **Backend target:** `1fcaf55` on `hard-implementation/community-rescue-resolution`. Animal deceased and participant completion/correction notifications belong to this feature branch. Coordinate their release with the backend; do not assume those additions are already deployed just because the Flutter baseline is main.

This is a source-code audit, not a device-tested release assessment. It covers confirmed gaps in the inspected screens and flows; it is not an exhaustive audit of every screen or work that has not been pushed. Paths below are relative to the repository root. Proof screens have already been removed, and several integrations have been added. Do not recreate that completed work.

## Task overview

Most entries are fixes to existing controls, not requests to build whole features again.

| Item | Work category | What the developer should change |
| --- | --- | --- |
| 1 | New rescue-feature integration | Add Animal deceased choice and localized outcome display; clarify Rescued wording. |
| 2 | Existing discussion UI fix | Refresh/reconcile ordering after add, pin, unpin and Boost, including pagination. |
| 3 | Existing action-state fix | Stop offering new contact/application submissions on completed Posts. |
| 4 | Existing renewal/closure fix | Disable Mark Sold/Adopted on expired listings until renewal succeeds. |
| 5 | Existing attachment UI completion | Add the second photo slot and recover failed uploads without dropping photos. |
| 6 | Existing submission reliability fix | Keep the same submission identity when retrying an uncertain result. |
| 7 | Existing list completion | Load beyond the first page and find older existing adoption applications. |
| 8 | Existing push integration fix | Complete routing, permission recovery and subscription cleanup. |
| 9 | Existing Terms integration fix | Recover from changed Terms versions without losing the user's draft. |

## Expected button states

| Viewer / Post state | Show or enable | Hide or disable |
| --- | --- | --- |
| Owner, ACTIVE rescue | Rescued and Animal deceased choices | Reopen |
| Owner, completed rescue | Accurate read-only outcome, including Animal deceased | Both closure choices and Reopen |
| Owner, ACTIVE product/adoption | Mark Sold/Adopted; Renew subject to cooldown | Reopen |
| Owner, EXPIRED product/adoption | Renew and an explanation that renewal is required before closure | Mark Sold/Adopted until renewal succeeds |
| Nonowner, ACTIVE Post, no prior interaction | Applicable new contact/application action | Owner closure controls |
| Nonowner, completed Post, no approved interaction | Outcome label; discussion under existing access rules | New contact/application submission |
| Previously approved contact requester/adoption applicant, completed Post | Existing WhatsApp retrieval, subject to current backend access checks | A new duplicate request/application |
| Inaccessible/Removed Post | Neutral “This content isn't available” state | Contact/application/closure actions |

Keep existing type-specific behavior: product seller contact is not the approved-request workflow. Reopening by an administrator does not revive rejected requests/applications, and the UI must not reset them to Pending.

## 1. Rescue outcome choice and truthful status labels

**Current behavior:** `frontend/lib/widgets/owner_post_actions.dart` defines only `RESOLVED` for rescue closure. There is no `ANIMAL_DECEASED` handling in Flutter. An administrator-recorded deceased outcome falls back to the ordinary resolved owner-button label; My Posts falls back to the raw API status string.

**Required work:** Offer active rescue owners **Rescued** and **Animal deceased**, with English/Arabic confirmation and completion labels. Reuse the alternate-outcome chooser already used for found-stray Posts. Render the actual outcome in details, owner history and any saved-Post status presentation. Never use a success checkmark or rescued wording to represent an animal's death. Explain Rescued as immediate danger addressed and appropriate care secured; permanent adoption is not required. An optional invitation to share a discussion update must not become a closure requirement.

**Acceptance:** Both choices call `updatePostStatus` with the correct target; nonowners have no closure controls; other Post types never offer Animal deceased; a deceased Post opened from history or a notification has an accurate localized label. Do not add owner reopening: that remains an administrator action.

**Example to reproduce:** Have an administrator mark a rescue Animal deceased, then open it as its owner and inspect My Posts. The label must say Animal deceased in the selected language, not Resolved or `ANIMAL_DECEASED`.

**Start here:** `frontend/lib/widgets/owner_post_actions.dart`, `frontend/lib/screens/rescue_detail_screen.dart`, `frontend/lib/screens/my_posts_screen.dart`. Contract: `backend/docs/post-lifecycle-transition-contract.md`.

## 2. Reconcile Comment ordering after interactions

**Current behavior:** `comments_sheet.dart` prepends every new Comment, changes pin flags in place, and replaces boosted Comments without reranking. Loading another page simply appends it. This can put a new Comment above the pin, leave a newly pinned Comment lower down, or leave Top in the wrong order.

**Required work:** Reconcile with the backend's pinned-first Top/Newest result after add, pin, unpin and Boost actions. Reset/refetch affected cursor pages and deduplicate IDs; sorting only the currently loaded subset cannot recover entries crossing a pagination boundary.

**Acceptance:** Pin stays first; replacing/unpinning repositions correctly; Boost ranking updates immediately; a multi-page discussion has no duplicate or dropped entries after ranking changes. Add widget interaction tests for these cases.

**Example to reproduce:** Pin a Comment, then add a new one. The new Comment must appear beneath the pin. Also pin an item on page two and verify that it moves to the first position without duplication.

**Start here:** `frontend/lib/widgets/comments_sheet.dart` (`_send`, `_pinComment`, `_unpinComment`, `_replaceComment`, `_loadMore`). Contract: `backend/docs/comments-flutter-integration-contract.md`.

## 3. Disable new contact/application actions on completed Posts

**Current behavior:** Rescue and mating contact buttons check the existing request status but not whether the Post is ACTIVE. Adoption allows a new application when there is no application and the listing is not EXPIRED, which also allows the button on an ADOPTED listing. The backend rejects these submissions.

**Required work:** Enable a new contact request or application only for ACTIVE Posts. Show an outcome-specific closed state instead of inviting a submission that must fail. Refresh state after a stale-screen rejection.

**Acceptance:** A new visitor cannot request contact on a completed rescue/mating Post or apply to an adopted animal. Preserve the separate **approved WhatsApp access** path: previously approved users may still retrieve contact details after closure, subject to backend access checks. Do not disable all existing approved contact buttons merely because a Post is completed.

**Example to reproduce:** Open an ADOPTED listing with an account that has never applied. It must display the completed state, not an enabled Ask to adopt button. Repeat with an approved applicant and verify WhatsApp remains available when the backend permits it.

**Start here:** `frontend/lib/screens/rescue_detail_screen.dart`, `frontend/lib/screens/mating_detail_screen.dart`, `frontend/lib/screens/adoption_detail_screen.dart`. Contract: `backend/docs/post-lifecycle-transition-contract.md`.

## 4. Expired listings must be renewed before closure

**Current behavior:** Product owners can tap Mark Sold on EXPIRED listings because the button only checks whether the listing is SOLD. Adoption owners can tap Mark Adopted on EXPIRED listings because `isClosed` only checks ADOPTED. Both operations are rejected by the backend.

**Required work:** Keep Renew available, disable closure until renewal succeeds, and show “Renew this listing before marking it sold/adopted.” After renewal, enable the correct closure action. Keep the expired label distinct from a completed outcome.

**Acceptance:** Expired product/adoption listings expose no enabled closure action; successful renewal restores it; cooldown failure leaves the expired state intact.

**Example to reproduce:** Open an EXPIRED product as its owner. Mark Sold must be disabled until Renew succeeds; a failed renewal must not enable Mark Sold.

**Start here:** `frontend/lib/screens/product_detail_screen.dart`, `frontend/lib/screens/adoption_detail_screen.dart`, `frontend/lib/widgets/renew_post_button.dart`. Contract: `backend/docs/post-expiry-and-renewal-contract.md` §3.

## 5. Complete the Comment attachment composer

**Current behavior:** The composer stores one `_pendingImage`; selecting another replaces it. The contract supports two images. Compression, ticket or upload failures also automatically continue by publishing text without the chosen photo. An uncaught upload exception can leave `_sending` true.

**Required work:** Support selecting, previewing and removing up to two photos on RESCUE/LOST Comments. When any attachment fails, preserve the draft and offer Retry or an explicit “Post without photo(s)” choice. Do not automatically change the submitted content. Use exception handling/finally so failed uploads cannot leave Send stuck.

**Acceptance:** Two attachments publish together; a failed attachment does not silently produce a partial/text-only Comment; offline upload leaves a recoverable draft and usable controls. Keep Replies image-free and hide attachments on other Post types.

**Start here:** `frontend/lib/widgets/comments_sheet.dart` (`_pendingImage`, `_pickImage`, `_send`). Contract: `backend/docs/comments-flutter-integration-contract.md` §§image upload/constraints.

## 6. Make Comment and Reply retries preserve the original submission

**Current behavior:** Each Send attempt generates a new `clientRequestId`. If the server commits a Comment/Reply but its response is lost, tapping Send again can create a duplicate. Image retries also start a new upload attempt rather than preserving the original submission identity.

**Required work:** Generate the request ID once per submission, retain its text and media IDs while the result is uncertain, and reuse the identical payload/ID for retries. Preserve recoverable draft state across screen/app interruption as required by the mobile retry contract. Start a new ID when the user intentionally creates a different submission. Handle expired media tickets separately from a retryable finalization failure.

**Acceptance:** Simulate server success followed by a lost response: Retry produces one canonical Comment/Reply and one notification, with the chosen images intact.

**Start here:** `frontend/lib/widgets/comments_sheet.dart` (`_send`, `_sendReply`), `frontend/lib/services/graphql_service.dart`. Contract: `backend/docs/comments-flutter-integration-contract.md`; original retry ticket: `.scratch/comment-images-remediation/issues/07-preserve-mobile-submissions-across-retries.md`.

## 7. Add pagination to requests, applications and the inbox

**Current behavior:** The inbox fetches 30 notifications; personal request/application lists fetch 50; owner pending sections use the service defaults of 20. These service methods discard connection pagination data and expose no `after` argument. Older entries have no Load more path. Adoption details also infer the user's application by scanning only the latest 50 applications, so an older approved application can be missed and the screen can offer Ask to adopt instead of WhatsApp.

**Required work:** Return `pageInfo` and accept `after` in the GraphQL service methods; add loading, retry and end-of-list states to the UI. For adoption detail, find the existing application across pages using currently supported operations; do not invent a backend filter that does not exist.

**Acceptance:** The 31st notification, 51st personal request/application and 21st owner pending item are reachable. An older approved application still exposes the correct contact action. Page retries do not duplicate rows.

**Start here:** `frontend/lib/services/graphql_service.dart`, `frontend/lib/screens/notifications_panel.dart`, `frontend/lib/screens/contact_requests_screen.dart`, `frontend/lib/screens/my_adoption_applications_screen.dart`, `frontend/lib/screens/adoption_detail_screen.dart`, and both owner request/application section widgets.

## 8. Finish push tap and session recovery behavior

**Current behavior:** `PushService` opens the Post but ignores `relatedCommentId`, unlike the inbox's discussion-aware routing. An unavailable Post causes a silent return. Initialization sets `_initialized` before permission/token registration succeeds; a permission denial or transient failure prevents another initialization attempt in that service instance. Stream subscriptions are not retained/cancelled, so sign-out/sign-in can accumulate listeners.

**Required work:** Share the inbox/push routing behavior: open the discussion for Comment/Reply notifications and show a neutral unavailable message for inaccessible content. Make initialization retryable after failure and permission changes, and dispose old subscriptions on session changes so each tap is handled once. Provide a usable recovery path after OS permission denial, such as instructions/link to device notification settings. Keep foreground toast behavior unless a richer banner is separately desired.

**Acceptance:** Test foreground/background/cold-start taps, inaccessible Posts, discussion notifications, denied-then-enabled OS permission, transient registration failure and repeated sign-out/sign-in. A single tap must open one destination for the current account. Verify on real iOS and Android devices; source wiring alone does not prove delivery.

**Start here:** `frontend/lib/services/push_service.dart`, `frontend/lib/screens/notifications_panel.dart`, `frontend/lib/screens/app_shell.dart`.

## 9. Recover when the Terms version changes

**Current behavior:** The acceptance sheet submits its original `widget.version`, ignores the returned error code, and shows a generic error when acceptance fails. If the backend publishes a new version while the sheet is open, repeatedly tapping Accept keeps submitting the outdated version.

**Required work:** On `TERMS_VERSION_MISMATCH`, fetch the latest Terms and present the updated version for explicit acceptance. Handle `TERMS_ACCEPTANCE_REQUIRED` from protected mutations as well as the preflight check; preserve the user's draft, obtain acceptance, and retry the intended action once safely.

**Acceptance:** Change the Terms version while the sheet/form is open: the user can read and accept the latest version without losing their draft or entering a permanent retry loop. Never automatically accept a newer version on their behalf.

**Start here:** `frontend/lib/services/terms_gate.dart`, protected submission handlers and `frontend/lib/services/graphql_service.dart`. Contract: `backend/docs/terms-acceptance-flutter-integration-contract.md`.

## Already present — preserve and verify

- Separate rescue-proof screens and service calls have been removed in the current checkout.
- Mating closure and the found-stray outcome chooser exist.
- Product/adoption renewal controls exist; the gap is their interaction with other buttons and states.
- Approved adoption WhatsApp retrieval exists.
- Terms screens, server language synchronization, notification preferences, device registration, profile-photo operations and server-side feed search have implementations.
- Report/Block screens and blocked-account management exist.
- Inbox routing already fetches the current Post via `relatedPostId`; do not report all new completion notification routing as missing. Add tests for `RESCUE_COMPLETED`, `RESCUE_REOPENED`, `POST_COMPLETED`, `POST_REOPENED` and Animal deceased labels.

These are implemented foundations, not claims that every edge case has passed runtime testing. In particular, Terms and push need the targeted corrections above; renewal needs correct disabled states; generic notification navigation needs feature-specific regression coverage.

## Suggested delivery order

1. Outcome labels and valid action states (1, 3, 4).
2. Comment ordering, attachment recovery and idempotent retries (2, 5, 6).
3. Pagination and existing-application lookup (7).
4. Push/session recovery and Terms-version recovery (8, 9).

Add targeted widget/integration tests with each item. Verify English and Arabic presentation, loading/disabled states, failed requests and account isolation. No new admin dashboard, owner reopening, proof workflow or backend endpoint is requested by this handoff.

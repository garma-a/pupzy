# Release Evidence: Integrated MVP Backend & Admin (Tickets 01–21, verified by Ticket 22)

This document records reproducible evidence that the integrated backend and AdminJS MVP work is compatible with existing mobile behavior, that migration ordering is safe, and that the agreed scope was verified cross-feature as one release. It distinguishes **executed** evidence from **static inspection** and explicitly records the one gate that was **unavailable** in this environment.

- **Branch:** `task/bwg-22`
- **Schema/compatibility baseline:** `9c568213afe325e17c308be0fd73a6aee9d66bbf` (merge-base with `origin/main`; the integration branch point before the 21 product tickets)
- **Code candidate under test:** `3d011fa5b32cd94d403930dd802986f2106e6155` (`test(release): verify terms gate and community evidence media as one release (ticket 22)`). The parent commit `78e1052` contains all product tickets; `3d011fa` adds only one integration test file and changes no SDL, resolver, service or client.
- **Companion document commit:** the commit containing this document adds only `docs/` files and `.gitignore` exceptions; it changes no product code and was not part of the tested candidate.
- **Final integrated candidate:** `19d4aa4` (integration branch tip after merging the whole-diff standards-review fixes: admin-image COPY + guard, migration `0056` reminder index, outcome-allowlist single-sourcing). Re-verified by the standalone suite runs in §14.
- **Evidence date:** 2026-09-22
- **Environment:** Linux, Node.js `v24.4.0`, Docker `29.6.1` (rootless context `unix:///run/user/1000/docker.sock`), test database image `postgis/postgis:16-3.4-alpine`, Chromium/Chrome `150.0.7871.46`.
- **Related documents:** `docs/integrated-mvp-frontend-handoff.md`, all per-feature contracts listed there, `docs/adr/0007-retire-saved-search-runtime-before-storage-contraction.md`, and the prior campaign's `docs/ugc-reporting-and-account-blocking-release-evidence.md`.

## Evidence Status Legend

| Status | Meaning |
|---|---|
| **EXECUTED** | Command was run in this environment against the candidate commit; results are recorded verbatim. |
| **STATIC** | Verified by inspecting files/history rather than executing a test. |
| **UNAVAILABLE** | Could not complete in this environment; the exact command and error are recorded, and no success is claimed. |

## Summary

| # | Gate | Status | Result |
|---|---|---|---|
| 1 | GraphQL schema compatibility vs `9c56821` | EXECUTED | **Authorized exception only** — 18 additive changes, 1 incompatible (`REMOVED_TYPE SavedSearch`) |
| 2 | `npm run format:check` (root + admin) | EXECUTED | exit 0 / exit 0 |
| 3 | `npm run lint` | EXECUTED | exit 0, no file modified |
| 4 | `npm run build` | EXECUTED | exit 0 |
| 5 | `npm run check:glossary` (root + admin) | EXECUTED | 6/6 passed (root), 3/3 passed (admin) |
| 6 | `npm run test:unit` | EXECUTED | 75 suites, **1023/1023 tests**, 36.96 s |
| 7 | `cd admin-service && npm test` | EXECUTED | 93 suites, **416/416 tests**, 74.09 s |
| 8 | Migration verification (clean, repeat, baseline upgrade, contraction) | EXECUTED | 1 suite, **8/8 tests**, 34.57 s |
| 9 | Reset safety verification | EXECUTED | 1 suite, **23/23 tests**, 25.92 s |
| 10 | `npm run test:integration` | EXECUTED | 40 suites, **580/580 tests**, 1725.74 s |
| 11 | `cd admin-service && npm run test:integration` | EXECUTED | 23 suites, **174/174 tests**, 1027.47 s |
| 12 | `cd admin-service && npm run test:browser` | EXECUTED | 4 suites, **27/27 tests**, 573.43 s |
| 13 | Focused cross-feature spec (terms gate × image-comment media) | EXECUTED | 1 suite, **2/2 tests**, 28.64 s (also included in gate 10) |
| 14 | No-Flutter-change confirmation | EXECUTED (command) | 0 files changed/committed vs `9c56821` |
| 15 | `npm run test:e2e` (production container smoke) | **UNAVAILABLE** | 6/9 pass; the 3 production-smoke tests fail at the admin Docker image build on this environment's symlinked `admin-service/node_modules`; exact error in §10 |
| 16 | `npm run verify:release` aggregate | PARTIAL | **14/15 stages passed, 2266/2269 tests, 0 skips**; stops at the environment-blocked `e2e-root` stage |

The aggregate run's own summary is reproduced in §11. The gate script classifies the `e2e-root` failure as `PRODUCT`; §10 shows the failure is a Docker build-context artifact of the provisioned symlinked `node_modules` and not a product assertion failure. Per the release rules, unavailable infrastructure is not claimed as passing.

---

## 1. GraphQL Schema Compatibility Proof (EXECUTED)

**Command**

```
cd backend
node scripts/graphql-schema-compat.mjs 9c56821 HEAD --dump-dir /tmp/opencode/bwg-22-evidence/schema-dumps
```

**Method**

1. Enumerate every `backend/src/**/*.graphql` file at each revision, read the SDL, merge it (`@graphql-tools/merge`, matching `@nestjs/graphql` `typePaths` behavior), and build an executable schema (`graphql-js`).
2. For every baseline type that still exists, compare type kind, every field's canonical type string (nullability/list nesting), every field argument and argument type, every enum value, and every union member.
3. Report any disappearing or changed baseline surface as **incompatible**, and any new type/field/optional argument/enum value as **additive**. Adding a required argument/input field is also incompatible.

**Result**

```
Baseline:  9c56821 -> 9c568213afe325e17c308be0fd73a6aee9d66bbf (14 SDL files)
Candidate: HEAD    -> 3d011fa5b32cd94d403930dd802986f2106e6155 (16 SDL files)

Additive changes (18):
  + ADDED_ARGUMENTS Query.adoptFeed(operation): search
  + ADDED_ARGUMENTS Query.helpFeed(operation): search
  + ADDED_ARGUMENTS Query.homeFeed(operation): search
  + ADDED_ARGUMENTS Query.marketFeed(operation): search
  + ADDED_ARGUMENTS Query.matingFeed(operation): search
  + ADDED_ENUM_VALUES NotificationType: POST_RESOLVED_BY_ADMIN, POST_REOPENED_BY_ADMIN
  + ADDED_ENUM_VALUES PostStatus: EXPIRED
  + ADDED_FIELDS CompleteProfileInput: languagePreference
  + ADDED_FIELDS Mutation: registerDevice, unregisterDevice, renewPost, acceptTerms,
      requestProfilePhotoUploadUrl, setProfilePhoto, removeProfilePhoto,
      updateMyLanguagePreference, updateMyNotificationPreferences
  + ADDED_FIELDS Query: getAdoptionWhatsAppLink, terms
  + ADDED_TYPE AcceptTermsInput (InputObject)
  + ADDED_TYPE DevicePlatform (ENUM)
  + ADDED_TYPE DeviceRegistration (Object)
  + ADDED_TYPE Language (ENUM)
  + ADDED_TYPE ProfilePhotoUploadTicket (Object)
  + ADDED_TYPE RegisterDeviceInput (InputObject)
  + ADDED_TYPE RequestProfilePhotoUploadInput (InputObject)
  + ADDED_TYPE TermsInfo (Object)

Incompatible changes (1):
  ! REMOVED_TYPE SavedSearch

RESULT: INCOMPATIBLE
```

The script exits `1` on `INCOMPATIBLE`; this is the expected fail-closed signal for the one **authorized** schema-removal exception (spec Implementation Decisions 2 and 22; ADR 0007). `SavedSearch` had no `Query` or `Mutation` field referencing it, so no client operation changes. The assertion for this release is therefore: **exactly one incompatible change, and it is `SavedSearch`; any additional incompatible change would be a defect.** Sorted SDL dumps for both revisions are written to `/tmp/opencode/bwg-22-evidence/schema-dumps/` (temporary).

This proves preservation of every existing operation name, argument, input shape, output shape, enum value and nullability except the authorized removal.

---

## 2. Static Quality Gates (EXECUTED)

All commands run from `backend/` unless noted.

| Command | Result | Notes |
|---|---|---|
| `npm run format:check` | exit 0 (26.14 s) | Root prettier check. |
| `cd admin-service && npm run format:check` | exit 0 (8.44 s) | Admin prettier check. |
| `npm run check:glossary` | 3 node tests + 3 jest tests passed | Root glossary conformance, includes the admin-service source scan. |
| `cd admin-service && npm run check:glossary` | 3/3 passed | Admin glossary conformance. |
| `npm run lint` (eslint `--fix`) | exit 0 (70.54 s) | `git status` unchanged afterwards; no file was reformatted. |
| `npm run build` (nest build) | exit 0 (25.94 s) | Build artifacts are gitignored. |

---

## 3. Unit Suites (EXECUTED)

```
cd backend
npm run test:unit        # part of verify:release
cd admin-service
npm test
```

- Root: **Test Suites: 75 passed, 75 total. Tests: 1023 passed, 1023 total. Time: 36.96 s.** No skips, no todos.
- AdminJS: **93 suites, 416 tests, 416 passed, 0 failed, 0 skipped** (`node --test`, 74.09 s).
- The new focused cross-feature spec is an integration suite and therefore runs in §5/§6, not in `test:unit`.
- `src/common/contracts/post-lifecycle.contract.spec.ts` runs here for the API side, and `admin-service/src/common/contracts/post-lifecycle.contract.test.js` for the AdminJS side, proving both services import the same transition/lock definitions.

---

## 4. Migration, Enum and Contraction Checks (EXECUTED)

The authoritative release gate runs both migration stages against disposable PostGIS PostgreSQL:

- **Migration verification:** **8/8 tests, 34.57 s** (`src/database/migrate.integration.spec.ts`), covering:
  - clean-database migration creates the full schema and custom SQL, including `device_registrations`, `push_deliveries`, `terms_accepted_version`/`terms_accepted_at`, the `PROFILE_PHOTO` upload purpose, the bilingual notification columns, the `post_status` enum ending in `EXPIRED`, nullable `renewed_at`/`reminder_sent_at`, and the AdminJS `post_status` filter operators;
  - clean install leaves **no `saved_searches` table** (historical create/evolve migrations replay, then the forward contract drops it);
  - repeatable custom SQL and re-running the migration operation on an already-migrated database succeed without corruption;
  - nonzero failure behavior when migration or custom SQL fails;
  - upgrade from the immediately preceding nullable-audit baseline (`0000..0018`) preserves existing attributed audits;
  - **saved-search contraction upgrade from the pre-contraction schema (`0000..0052`)**: a populated `saved_searches` table and a `SYSTEM_ANNOUNCEMENT` row exist before the upgrade, the upgrade drops only the retired table, and the account, `post_saves`, the `SYSTEM_ANNOUNCEMENT` enum value and the retained notification row survive; a second full migration run stays idempotent.
- **Reset safety verification:** **23/23 tests, 25.92 s** (`src/database/reset.integration.spec.ts`), covering the fail-closed target gate and seeding.
- **Static contraction guards** in the unit suite (`src/database/saved-search-storage-contraction.spec.ts`, `src/posts/saved-search-retirement.spec.ts`) prove historical migrations are byte-for-byte preserved, exactly one forward migration drops the table, and no runtime/test reference to the storage returns.

**Rollout ordering (operationally binding).** Apply `0053_drop_saved_searches` only after the retired saved-search runtime has been deployed to both services and the rolling deployment has drained; the Main API is the sole migration owner and AdminJS never runs migrations. All other new migrations (`0045`–`0052`, `0054`, `0055`) are additive and safe to run while the previous code revision is still serving. Full ordering is in `docs/integrated-mvp-frontend-handoff.md` §6 and `docs/deployment/three-service-railway-release.md` §4.

---

## 5. Root Integration Suite (EXECUTED)

```
cd backend
npm run test:integration -- --runInBand   # executed by verify:release
```

**Result: Test Suites: 40 passed, 40 total. Tests: 580 passed, 580 total. Time: 1725.74 s.** No skips, no todos. This includes the migration and reset gates above as part of the same disposable-database run, plus every per-feature acceptance suite:

| Feature area | Integration suite(s) |
|---|---|
| Post lifecycle closure | `src/posts/post-lifecycle.integration.spec.ts`, `src/posts/owner-post-closure.integration.spec.ts` |
| Expiry, reminders, renewal | `src/posts/post-expiry.integration.spec.ts` (40 tests covering 14/30/60-day windows, concurrency, stale candidates, interaction cleanup, approved-contact retention) |
| Terms acceptance | `src/terms/terms-acceptance.integration.spec.ts`, `src/terms/terms-gate-comment-media.integration.spec.ts` (new) |
| Community Evidence | `src/comments/comment-image-post-type-restriction.integration.spec.ts`, `comment-image-publishing`, `comment-image-flutter-compat`, `comment-image-recovery`, `comments-creation-replay`, `comments-quotas`, `comments-isolation`, `comments-counters-reachability`, `comments-moderation-restoration`, `discussion-notifications` |
| Search | `src/posts/posts-search.integration.spec.ts` (all five feeds, English/Arabic normalization, cursor stability, Block isolation, non-ACTIVE exclusion, query plans) |
| Adoption contact | `src/adoptions/adoption-contact-access.integration.spec.ts` |
| Profile photos | `src/users/profile-photo-lifecycle.integration.spec.ts` |
| Account deletion | `src/users/account-deletion.integration.spec.ts` (terms record, avatar capture, bilingual redaction) |
| Notification language | `src/notifications/notification-language.integration.spec.ts` |
| Push delivery | `src/notifications/push-delivery.integration.spec.ts`, `src/notifications/workflow-push-delivery.integration.spec.ts` (all push-enabled types, queues from real workflows, suppression after Block/opt-out/deletion/token takeover) |
| Migration/reset/schema | `src/database/migrate.integration.spec.ts`, `src/database/reset.integration.spec.ts`, schema specs, `admin-bootstrap` |
| Isolation matrices | account reports, blocks, post/comment/engagement/contact/notification isolation, cities |

No per-feature suite was weakened or skipped for this release; the run executes 39 integration suites already present on the branch plus the new focused cross-feature suite from §6.

---

## 6. Focused Cross-Feature Verification (EXECUTED)

Per-ticket suites alone do not prove that the transport-level Terms gate and the Community Evidence media pipeline compose correctly. The new `src/terms/terms-gate-comment-media.integration.spec.ts` boots the real NestJS HTTP/GraphQL pipeline (global Firebase + Terms guards, real `CommentsService`, `PostsRepository`, `UsersService` and `UploadService`, real Postgres, controllable R2 adapter) and proves:

1. **Gate before media work.** An unaccepted account posting an image Comment on an `ADOPTION` listing receives `TERMS_ACCEPTANCE_REQUIRED` with `extensions.currentVersion`/`termsUrl`; no Comment row is written, no `comment_media` row is written, the durable `staged_uploads` ticket is still `ISSUED`, the staging object still exists, and no finalized `comments/` object exists — so the rejected upload stays retryable.
2. **Eligibility after acceptance, same ticket.** After acceptance, the same account and the same staged ticket on the restricted listing receive `COMMENT_MEDIA_NOT_ALLOWED` with the ticket untouched; retrying the identical ticket on a `RESCUE` listing publishes successfully, finalizing the ticket and moving the object from `staging/` to `comments/<commentId>/`.

The focused run alone: **1 suite, 2 tests, 2 passed, 28.64 s**. The spec is also part of the 40-suite/580-test integration run in §5.

### Cross-feature matrix (executed evidence)

| Interaction | Evidence |
|---|---|
| Terms gate × all 9 protected operations | `terms-acceptance.integration.spec.ts`: `it.each` over rescue/lost/adoption/product/mating posts, comment, reply, contact request, adoption application; real HTTP; all return `TERMS_ACCEPTANCE_REQUIRED` with version/URL extensions. |
| Terms gate × browsing/onboarding/reporting/deletion | Same suite: `me`, feed, `reportPost`, `completeProfile`, `deleteMyAccount` succeed unaccepted; onboarding schema has no terms field; gate inactive when unconfigured. |
| Terms gate × image-comment eligibility × finalization | New spec (§6); also account-isolation-before-image-restriction and retryable-upload cases in `comment-image-post-type-restriction.integration.spec.ts`. |
| Terms acceptance × Account Deletion cleanup | `account-deletion.integration.spec.ts`: recorded acceptance is removed with the account, deletion never requires acceptance. |
| Expiry × discovery (feeds and search) × renewal | `post-expiry.integration.spec.ts` proves expiry leaves feeds and renewal returns to discovery; `posts-search.integration.spec.ts` proves `EXPIRED`/`REMOVED`/completed Posts never appear in any feed's search and Block isolation holds. |
| Expiry × pending interactions × approved contact | `post-expiry.integration.spec.ts`: pending contact requests/applications become terminal `REJECTED`, application uniqueness preserved, approved `getAdoptionWhatsAppLink` access survives expiry and renewal and is denied across a Block. |
| Lifecycle closure × push | `workflow-push-delivery.integration.spec.ts`: ban-cascade removal push queued and suppressed; inactivity reminder pushed once per cycle; `notification-templates.spec.ts` requires both languages for every type. |
| Admin resolution/reopening × audit × owner notification × pending cleanup | `admin-case-resolution.test.js`, `moderation-actions.test.js`: atomic status + audit + localized notification + cleanup; each writes one durable `push_deliveries` intent. |
| Push × Block/opt-out/deletion/token reassignment | `workflow-push-delivery.integration.spec.ts` and `push-delivery.integration.spec.ts`: queued work terminally suppressed, inbox row retained. |
| Search × feed filters × cursors × Block isolation | `posts-search.integration.spec.ts` (all five feeds, multi-page cursor assertions, two Block directions). |
| Profile photo × provider sync × Account Deletion | `profile-photo-lifecycle.integration.spec.ts`, `account-deletion.integration.spec.ts` (owned avatar deleted, provider URL excluded). |
| Saved-search retirement × runtime/startup/Account Deletion | `saved-search-storage-contraction.spec.ts`, `saved-search-retirement.spec.ts`, migration upgrade test, `admin-bootstrap.integration.spec.ts` against the contracted schema. |
| Saved-search type removal × schema compatibility | Schema gate §1: exactly the one authorized incompatible entry. |

---

## 7. AdminJS HTTP, Authority and Browser Suites (EXECUTED)

```
cd admin-service
npm run test:integration   # 23 suites, 174/174, 1027.47 s
npm run test:browser       # 4 suites, 27/27, 573.43 s
```

The browser runner is not mapped-location-only: `test:browser` explicitly includes `mapped-location-browser.test.js`, `post-review-workspace-browser.test.js`, `admin-work-queues-browser.test.js` and `admin-review-experience-browser.test.js`. The 27 real-Chrome tests cover the ticket 21 cross-screen acceptance scenarios (one labeled action to flagged Posts, counts equal results, filtered-queue return including Browser Back, aligned thumbnails and full-image previews, resolution and reopening correction journeys, keyboard focus return, reduced motion, narrow screens, loading/error/retry states, long titles) with screenshots recorded under the suites' `BWG*_EVIDENCE_DIR` directories (not committed).

The authenticated AdminJS HTTP suites additionally prove the additive lifecycle actions, role enforcement, internal-reason rules, banned-owner rejection, term-field read-only inspection, expired filtering, queue predicates and push intents, plus the pre-existing moderation/reporting workflows.

---

## 8. No Flutter Source or Flutter Test Changes (EXECUTED command; STATIC conclusion)

```
git diff --name-only 9c56821...HEAD -- frontend/ | wc -l   # 0
git log --oneline 9c56821..HEAD -- frontend/ | wc -l       # 0
```

Result: **0**. No file under `frontend/` — including Flutter tests — was added, modified or deleted by the 21 product tickets or by this verification slice. The only frontend-facing artifact is `docs/integrated-mvp-frontend-handoff.md`; Flutter implementation remains separate client work.

---

## 9. Static Quality of the Verification Slice

The candidate commit `3d011fa` adds one test file (`backend/src/terms/terms-gate-comment-media.integration.spec.ts`); `npm run lint`, `npm run format:check`, `npm run build`, `npm run test:unit` and the full `verify:release` all ran after it. This evidence document and the handoff document add only `docs/` files and `.gitignore` whitelist exceptions.

---

## 10. Production Container Smoke / e2e — UNAVAILABLE (environment)

**Command:** `npm run test:e2e` (stage `e2e-root` in `verify:release`)

**Result: not certified in this environment.** The suite contains two files and 9 tests: `test/repositories.e2e-spec.ts` passed **6/6** (repository layer against a real testcontainers PostGIS database), while all three tests in `test/production-smoke.e2e-spec.ts` failed during the **admin-service Docker image build** — before any product container behavior was exercised. Stages: `Test Suites: 1 failed, 1 passed, 2 total. Tests: 3 failed, 6 passed, 9 total. Time: 58.05 s`.

Exact build error (identical for the pre-deploy CLI, main API image and AdminJS image tests):

```
#9 [5/8] COPY --chown=node:node admin-service/ .
#9 ERROR: cannot replace to directory
  /home/girgis/.local/share/docker/buildkit/containerd-overlayfs/cachemounts/buildkit765552864/app/node_modules
  with file
------
 > [5/8] COPY --chown=node:node admin-service/ .:
------

ERROR: failed to build: failed to solve: cannot replace to directory .../app/node_modules with file
```

**Root cause:** this workspace is provisioned with `backend/node_modules` and `backend/admin-service/node_modules` as **symlinks** to a shared install (a documented environment constraint). Docker BuildKit cannot overlay the symlinked `admin-service/node_modules` onto the image's `node_modules` directory during `COPY admin-service/ .`. The `production-smoke.e2e-spec.ts` file builds images itself, so no product assertion (health, zero startup DDL, pre-deploy CLI) was reached. The failure is reproducible and unrelated to the candidate diff: the only Dockerfile changes in this branch add `COPY` lines for shared contract/template files, and the failing instruction predates the branch.

**Honest classification:** this environment's `verify:release` classifier labelled the stage `PRODUCT` because its pattern list does not recognize this BuildKit/symlink error, but this document records the gate as **UNAVAILABLE — environment**, not as a failed product assertion. No repository symlink was replaced, no `npm install` was run, and no tracked file was modified to work around it, per the environment rules. A clean CI runner with materialized `node_modules` (or a non-symlinked checkout) is required to execute this gate; that evidence is still outstanding.

---

## 11. Aggregate `verify:release` Output

```
cd backend
npm run verify:release
```

Candidate `3d011fa` (branch `task/bwg-22`, clean working tree at start), baseline `9c56821`, execution time 3744.22 s:

| # | Stage ID | Stage Name | Tests | Skips | Duration | Status | Class |
|---|---|---|---|---|---|---|---|
| 1 | env-prereqs | Runtime Environment & Prerequisites Preflight | N/A | 0 | 1.55 s | PASS | NONE |
| 2 | format-root | Root Formatting Check | N/A | 0 | 26.14 s | PASS | NONE |
| 3 | format-admin | AdminJS Formatting Check | N/A | 0 | 8.44 s | PASS | NONE |
| 4 | glossary-root | Root & AdminJS Glossary Conformance | 6/6 | 0 | 2.40 s | PASS | NONE |
| 5 | glossary-admin | AdminJS Glossary Conformance | 3/3 | 0 | 0.52 s | PASS | NONE |
| 6 | lint-root | TypeScript Linting | N/A | 0 | 70.54 s | PASS | NONE |
| 7 | build-root | Production Bundle Build | N/A | 0 | 25.94 s | PASS | NONE |
| 8 | unit-root | Root Unit Tests | 1023/1023 | 0 | 36.96 s | PASS | NONE |
| 9 | unit-admin | AdminJS Unit Tests | 416/416 | 0 | 74.09 s | PASS | NONE |
| 10 | migration-verification | Migration Verification (Clean, Repeat, Baseline Upgrade) | 8/8 | 0 | 34.57 s | PASS | NONE |
| 11 | reset-verification | Reset Safety Verification | 23/23 | 0 | 25.92 s | PASS | NONE |
| 12 | integration-root | Root Domain Integration Tests | 580/580 | 0 | 1725.74 s | PASS | NONE |
| 13 | integration-admin | AdminJS HTTP & Authority Integration Tests | 174/174 | 0 | 1027.47 s | PASS | NONE |
| 14 | browser-admin | AdminJS Real-Browser Journey Suite | 27/27 | 0 | 573.43 s | PASS | NONE |
| 15 | e2e-root | Production Container Smoke & E2E Tests | 6/9 | 0 | 110.41 s | **FAIL** | environment (see §10) |

`Completed Stages: 14 / 15`, `Observed Tests: 2266 passed, 2269 total`, `Observed Skips: 0`. The gate reports `NOT RELEASE READY` solely because its final stage is environment-blocked; every executable stage — including all unit, migration, reset, integration and real-browser suites — passed with zero skips.

---

## 12. Compliance Positioning and Residual Risk

**What this evidence supports:** the backend/admin implementation of the agreed MVP scope preserves existing mobile behavior, keeps account isolation and media/cleanup guarantees across the new features, is migration-safe (including the destructive saved-search contraction ordering), and passes the executable release gates with the single environment-blocked e2e exception recorded above.

**What it does not certify:**

- **Real-device push receipt and tap routing**, APNs configuration and Flutter permission/foreground/background handling are not exercised by backend tests (which use a controlled provider). External dependency; see the handoff §8.
- **Actual published Terms URL/version and the client acceptance UI** do not exist in this repository; the gate is implemented and verified but ships inactive until the release owner sets `TERMS_URL`/`TERMS_VERSION`. No legal/store-compliance claim is made.
- **The production container smoke gate is unexecuted in this environment** (§10); a clean CI runner must run it before launch.
- **Flutter UI, Arabic/English copy rendering and App Store/Play review outcomes** are outside this backend effort.
- Migration and rollout ordering are documented and locally verified but **no hosted/production deployment was performed** by this ticket.

**Operational notes:**

- Integration and browser suites require Docker and Chrome; `npm run test:e2e` additionally requires a Docker build context without symlinked `node_modules`.
- `npm run test:integration` and the migration stages each start their own disposable PostGIS container; the full gate took ~62 minutes in this environment.

---

## 13. Reproduction Quick Reference

```bash
# Schema compatibility (no Docker) — the script exits 1 with exactly one incompatible entry: SavedSearch
cd backend
node scripts/graphql-schema-compat.mjs 9c56821 HEAD

# Static gates
npm run format:check && (cd admin-service && npm run format:check)
npm run lint
npm run build
npm run check:glossary && (cd admin-service && npm run check:glossary)

# Focused cross-feature suite (Docker required)
./node_modules/.bin/jest src/terms/terms-gate-comment-media.integration.spec.ts --runInBand

# Authoritative aggregate (Docker + Chrome; long)
npm run verify:release

# No-Flutter-change check
git diff --name-only 9c56821...HEAD -- frontend/ | wc -l    # expected: 0
```

---

## 14. Final integrated re-verification after standards fixes (EXECUTED)

A whole-diff standards review of the integrated branch found one blocking and two major cross-cutting issues; all were fixed and independently reviewed on `task/bwg-fix` and merged into the integration branch:

| Fix | Commit | What changed |
|---|---|---|
| Admin production image could not boot | `8ca9092`, `07c32c5` | `admin-service/Dockerfile` now copies the runtime-imported `src/notifications/push-delivery.constants.ts`; a new guard test fails if any runtime relative import into `src/**` lacks a Dockerfile COPY line. |
| No index served the RESCUE/LOST reminder query | `3fa5bb3` | Migration `0056_cover_reminder_post_types.sql` widens the `idx_posts_last_engaged` predicate to ADOPTION/PRODUCT/RESCUE/LOST; `src/posts/post-expiry-index.integration.spec.ts` proves index usage with EXPLAIN plans captured from the real processor query. |
| Completed-outcome allowlist duplicated three ways | `7d54c5c` | `COMPLETED_POST_OUTCOMES` is the single frozen source; notification labels are compile-time exhaustive and the AdminJS queue constants derive from it. |

**Final-tip standalone results (`19d4aa4`, sequential runs, no concurrent load):**

| Command | Result |
|---|---|
| `npm run test:integration` (backend) | 41 suites, **583/583 tests PASS**, exit 0 |
| `cd admin-service && npm run test:integration` | 23 suites, **174/174 tests PASS**, exit 0 |
| `cd admin-service && npm run test:browser` | 4 suites, **27/27 tests PASS**, exit 0 |
| `npm run test:unit` (backend) | 75 suites, **1023/1023 tests PASS** |
| `npm run test:unit` (admin) | 94 suites, **417/417 tests PASS** (includes the new Dockerfile guard) |
| Migration verification (clean, repeat, upgrade) | **8/8 PASS** (applies 0056 on clean install and upgrade) |
| Reset safety verification | **23/23 PASS** |

**Gate flake note (honest reporting):** two full `verify:release` runs on the final tip each observed **all tests passing** (583/583 integration tests, 0 test failures) but exited non-zero because one suite's disposable Postgres container was terminated mid-run ("terminating connection due to administrator command") under host memory pressure — this host keeps a resident Supabase stack and has ~1 GB free RAM, and the failing suite differed between runs. Each affected suite passed on isolated re-run, and the complete standalone suite sequence above is green on the final tip. The `e2e-root` production container smoke remains **UNAVAILABLE** for the same environmental reason documented in §10 (rootless Docker and a symlinked `admin-service/node_modules` build context); it is not claimed as passing and must run on a clean CI runner before launch.

---

## 15. Post-review fixes (PR review of `43ecfc1`)

Two confirmed P2 findings from the PR review were fixed on `task/bwg-fix2` and merged (`0bcdc90`); both were independently reproduced red/green by a separate reviewer against real PostgreSQL.

| Finding | Fix commits | Regression evidence |
|---|---|---|
| A delayed avatar set could undo an explicit removal for provider-owned/empty profiles (activation compared only the storage key, which stays `NULL` after removal) | `f05db72` | `activateProfilePhoto` now compares the `profile_photo_changed_at` revision marker as well and rejects stale requests with `PROFILE_PHOTO_REPLACED`; new repo-level and service-level interleaving tests in `src/users/profile-photo-lifecycle.integration.spec.ts` plus unit coverage. Pre-fix, the stale activation **resolved and installed the photo**; post-fix it rejects and compensates. |
| An interrupted push delivery at the attempt bound could be reclaimed and sent a sixth time (expired-lease reclaim ignored `attempts`) | `935016c` | `claimNextDelivery` now terminalizes exhausted expired-lease `PROCESSING` deliveries as `FAILED` and never claims rows at/over `MAX_PUSH_DELIVERY_ATTEMPTS`; four new regression tests in `src/notifications/push-delivery.integration.spec.ts`. Pre-fix, `processPendingDeliveries()` returned 1 (a sixth send); post-fix it returns 0 and the row is terminal. |

**Re-verification on the merge (`0bcdc90`):** backend unit **1026/1026 PASS**; `profile-photo-lifecycle` + `push-delivery` integration **39/39 PASS**. The per-feature contracts (`profile-photo-flutter-integration-contract.md`, `device-push-delivery-flutter-integration-contract.md`) were updated to match the fixed behavior.

# Release Evidence: UGC Reporting & Account Blocking

This document records reproducible evidence that the UGC Reporting and Account Blocking backend effort is additive, safe, and compatible with existing mobile behavior. It distinguishes **executed** evidence from **static inspection** and explicitly records gates that were **unavailable** in this environment.

- **Branch:** `task/12-publish-contract-prove-compatibility`
- **Schema/compatibility baseline:** `b6df50c` (pre-feature `main` commit, repository history)
- **Code candidate under test:** `e4220d4` (`merge: issue 11 expose Block, Unblock, and Blocked Accounts safely`)
- **Evidence date:** 2026-09-19
- **Evidence commit note:** the commit containing this document adds only docs, `.gitignore` exceptions, and two evidence scripts; it changes no SDL, no resolver, and no Flutter code, so the results below hold for the final branch HEAD.
- **Environment:** Linux, Node.js `v24.4.0`, Docker `29.6.1` (rootless context `unix:///run/user/1000/docker.sock`), test database image `postgis/postgis:16-3.4-alpine`, Chromium/Chrome `150.0.7871.46`.
- **Related documents:** `docs/ugc-reporting-and-account-blocking-flutter-integration-contract.md`, `docs/adr/0006-directional-blocks-create-mutual-isolation.md`.

## Evidence Status Legend

| Status | Meaning |
|---|---|
| **EXECUTED** | Command was run in this environment against the candidate commit; results are recorded verbatim. |
| **STATIC** | Verified by inspecting files/history rather than executing a test. |
| **UNAVAILABLE** | Could not complete in this environment; the exact command and error are recorded, and no success is claimed. |

## Summary

| # | Gate | Status | Result |
|---|---|---|---|
| 1 | GraphQL schema compatibility vs `b6df50c` | EXECUTED | **COMPATIBLE** — 0 incompatible changes, 9 additive changes |
| 2 | `npm run format:check` (root + admin) | EXECUTED | exit 0 / exit 0 |
| 3 | `npm run lint` | EXECUTED | exit 0 |
| 4 | `npm run build` | EXECUTED | exit 0 |
| 5 | `npm run check:glossary` (root + admin) | EXECUTED | 6 passed (root), 3 passed (admin) |
| 6 | `npm run test:unit` | EXECUTED | 63 suites, **866/866 tests**, 73.2 s |
| 7 | `npm run test:integration` | EXECUTED | 28 suites, **376/376 tests**, 1294.7 s |
| 8 | `cd admin-service && npm test` | EXECUTED | 83 suites, **361/361 tests**, 74.1 s |
| 9 | `cd admin-service && npm run test:integration` | EXECUTED | 14 suites, **113/113 tests**, 440.1 s |
| 9b | `cd admin-service && npm run test:browser` | EXECUTED | 10/10 real-browser tests, 257.7 s |
| 10 | Focused reporting/Block/isolation/Account Deletion matrices | EXECUTED | 13 suites, **195/195 tests**, 644.2 s |
| 11 | Query-plan inspection (feeds, Saved Posts, discussions, counts, Blocked Accounts) | EXECUTED | See §6; no N+1, Block predicate precedes `LIMIT` |
| 12 | No-Flutter-change confirmation | EXECUTED (command) | 0 frontend files changed vs `b6df50c` |
| 13 | `npm run test:e2e` (production container smoke) | **UNAVAILABLE** | 6–7 of 9 pass; remaining tests fail on container→host DB reachability under this Docker setup; exact errors in §7 |
| 14 | `npm run verify:release` aggregate | PARTIAL | Runtime prerequisites pass; component stages were run individually; the aggregate command was not executed because its only failing stage (e2e) is environment-blocked (§7) |

---

## 1. GraphQL Schema Compatibility Proof (EXECUTED)

**Command**

```
cd backend
node scripts/graphql-schema-compat.mjs b6df50c HEAD --dump-dir /tmp/opencode/hard-impl/task-12/schema-dumps
```

**Method**

1. Enumerate every `backend/src/**/*.graphql` file at each revision (`git ls-tree`), read each file at that revision (`git show`).
2. Merge the SDL with `@graphql-tools/merge` (the same merge behavior `@nestjs/graphql` applies to its schema-first `typePaths`), then build an executable schema with `graphql-js`.
3. Walk the complete type map and compare, for every baseline type that still exists: type kind, every field's canonical type string (list nesting and `!` nullability preserved), every field argument and argument type, every enum value, and every union member. Scalar presence is compared by type name.
4. Any baseline type/field/argument/enum value/scalar that disappears or changes is reported as **incompatible**. New types, fields, arguments, and enum values are reported as **additive**.

**Result**

```
Baseline:  b6df50c -> b6df50cd900027ec3e3cb15dd46508f47dc1c2db (12 SDL files)
Candidate: HEAD    -> e4220d445556744c03a276a83a3d705be7ac7c83 (14 SDL files)

Additive changes (9):
  + ADDED_FIELDS Mutation: reportUser, blockUser, unblockUser, reportPost
  + ADDED_FIELDS Query: blockedUsers
  + ADDED_TYPE AccountReportReason (ENUM)
  + ADDED_TYPE AccountReportSourceType (ENUM)
  + ADDED_TYPE BlockedUser (Object)
  + ADDED_TYPE BlockedUserConnection (Object)
  + ADDED_TYPE BlockedUserEdge (Object)
  + ADDED_TYPE ReportPostInput (InputObject)
  + ADDED_TYPE ReportUserInput (InputObject)

Incompatible changes (0):

RESULT: COMPATIBLE - no existing type, operation, argument, field, nullability, enum value, or scalar changed.
```

The script exits `0` on `COMPATIBLE` and `1` on `INCOMPATIBLE`, so it can be re-run as a regression check. Sorted SDL dumps for both revisions were written to `/tmp/opencode/hard-impl/task-12/schema-dumps/` (temporary; regenerated by `--dump-dir`). Existing contract specs (`src/posts/post-report-schema.contract.spec.ts`, `src/comments/comments-schema.contract.spec.ts`) remain in `test:unit` and passed unchanged.

This proves preservation of every existing operation name, argument, input shape, output shape, enum value, and nullability against the pre-feature contract.

---

## 2. Static Quality Gates (EXECUTED)

All commands run from `backend/` unless noted.

| Command | Result | Notes |
|---|---|---|
| `npm run lint` (eslint, `--fix`) | exit 0 | No files modified (`git status` unchanged afterwards) |
| `npm run build` (nest build) | exit 0 | No generated files changed |
| `npm run format:check` | exit 0 | Root prettier check |
| `cd admin-service && npm run format:check` | exit 0 | Admin prettier check |
| `npm run check:glossary` | 3 node tests passed + 3 jest tests passed | Root glossary conformance, includes admin-service source scan |
| `cd admin-service && npm run check:glossary` | 3/3 passed | Admin glossary conformance |

---

## 3. Backend Unit & Integration Suites (EXECUTED)

### 3.1 Unit tests

```
cd backend
npm run test:unit -- --cacheDirectory=/tmp/opencode/hard-impl/jest-cache-12
```

Result: **Test Suites: 63 passed, 63 total. Tests: 866 passed, 866 total. Time: 73.2 s.** No skips, no todos.

### 3.2 Integration tests — complete backend suite

```
cd backend
npm run test:integration -- --cacheDirectory=/tmp/opencode/hard-impl/jest-cache-12
```

Result: **Test Suites: 28 passed, 28 total. Tests: 376 passed, 376 total. Time: 1294.685 s.** No skips, no todos.

This run includes the migration and reset gates as real suites against disposable PostgreSQL:

- `src/database/migrate.integration.spec.ts` — clean migrate, repeat migrate, existing-database upgrade
- `src/database/reset.integration.spec.ts` — fail-closed reset safety and seeding
- `src/database/schema/admin-schema.integration.spec.ts`
- `src/database/schema/blocks-schema.integration.spec.ts`
- All Post, mating, feed, Comment, engagement, contact, adoption, notification, Account Deletion, and upload integration suites (no assertions weakened; no test files modified by this ticket).

### 3.3 Admin-service unit and integration suites

```
cd admin-service
npm test                    # unit
npm run test:integration    # DB-backed HTTP, authority, dashboard, moderation, browser journeys
```

Results:

- Unit: **Test Suites: 83 passed, 83 total. Tests: 361 passed, 361 total. Time: 74.1 s.**
- Integration: **Test Suites: 14 passed, 14 total. Tests: 113 passed, 113 total. Time: 440.1 s.** (`node --test`, concurrency 1; includes the real-browser AdminJS journey file.)

Dedicated admin browser stage (the `browser-admin` release stage):

```
cd admin-service
npm run test:browser
```

Result: **10/10 tests passed, 0 failed, 0 skipped, 257.7 s** (Chromium `150.0.7871.46`).

---

## 4. Reporting and Block Acceptance Matrices (EXECUTED)

Run against the real disposable PostgreSQL test database through authenticated, schema-first GraphQL. Focused re-run with machine-readable results:

```
cd backend
npx jest \
  src/account-reports/account-reports.integration.spec.ts \
  src/blocks/blocks.integration.spec.ts \
  src/blocks/account-isolation.policy.integration.spec.ts \
  src/posts/post-reports.integration.spec.ts \
  src/posts/posts-isolation.integration.spec.ts \
  src/comments/comments-isolation.integration.spec.ts \
  src/comments/comments-counters-reachability.integration.spec.ts \
  src/comments/comments-moderation-restoration.integration.spec.ts \
  src/engagement/engagement-isolation.integration.spec.ts \
  src/contacts/direct-interaction-isolation.integration.spec.ts \
  src/notifications/notifications-isolation.integration.spec.ts \
  src/database/schema/blocks-schema.integration.spec.ts \
  src/users/account-deletion.integration.spec.ts \
  --runInBand --json --outputFile=/tmp/opencode/hard-impl/task-12/safety-matrix.json \
  --cacheDirectory=/tmp/opencode/hard-impl/jest-cache-12
```

Result: **13 suites, 195 tests, 195 passed, 0 failed, 0 skipped, 644.2 s** (`"success": true` in the JSON report).

| Spec (executed) | Tests | Matrix proven |
|---|---|---|
| `account-reports.integration.spec.ts` | 33/33 | Every account reason, `OTHER` details, self-report, one-open-report uniqueness, report-after-review, all four source-context types, source relationship validation, privacy, allowance participation, no automatic ban |
| `post-reports.integration.spec.ts` | 24/24 | All five Post types, self/duplicate rejection, inaccessible/Removed rejection, details validation, shared allowance, counter increments once, CLEAN→FLAGGED without removal, no automatic removal |
| `blocks.integration.spec.ts` | 16/16 | Self-Block rejection, directional ownership, idempotent Block/Unblock, only-blocker Unblock authority, Blocked Accounts ordering/pagination/minimal fields, no notifications |
| `account-isolation.policy.integration.spec.ts` | 7/7 | Pair isolation policy, canonical pair key, policy-level isolation semantics |
| `posts-isolation.integration.spec.ts` | 11/11 | Home/help/adoption/market/mating feeds, direct Post lookup and every type-specific detail query, Saved Posts omission, My Posts unaffected, filter-before-limit/cursor |
| `comments-isolation.integration.spec.ts` | 13/13 | TOP/NEWEST, pins, whole hidden Reply branches, blocked Replies, direct creation rejection, cursor continuation |
| `comments-counters-reachability.integration.spec.ts` | 17/17 | Personalized `commentCount`/`replyCount` exactly match reachable results; stored counters preserved |
| `comments-moderation-restoration.integration.spec.ts` | 2/2 | Comment Report continuity through removal/restoration |
| `engagement-isolation.integration.spec.ts` | 11/11 | New Upvotes/Saves/Boosts rejected across a Block, owned-row removal allowed, stored rows preserved, viewer booleans false, Unblock restores |
| `direct-interaction-isolation.integration.spec.ts` | 10/10 | Contact Request/Adoption Application creation, approval, lists, approved-link retrieval, product seller contact; pending records rejected atomically; no contact disclosure across a Block |
| `notifications-isolation.integration.spec.ts` | 8/8 | No new immediate/delayed notifications across a Block, suppressed events terminal, historical notifications retained, neutral fallback |
| `blocks-schema.integration.spec.ts` | 7/7 | Foreign keys, cascade, self-Block prohibition, ordered-pair uniqueness, indexes |
| `users/account-deletion.integration.spec.ts` | 36/36 | Block/open-report cascade, free-text removal, redacted append-only moderation history, counter decrement exactly once, unrelated data intact |

The complete `test:integration` run (§3.2) additionally covers every Post, mating, feed, Comment, engagement, contact, adoption, notification, Account Deletion, admin, migration, and production-smoke-adjacent suite in the repository — the focused run above is a subset re-run for per-test evidence, not a replacement.

---

## 5. Admin Review, Audit, Redaction, and Block Bypass (EXECUTED)

`cd admin-service && npm run test:integration` ran the real AdminJS HTTP seams against PostgreSQL and passed 113/113. Directly relevant executed cases include:

- `Ticket 04: reviews a Post Report with no action over authenticated AdminJS HTTP and appends a correlated audit entry`
- `reviews a Post Report with no action and appends one correlated audit entry`
- `reviews a Pupzy Account Report with no action and permits a later report`
- `serializes concurrent no-action reviews to one closure and one audit entry`
- `closes every open Post Report when the Post is removed and correlates the audit`
- `closes open Post Reports on approval, flagging, and restoration`
- `closes every open Comment Report when a Comment is removed`
- `closes every open Pupzy Account Report when the account is banned`
- **`reviews reports despite an active Block between the reporter and reported account`** (administrator Block bypass)
- `rolls back the target mutation and report closure when the audit insert fails`
- `rolls back a no-action review when the report closure fails`
- `restores hidden comment, restores post comment count, marks reports reviewed, and writes audit row`
- Dashboard: `counts only active pending or flagged posts as needing review`, `sorts review rows by reports then creation time and excludes clean/removed posts`

Redaction and retention behavior is executed in `src/users/account-deletion.integration.spec.ts` (36/36, §4): Blocks and open reports involving a deleted account disappear, report free text is deleted with them, and reviewed moderation history survives only in its existing redacted append-only form.

---

## 6. Query-Plan Evidence (EXECUTED)

**Command**

```
cd backend
npx ts-node -r tsconfig-paths/register scripts/query-plan-evidence.ts
```

**Method.** The script starts a disposable PostGIS test database, runs the real migrations, seeds realistic cardinality, then calls the **real repository methods** (Home/help/market feeds, Saved Posts, pinned/top-level Comments, Replies, both personalized count DataLoaders, Blocked Accounts page 1 and cursor page 2) with a Drizzle query logger attached. Each captured SQL statement is replayed through `EXPLAIN (ANALYZE, BUFFERS)` with its bind parameters against the same database.

**Seeded cardinality:** 2,000 users; 20,000 Posts across all five listing types (≈20% authored by accounts the viewer blocked); 1,117 Blocks in both directions (viewer owns 250 outgoing Blocks, is blocked by others); 12,000 top-level Comments + 18,000 Replies concentrated on 12 discussion Posts; 8,000 Saved Posts including Posts from blocked creators. `ANALYZE` was run before inspection.

**Observed results (executed):**

| Surface | Queries executed | Key plan facts | Execution |
|---|---|---|---|
| Home Feed (page 1) | 1 SELECT | `Limit` → top-N sort over `Bitmap Index Scan on idx_posts_coordinates`; Block anti-join appears as `hashed SubPlan 1` computed **once per query** from `idx_blocks_blocker_created` (outgoing) and `idx_blocks_blocked` (incoming) | 102.6 ms (incl. JIT) |
| Help Feed | 1 SELECT | `BitmapAnd` of `idx_posts_help_gov` + `idx_posts_coordinates`; hashed Block anti-join before `Limit` | 122.9 ms (incl. JIT) |
| Market Feed | 1 SELECT | Bitmap indexes + hashed Block anti-join before `Limit` | 27.7 ms |
| Saved Posts | 1 SELECT | `Index Only Scan using idx_post_saves_user_saved_at`, nested-loop `posts_pkey`; hashed Block anti-join evaluated once per query, filtering before `LIMIT` | 3.7 ms |
| Pinned + top-level Comments (TOP) | 2 SELECTs (pinned probe + page) | `BitmapAnd` of `idx_comments_post_status_boost_created` and `idx_comments_parent_id`; reply-branch `EXISTS` subplan reported `never executed` on a page with no tombstones; author anti-join hashed once | 6.0 ms |
| Replies | 1 SELECT | `Index Scan using idx_comments_parent_id`; hashed Block anti-join in the filter | 1.7 ms |
| Post `commentCount` batch | 2 SELECTs for a 12-Post batch (top-level + Replies) | Aggregation with both author anti-joins hashed; bounded by the batch, no per-Post round trip | 300.8 ms (30k-row synthetic comments table, JIT startup included) |
| Comment `replyCount` batch | 1 SELECT for 50 Comment keys | `comments_pkey` + `LATERAL` nested-loop `idx_comments_parent_id`; hashed author anti-joins | 5.3 ms |
| Blocked Accounts page 1 | 1 SELECT | `Index Scan using idx_blocks_blocker_created` + `Memoize` over `users_pkey` (0 cache misses on first page) | 0.59 ms |
| Blocked Accounts cursor page 2 | 1 SELECT | Row-value comparison `(created_at, id) < ($2, $3)` inside the index condition on `idx_blocks_blocker_created` | 2.38 ms |

Conclusions supported by the plans:

- Block predicates execute **inside SQL**, before `LIMIT`/cursor evaluation, so filtered pages stay dense and `hasNextPage` reflects the viewer-visible set.
- The anti-join is an **uncorrelated hashed subplan** evaluated once per query, not an N+1 account-pair check per row.
- Blocked Accounts pagination uses the `(blocker_id, created_at DESC, id DESC)` index in both the first-page and cursor paths.
- The only relatively expensive plan was the `commentCount` DataLoader batch over the synthetic 30,000-row comments table (300 ms with JIT); it is one bounded batched query per response, not per-Post.

Raw plans are reproducible from the command above; the full captured output of this run is 463 lines and available in the run log (`/tmp/opencode/hard-impl/task-12/query-plans.log` in this environment).

---

## 7. Production Container Smoke / e2e — UNAVAILABLE (environment)

**Command**

```
cd backend
npm run test:e2e
```

**Result: not certified in this environment.** The suite contains 9 tests; executed attempts are recorded honestly below.

### Attempt 1 — provisioned rootless Docker context (default)

- Images built successfully after materializing the provisioned symlinked `backend/admin-service/node_modules` as a real directory *for the build context only* (Docker cannot overlay a symlinked directory onto the image's `node_modules`; the symlink was restored afterwards, and no repository file was changed).
- Result: **7 passed, 2 failed** (`Test Suites: 1 failed, 1 passed`).
- Failing tests:
  - `executes the exact packaged pre-deploy CLI successfully on a clean database`
  - `starts the real AdminJS image without Redis and performs zero startup DDL`
- Exact error from inside the containers:

  ```
  [Migration] Migration operation failed: Error: connect ECONNREFUSED 172.17.0.3:5432
  Error: connect ECONNREFUSED 172.17.0.3:5432
  ```

  The production images resolve `host.docker.internal:host-gateway` to `172.17.0.3` under this rootless Docker installation, and the host-published testcontainers PostgreSQL port is not reachable through the rootless bridge gateway. This is a container→host networking limitation, not a product assertion failure. The API-image happy-path test passed in this attempt.

### Attempt 2 — rootful daemon (`DOCKER_HOST=unix:///var/run/docker.sock`)

- The suite's `beforeAll` (which builds both images) exceeded its 600,000 ms hook timeout on a cold-but-pull-disabled rootful build: `thrown: "Exceeded timeout of 600000 ms for a hook."`
- To warm the cache independently, `docker build --pull=false -t pupzy-api-smoke:warm .` was run against the rootful daemon; it failed during `npm ci --only=production` with `process "/bin/sh -c npm ci --only=production && npm cache clean --force" did not complete successfully: exit code: 1` (npm registry/network failure from the rootful daemon's build containers — only deprecation warnings are visible before the failure, no product compile error).

**Conclusion:** the e2e production-smoke gate is **UNAVAILABLE in this environment** and is not claimed as passing. Nothing in the failures implicates the reporting/Blocking code: they are image-build-context/networking issues. The remaining 6–7 tests that did execute include the real main API image health path.

---

## 8. No Flutter Source or Flutter Test Changes (EXECUTED command; STATIC conclusion)

```
git diff --name-only b6df50c..HEAD -- frontend/ | wc -l
```

Result: **0**. `git log b6df50c..HEAD -- frontend/` is empty. No file under `frontend/` — including Flutter tests — was added, modified, or deleted by this backend effort. The 103 files changed between `b6df50c` and the code candidate are all under `backend/` and include backend/admin-service code, migrations, tests, and the new docs/scripts. The only frontend-facing artifact of this ticket is the integration contract document; Flutter implementation remains a separate effort.

---

## 9. Compliance Positioning and Residual Risk

**What this evidence supports:** the backend closes the identified in-app reporting gaps (Post Report, existing Comment Report, new Pupzy Account Report with validated source context) and the missing Block gap (immediate, reversible, mutually isolating personal protection) with additive GraphQL operations that leave existing mobile behavior compatible.

**What it does not certify:**

- Not complete Apple App Review or Google Play UGC compliance. Terms acceptance, published support contact, broader content-filtering review, moderation staffing, and response-time operations require separate verification.
- The Flutter Report/Block/Blocked Accounts UI has **not** been implemented or device-tested; only the contract is published.
- App-store review outcomes and real-device Arabic/English copy rendering are outside this backend effort.
- The full `verify:release` aggregate was not executed end-to-end because its `e2e-root` stage is environment-blocked (§7); every other release stage was executed individually with the results above.

**Operational notes for the reviewer:**

- Query-plan timings were measured on the developer machine with a synthetic-but-realistic dataset; absolute times will differ in production. The structural conclusions (SQL-level predicate, index usage, single anti-join, no N+1) are what the plans establish.
- `npm run test:integration` and the query-plan script require Docker; `npm run test:e2e` additionally requires container→host database reachability that this rootless Docker environment does not provide.
- The e2e attempt required a local, non-committed workaround for the worktree's symlinked `admin-service/node_modules` inside the Docker build context; the symlink was restored after the attempt and no tracked file was touched.

---

## 10. Reproduction Quick Reference

```bash
# Schema compatibility (no Docker)
cd backend
node scripts/graphql-schema-compat.mjs b6df50c HEAD

# Static gates
npm run format:check && (cd admin-service && npm run format:check)
npm run lint
npm run build
npm run check:glossary && (cd admin-service && npm run check:glossary)

# Test suites (Docker required for the integration suites)
npm run test:unit
npm run test:integration -- --cacheDirectory=/tmp/opencode/hard-impl/jest-cache-12
(cd admin-service && npm test)
(cd admin-service && npm run test:integration)

# Query-plan evidence (Docker required)
npx ts-node -r tsconfig-paths/register scripts/query-plan-evidence.ts

# No-Flutter-change check
git diff --name-only b6df50c..HEAD -- frontend/ | wc -l    # expected: 0
```

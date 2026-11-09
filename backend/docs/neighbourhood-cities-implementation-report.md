# Neighbourhood Cities implementation report — 2026-11-09

**Network blocked; data incomplete; ADR 0009 merge gate fails.** DNS resolution failed for `https://overpass-api.de/api/interpreter` and `https://query.wikidata.org/sparql`. Nothing was fetched from either source. The requested complete neighbourhood dataset is not delivered by this fallback. No production, Railway, push, PR, merge or frontend operation occurred.

**Commits blocked by filesystem permissions.** `git add` failed with `fatal: Unable to create '/home/girgis/repo/work/pupzy_comapny/pupzy/.git/worktrees/neighbourhood-cities/index.lock': Read-only file system`. All changes are present in the worktree, including the previously uncommitted CONTEXT and ADR 0009; no commit was created. Suggested grouping when Git becomes writable: `feat(cities): support district-linked neighbourhood releases` for schema/API/pipeline/docs; `data(cities): normalize district names and stage neighbourhood sources` for catalog/snapshots/overrides/migrations/journal; `test(cities): gate neighbourhood releases on offline coverage evidence` for verification tools and specs. Keep 0065/0066 and the complete journal together if committing the migration artifacts as one group.

## Actual data

| Coverage area | OSM fetched | Wikidata fetched | PUPZY hand-curated starter names | New selectable Neighbourhoods |
| --- | ---: | ---: | ---: | ---: |
| Greater Cairo | 0 | 0 | 28 | 0 |
| Alexandria / coast / Kafr El-Dawwar | 0 | 0 | 39 | 0 |
| Port Said / Ismailia / Damietta | 0 | 0 | 16 | 0 |

All 83 starter names have `reviewed: false`; none has an invented coordinate or containing ADM2 assignment. The current 351 OCHA districts remain selectable nationwide. Their source codes and representative points are unchanged; 87 district edit instructions produce 85 English display-name changes and 99 aliases. All raw OCHA data remains untouched. The combined source snapshot embeds the review decisions and unavailable-evidence placeholders, so it reproduces the released district cleanup without importing the starter set.

## Changes and file map

- `src/database/schema/cities.schema.ts`, `drizzle/migrations/0065_add_city_neighbourhood_fields.sql`: text-array aliases, nullable self-FK, index, namespace/self-parent checks, and deferred root-parent/lifecycle/governorate constraints. Existing UUIDs and references survive.
- `src/cities/cities.graphql`, `cities.resolver.ts`, `src/graphql.ts`: exactly the two additive public fields; district resolution uses the request DataLoader. Repository nearest selection includes both kinds, filters OFFICIAL, and now measures geography distance in metres.
- `catalog.ts`, `neighbourhoods.ts`, `diff.ts`, `plan.ts`, `seed.ts`, `reconcile.ts`, `release-sql.ts`, `publish.ts`: shared catalog lifecycle/release path, aliases and parent propagation, parent-first SQL/seeding, alias/parent diffs, combined snapshot publication and existing crash recovery. Neighbourhood publication requires passing coverage evidence and reviewed OSM decisions. An ADM2-only refresh is rejected after neighbourhoods exist.
- `src/cities/data/egypt-cities-catalog.json`, `combined-city-source-snapshot.json`, `data/neighbourhoods/`, `drizzle/migrations/0066_release_city_catalog.sql`, migration journal: deterministic district cleanup, source manifest, pending candidates and evidence inputs. No new active neighbourhood data.
- `src/cities/scripts/*.overpass`, `neighbourhoods.sparql`, `fetch-neighbourhood-snapshots.py`, `build-neighbourhood-candidate.ts`: exact fetch queries, expected paths, provenance and deterministic offline transformation.
- `coverage.ts`, `search.ts`, `scripts/verify-coverage.ts`, `scripts/verify-neighbourhood-sql.py`, city specs: offline checks and supplemental socket-free migration checks.
- `admin-service/src/adminjs/resources/cities.resource.js`: read-only aliases and parent display; operator CRUD remains disabled.
- `NOTICE.md`, `docs/neighbourhood-cities-runbook.md`, `CONTEXT.md`, ADR 0009: attribution, handoff and domain decision. Frontend untouched. App attribution remains a Flutter-owner action before enabling an OSM-derived release.

## Verification

| Gate | Result | Evidence |
| --- | --- | --- |
| Grid, all 3 areas | FAIL / unmeasured | 0 polygons, 0 samples. No worst-gap coordinates can be honestly reported. This is not a zero-gap result. |
| Greater Cairo names | FAIL | 157 candidate entries / 155 distinct Arabic names; 226 of 314 English/Arabic variants unmatched. Not researched/reviewed; misspelling arrays empty. |
| Alexandria names | FAIL | 163 entries / 145 distinct names; 287 of 326 variants unmatched. Below 150 distinct names. |
| Port Said region names | FAIL | 56 entries / 56 distinct names; 84 of 112 variants unmatched. Below 150; no reduced threshold justified/enabled. |
| GPS, all 3 areas | FAIL / unavailable | 0 of 30 independent coordinates per area. Synthetic unit/SQL fixtures are not counted as real GPS evidence. |
| Structural catalog quality | PASS | 351 official rows, 27 governorates, 0 duplicate source identities or English names, 0 missing bilingual names, 0 alias/canonical duplicates, unchanged points. |
| Geographic catalog quality | FAIL / unverified | 353 errors: 2 missing reviewed boundary collections plus 351 unverified governorate containments. No neighbourhood parents have been asserted. |
| City unit specs | PASS | 12 suites, 160 tests. Includes catalog, seed, reconcile, release/publish, benchmark, repository, service, pipeline, normalization, grid geometry and resolver tests. |
| PostGIS socket-free SQL check | PASS | PostgreSQL 18 + PostGIS: main schema 0000–0064; User/Post district references; 0065+0066 applied twice; 0 errors, UUID/reference preservation, nearest neighbourhood, invalid parent rejection. |
| Standard city integration suites | UNAVAILABLE / startup failures | 3 suites, 17 tests fail before assertions: Docker unavailable. Local PostGIS cannot listen on TCP or Unix sockets (EPERM). No successful Drizzle/repository integration result claimed. |
| Full TypeScript acceptance check | FAIL, existing baseline | 158 diagnostics on untouched HEAD and 158 here; identical file/error-code counts, no new location/code pair. Application build config passes. |
| City ESLint | PASS | Exact city glob, zero errors/warnings. |
| Touched vet resolver fixture | PASS | 1 suite, 8 tests. |
| Admin resource tests | UNAVAILABLE | Installed tree has no `adminjs` dependency for admin-service. No dependencies reinstalled. |

Runtime caches retain the existing revision fence and post-commit invalidation; the existing cache tests pass. SQL re-runs advance the revision again (as the existing release mechanism does) while retaining the same City UUIDs, data and foreign keys.

## Commands run

From `backend/` unless specified:

```sh
npx tsc --noEmit -p tsconfig.json
# exit 2; 158 existing diagnostics, also reproduced on untouched HEAD in /tmp
npx tsc --noEmit -p tsconfig.build.json
# exit 0
npx eslint 'src/cities/**/*.ts'
# exit 0; eslint --fix was also used during implementation
npx jest src/cities --runInBand
# exit 1; 160 passed, 17 integration startup failures, 15 suites total
npx jest --testPathPatterns='/src/cities/' --testPathIgnorePatterns='.*\.integration\.spec\.ts$' --runInBand
# exit 0; 160 passed / 12 suites
npx jest src/vet-clinics/vet-clinics.resolver.spec.ts --runInBand
# exit 0; 8 passed
npm run cities:build-neighbourhood-candidate
# exit 0; 351 selectable, 83 pending curated decisions, 0 OSM observations
npm run cities:verify-coverage
# exit 1; report.md and report.json in output/neighbourhood-cities/
python3 src/cities/scripts/verify-neighbourhood-sql.py
# exit 0; zero SQL errors, OFFLINE_UPGRADE_OK
```

The existing `publishReviewedRelease` function was called through `npx ts-node -r tsconfig-paths/register -e ...` with the generated candidate snapshot, default catalog/snapshot/migration/journal paths; it generated 0066 and its matching catalog. The `.overpass`/SPARQL acquisition script was **not** run after the initial network probe failed. The ordinary `npm run test:integration -- src/cities` was not separately run because no database/container runtime is reachable; the exact city Jest run already attempted all three integration suites and recorded startup failures.

Additional attempts: Docker info failed on its protected Unix socket; local `initdb` succeeded, but `pg_ctl` failed on both TCP and Unix socket creation. A first single-user attempt used SQL_ASCII and found a Unicode conversion error; the committed verifier explicitly creates UTF8 and then passed. `git diff --check` passes. In `admin-service/`, `node --test src/adminjs/resources/cities.resource.test.js src/adminjs/resources/curated-tables.layout.test.js` failed at import because `adminjs` is unavailable. During test-command setup, `npm run test:unit -- src/cities --runInBand` expanded to broader unit runs because Jest consumed positional arguments as ignore patterns; the broader run reported 30 unrelated HTTP-listener failures (EPERM). The scoped command above avoids that ambiguity.

## Human review priorities

The missing production-quality dataset is the main blocker: Smouha, Mohandessin, Rehab and other starter names are still not selectable. No claim of complete geographic coverage is made. First fetch and review snapshots, then verify point containment against the real governorate and ADM2 polygons, especially new urban communities whose administrative boundaries have changed since OCHA's source vintage. The starter rows do not pretend to resolve that ambiguity.

The independent checklist needs external research and pruning. Least reliable candidates include Port Said's “El Gaber” and “Mubarak” (ambiguous), Alexandria's “El Hager” / “الهواجر”, “El Daraisa” and numbered Abis areas, and Sidi Abdel Rahman (potentially outside the requested coastal cutoff). These are not released Cities. Check compounds individually, prevent duplicate node/way representations and use merge decisions for a district with the same name. Do not enable OSM-derived records before the Flutter owner adds attribution.

See the runbook for exact input shapes and completion steps. The generated report and all command logs remain under ignored `output/neighbourhood-cities/`.

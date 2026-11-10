# Neighbourhood candidate: offline build and blocked release

**2026-11-10: 3,455 candidate OFFICIAL Cities = 351 districts + 3,104 neighbourhoods (2,146 Greater Cairo / 717 Alexandria region / 241 Port Said region). Release blocked.** Data quality and source-point integrity pass. Grid and independent-name gates fail; GPS passes 30/30 in Cairo and Alexandria offline, 29/30 in Port Said. Do not deploy the candidate. The actual catalog, combined snapshot, 0066 and journal remain unchanged.

The requested Nominatim probe still fails DNS (curl exit 6). No web responses were fetched in this continuation. The lead supplied nine OSM responses on November 9/10, Wikidata and OCHA ADM1/2/3/populated places. Fourteen used compressed source files have raw/compressed SHA-256, sizes, available retrieval times, licences and attribution in `src/cities/data/neighbourhoods/source-manifest.json`. Approximate lead retrieval times are explicitly approximate. OCHA boundary vintage is 2017. The unused OSM administrative response is omitted. NOTICE records ODbL, CC0 and CC BY-IGO.

## Reproduce offline

Run from `backend/` with the installed dependencies; do not reinstall. Python geometry scripts require the system GEOS shared library. No build/test/migration command fetches data.

```sh
python3 src/cities/scripts/prepare-geographic-evidence.py
python3 src/cities/scripts/build-reviewed-dataset.py
python3 src/cities/scripts/build-independent-names.py
python3 src/cities/scripts/build-gps-fixtures.py
python3 src/cities/scripts/finalize-neighbourhood-review.py
python3 src/cities/scripts/verify-source-points.py
npm run cities:build-neighbourhood-candidate
npm run cities:verify-coverage -- output/neighbourhood-cities/candidate-catalog.json
npx ts-node -r tsconfig-paths/register src/cities/scripts/review-grid-gaps.ts
```

Coverage verification currently exits 1. Its report JSON/Markdown, missing variants and ten worst grid samples per area are under ignored `output/neighbourhood-cities/`. The separate grid review asserts exact agreement with that report and lists per-ADM2 feature/sample counts and the forty largest remaining OSM residential footprints (plus largest ADM3 extents). `gps-case-review.md`, `name-resolution-review.md` and `name-research-queue.json` document the remaining research. The implementation report records counts, review errors and thirty priority decisions.

`dataset_geography.py` defines membership from OCHA polygons and explicit reviewed urban/coastal expansion polygons. Fetch boxes never decide inclusion. The committed ADM3 extract retains 754 exact features from 5,716 with full-member checksum/filter metadata. To repeat initial extraction, supply the original `ocha-cod-ab/egy_admin3.geojson.gz`; normal builds need only the filtered file.

All 7,008 clipped residential features remain in evidence. Populated ADM3 polygons are added whole, without cutting out agricultural/water/desert portions to hide gaps. There are now 706 populated units, 7,714 polygons total. OSM named settlements, residential landuse, populated-place points and explicit reviewed WD locality evidence can establish habitation. Every mandatory fill point uses the OCHA centre; every ordinary parent uses exact ADM2 containment. A unit without any credible habitation evidence is recorded as excluded. Never name arbitrary grid points to obtain green coverage.

OSM hamlets/localities follow the same bilingual/name/coverage rules as other places. Natural features, private gates/premises, bare codes, plots, building phases, single buildings and streets are excluded. Established named estates, compounds and properly qualified numbered city districts remain eligible. Both languages must be credible; standard translations/transliterations are marked curated. OCHA populated-place English labels receive Arabic only when unambiguous or independently corroborated. Raw source spelling remains preserved. Named districts merge into their existing application UUID rather than creating duplicate Cities.

## Parent exceptions and audit signatures

For Zemam Out/no selectable ADM2 polygon, keep the containing OCHA ADM1. Prefer the named/enclosing new city's selectable same-governorate district(s), choosing the nearest polygon among its kisms; otherwise choose the nearest selectable same-governorate polygon edge. Refuse automatic inclusion beyond 40 km. Each exception records the rule, original Zemam code or null, candidate set and distance. The quality gate independently recomputes this; all other rows require exact containment. There are 34 named-city and 306 nearest-polygon exceptions, maximum 16.89781 km, zero beyond 40 km. Every case is in `zemam-out-exceptions.json.gz`.

`personal-review.json` records Codex's source/rule audit, residue, curated names, merges/disambiguations and five overlapping 300-included/300-excluded sample rounds. The fifth found 10 inclusion-classification errors (3.33%), two spelling errors and one false exclusion (0.33%); corrections and archived pre-correction samples are retained. These are not independent field observations or a zero-error claim. Every staged settlement and all covered populated-place records were screened. Source-point verification checks every included coordinate against the recorded raw response or a specifically documented geometric derivation/correction.

Finalization refuses changed snapshot/rule/editorial hashes, changed decision bytes, unresolved residue or parents beyond 40 km. A maintainer changing inputs must review the resulting decisions and record a new deliberate signoff; routine build scripts must never automatically renew approval hashes. GPS and independent-name lists have separate exact-area signatures. The GPS signature is current. **Independent-name review remains pending** because original regional requests (especially Port Said El Rehab/El Fayrouz) could not be verified online.

The independent lists select from raw OCHA/WD labels and the separate task/knowledge input, never catalog output. They contain 409 / 264 / 88 distinct names, with 18 / 68 / 33 unmatched variants. The strict 150-name floor remains; 88 is not a claim that the Port Said region genuinely has fewer than 150 areas. Public URLs are retained in the list. Wikipedia/governorate page research remains outstanding.

GPS uses thirty spatially spread independent landmarks per region and OCHA-containing districts. QIDs reused as City coordinate sources are excluded from selection; a name-only corroborating landmark may remain if the City point is independently derived from OSM geometry. Every original fixture coordinate survives this round. Default adjacent approvals require a shared boundary and proximity; two explicit reviewed rural approvals (Q138206790→EG0310 and Q138206791→EG0311) use the user-authorized adjacent-district option with real shared boundaries and recorded distances/reasons. Q138196168 remains a failure: expected EG0306, nearest EG0308, whose polygons do not intersect. Do not add an adjacency or replace its fixture without source evidence. Sixty recent WD mosque imports have weaker confidence than thirty older landmarks.

## Checks and local SQL benchmark

```sh
npx jest src/cities --testPathIgnorePatterns='.*\.integration\.spec\.ts$' --runInBand
npx eslint 'src/cities/**/*.ts'
npx tsc --noEmit -p tsconfig.build.json
python3 -m py_compile src/cities/scripts/*.py
python3 src/cities/scripts/verify-neighbourhood-sql.py
npx ts-node -r tsconfig-paths/register src/cities/scripts/benchmark-neighbourhood-candidate.ts
python3 src/cities/scripts/verify-neighbourhood-sql.py --catalog output/neighbourhood-cities/candidate-catalog.json --migration output/neighbourhood-cities/candidate-benchmark.sql
```

Unit: 15 suites / 172 tests pass; lint/build typecheck/Python compilation pass. Full `tsconfig.json` reports 158 pre-existing non-Cities diagnostics, matching the untouched HEAD location/error-code baseline. The SQL verifier uses a disposable PostgreSQL/PostGIS single-user cluster without sockets or Docker. It verifies schema 0064 with User/Post references, 0065 then release SQL, rerun, repeatable SQL/redeploy, UUID/reference/exact-row preservation, stable no-op revisions and negative hierarchy cases. Both the published 351-row release and candidate benchmark pass.

The ignored candidate SQL is **not a release**. It is 2,916,423 bytes; local apply at 3,455 rows measured 0.993 s and rerun 0.568 s (0065 plus candidate, excluding repeatable SQL). Whole workload: 2.279 s. Timings depend on this machine; Docker integration is still required. Indexed hierarchy checks inspect the changed row and direct children rather than globally scanning all Cities per row.

The lead must run these on Docker after reproducing the candidate:

```sh
npx jest --testRegex='.*\.integration\.spec\.ts$' --runInBand src/cities
CITY_CATALOG_CANDIDATE=output/neighbourhood-cities/candidate-catalog.json npx jest --testRegex='.*\.integration\.spec\.ts$' --runInBand src/cities
```

The optional environment variable loads validated candidate rows parent first only inside the GPS Testcontainers database, then exercises real repository `findNearest`. No Docker integration was run here. The lead's prior 16-pass/1-review-gate result predates the candidate.

## Publication and deployment order

All five gates must pass before publication. `publishReviewedRelease` retains the existing atomic four-artifact mechanism and refuses failed coverage. It was checked against disposable artifact paths and correctly rejected this candidate, leaving the real four files untouched. Do not deploy benchmark SQL, hand-edit around the gate or append 0067. When ready, use the publisher in isolated staging whose journal ends at 0065 to replace the unshipped 0066 together with catalog, combined snapshot and journal. The publisher intentionally refuses to overwrite an existing migration.

Pinned compressed source references are relative to `cities/data`; retain all referenced assets with a release. SQL is self-contained and offline. Configured pre-deploy applies pending migrations transactionally, then repeatable custom SQL, before a new application process starts. 0065 precedes 0066; the old application tolerates additive columns. A new instance starts with those columns present and a cold revision-fenced cache. No-op repeatable SQL cannot restore old district spellings. This is code/configuration review and local SQL verification, not a production deployment test.

Admin Cities remain read-only. Public API additions remain exactly non-null `aliases` and nullable `district`, request DataLoader resolution and official district/neighbourhood nearest recognition. The Flutter owner must add OSM attribution from NOTICE before an OSM-derived release is enabled.

Git's shared worktree metadata is read-only here, so no commit was created. The ignored handoff archive includes the tracked patch and new files plus verification output; apply/review it in a writable checkout before making logical conventional commits. Do not push or deploy as part of this handoff.

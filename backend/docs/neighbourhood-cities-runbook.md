# Neighbourhood dataset: offline release and review gates

Current round8 status: **3,156 Cities; REVIEW ONLY / NOT MERGEABLE**. Headline checks141/141 pass. Only Greater Cairo grid coverage fails (270 uncovered; maximum254); names pass; floors stay97/91/94.5. See [current results](neighbourhood-cities-round9-report.md). Counts below describing the prior checkpoint are historical.

The local release is prepared as the single replacement `0066_release_city_catalog.sql`, catalog, combined source snapshot and journal. See the [implementation report](neighbourhood-cities-implementation-report.md) for counts, source limitations, known missing names, timings and the 30 priority decisions. Unit and local Docker checks pass; the lead can independently reproduce them. Nothing has been committed, pushed or deployed.

From `backend/`, using existing dependencies and system GEOS, rebuild without fetching data:

```sh
python3 src/cities/scripts/prepare-geographic-evidence.py
python3 src/cities/scripts/build-reviewed-dataset.py
python3 src/cities/scripts/build-independent-names.py
python3 src/cities/scripts/build-gps-fixtures.py
python3 src/cities/scripts/finalize-neighbourhood-review.py
python3 src/cities/scripts/verify-source-points.py
npm run cities:build-neighbourhood-candidate
npm run cities:verify-coverage -- output/neighbourhood-cities/candidate-catalog.json
npm run cities:verify-coverage
```

The immutable `district-seed.json.gz` supplies 351 original district identities for source matching. Published aliases never feed back into that process. It preserves source names, P-codes, coordinates and the previous English display review. Source/rule/editorial signatures, decision-byte hashes, exact independent-list signatures and frozen GPS identities fail closed if inputs change. A regular build cannot approve changed research or renew those signatures. The final offline rebuild reproduced the decision file byte for byte after publication.

The combined snapshot references pinned compressed decisions, source geometry and checklist/GPS evidence. `readCityData` and coverage hydration verify hashes before reading them. Full review prose is retained once in compressed audits; published City provenance links to its decision record. Every fetched response, including HTTP failures and explicitly marked search excerpts, remains cached with URL, retrieval time, licence/rights and raw/compressed hashes in `source-manifest.json`.

Grid sampling uses only complete clipped OSM `landuse=residential` polygons. ADM3 City fill remains selectable but its administrative polygons are never sampled. Centred 500m cells and interior-point fallback supply samples. A sample is covered within 1.5 km of an OFFICIAL City OR when its residential polygon contains an OFFICIAL City point. Reviewed per-feature exceptions bind OSM identity, centre, uncovered count, worst distance, nearest City, research and reason no whole-block name was assigned. Features beyond 4 km additionally require individual research. Missing notes, increased gaps/distances, changed nearest identities or coverage below 97/91/94.5% fail. Final exceptions=332, including 65 far features. Full notes are in `research-blocks/feature-notes.json.gz`.

`propose-residential-review.ts` writes an **unreviewed draft** to ignored output. It cannot approve it. Named enclosing-area reverse evidence supports explicitly marked extra representatives; a code, road, generic city or nearby named feature alone does not prove a distinct neighbourhood. The reviewed coverage extensions use exact Mostakbal Ismailia residential and Kafr ElBattikh city source polygons. The Ras ElBar supplement adds only recorded named city-boundary portions outside all original OCHA governorate land, correcting a2017 coast/water gap. There are no buffers or reassigned existing land. Both inputs and the two modified P-code geometries are pinned.

Independent checklists use task input and separately selected public OCHA/Wikidata/Wikipedia/governorate sources, never candidate output. Current checklist counts 418/268/85; reviewed minima 150/150/85. Port Said's honest minimum follows the lead decision dated 2026-11-10. A name matches only by exact normalized equality on its own City display or alias; governorate, parent and substring matches cannot satisfy the gate. All lead headline tuples additionally require exactly one literal bilingual display. Every unmatched variant must exactly belong to a reviewed entry in `known-missing-names.json`, with research, reason and source URLs. Eleven unresolved names remain visible to the client. Resolved aliases/usable unambiguous points cannot be hidden there. Arabic display uniqueness is also a data-quality requirement.

GPS retains 30 fixtures per area, frozen in `gps-selection.json`. At least 29 must pass and at most one may fail, with an exact individual reviewed match of area, coordinate, actual City and expected district in committed metadata. Q138196168 stays a fish-farm landmark failure in `gps-failure-review.json`. No coordinate was changed or fixture substituted to improve its result. Other failures require their own evidence; two failures fail an area.

Run release verification offline:

```sh
npx jest src/cities --testPathIgnorePatterns='.*\.integration\.spec\.ts$' --runInBand
npx jest --testRegex='.*\.integration\.spec\.ts$' --runInBand src/cities
npx eslint 'src/cities/**/*.ts'
npx tsc --noEmit -p tsconfig.build.json
python3 -m py_compile src/cities/scripts/*.py
python3 src/cities/scripts/verify-neighbourhood-sql.py
```

Docker uses disposable PostGIS containers. Historical district-only reconciliation/release scenarios have their own pinned fixture, including the former English cleanup and revision bump; Neighbourhood integration applies the actual repository 0066 and tests the complete release's UUIDs, references, hierarchy and all 90 GPS fixtures. The socket-free SQL verifier separately checks migration apply/re-run, bilingual/source names, exact released rows, retained legacy entries, parent hierarchy and no-op redeploy revisions. Its output records transaction start/finish times.

For a future deliberately reviewed replacement of this unshipped 0066, use the existing `publishReviewedRelease` API in isolated staging whose journal ends at 0065 and whose starting catalog is the pre-Neighbourhood district catalog. Supply explicit reviewed official/governorate counts. The publisher validates all gates and the four artifacts. Its default still rejects failed coverage. The explicit local review-only option binds an exact failed report SHA-256 and dated reason, preserves failed names/grid status and marks the SQL REVIEW ONLY; it cannot waive headline/display, structural or GPS failures. This local artifact must not be merged or deployed while those failures remain. Verify staged SQL, then replace catalog, combined snapshot,0066 and journal together with backups/rollback. Do not generate 0067 for this unshipped release. The current four artifacts already came through that publisher and match staging byte for byte. After deployment, append-only migration rules apply normally.

This worktree cannot commit because Git metadata is read-only. Leave changes for review here. No dependency reinstall, frontend change, push, PR, production or Railway operation is part of this task.

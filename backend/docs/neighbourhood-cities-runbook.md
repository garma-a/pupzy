# Neighbourhood dataset: offline candidate and release gates

The 2026-11-10 internet-enabled continuation remains a candidate. See the [implementation report](neighbourhood-cities-implementation-report.md) for measured counts and remaining failures. Do not publish until coverage verification passes. The actual catalog, combined release snapshot, 0066 and journal remain unchanged.

From `backend/`, using the existing installed dependencies and system GEOS, reproduce without network access:

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

Verification exits 1 while a gate fails. Reports under ignored `output/neighbourhood-cities/` enumerate every unmatched variant, failed GPS check and unreviewed residential feature. The committed independent research, raw responses and exceptions are under `src/cities/data/neighbourhoods/`; the source manifest pins raw and compressed hashes, URLs, actual retrieval dates, licences and statuses, including failed HTTP attempts. The lead-provided lookup envelope preserves each original URL/time. An indexed excerpt or blocked endpoint is identified as such, never represented as a complete fetched public page.

The lead correction of 2026-11-10 samples only complete clipped OSM `landuse=residential` polygons. It retains ADM3 City fill without sampling administrative polygons. Grid cells are 500 m, centred in each footprint's bounding box, with a recorded interior-point fallback for small polygons. A sample is covered within 1.5 km of an OFFICIAL City OR if its residential polygon contains an OFFICIAL point. Legacy Cities cannot credit coverage. `residential-grid-review.json` holds reviewed per-feature exceptions and per-area coverage floors rounded down to 0.5%. Increased per-feature gap counts/distances, changed nearest Cities, missing research, missing individual research beyond 4 km, or coverage below a floor fail verification. `propose-residential-review.ts` writes an **unreviewed draft** to output only; it cannot renew review automatically.

Independent names come from separate client inputs, OCHA/WD labels and selected Arabic/English Wikipedia/governorate sources, never from catalog output. Minima live in reviewed per-area metadata: Cairo and Alexandria retain 150; Port Said uses the honest researched total per the dated lead decision. Unresolved genuine areas remain on the checklist and fail matching. A known area may use a documented landmark proxy, but fuzzy unrelated search results cannot supply its name/point.

Source/rule/editorial review signatures, decision-byte hashes and separate exact-list/GPS signatures remain enforced. Changing inputs requires a deliberate documented review; the normal build cannot approve itself. No new independent 300/300 random audit is claimed this continuation: original audits remain archived; explicit additions, aliases and changed decisions were reviewed individually. Points are exact recorded coordinates or the already documented geometric exceptions. Ordinary parents use OCHA containment; Zemam Out uses documented same-governorate polygon-edge distance, never a centroid, with the existing 40 km ceiling.

Run the checks without fetching data:

```sh
npx jest src/cities --testPathIgnorePatterns='.*\.integration\.spec\.ts$' --runInBand
npx eslint 'src/cities/**/*.ts'
npx tsc --noEmit -p tsconfig.build.json
python3 -m py_compile src/cities/scripts/*.py
python3 src/cities/scripts/verify-neighbourhood-sql.py
npx ts-node -r tsconfig-paths/register src/cities/scripts/benchmark-neighbourhood-candidate.ts
python3 src/cities/scripts/verify-neighbourhood-sql.py --catalog output/neighbourhood-cities/candidate-catalog.json --migration output/neighbourhood-cities/candidate-benchmark.sql
```

Candidate benchmark SQL is disposable output, not a release. The local socket-free PostgreSQL/PostGIS verifier checks apply/rerun, exact rows, UUID/reference preservation, parent hierarchy and no-op revisions. The lead must also run real Docker integration:

```sh
npx jest --testRegex='.*\.integration\.spec\.ts$' --runInBand src/cities
CITY_CATALOG_CANDIDATE=output/neighbourhood-cities/candidate-catalog.json npx jest --testRegex='.*\.integration\.spec\.ts$' --runInBand src/cities
```

Only after every gate passes, invoke the existing atomic publisher in isolated staging whose journal ends at 0065. Replace the unshipped 0066, catalog, combined snapshot and journal together; do not add 0067. The publisher refuses failed coverage and existing migration overwrite. Generated SQL must remain offline, idempotent and parent-first. Keep all pinned sources; display OSM attribution before enabling an OSM-derived release.

This worktree cannot commit because Git metadata is read-only. Changes are left for review here. No dependency reinstall, frontend change, push, PR, production or Railway operation is part of this task.

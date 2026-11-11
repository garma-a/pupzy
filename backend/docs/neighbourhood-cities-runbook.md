# Neighbourhood Cities release runbook

The release has **3,156 OFFICIAL Cities: 351 districts + 2,805 Neighbourhoods across 27 governorates**. All gates pass. The four local publisher artifacts are the catalog, combined snapshot, single replacement `0066_release_city_catalog.sql`, and journal. The [implementation report](neighbourhood-cities-implementation-report.md) records final results and timings; no deployment is included.

Grid evidence is clipped OSM `landuse=residential` geometry; ADM3 polygons are never sampled. A 500 m sample is covered within 1.5 km of an OFFICIAL City, or when its residential polygon contains an OFFICIAL City point. Each remaining feature requires reviewed identity, centre, uncovered count, worst distance, actual nearest City, research and reason. Features beyond 4 km additionally require individual research. There are 360 current exceptions, 68 beyond 4 km, and zero unreviewed features. Measurements and notes are in `residential-grid-review.json` and `round9-grid-remeasurement.json.gz`.

Lead amendment, **2026-11-11**: floors are **96.8% Greater Cairo / 91% Alexandria / 94.5% Port Said region**. A fractional calibration requires a dated, reviewed lead decision matching the exact floor and containing its reason. Share regressions and stale exceptions still fail. ADR 0009 and gate metadata retain this reason verbatim:

> The 97% floor was calibrated on 2026-11-10 against a catalog that contained unnamed synthetic reference points, since removed as not being real places. The lead reviewed the remaining 270 uncovered samples (176 features): they are unnamed residential blocks on the desert fringe of 6th of October, New October, New Sphinx and New Cairo, and lettered building groups (B1, B2, B3, B7, Buildings 6) inside Madinaty whose residents use the name Madinaty. No verifiable area name exists for them. The floor is a ratchet at the measured level; it must not be lowered again without a new lead decision.

Names require exact normalized equality on a City's own display or aliases. All 141 headline tuples require one literal bilingual display in their governorate. Independent lists contain 418/268/85 names, with reviewed minima 150/150/85; the 14 researched known-missing entries remain client-visible. Arabic displays are unique within a governorate and use Western digits, retaining original forms as aliases; English displays are ASCII. Synthetic near/قرب labels and nested or multiple disambiguators fail.

GPS uses 30 frozen fixtures per area: at least 29 must pass, with every failure individually documented. Q138196168 remains the sole fish-farm failure. City data, coordinates, fixtures and individual exception notes were unchanged by the floor amendment.

Run from `backend/`, using the existing dependency symlink and local PostgreSQL/PostGIS:

```sh
npx jest src/cities --testPathIgnorePatterns='.*\.integration\.spec\.ts$' --runInBand
npx eslint 'src/cities/**/*.ts'
npx tsc --noEmit -p tsconfig.build.json
npm run cities:verify-coverage
python3 src/cities/scripts/verify-neighbourhood-sql.py
python3 src/cities/scripts/verify-source-points.py
npx jest --testRegex='.*\.integration\.spec\.ts$' --runInBand src/cities
```

For offline reconstruction, run `prepare-geographic-evidence.py`, `build-reviewed-dataset.py`, `build-independent-names.py`, `build-gps-fixtures.py`, then `finalize-neighbourhood-review.py` under `src/cities/scripts/`. Build with `npm run cities:build-neighbourhood-candidate` and verify that candidate explicitly. Signatures bind source/rule/decision review, independent lists and frozen GPS identities. Builders cannot approve changed research; the immutable district seed prevents published aliases feeding back into identity matching.

To replace this **unshipped 0066**, stage `publishReviewedRelease` with a journal ending at 0065, the immutable 351-district seed as current input, the reviewed candidate snapshot, and explicit counts 3156/27. Use normal options, without `reviewOnlyCoverageReport`: all gates must pass. The combined snapshot must lack `reviewOnlyPublication`, and SQL must lack a review-only marker. Verify staged SQL, then install all four artifacts with backups and durable atomic renames; confirm bytes match staging. Do not generate 0067. After deployment, migrations are append-only.

All 334 source responses retain URLs, retrieval times, rights/licences and compressed/raw hashes in `source-manifest.json`; failures and indexed excerpts are identified honestly. All builds, gates and migrations are offline. Preserve NOTICE and OpenStreetMap attribution. No frontend edit, reinstall, Git commit, push, PR, production or Railway action is included.

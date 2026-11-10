# Neighbourhood dataset continuation — 2026-11-10

**NETWORK STILL UNAVAILABLE: Nominatim DNS fails (curl exit 6). No web response fetched this round; offline continuation only.** The requested first command produced no header; its pipeline exit 0 masked curl failure. The direct diagnostic `curl -sSI --connect-timeout 5 --max-time 15 https://nominatim.openstreetmap.org/` exposed the DNS failure. No Nominatim bulk requests, invented coordinates, Wikipedia research or live geocoding is claimed. The manifest records the probe.

**3,455 OFFICIAL candidate Cities = 351 existing districts + 3,104 neighbourhoods. Net +140 this round; RELEASE BLOCKED.** The actual catalog, combined snapshot, 0066 and migration journal remain unchanged. The publisher was exercised against disposable artifact paths and rejected the candidate. No frontend, production, Railway, Docker, push, PR, merge, main or dependency-install operation occurred.

**No commit created:** Git cannot create the worktree index lock because the shared Git metadata is read-only: `/home/girgis/repo/work/pupzy_comapny/pupzy/.git/worktrees/neighbourhood-cities/index.lock`. Edits remain on `feat/neighbourhood-cities`; the refreshed ignored handoff bundle contains the tracked patch, new source/code files and verification artifacts. This is a filesystem restriction, not an approval rejection.

## Added rows this round

The lead-staged Overpass responses contain 315 objects (149 / 120 / 46). Their raw bytes were moved into three deterministic gzip snapshots with queries, approximate retrieval time, upstream OSM timestamp, sizes, raw/compressed SHA-256, ODbL and attribution. All 315 names/tags were inspected. There are 121 included settlements, 3 district merges and 191 exclusions. No raw source is duplicated as an envelope.

| Area | Staged OSM localities + hamlets | Restored OSM estates | OCHA populated places | Additional ADM3 names/fill | Source-backed curated | Added / removed | Net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Greater Cairo | 61 + 3 | 2 | 7 | 2 | 0 | 75 / 16 | 59 |
| Alexandria region | 47 + 5 | 0 | 15 | 2 | 3 | 72 / 0 | 72 |
| Port Said region | 3 + 2 | 0 | 5 | 0 | 1 | 11 / 2 | 9 |

158 rows added; 18 removed: thirteen coded-unit/facility/conflicting-source rows and five now-covered duplicate ADM3 identities. Swiss A/B are named residential estates restored after false-exclusion review. The four new curated places are Village 29 Banger El Sokkar (independent OSM geometry point plus WD name evidence), Ghorbal, Maamoura El Balad and Shatt El Sheikh Dergham. Every coordinate is read from a source response or explicitly derived from its recorded geometry.

## Full candidate by inclusion source

Mutually exclusive rule counts below; compounds/numbered districts are separated from raw OSM place tags. Original tags remain in provenance.

| Area | city / town / village / suburb / quarter | neighbourhood | locality / hamlet | compounds | numbered city districts | ADM3 fill / extra names | OCHA populated places | WD localities | curated additions | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Greater Cairo | 8 / 2 / 82 / 46 / 0 | 1175 | 61 / 3 | 497 | 75 | 39 / 121 | 7 | 5 | 25 | 2146 |
| Alexandria region | 3 / 1 / 113 / 7 / 0 | 368 | 47 / 5 | 13 | 7 | 31 / 81 | 15 | 7 | 19 | 717 |
| Port Said region | 1 / 0 / 8 / 1 / 0 | 175 | 3 / 2 | 5 | 5 | 5 / 22 | 5 | 1 | 8 | 241 |

Namespaces: {'OSM': 2713, 'WD': 34, 'PUPZY': 357}. Curated additions can carry WD identities or PUPZY identities backed by WD/ADM3/OSM geometry. There are 137 district merges ({'greater-cairo': 92, 'port-said-region': 22, 'alexandria': 23}); 14 more than before. EG3307 display name is now Marina Alamein, matching its authoritative Arabic; old Alamn remains an alias. Application UUID, source code and district point stay unchanged. This cleanup is candidate-only.

## Source size and provenance

Fourteen used compressed snapshots: nine Overpass responses, Wikidata, OCHA ADM1/ADM2, filtered ADM3 and populated places. Raw compressed bytes: 10,596,660. The complete neighbourhood directory is 14,314,514 bytes; all cities/data is 15,177,006 bytes (15.18 MB decimal, below 20 MB). Derived review/evidence files are included in these totals. The ADM3 extract retains 754 exact features from 5,716, with full-member SHA-256 and deterministic filter. OCHA boundaries have 2017 vintage, downloaded 2026-11-09; no current survey is claimed.

OCHA source: https://data.humdata.org/dataset/cod-ab-egy and the exact archive resource in source-manifest.json, CC BY-IGO. OSM endpoint: https://overpass-api.de/api/interpreter , © OpenStreetMap contributors, ODbL 1.0. Wikidata endpoint: https://query.wikidata.org/sparql , CC0. Retrieval dates, exact available times, checksums, sizes and attribution are per file in the manifest and NOTICE. Build, tests and migrations remain offline.

## Review and exclusions

| Round | Included / excluded read | Inclusion errors before correction | Exclusion errors |
| --- | ---: | ---: | ---: |
| 1 | 300 / 300 | 26 (8.67%) | 0 confirmed |
| 2 | 300 / 300 | 11 (3.67%) | 0 confirmed |
| 3 | 300 / 300 | 4 (1.33%) | 0 confirmed |
| 4 | 300 / 300 | 5 (1.67%) | 0 confirmed |
| 5, this round | 300 / 300 | 10 (3.33%), plus 2 spelling errors | 1 (0.33%) |

Samples overlap and are archived before corrections; they are not 1,500 independent observations or a final production error-rate estimate. Codex performed the source/rule audit; no field verification or independent human approval is claimed. The fifth round found coded allocations, building phases, student accommodation and contradictory bilingual names. Rules were corrected; Swiss B and targeted Swiss A were restored. First Heights and Electricity and Mechanics spelling fixes preserve raw labels. Every staged object, all 60 covered populated-place records, new curated names, changed merges and disambiguations were read. Six populated-place names lacking credible Arabic remain excluded; no Arabic was borrowed from a neighbouring unit.

Final reviewed tables contain 525 curated-name rows, 137 merges, 292 identity/disambiguation decisions, 94 ordinal-name edits and all 83 starter requests. Two unsupported starter requests remain unpromoted. An attempted Nasr City interpretation of two bare “5th/6th Zone” labels was caught by OCHA geometry (Basateen) and removed rather than published as an alias.

**Source-point integrity PASS: 3,104 neighbourhoods = 3,102 exact raw points + 1 independently derived OSM geometry point + 1 documented Stanley coastline correction (70.88 m).** Review signatures bind snapshots, rules, editorial input and decision bytes; name lists and GPS fixtures have separate signatures. No unresolved bilingual/parent residue is promoted.

9,119 decisions; 5,878 exclusions:

| Exclusion rule | Count |
| --- | ---: |
| adm3-covered-same-name | 347 |
| adm3-covered-unnamed-unit | 3 |
| adm3-uninhabited | 48 |
| duplicate-place | 115 |
| duplicate-populated-place | 13 |
| duplicate-populated-place-reviewed | 3 |
| duplicate-reviewed-identity | 26 |
| gate-or-private-premises | 9 |
| generic-allocation-or-building-phase | 2 |
| generic-phase-or-housing-label | 8 |
| generic-sector-or-service-code | 683 |
| locality-without-settlement-evidence | 16 |
| micro-unit-or-building | 3271 |
| no-name | 15 |
| non-place-feature | 4 |
| non-settlement-locality | 49 |
| outside-coverage | 1122 |
| personal-review-exclusion | 53 |
| personal-source-review-exclusion | 5 |
| populated-place-no-credible-arabic | 6 |
| single-accommodation-or-direction | 3 |
| sub-compound-unit-or-generic-building | 77 |

## Strict gates

| Area | Grid samples: before → after | Gaps >1.5 km: before → after | Worst gap km | Distinct names / unmatched variants | GPS / failures |
| --- | ---: | ---: | ---: | ---: | ---: |
| Greater Cairo | 16595 → 16603 | 2182 → 2137 | 8.579 | 409 / 18 of 987 | 30 / 0 |
| Alexandria region | 10862 → 10904 | 4909 → 4465 | 11.751 | 264 / 68 of 650 | 30 / 0 |
| Port Said region | 5444 → 5517 | 3681 → 3704 | 15.876 | 88 / 33 of 228 | 30 / 1 |

**Structural PASS (3,455 / 27 governorates), geographic quality PASS (0 errors), source-point audit PASS. Grid FAIL in all three areas. Independent names FAIL (119 unmatched variants total; name-list review pending; Port Said below 150). GPS PASS offline in Cairo and Alexandria, FAIL in Port Said (1); real PostGIS findNearest remains unrun here. Overall release FAIL.**

Built-up evidence grew from 7,710 to 7,714 polygons: all 7,008 clipped OSM residential features plus 706 populated ADM3 units. Zero previous polygons were removed or trimmed. Abu El Noum, Kom Ashu, Kom El Akhdar and Shatt El Sheikh Dergham add populated-unit evidence. Port Said improves 31 old gap samples, then adds 54 uncovered samples in the newly evidenced Dergham unit: net 23 more gaps, honestly retained. Full populated-unit extents include agricultural, water, desert and planned portions. No threshold changed.

The ignored **output/neighbourhood-cities/grid-gap-review.md** and JSON contain per-area/per-ADM2 feature/sample totals and the forty largest remaining OSM residential extents, with IDs, centres, estimated areas, original tags, nearest named City/distance, source-only identification and reason no additional real name was assigned. Fifteen largest ADM3 extents are listed separately. There are 492 uncovered features (213 Cairo, 222 Alexandria, 57 Port region). Unnamed developments remain unidentified because online lookup is blocked; source-coded plots/building series remain excluded. Named broad extents are not split into invented places. Source bbox centres in that diagnostic are geometric summaries, not new City coordinates.

Worst remaining samples (lat, lon): Cairo 29.8987688, 31.7769411 — 8.579 km; Alexandria 30.7873308, 29.9565042 — 11.751 km; Port region 31.0960232, 32.1330052 — 15.876 km. Ten worst samples per area are reproduced below and in report.json.

## Independent names

Distinct checklists grew 386 → 409, 234 → 264, 80 → 88. They are selected from the independent task/knowledge input, raw OCHA ADM3/populated-place labels and raw Wikidata locality labels; never from the built catalog. Source URLs are https://data.humdata.org/dataset/cod-ab-egy and per-entity https://www.wikidata.org/wiki/Q… links retained in independent-names.json. Wikipedia/governorate page expansion was not performed because DNS remains unavailable. Port Said 88 is an incomplete checklist, not proof that the region has fewer than 150 real areas.

Resolved 17 old variants: Cairo Mariouteya/المريوطية; Alexandria Falaky, Ghorbal/غربال, Ghait El Enab, Kom El Dikka, Maamoura El Balad forms, Abis 7/8/10 ordinals, Nakheel forms and مراقيا. All newly introduced source-list variants now match. Cached-source spelling aliases also cover Kafr Abdu, Kafr el-Dawwar, Ezbet El-Nakhl, 6th October/15th May City, New October, Madinat El-Amal, Kafr El Olow and Arts/Culture City. Q4519131’s conflated Port Alexandria Police Department alias was rejected: Alexandria Port EG0215 is separate from Gomrok EG0210. New October’s WD point differs substantially from its OSM representative; aliases only, no invented point correction or duplicate City.

No original checklist area removed this round. The newly encountered WD typo “Central business district,l” was cleaned to Central Business District, not added as a junk alias. Prior removals remain documented: El Hager/الهواجر (language/locality conflict), El Daraisa (unconfirmed Alexandria identity), Sidi Abdel Rahman (outside the reviewed coast cutoff), El Gaber (unsupported), Port Said Mostafa Kamel and El Afrang (unconfirmed; Ismailia Afrang retained). The independently evidenced El Hagir/الحاجر ADM3 unit is a different name and remains a strict miss. Port Said El Rehab/El Fayrouz, Bahr El Baqar and other unresolved regional names remain failures; none was transplanted from Cairo or attached to a generic district. See name-resolution-review.md and name-research-queue.json for every request and variant.

## Four original GPS failures

All original fixture coordinates retained; no fixture replaced to conceal a failure. Source IDs and OCHA containing district come from the committed snapshots.

| Case | Decision / result |
| --- | --- |
| Q138181804 — Village 29 mosque, EG3302 | Added real Village 29 with independently derived OSM polygon point, 168 m from landmark. PASS offline. |
| Q138206790 — مسجد الرحمنه, EG0306 | Explicit adjacent EG0310: OCHA polygons genuinely share a boundary; landmark is 6.649 km from that neighbour polygon, nearest representative point 9.277 km away. PASS under the permitted documented-adjacent rule. |
| Q138206791 — mosque of Dr Ali El Hadidi, EG0306 | Explicit adjacent EG0311, genuine shared boundary; landmark 2.492 km from neighbour polygon, nearest point 7.708 km away. PASS under that rule. |
| Q138196168 — مسجد مالك الملك 57, EG0306 | FAIL: nearest EG0308 at 2.002 km. Exact polygons do not intersect (165.582 m separation). No unsupported adjacency, fabricated place or fixture replacement. External location verification still needed. |

gps-case-review.md/JSON gives coordinates, source links, distances and boundary proof. These rural adjacent exceptions acknowledge sparse representative points; they do not claim 1.5 km coverage or reclassify the landmark. Default adjacency requires a genuine shared boundary and proximity; these two separately reviewed exceptions use the original user contract’s explicit adjacent-district option. Sixty recent WD mosque imports have weaker source confidence than the thirty older landmark fixtures.

## Zemam Out exceptions

340 included exceptions: 34 named-city, 306 nearest-polygon; zero beyond 40 km. All retain the true OCHA ADM1, original Zemam/no-polygon code, chosen same-governorate OFFICIAL district, rule, distance and candidate set. Every other neighbourhood requires exact ADM2 containment. The quality gate recomputes polygon-edge distances; no centroid shortcut.

| Source | Parent | Rule | Polygon distance km |
| --- | --- | --- | ---: |
| OSM:way/546460548 | EG2119 | zemam-out-nearest-polygon | 16.89781 |
| OSM:way/880115683 | EG1321 | zemam-out-named-city | 13.23051 |
| OSM:way/876202113 | EG1321 | zemam-out-named-city | 12.03056 |
| OSM:way/878865997 | EG1321 | zemam-out-named-city | 11.72778 |
| OSM:way/712641029 | EG1321 | zemam-out-named-city | 11.52537 |
| OSM:way/876577841 | EG1321 | zemam-out-named-city | 10.82544 |
| OSM:way/877547475 | EG1321 | zemam-out-named-city | 10.67718 |
| OSM:way/879151658 | EG1321 | zemam-out-nearest-polygon | 10.59513 |
| OSM:way/692556528 | EG2109 | zemam-out-nearest-polygon | 10.48046 |
| OSM:way/877841729 | EG1321 | zemam-out-named-city | 10.17038 |

## SQL, code and commands

Actual 0066: 264,485 bytes, unchanged. Disposable candidate benchmark: 2,916,423 bytes (2.916 MB). Local PostgreSQL 18/PostGIS single-user benchmark at 3,455 rows measured 0065+candidate apply 0.993 s, rerun 0.568 s; complete SQL workload 2.279 s. Local timing is not a production SLA. Indexed hierarchy checks avoid a full-table scan per changed row. SQL checks pass from schema 0064 with real-format User/Post references, 0065→0066, repeatable custom SQL/redeploy, unchanged UUIDs/references and exact City row state, stable no-op revision and rejected invalid parents.

Source loaders support pinned compressed files; deterministic rules emit provenance/decisions; verify-source-points.py and review-grid-gaps.ts add offline diagnostics. Only source-manifest count expectation changed 11 → 14 in data-files.spec.ts because three legitimate raw snapshots were added; checksum, size, metadata and mismatch rejection assertions remain strict. No coverage/GPS assertions or thresholds were loosened. Empty unavailable-source placeholders were removed. The public additive aliases/district API, request DataLoader, OFFICIAL nearest selection, revision-fenced cache and read-only admin contract are retained.

| Command from backend/ | Result |
| --- | --- |
| `curl -sI https://nominatim.openstreetmap.org/ | head -1` | Empty output; pipeline masks failure |
| `curl -sSI --connect-timeout 5 --max-time 15 https://nominatim.openstreetmap.org/` | FAIL DNS, exit 6 |
| `python3 src/cities/scripts/build-reviewed-dataset.py` | PASS: 3,104 inclusions, no bilingual/parent residue |
| `python3 src/cities/scripts/build-independent-names.py` | Generated 409 / 264 / 88; approval remains false |
| `python3 src/cities/scripts/build-gps-fixtures.py` | 30 per area; exact reviewed signature retained |
| `python3 src/cities/scripts/finalize-neighbourhood-review.py` | PASS: exact audited inputs/output |
| `python3 src/cities/scripts/verify-source-points.py` | PASS: 3,104 |
| `npm run cities:build-neighbourhood-candidate` | PASS: 3,455; candidate only |
| `npm run cities:verify-coverage -- output/neighbourhood-cities/candidate-catalog.json` | FAIL exit 1, numbers above |
| `npx ts-node -r tsconfig-paths/register src/cities/scripts/review-grid-gaps.ts` | PASS: 492 uncovered features, counts equal strict gate |
| `npx jest src/cities --testPathIgnorePatterns='.*\.integration\.spec\.ts$' --runInBand` | PASS: 15 suites / 172 tests |
| `npx eslint 'src/cities/**/*.ts'` | PASS, zero errors/warnings; formatting fixed earlier |
| `npx tsc --noEmit -p tsconfig.build.json` | PASS |
| `npx tsc --noEmit -p tsconfig.json` | FAIL: 158 existing non-Cities diagnostics; same location/error-code multiset as untouched HEAD baseline |
| `python3 -m py_compile src/cities/scripts/*.py` | PASS |
| `python3 src/cities/scripts/verify-neighbourhood-sql.py` | PASS: released 351 rows, 0 SQL errors |
| `npx ts-node -r tsconfig-paths/register src/cities/scripts/benchmark-neighbourhood-candidate.ts` | PASS: ignored benchmark, not release |
| `python3 src/cities/scripts/verify-neighbourhood-sql.py --catalog output/neighbourhood-cities/candidate-catalog.json --migration output/neighbourhood-cities/candidate-benchmark.sql` | PASS: 3,455 rows, 0 SQL errors |
| `node -r ts-node/register -r tsconfig-paths/register output/neighbourhood-cities/check-publication.cjs` | PASS: publisher rejects, all four real artifacts unchanged |
| Rebuild + finalization + candidate digest comparison | PASS: six exact catalog/snapshot/decision/evidence/admin hashes unchanged |
| Built-up retention comparison | PASS: 0 removed / 0 changed geometries; 4 populated units added |
| `git diff --check` | PASS |
| `git add -- backend/NOTICE.md` | FAIL: shared Git index is read-only; no commit |

Integration was not run: Docker is unavailable and forbidden here. The lead’s earlier 16-pass/1-review-gate run predates this candidate. Lead commands:

```sh
npx jest --testRegex='.*\.integration\.spec\.ts$' --runInBand src/cities
CITY_CATALOG_CANDIDATE=output/neighbourhood-cities/candidate-catalog.json npx jest --testRegex='.*\.integration\.spec\.ts$' --runInBand src/cities
```

The optional environment variable loads validated candidate rows parent first only inside the GPS Testcontainers database and runs real findNearest. Neither integration command is claimed passing. Existing 0066 remains district-only and cannot serve as this candidate’s data release. Once all gates pass, replace the unshipped 0066 through the publisher in isolated staging whose journal ends at 0065; never hand-edit or append 0067. Pre-deploy pending migrations precede new application start; added columns are compatible with the old process. Repeatable SQL cannot restore old names, as verified locally.

## Thirty review priorities

Source/rule approval does not establish local familiarity. These are the least certain points/decisions, not confirmed errors. Coordinates are source-backed; proxy evidence and conflicts deserve human inspection.

| # | Source / name | Lat, lon | Concern |
| ---: | --- | --- | --- |
| 1 | Q138196168 / مسجد مالك الملك 57 | 31.1574129, 32.3023366 | GPS landmark, unresolved non-adjacent nearest result; raw WD location may be wrong. |
| 2 | PUPZY:banger-el-sokkar-village-29 / Banger El Sokkar Village 29 | 30.72684575, 29.474525342439463 | Unnamed residential geometry receives name from a contained independent mosque label; inspect settlement identity. |
| 3 | PUPZY:shatt-sheikh-dergham / Shatt El Sheikh Dergham | 31.48701, 31.83493 | Curated transliteration and WD representative; full newly populated ADM3 extent increases measured gaps. |
| 4 | PUPZY:ghorbal-alexandria / Ghorbal (Alexandria) | 31.1874636, 29.9085814 | Mosque proxy; distinguish Beheira Ghorbal Bahary/Qebly. |
| 5 | PUPZY:maamoura-balad / Maamoura El Balad | 31.3001869, 30.0546395 | Mosque proxy for Balad, separate from beach. |
| 6 | OSM:relation/17266240 / New October | 29.8869331, 30.9112405 | New October WD point differs substantially; broad OSM representative retained, aliases only. |
| 7 | PUPZY:stanley / Stanley | 31.233970863348564, 29.947138420836485 | 70.88 m coastline correction against dated OCHA geography. |
| 8 | PUPZY:ismailia-afrang / Afrang (Ismailia) | 30.592987, 32.283642 | Museum proxy for French quarter. |
| 9 | PUPZY:ard-el-golf / Ard El Golf | 30.0758483, 31.3312707 | Cemetery/mosque point may lie at commonly understood area edge. |
| 10 | PUPZY:triumph / Triumph | 30.0860218, 31.3058291 | Heliopolis hotel proxy, not namesake New Cairo hotel. |
| 11 | PUPZY:new-obour / New Obour | 30.247688, 31.5117706 | Mosque proxy and Zemam named-city exception; extent needs local confirmation. |
| 12 | PUPZY:korba / Korba | 30.093624, 31.325206 | Basilica representative, not measured area centroid. |
| 13 | PUPZY:saint-fatima / Saint Fatima | 30.10589, 31.34447 | Cathedral representative; old OCHA assigns Nozha. |
| 14 | WD:Q4518887 / Zizinia | 31.2354, 29.9682 | Zizinia source point is in Raml Second; compare resident understanding. |
| 15 | WD:Q138183324 / District Asfour Al Janah | 29.9603318, 30.9511728 | District Asfour Al Janah: recent WD import and less-established name. |
| 16 | WD:Q110420273 / Arts and Culture City | 30.012861111, 31.721694444 | Arts/Culture City is a broad campus/area identity. |
| 17 | PUPZY:ezbet-el-walda / Ezbet El Walda | 29.869711944, 31.292208055 | Palace proxy for surrounding quarter. |
| 18 | PUPZY:el-garabaa / El Garabaa | 31.3185054, 32.1346188 | Recent mosque import, proxy and transliteration. |
| 19 | PUPZY:el-aasar / El Aasar | 31.4282162, 31.8055141 | Recent mosque representative in Damietta. |
| 20 | PUPZY:oboor-ismailia / El Oboor (Ismailia) | 30.6063251, 32.2568263 | Mosque representative; retain Ismailia qualifier. |
| 21 | PUPZY:taawon-ismailia / El Taawon (Ismailia) | 30.548393, 32.2987515 | Mosque representative; local extent needs review. |
| 22 | PUPZY:adm3-eg031001 / El Manasra and El Gamil Airport | 31.2371881, 32.17303588 | Broad Manasra/airport unit; centre may miss resident core. |
| 23 | PUPZY:adm3-eg021309 / Mariout Sector | 30.87204445, 29.7631614 | Mariout sector spans mixed/unbuilt land; largest Alexandria gaps. |
| 24 | PUPZY:adm3-eg030601 / South Villages El Siddiq | 31.14080705, 32.29136884 | South Villages irregular unit; major grid/GPS uncertainty. |
| 25 | OSM:node/768552340 / El Dimirdash | 30.0650382, 31.2992074 | GNS Demerdash village point is in Nasr City Second, distinct from familiar hospital quarter. |
| 26 | OSM:way/746698351 / Al Sheikh Moustafa Ismail (Amreya, south-east of Sugar beet 2 Village) | 30.7222428, 29.8596262 | Distant Sheikh Moustafa Ismail homonym, geographic qualifier references a place 10 km away. |
| 27 | OSM:way/806002627 / Housing 144 | 31.1494571, 30.1246472 | Housing 144 may be locally useful or too fine a unit. |
| 28 | OSM:way/701038264 / Atlas G | 30.0071591, 31.3393985 | Atlas G is borderline named housing phase versus coded plot. |
| 29 | OSM:way/546460548 / Janna El Soleimaniya Fourth District | 30.12729, 30.7683914 | Largest nearest-polygon exception, 16.89781 km to Sheikh Zayed. |
| 30 | OSM:way/819260788 / Conflicting source label | see raw, see raw | Excluded: contradictory IL Bosco City / La Mirada source labels. |

## Ten worst grid samples per region

### Greater Cairo

| Lat, lon | km | Nearest | Evidence |
| --- | ---: | --- | --- |
| 29.8987688, 31.7769411 | 8.579 | OSM:way/819189829 | OSM:way/320492141 landuse=residential clipped to coverage-areas |
| 30.1234299, 30.8374949 | 6.627 | OSM:way/727261263 | OSM:way/540236637 landuse=residential clipped to coverage-areas |
| 30.1279265, 30.8374960 | 6.571 | OSM:way/727261263 | OSM:way/540236637 landuse=residential clipped to coverage-areas |
| 30.1324231, 30.8374972 | 6.553 | OSM:way/727261263 | OSM:way/540236637 landuse=residential clipped to coverage-areas |
| 30.1189333, 30.8322952 | 6.216 | OSM:way/546460548 | OSM:way/540236637 landuse=residential clipped to coverage-areas |
| 30.1584665, 30.8492405 | 6.158 | OSM:way/727261263 | OSM:way/546468326 landuse=residential clipped to coverage-areas |
| 30.1369197, 30.8426978 | 6.075 | OSM:way/727261263 | OSM:way/540236637 landuse=residential clipped to coverage-areas |
| 30.1279265, 30.8426950 | 6.073 | OSM:way/727261263 | OSM:way/540236637 landuse=residential clipped to coverage-areas |
| 30.1324231, 30.8426964 | 6.053 | OSM:way/727261263 | OSM:way/540236637 landuse=residential clipped to coverage-areas |
| 30.1550693, 30.8215749 | 5.975 | OSM:way/546460548 | OSM:way/546460689 landuse=residential clipped to coverage-areas |

### Alexandria region

| Lat, lon | km | Nearest | Evidence |
| --- | ---: | --- | --- |
| 30.7873308, 29.9565042 | 11.751 | OSM:way/746698351 | OCHA ADM3 EG021309 populated by residential landuse |
| 30.7918274, 29.9512847 | 11.503 | OSM:way/100953278 | OCHA ADM3 EG021309 populated by residential landuse |
| 30.7873308, 29.9512700 | 11.361 | OSM:way/746698351 | OCHA ADM3 EG021309 populated by residential landuse |
| 30.7918274, 29.9460502 | 11.221 | OSM:way/100953278 | OCHA ADM3 EG021309 populated by residential landuse |
| 30.7828342, 29.9512553 | 11.048 | OSM:way/746698351 | OCHA ADM3 EG021309 populated by residential landuse |
| 30.7873308, 29.9460357 | 10.980 | OSM:way/746698351 | OCHA ADM3 EG021309 populated by residential landuse |
| 30.7918274, 29.9408157 | 10.819 | OSM:node/769126889 | OCHA ADM3 EG021309 populated by residential landuse |
| 30.7963240, 29.9460646 | 10.807 | OSM:way/100953278 | OCHA ADM3 EG021309 populated by residential landuse |
| 30.7828342, 29.9460213 | 10.656 | OSM:way/746698351 | OCHA ADM3 EG021309 populated by residential landuse |
| 30.7873308, 29.9408015 | 10.609 | OSM:way/746698351 | OCHA ADM3 EG021309 populated by residential landuse |

### Port Said region

| Lat, lon | km | Nearest | Evidence |
| --- | ---: | --- | --- |
| 31.0960232, 32.1330052 | 15.876 | EG0306 | OCHA ADM3 EG030601 populated by residential landuse |
| 31.1005198, 32.1330074 | 15.667 | EG0310 | OCHA ADM3 EG030601 populated by residential landuse |
| 31.0915266, 32.1382539 | 15.521 | EG0311 | OCHA ADM3 EG030601 populated by residential landuse |
| 31.1005198, 32.1277560 | 15.494 | EG1206 | OCHA ADM3 EG030601 populated by residential landuse |
| 31.0960232, 32.1382563 | 15.403 | EG0306 | OCHA ADM3 EG030601 populated by residential landuse |
| 31.1005198, 32.1382588 | 15.248 | EG0306 | OCHA ADM3 EG030601 populated by residential landuse |
| 31.1050164, 32.1330096 | 15.182 | EG0310 | OCHA ADM3 EG030601 populated by residential landuse |
| 31.1050164, 32.1277580 | 15.175 | EG1206 | OCHA ADM3 EG030601 populated by residential landuse |
| 31.0915266, 32.1435048 | 15.105 | EG0306 | OCHA ADM3 EG030601 populated by residential landuse |
| 31.1050164, 32.1382613 | 15.065 | EG0310 | OCHA ADM3 EG030601 populated by residential landuse |

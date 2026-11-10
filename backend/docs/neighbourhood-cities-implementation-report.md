# Neighbourhood release investigation — 2026-11-10

**3,469 Cities = 351 districts + 3,118 neighbourhoods; +14 rows. Grid PASS / data quality PASS / source-point integrity PASS. Names FAIL in all three areas; GPS 30/30, 30/30, 29/30. Release blocked; 0066 was not regenerated.**

| Area | Residential samples before → after | Uncovered before → after | Share before → after | Floor | Exceptions | Unmatched variants |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| greater-cairo | 8469 → 8469 | 242 → 242 | 97.143% → 97.143% | 97.0% | 161 | 22/1027 |
| alexandria | 2146 → 2146 | 195 → 189 | 90.913% → 91.193% | 91.0% | 149 | 47/674 |
| port-said-region | 721 → 721 | 38 → 38 | 94.730% → 94.730% | 94.5% | 34 | 30/236 |

Before means checkpoint `5750b75` Cities measured on the same residential evidence with the final centred-cell sampling method, not the obsolete ADM3 grid. ADM3 City rows remain. Only clipped OSM landuse=residential is sampled; a contained OFFICIAL City credits the polygon. All 344 remaining features have reviewed exceptions, and all 70 remaining >4km features have individual notes. No legacy point can credit a polygon.

Lead reference: 8332/220,2132/194,723/43 samples/gaps. Our centred 500 m grid plus interior fallback yields8469/242,2146/195,721/38 before additions. Sample totals differ by at most 1.64%; coverage shares differ by at most 0.68 percentage points. This is an explicit reproduction limitation, not a claim of exact agreement. The old lower-left-anchored grid yielded7724/203,2025/183,665/36; changing origin changes the inclusion of edge cells. The lead’s exact grid origin was not supplied, so exact reproduction remains unresolved. The committed algorithm uses centred cells consistently in the gate and diagnostic. The lead should compare this origin on Docker.

The 78 baseline far features were individually investigated: 4 full named Banger El Sokkar villages 23–26 added, 0 extra representative attachments, 73 lack corroborated whole-block names, 1 is identified as existing New October but has no extra representative yet. New points reduce the far-feature count to 70 and uncovered features 350→344. An additional 168 features at 2–4 km were inspected against recorded named OSM context. Live Overpass attempts failed with 502/414/timeouts; these are not negative naming evidence. Original regional place/landuse snapshots were inspected, successful Nominatim reverses cached, and project/village web evidence retained. See [residential research](neighbourhood-cities-residential-research.md).

## Names and sources

The 52 original unmatched checklist entries finish with 8 sourced resolutions, 6 alias/identity resolutions, 9 removals and 29 still unresolved. Ten total name City additions include two newly researched public names; four additional Cities are the far-block villages. Eight direct alias reviews plus 19 individually inspected exact-Arabic spelling/translation matches were applied. Final checklist sizes 425/269/85; reviewed minimums 150/150/85 are committed in metadata with the lead decision dated 2026-11-10. The compiler never selects checklist entries from catalog output. Port Said was semantically deduplicated and not padded.

El Rehab is a real El Dawahy housing area; no defensible point was found, so it remains a failure. El Fayrouz is a real Bor Fouad housing district, supported by the [Port Said governorate](https://portsaid.gov.eg/News/details/109694); its recorded apartment الفيروز١٥٣ supplies an explicitly approximate proxy. [ITDA addresses](https://www.itda.gov.eg/CRM/885/CRA78.pdf) and governorate indexed material support Rehab. Neither was removed as a misfiled Cairo name.

Public checklist source URLs (exact fetched bytes/statuses in manifest):

- https://ar.wikipedia.org/wiki/أحياء_الإسكندرية
- https://ar.wikipedia.org/wiki/الإسماعيلية_(مدينة)
- https://ar.wikipedia.org/wiki/بورسعيد
- https://ar.wikipedia.org/wiki/محافظة_الجيزة
- https://en.wikipedia.org/wiki/Alexandria
- https://en.wikipedia.org/wiki/Cairo
- https://en.wikipedia.org/wiki/Damietta_Governorate
- https://en.wikipedia.org/wiki/Giza

Nine removals, with retained source evidence:

| Entry | Reason |
| --- | --- |
| Nozha Gardens | A named public garden/zoo complex, rather than an independently established residential neighbourhood. Retain Nuzha/Manshiyet El Nozha separately. Wikidata Q23976192; source garden label and Alexandria page garden discussion. |
| Fawzi Moaz | Checklist names the main street, OSM:way/30644575 شارع اللواء محمد فوزي معاذ. Staged lookup found the street and unrelated facilities, no independently established separate residential area. Smouha remains selectable. |
| El Nasr Smouha | Street in Smouha rather than independently established district; primary bank Fawry agents list locates شارع النصر under سموحة. Remove street-level acceptance entry; keep Smouha. |
| El Mahmoudeya | Ambiguous canal/linear road through several areas; staged response only شارع قنال المحمودية. Not evidence of an Alexandria residential neighbourhood of that name; Beheira Mahmoudiya city lies outside coverage. |
| El Horreya | City-spanning road name rather than independently established Alexandria neighbourhood. Staged responses find isolated towers; existing road/address sources call it طريق الحرية. |
| Soter | Former Soter Street, now شارع دكتور على مصطفى مشرفه, OSM:way/9929693; no separate residential locality established. Street-only acceptance entry removed, Azarita/Shatby retained. |
| Merghem 1 | Numbered industrial-complex phase, not distinct residential area. Official SIS record identifies مجمعي مرغم 1 و2 as industrial production sites; Merghim neighbourhood retained. |
| Merghem 2 | Numbered industrial-complex phase, not distinct residential area. Official SIS record identifies مجمعي مرغم 1 و2 as industrial production sites; Merghim neighbourhood retained. |
| El Shatea Ras El Bar | Generic beach extent, not residential neighbourhood name. Source OSM:way/1554277916 is natural=beach; Ras El Bar and named El Lessan area retained. |

All remaining variants are enumerated in committed `release-gate-status.json` and reproducible output/report.json. They include Asafra Bahary/Qebly, Hadara El Gedida, several new-capital/Alamein names, Rehab, Bahr El Baqar and the Ismailia groups. Genuine unresolved areas stay listed. Bahr El Baqar’s Nominatim result was Sharqia; El Lessan’s attraction point was outside both coastal coverage and OCHA governorate geometry. Mostakbal Ismailia’s WD mosque point is in EG1906 outside current city scope. Those proposals were withheld; no point was shifted to force containment. See [name research](neighbourhood-names-research-2026-11-10.md) and the final dispositions in `research-names/original-name-dispositions.json`.

## GPS, rows and verification

Q138196168 stays unchanged and fails: expected EG0306; nearest EG0308 at2,001.827 m versus EG0306 at2,121.059 m, without polygon adjacency. Reverse returns only the Ismailia–Port Said road. Imagery shows fish farms and a small structure near the point, so it does not prove the mosque coordinate wrong. No new place name was established and no substitute fixture/adjacency was invented. [GPS investigation](neighbourhood-gps-research-2026-11-10.md).

| Added coordinate source | Cairo | Alexandria | Port Said | Total |
| --- | ---: | ---: | ---: | ---: |
| Recorded lead Nominatim response |4|3|1|8|
| Original OSM place response |1|4|0|5|
| Original Wikidata P625 |0|1|0|1|
| Total |5|8|1|14|

Source-point audit: 3,118 rows, 3,116 exact recorded points, 1 previously documented OSM geometry representative, 1 previously documented Stanley coastal correction. All 14 additions use exact recorded source coordinates. Parent checks pass; there are 341 ZemamOut exceptions (35 named-city/306 nearest-polygon), no new >40km approval. Explicit changed decisions/alias reviews and hashes are recorded in personal-review.json. Existing random samples remain archived; no new independent random audit or field survey is claimed.

Executed from backend/:

```sh
python3 src/cities/scripts/build-reviewed-dataset.py
python3 src/cities/scripts/build-independent-names.py
python3 src/cities/scripts/build-gps-fixtures.py
python3 src/cities/scripts/finalize-neighbourhood-review.py
python3 src/cities/scripts/verify-source-points.py
npm run cities:build-neighbourhood-candidate
npm run cities:verify-coverage -- output/neighbourhood-cities/candidate-catalog.json
npx jest src/cities --testPathIgnorePatterns='.*\.integration\.spec\.ts$' --runInBand
npx eslint 'src/cities/**/*.ts'
npx tsc --noEmit -p tsconfig.build.json
python3 -m py_compile src/cities/scripts/*.py
npx ts-node -r tsconfig-paths/register src/cities/scripts/review-grid-gaps.ts
python3 src/cities/scripts/verify-neighbourhood-sql.py
npx ts-node -r tsconfig-paths/register src/cities/scripts/benchmark-neighbourhood-candidate.ts
python3 src/cities/scripts/verify-neighbourhood-sql.py --catalog output/neighbourhood-cities/candidate-catalog.json --migration output/neighbourhood-cities/candidate-benchmark.sql
```

Unit 16 suites/179 tests pass; eslint/build typecheck/Python compilation pass. Coverage exits 1 for names/GPS, with structural/geographic/grid checks passing. Both the existing 351-row release and final 3,469-row candidate SQL pass the socket-free PostgreSQL/PostGIS upgrade/rerun/reference/hierarchy/no-op checks. Docker integration was not run here; commands remain in the runbook.

184 compressed raw snapshots, 13,567,760 bytes; all Cities data approximately 18,276,499 bytes (18.28MB), below 20 MB. Final disposable candidate SQL 2,929,286bytes; measured 0065+candidate apply 1.091935s and rerun 1.182597s; whole SQL verification 3.229 s on this machine. These are local candidate timings, not a published release or Docker measurement. Existing 0066 remains 264,485bytes; catalog, combined published snapshot and journal unchanged. No 0067, no commit (read-only Git), no dependency reinstall, frontend change, push, PR, production or Railway operation.

## Thirty decisions with the most uncertainty

These require reviewer attention; inclusion means the cited evidence met the source rule, not that its point is a surveyed neighbourhood centre. Withheld cases remain withheld.

| # | Decision | Remaining uncertainty |
| --- | --- | --- |
| 1 | Q138196168 | Keep failing GPS fixture; positive mosque identity/coordinate evidence missing. |
| 2 | PUPZY:arab-el-maadi | Representative landmark/road/housing point approximates an established area; verify resident extent. |
| 3 | PUPZY:bangar-el-sokkar-village-23 | Full village identity corroborated by primary indexed sources; rural administrative descriptions conflict, OCHA controls parent. |
| 4 | PUPZY:bangar-el-sokkar-village-24 | Full village identity corroborated by primary indexed sources; rural administrative descriptions conflict, OCHA controls parent. |
| 5 | PUPZY:bangar-el-sokkar-village-25 | Full village identity corroborated by primary indexed sources; rural administrative descriptions conflict, OCHA controls parent. |
| 6 | PUPZY:bangar-el-sokkar-village-26 | Full village identity corroborated by primary indexed sources; rural administrative descriptions conflict, OCHA controls parent. |
| 7 | PUPZY:fayrouz-bor-fouad | Representative landmark/road/housing point approximates an established area; verify resident extent. |
| 8 | PUPZY:kom-el-dikka | Representative landmark/road/housing point approximates an established area; verify resident extent. |
| 9 | PUPZY:manshiyet-el-nozha | WD mosque proxy distinguishes ManshiyetEl Nozha from garden/zoo and other Nozha homonyms. |
| 10 | PUPZY:mariouteya | Representative landmark/road/housing point approximates an established area; verify resident extent. |
| 11 | PUPZY:motamayez-october | Representative landmark/road/housing point approximates an established area; verify resident extent. |
| 12 | PUPZY:nagaa-el-arab | Representative landmark/road/housing point approximates an established area; verify resident extent. |
| 13 | PUPZY:ras-el-soda | Representative landmark/road/housing point approximates an established area; verify resident extent. |
| 14 | PUPZY:safir | Representative landmark/road/housing point approximates an established area; verify resident extent. |
| 15 | PUPZY:shabab-obour | Representative landmark/road/housing point approximates an established area; verify resident extent. |
| 16 | Checklist removal: Nozha Gardens | Evidence supports street, facility, canal or industrial phase; lead should confirm residents do not use it as an area name. |
| 17 | Checklist removal: Fawzi Moaz | Evidence supports street, facility, canal or industrial phase; lead should confirm residents do not use it as an area name. |
| 18 | Checklist removal: El Nasr Smouha | Evidence supports street, facility, canal or industrial phase; lead should confirm residents do not use it as an area name. |
| 19 | Checklist removal: El Mahmoudeya | Evidence supports street, facility, canal or industrial phase; lead should confirm residents do not use it as an area name. |
| 20 | Checklist removal: El Horreya | Evidence supports street, facility, canal or industrial phase; lead should confirm residents do not use it as an area name. |
| 21 | Checklist removal: Soter | Evidence supports street, facility, canal or industrial phase; lead should confirm residents do not use it as an area name. |
| 22 | Checklist removal: Merghem 1 | Evidence supports street, facility, canal or industrial phase; lead should confirm residents do not use it as an area name. |
| 23 | Checklist removal: Merghem 2 | Evidence supports street, facility, canal or industrial phase; lead should confirm residents do not use it as an area name. |
| 24 | Checklist removal: El Shatea Ras El Bar | Evidence supports street, facility, canal or industrial phase; lead should confirm residents do not use it as an area name. |
| 25 | Bahr El Baqar withheld | Real Port Said locality remains unlocated; sourced Sharqia point is a homonym. |
| 26 | El Lessan withheld | Known named tip; recorded attraction point falls outside OCHA coastline/coverage. |
| 27 | Mostakbal Ismailia withheld | Genuine western city extension; recorded mosque point lies in EG1906 outside current city scope. |
| 28 | OSM:way/692962840 | Reverse identifies New October; no extra representative point implemented. |
| 29 | OSM:way/635698474 | Exception with worst distance 9.598km; failed liveOverpass leaves incomplete naming evidence. |
| 30 | OSM:way/635698436 | Exception with worst distance 9.444km; failed liveOverpass leaves incomplete naming evidence. |

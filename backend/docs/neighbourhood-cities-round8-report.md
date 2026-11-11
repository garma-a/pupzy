# Round8 results — 2026-11-11

Historical checkpoint4a176ad. Superseded by [round9 results](neighbourhood-cities-round9-report.md).

Internet available: requested Nominatim probe returned HTTP/2 302. **3,366 → 3,149 Cities (351 districts + 2,798 Neighbourhoods).** **181 merges; 42 noise removals; 9 synthetic reference removals; 3 unqualified collisions removed; 18 additions, including 10 headline rows.** Official district source codes, source labels, coordinates and UUIDs are preserved. No frontend edits, dependency reinstall, commit, push, PR or production action.

**141/141 exact bilingual headlines pass; no outstanding headline objection.** Per the lead's own list edit, Gleem stays primary; Glymonopoulo / جليمونوبولو are its aliases. Headline additions: Smouha, Sidi Bishr, Alf Maskan, Mostakbal City, Degla, Bitash, Khorshid, Seyouf, Bolkly, and restored Smart Village. The nine new PUPZY rows use recorded named-feature proxies or Wikidata points; Smart Village retains its original OSM point. Proxies are disclosed, not claimed as surveyed area centres.

Display counts: **near0 / قرب qualifiers0; English parentheses188; Arabic parentheses8; nested parentheses0; multiple disambiguators0; non-ASCII English0.** القربية is a legitimate name, not a قرب qualifier. Generic compound prefixes are removed; real village/type context is retained where reviewed. Source strings remain in source fields and appropriate aliases.

Aliases: **725,896 → 237,776 UTF-8 string bytes** (the payload measure); including compact JSON array syntax, **828,191 → 275,694 bytes**. Generated variants cap at4 per row, with no triple letters/new consonant doubling/Allamein. Exact canonical-name collisions are excluded. Final materialization also removed13 aliases on9 rows that old ADM3 merges had restored onto the wrong parent, with the official Arabic source-label contract preserved.

| Area | Exact variants matched / total | Reviewed unmatched variants | New unresolved variants | Names | Grid samples / uncovered / share | Floor | Grid | GPS |
|---|---:|---:|---:|---|---|---:|---|---|
| greater-cairo | 1012/1014 | 2 | 0 | PASS | 8,469 / 278 / 96.717% | 97% | FAIL | 30/30 |
| alexandria | 656/672 | 10 | 6 | FAIL | 2,146 / 304 / 85.834% | 91% | FAIL | 30/30 |
| port-said-region | 218/237 | 16 | 3 | FAIL | 734 / 38 / 94.823% | 94.5% | PASS | 29/30 |

Structural and geographic/display quality pass with0 errors. GPS passes all three gates; Q138196168 remains the individually documented Port Said failure. Grid floors are unchanged. Cairo38 and Alexandria27 uncovered features no longer satisfy the old exception measurements/nearest identities; Port Said has0 unreviewed. No unnamed representative points were retained to inflate coverage, and no exception measurements were automatically reapproved.

Checklist sizes:419 /268 /85; minima150 /150 /85. Exact equality exposed38 additional failing entries at cb40dee:35 are now resolved and3 remain. El Shams Club was separately removed as facility noise. The existing known-missing file remains11 entries: Hadayek Zayed; Ezbet El Matar, El Islah, Kilo34, Al Hagir; El Rehab (Port Said), Bahr El Baqar, Hay El Salam Ismailia, El Mahatta El Gedida, El Saba Banat, El Balabsa.

Three additional ambiguous entries remain outside the exemption list and fail honestly: **El Zahraa** (Alexandria: several unrelated streets), **Al Salam** (Alexandria region: inland OCHA administrative unit lacks habitation evidence; coastal Al Salam Beach is different), **El Gharbi** (Port Said region: only a New Damietta western bus station; Ras El Bar query empty). Individual recorded searches and reasons are in `unresolved-exact-name-review.json`.

Single replacement **0066 regenerated through the publisher, 2,820,216 bytes; local apply 1.069970s, re-run 0.949269s**. Catalog, combined snapshot, SQL and journal match staging byte for byte; no0067. The explicit SHA-bound local review-only publication retains the failed report and marks the SQL **REVIEW ONLY / NOT MERGEABLE**. Normal publication still rejects failed coverage; no structural, display/headline or GPS waiver is possible. This is a prepared review artifact, not a passed release.

Data: **20,598,941 bytes (19.645 MiB)**; all316 compressed source snapshots and declared raw hashes verified. Point verifier:2,798 rows,2,796 exact source points,1 source geometry,1 pre-existing documented coastal correction. Full offline rebuild reproduced decisions byte for byte.

Commands/results (final installed catalog):

- `npx jest src/cities --testPathIgnorePatterns='.*\.integration\.spec\.ts$' --runInBand`:18 suites,192 tests PASS.
- `npx jest --testRegex='.*\.integration\.spec\.ts$' --runInBand src/cities`:3 Docker suites,17 tests PASS (disposable PostGIS).
- `npx eslint 'src/cities/**/*.ts'`:PASS.
- `npx tsc --noEmit -p tsconfig.build.json`:PASS.
- `npm run cities:build-neighbourhood-candidate`:PASS.
- `npm run cities:verify-coverage`:FAIL/exit1, exactly the grid/name failures above;141 headlines pass.
- `python3 src/cities/scripts/verify-neighbourhood-sql.py`:PASS, exact rows/source/display fields, identities/references, hierarchy, idempotent migration and no-op redeploy.
- `python3 src/cities/scripts/verify-source-points.py`:PASS.
- `python3 src/cities/scripts/build-reviewed-dataset.py` plus SHA-256 comparison:offline decisions reproduced exactly.

No requested verification suite was skipped. Lead Docker acceptance and resolution of the reported grid/name failures remain outstanding.

Neighbourhood rows by coverage/source (districts remain351 nationally):

| Area | OSM | Curated/source-backed | Wikidata | Total Neighbourhoods |
|---|---:|---:|---:|---:|
| greater-cairo | 1794 | 106 | 10 | 1910 |
| alexandria | 524 | 126 | 19 | 669 |
| port-said-region | 184 | 32 | 3 | 219 |

The compressed `resident-review-audit.json.gz` records every merge/removal/name change; `final-alias-pruning-audit.json.gz` records the final materialization correction. `exact-name-dispositions.json.gz` gives all baseline missing variants, final exact target identities, and unresolved cases. A readable disposition for each newly exposed entry follows; all paths above are under `src/cities/data/neighbourhoods/`.

| Area / checklist entry | Final exact target / outcome |
|---|---|
| greater-cairo / 6th of October | 6th of October (`EG2107`) |
| greater-cairo / Fifth Settlement | Fifth Settlement (`OSM:way/774635278`) |
| greater-cairo / Degla | Degla (`PUPZY:degla-headline`) |
| greater-cairo / Ramses | Ramses (`PUPZY:ramses-area`) |
| greater-cairo / Mostorod | Mostorod (`OSM:node/384309619`) |
| greater-cairo / Mivida | Mivida (`OSM:way/252472309`) |
| greater-cairo / Hyde Park | Hyde Park (`OSM:way/252474635`) |
| greater-cairo / Sodic East | Sodic East (`PUPZY:sodic-east-area`) |
| greater-cairo / Hegaz | Hegaz (`PUPZY:hegaz-area`) |
| greater-cairo / New Zayed | New Zayed (`PUPZY:new-zayed-area`) |
| greater-cairo / El Ashgar | Al-Ashgar Suburb (`OSM:node/670235344`) |
| greater-cairo / Warraq El Arab | Waraq Al Arab (`OSM:way/727511112`) |
| greater-cairo / Kerdasa | Kerdasa (`EG2120`) |
| greater-cairo / Manial Shiha | Manial Shiha (`OSM:node/331168623`) |
| greater-cairo / 15th of May City | 15th of May (`EG0103`) |
| alexandria / Maamoura | Maamoura (`OSM:relation/13601670`) |
| alexandria / Sidi Bishr | Sidi Bishr (`PUPZY:sidi-bishr`) |
| alexandria / Smouha | Smouha (`PUPZY:smouha`) |
| alexandria / Bacos | Bacchus (`OSM:way/749734834`) |
| alexandria / Seyouf | Seyouf (`PUPZY:seyouf-headline`) |
| alexandria / Khorshid | Khorshid (`PUPZY:khorshid-headline`) |
| alexandria / Ghait El Enab | Ghait El Enab (`PUPZY:ghit-enab-area`) |
| alexandria / Wabour El Maya | Wabour Al Meyah (`OSM:way/745355801`) |
| alexandria / El Tabia | Tabia (`PUPZY:tabia-area`) |
| alexandria / Toson | Tousoun (`OSM:way/742223060`) |
| alexandria / Fayrouz | Fayrouz (`OSM:way/267174187`) |
| alexandria / El Zahraa | **UNRESOLVED** |
| alexandria / Kilo 21 | Al Kilo 21 (`OSM:way/746592370`) |
| alexandria / Kilo 26 | Al Kilo 26 (`OSM:way/746652733`) |
| alexandria / Krier | Sidi Kerir (`OSM:node/676395184`) |
| alexandria / Sayala | Sayala (`PUPZY:sayala-alex-area`) |
| alexandria / Wadi El Qamar | Ezbet Wadi al Qamar (`OSM:node/769118972`) |
| alexandria / Al Salam | **UNRESOLVED** |
| port-said-region / El Amal | Amal Nahdet Misr (`OSM:way/751315213`) |
| port-said-region / Arayesheya | New Al Araishyah (`OSM:way/810437370`) |
| port-said-region / El Gharbi | **UNRESOLVED** |
| port-said-region / El Shoaraa | Shat Al Shoaara (`OSM:way/794862513`) |
| port-said-region / El Sayala | El Sayala (`PUPZY:sayala-damietta-area`) |

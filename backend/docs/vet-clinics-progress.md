# Vet Clinics — stage 1 review handoff

163 raw OSM elements → 130 discovery-noise exclusions + 33 candidates → 26 candidate exclusions → 0 merges → **7 clinics: 4 active / 3 inactive-no-phone**. No inactive-imprecise records. Active clinics cover **3/27 governorates**. Stage 1 implementation is ready for lead review; integration execution and the lead's independent checklist remain pending.

Network confirmed first: Overpass status returned HTTP 406, OpenStreetMap HTTP 200. A complete country-wide Overpass query succeeded on overpass-api.de (163 elements, no error remark). The private.coffee attempt timed out after 220 seconds. Requests used PupzyDataReview/1.0. Access timestamp, exact query, raw response and SHA-256 are checked in; UTC fetch date 2026-11-11, local Cairo date 2026-11-12.

No frontend changes, commits, pushes, dependency installation, Railway or production actions. All changes remain uncommitted.

## Files and migrations

- Schema: `src/database/schema/vet-clinics.schema.ts`; `drizzle/migrations/0067_vet_clinic_release_fields.sql` adds is_24_hours, facebook_url, unique source_key/backfill, HTTP(S)/Egyptian phone write constraints, and WEB_RESEARCH via transaction-safe enum replacement. Phone/website constraints are NOT VALID for pre-existing rows to preserve administrator ownership.
- Release: `0068_release_egypt_vet_clinics.sql`, `meta/_journal.json`, `meta/0067_snapshot.json`, `meta/0068_snapshot.json`. Migration slots allocated with drizzle-kit custom generation; snapshots checkpoint current schema using drizzle-kit/api. 0068 inserts absent identities, updates/deactivates only pristine original seed rows, resolves Cities by source_code, uses explicit WGS84 PostGIS points and bumps the existing shared catalog revision only on actual changes.
- Pipeline: `src/vet-clinics/catalog.ts`, `pipeline.ts`, `migration.ts`; `scripts/{egypt-vets.overpass,fetch-osm.ts,build.ts}`.
- Data: `data/{osm-egypt.json.gz,osm-manifest.json,review-metadata.json,reviewed-decisions.json,egypt-vet-clinics.json,baseline-report.json,web-reviewed-clinics.json,README.md}`. Reviews bind to the source hash; the web input is empty for stage 1.
- API: `vet-clinics.graphql`, repository, service/DTO, generated/formatted `src/graphql.ts`; repository/service/resolver specs and existing integration fixtures receive additive fields.
- Admin: enums, existing virtual queue filters and their tests; Vet Clinic resource/mutations and tests. Editing hours/Facebook, active and missing/present-phone filters, needs-phone navigation, protected release identity and transactional activation validation.
- Tests: `catalog.spec.ts`, `data-quality.spec.ts`, `release.integration.spec.ts`.

## Baseline counts

Rejected column counts candidate exclusions; raw rejected includes all query noise. One candidate and four raw rejected elements have no containing governorate and are reported separately, not guessed from names.

| Governorate   | Active | Inactive: no phone | Rejected candidates | Raw rejected |
| ------------- | -----: | -----------------: | ------------------: | -----------: |
| Alexandria    |      0 |                  1 |                   1 |            6 |
| Assiut        |      0 |                  0 |                   0 |            0 |
| Aswan         |      0 |                  0 |                   1 |           41 |
| Behera        |      0 |                  0 |                   0 |            2 |
| Beni Suef     |      0 |                  0 |                   1 |            3 |
| Cairo         |      2 |                  1 |                   3 |           19 |
| Dakahlia      |      0 |                  0 |                   2 |            3 |
| Damietta      |      0 |                  0 |                   0 |            0 |
| Fayoum        |      0 |                  0 |                   0 |            0 |
| Gharbia       |      0 |                  0 |                   0 |            2 |
| Giza          |      0 |                  1 |                   7 |           16 |
| Ismailia      |      0 |                  0 |                   0 |            4 |
| Kafr El-Shikh |      1 |                  0 |                   0 |            1 |
| Kalyoubia     |      0 |                  0 |                   0 |           16 |
| Luxor         |      0 |                  0 |                   1 |            1 |
| Matrouh       |      0 |                  0 |                   1 |            4 |
| Menia         |      0 |                  0 |                   0 |            0 |
| Menoufia      |      0 |                  0 |                   2 |            4 |
| New Valley    |      0 |                  0 |                   0 |            0 |
| North Sinai   |      0 |                  0 |                   0 |            0 |
| Port Said     |      0 |                  0 |                   0 |            0 |
| Qena          |      0 |                  0 |                   0 |            0 |
| Red Sea       |      1 |                  0 |                   0 |            8 |
| Sharkia       |      0 |                  0 |                   2 |           15 |
| South Sinai   |      0 |                  0 |                   1 |            5 |
| Suez          |      0 |                  0 |                   1 |            1 |
| Suhag         |      0 |                  0 |                   1 |            1 |

Top-four target governorates (active / inactive-no-phone / total retained): Cairo **2 / 1 / 3**, Giza **0 / 1 / 1**, Alexandria **0 / 1 / 1**, Port Said **0 / 0 / 0**.

Candidate exclusions by reason:

- faculty-administration: **6**
- government-or-livestock: **8**
- outside-selectable-adm2: **1**
- shop-grooming-or-boarding: **2**
- unrelated-name-match: **5**
- unresolved-government-hospital: **1**
- unresolved-pet-clinic-evidence: **3**

All raw-element exclusions by reason:

- faculty-administration: **6**
- government-or-livestock: **8**
- outside-selectable-adm2: **1**
- pet-shop-without-clinic-evidence: **31**
- road-not-clinic: **48**
- shop-grooming-or-boarding: **2**
- unrelated-name-match: **56**
- unresolved-government-hospital: **1**
- unresolved-pet-clinic-evidence: **3**

The included source nodes are The Ark Veterinary Clinic (Red Sea), Modern Veterinary Clinic (Maadi), Maadi Vet Clinic, German Veterinary Hospital Egypt, Modern Veterinary Clinic / Dr Sameh (Kafr El-Shikh), Tabib Baytari: Magdy Samir and Ultra Vet Care. No 24-hour status is inferred from an emergency tag. One retained clinic has an additional valid phone in the report; only the first is migrated. Malformed +010… is explicitly rejected rather than repaired by guessing.

## Gates and commands

| Check                                                                        | Result                                                                                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Complete source/hash/query and exactly one review per raw element            | Pass                                                                                                                    |
| Record schema and decided fields                                             | Pass                                                                                                                    |
| Excluded-category rules and explicit review list                             | Pass                                                                                                                    |
| Original ADM2/Egypt/governorate containment and City assignment              | Pass                                                                                                                    |
| Active implies phone, street/building precision, source URL                  | Pass                                                                                                                    |
| Exact source coordinates, dated provenance, bilingual names/origins          | Pass                                                                                                                    |
| Duplicate phones (including extras), normalized nearby names, OSM identities | Pass                                                                                                                    |
| No Google Maps source URLs; canonical URLs and cleaned names                 | Pass                                                                                                                    |
| Dataset/report and migration regeneration match                              | Pass                                                                                                                    |
| Independent checklist >=90%                                                  | Explicitly skipped: lead-owned file absent; not created                                                                 |
| >=1 active clinic in all 27 governorates                                     | Reported 3/27; enforcement deferred to stage 3 with VET_CLINICS_FINAL=1                                                 |
| `npm run lint`                                                               | Pass                                                                                                                    |
| `npm run build`                                                              | Pass                                                                                                                    |
| `npm run test:unit -- --runInBand`                                           | 103 suites, 1,301 tests pass; one requested checklist skip                                                              |
| `cd admin-service && npm test`                                               | 426 tests pass                                                                                                          |
| `npx jest src/vet-clinics/data-quality.spec.ts --runInBand`                  | 6 pass, one requested checklist skip                                                                                    |
| Changed TypeScript/JS/JSON/Markdown Prettier check                           | Pass                                                                                                                    |
| `git diff --check`                                                           | Pass                                                                                                                    |
| `npx tsc --noEmit --pretty false`                                            | Fails on 157 existing test-fixture diagnostics; clean HEAD baseline in /tmp has 158, no new file/error-code diagnostics |

Existing full-typecheck errors include outdated constructor mocks, old Comment/Post fixtures, database helper typing and Cache.reset mocks. Production compilation passes. No unrelated files or gates were changed to suppress those errors. Early glossary and Alexandria landline-test failures were corrected and rerun successfully.

Integration specs written but NOT run (Docker unavailable):

- `src/vet-clinics/release.integration.spec.ts`: empty DB through production migrator; immediate WEB_RESEARCH insert in the next pending file in the same batch; source-key backfill, existing OSM identity collision preservation, pristine seed normalization/deactivation versus administrator-edited rows, source-code City resolution, geography and contact mapping, rerun timestamps/revision no-op, unique key and phone/HTTP(S) constraints.
- Existing `src/vet-clinics/vet-clinics.integration.spec.ts`: additive DTO fixtures updated. Run this with the new release spec. Existing `src/database/migrate.integration.spec.ts` and `src/cities/neighbourhoods.integration.spec.ts` remain relevant full-migration regressions for the lead's Docker run.

## Decisions for the lead / remaining stages

- Drizzle 0.45 wraps ALL pending migrations in one transaction. Separate ADD VALUE and data files alone are insufficient. 0067 recreates the enum preserving prior labels plus WEB_RESEARCH; 0068 contains the data. The new integration fixture would fail on unsafe ADD VALUE use. See the linked PostgreSQL rule in data/README.md.
- NOT VALID phone/website checks are necessary to reconcile strict new-write constraints with the prohibition on rewriting administrator-owned historical invalid values. No current invalid values are silently repaired. Existing data becomes valid only via an allowed pristine update or an administrator edit.
- Pristine matching includes every seed-written value, original geometry bytes, City, unchanged timestamps, location provenance, null capture timestamp/new fields, and no location audit. Original City resolution is pinned to the district seed and old cache/KNN rules; uncertain historical assignments fail closed. Consequently a historical row seeded against some other catalog may remain untouched even if it was never edited.
- Use original OCHA polygons, including their real gaps. The Ark Animal Clinic Cairo source point is outside every original ADM2 and governorate polygon and is listed rather than nudged into a district. Points inside nonselectable Zemam Out also fail closed. Stage 2 must obtain a real sourced point/geocode response if correcting such a record.
- ACE, Pet welfare center and Al-Murabit are held for evidence that these locations treat pets as qualifying clinics; Abbassia hospital is held for ownership evidence. No claims that these places are permanently ineligible. Review their exact OSM tags and primary web sources in stage 2.
- Node precision is recorded as OSM street-level, not independently surveyed or business-verified. Data freshness/phone reachability depend on upstream contributors. The sparse OSM baseline is not national completeness: 24 governorates still lack active clinics.
- New manual clinics without phones default inactive; explicit activation needs a valid E.164 phone. Release source_key cannot be edited in AdminJS.
- Stage 2 can add fully sourced WEB_RESEARCH records to web-reviewed-clinics.json; keep raw/geocode responses and access metadata offline, mark authored/transliterated fields, and retain stable WEB identities. Shared City assignment, deduplication, quality gates and SQL generation already handle the combined input. Research Cairo/Giza/Alexandria/Port Said, then fill remaining governorates for stage 3 and add the independent lead checklist.
- This stage 1–3 build rewrites only the uncommitted 0068 first-release migration. Future published refreshes must allocate a new migration and use the generator default, INSERT only (`firstRelease` false).

## Stage 2 checkpoint — 2026-11-12

Part A implemented first: schema plus escape and both original snapshots repaired; rendered check SQL regression passes against 0067; `drizzle-kit generate` reports no changes. Admin mutation normalization now accepts Egyptian local/digit/spacing/international formats with one shared JSON fixture tested in both packages (24 admin cases, backend normalization cases). Generic clinic/hospital descriptors translated in stage-1 names; origins remain transliterated for mixed translation/transliteration. Facebook/hours SDL comments added. Dataset regenerated and quality spec passes. Part B and governorate research follow.

### Decisions for the lead (stage 2)

- Owner decision dated 2026-11-12 extends ADR-0004: researched area locations use a text search Maps handoff; administrator map edits still require a Mapped Location. No frontend edits authorized here.
- Reserve retired slot 0068; new precision schema will be 0069, regenerated first release 0070, ordered in the journal. Nothing deployed.

Part B checkpoint: 0069 adds NOT NULL `location_precision` with street default/check; 0070 is the renumbered first release (0068 retired, snapshot relocated with corrected regex). Exact OSM locations now follow the owner's definition. Admin creates/map changes set exact; contact-only edits preserve the imported precision. Repository reads governorate names from the catalog; area Maps searches prefer Arabic and omit null parts. Additive `isApproximateLocation` is documented and tested through service/resolver. Area gates require the exact selected catalog centre and the matched City name/alias in the address; no offsets. No Nominatim requests made so far.

- Explicit branches with different documented qualifiers in one chain remain separate even when reception phones/pages are shared. All other shared-phone duplicates still merge; same-area names/pages are also deduped.
- An undated current directory page has `lastSeenActive: null`; access date is never presented as dated operation evidence. Old single-source dated evidence before 2022 is inactive `stale-evidence`.
- Targeted backend tests pass (76 tests + independent-checklist skip). Production build passes. Initial admin full run found one old expectation that local numbers were rejected; updated it to test malformed input and local-format acceptance under the new requirement. Full admin rerun pending.

Alexandria first imported checkpoint: 22 reviewed web candidates → 1 unresolved catalog area (Winget) → 21 imported, plus the pre-existing OSM record. Build/release regenerated; quality spec passes. Research continues with central/east and west searches. Source-specific blocked access and address conflicts are in `docs/vet-clinics-research.md`.

Checks checkpoint: admin-service **450/450 pass**. First full backend run **103 suites pass / 1 fails** solely because repository journal gate requires contiguous journal indices. Fixed: journal indices 68/69 now point to migration tags **0069/0070**; filenames retain retired 0068 gap, indices do not. Rerun pending. This is a journal convention correction, not a weakened gate.

Migration follow-up after inspecting installed Drizzle generator: it chooses the next filename from last journal idx+1, so skipping filename0068 with compressed indices would overwrite snapshot0070 on a future real schema change. Keep original0068 as an explicit no-op reserved slot (SELECT1, repaired snapshot);0069 is precision,0070 is data, and both filenames/indices now align. This preserves both repository journal gate and future generation. Original0068 release payload is fully moved to0070; nothing deployed. Supersedes earlier note that0068 was absent.

Full backend rerun: **104 suites /1323 tests pass**, one lead-checklist skip. Production build and450 admin tests passed. Formatting/lint follow-up remains necessary after subsequent research merges.

Alexandria released checkpoint before Cairo: **115 authored web candidates →4 unresolved catalog areas →111 imported →2 duplicate merges →109 active web clinics**, plus1 existing OSM clinic inactive-no-phone. Precision109area/1exact/0street;8explicit24-hour entries. Full source/holds accounting and individual citations are in research notes; deterministic10-clinic sample in `docs/vet-clinics-stage2-report.md`. No claim that the market enumeration is exhaustive. Final pass included Dalili57-entry discovery category and Welpstar13working pages (later pagesHTTP500), own clinic sites and other entry-specific directories. Main/extra research notes distinguish blocked requests from read evidence. Cairo now underway, east/new-city and central/south/north separately reviewed.

Alexandria location follow-up: resolved Bacous spelling against the **Arabic address باكوس**, which exactly matches catalog City Bacchus `OSM:way/749734834`; two records are now included with that explicit City identity. Final current Alex **115 authored →2 unresolved locations (Winget,Shalalat) →113 imported →2 merges →111 active +1 inactive-no-phone OSM**. Precision111area/1exact;8explicit24h. Gate/release regenerated and pass. Earlier109 count superseded. No coordinates were inferred from spelling or moved; only the catalog City explicitly named in the Arabic address was selected.

Full typecheck measured against clean committed baseline in /tmp: **157 diagnostics in each**, no added file/error-code diagnostics. Existing Cache.reset mocks and unrelated fixtures account for failures; build passes. Lead should run changed integration specs `src/vet-clinics/release.integration.spec.ts` and `vet-clinics.integration.spec.ts`, plus existing database/migrate and cities/neighbourhoods full-migration regressions. Docker is unavailable here; no integration run attempted.

Alexandria address specificity audit: DoctorVetAmreya moved from district centre to named AlZeraaAlBahary City; FluffyPets and TheCity to named AbouAlNawatir; HealthyPets to named EzbetSaad. Exact catalog centres, same sourced addresses. SportingBuilding text is a building name and does not establish Sporting neighbourhood; retain its explicit SidiGaber district match. Counts unchanged; quality spec passes after regeneration.

Latest complete checks after A/B: production build passes; full backend104suites/1322tests pass (one checklist skip); admin449tests pass. Counts decreased by1 in each after removing the plural-phone input from the shared _single-phone_ parity fixture; pipeline's separate multiple-phone extraction test remains. Typecheck157existing diagnostics, matching157baseline. No dependencies installed. Lint passes; final formatting and data-only checkpoints still required as research progresses.

## Stage 2 resumed after lead checkpoint 4c40813 — 2026-11-12

Lead corrections supersede the migration reservation notes above: **0067 now includes location_precision; 0068 is the generated release; 0069/0070 and snapshots deleted; journal ends at68**. Both67/68snapshots carry precision and phone escape. `npx drizzle-kit generate` reports no schema changes; no probe created.

Added bilingual source-name aliases to research/import/schema/merge inputs and checklist normalization (generic descriptors removed, pets retained, exactly one trailing branch qualifier removed, aliases accepted); unit coverage includes both scripts, wrong brand/governorate/inactive negatives and hyphenated brand preservation. A shared-phone gate now runs **before** deduplication with explicit evidence decisions; Victoria/Riyada's four shared contacts are reviewed as the two Dr.EhabSaad branches explicitly published together. ElHorreya Ibrahimia now qualified and Freedom Veterinary Clinics retained as alias. Monem display corrected, Men3am alias retained; PetsHaven own published clinic name restored. Bacos/Bacchus and AlexPetVeterinaryCenter aliases recorded with the matching individual source.

Lead gaps: AlQadi and Alivi were existing records under ElQady/Aleefy spellings; aliases and matching English entries added. Kashif added; Wessam SidiBishr branch added and existing WesamMandara identity retained with Wessam aliases. GreenForAnimals held for current pet-service/contact evidence (only YellowPages category lead; block respected). ElMorshedy SidiBishr is held: same exact address/landline as Wessam listing, ownership cannot be established. See `research-alexandria-review-holds.json`.

`geocoding.ts` plus serial `scripts/geocode-research.ts` record every Arabic/English Nominatim request with PupzyDataReview/1.0, >=1.1s between request starts, raw/error bodies cached. Road/building classification, normalized exact street-name agreement and original catalog district polygon containment required for street; otherwise area retained. Geocoding underway; do not run importer concurrently with geocoder's final web-reviewed write. Importer replays caches offline. Geocoder acceptance tests and updated matcher/schema tests pass (42tests before final hyphen case added). Full checks pending research integration.

Research skill explicitly delegates Cairo/Giza/PortSaid to independent agents with disjoint input/evidence/note files. Cairo83existing inputs plus133individual EVC leads being reviewed; Giza81authored and more in progress; PortSaid12retained(9phone/3no-phone),20lead accounting, complete input/ledger/notes ready. No shared generated imports from these agents. Parent handles serial governorate import/geocode/build/quality checkpoints. All changes remain uncommitted; no frontend/production/install/commit/push actions.

Alexandria corrected checkpoint (before independent enrichment): source aliases/holds integrated, **113retained =112active/1no-phone; precision1exact/6street/106area;23multi-domain clinic sources/14dated**. Arabic+English cached Nominatim attempts for all imported street addresses; no fabricated points. Dataset +0068 regenerated and data-quality8pass/1lead-checklistskip. Previously imported44Cairo partial records temporarily left in authored input staging while completing Alex checkpoint; Cairo full import next. Green hold resolved by individually read BizMidEast pet-surgery hospital entry +WSlny identity match; olderRoushdy address/2021update explicitly recorded, no invented second branch. Additional Alex enrichment underway; final counts will supersede these.

Checks on resumed implementation: lint pass; productionbuild pass; admin449/449pass; targetedmatcher/geocoder/schema43pass. Fulltypecheck157diagnostics, same157 baseline `/tmp/vets-baseline-tsc.log`, no additional file/error-code diagnostics. Docker still unavailable; integration run remains lead-owned.

## Stage 2 serial continuation after 36543a1 — 2026-11-12

### Stop point A — Alexandria consistent

Finished the interrupted Arabic/English Nominatim refresh using cached responses, `PupzyDataReview/1.0` and serial requests at least 1.1 seconds apart. Reimporting from the reviewed addresses cleared a superseded street point; no quality gate was weakened. Regenerated the dataset, baseline report and **0068**. The complete vet-clinics non-integration suite passes: **7 suites, 91 tests, 1 lead-checklist skip**.

Final Alexandria: **113 authored candidates → 2 unresolved catalog areas (Winget, Shalalat) → 111 imported → 1 duplicate merge, plus 1 existing OSM record → 111 retained: 110 active / 1 inactive (`no-phone`)**. Precision **1 exact / 5 street / 105 area**; **7 explicit 24-hour** clinics; **42/111 multi-domain clinic sources**, **38/111 dated evidence**. Geocoder URLs are excluded from corroboration counts; mirrors are not independent operational witnesses. These counts supersede earlier Alexandria checkpoints. The remaining holds and evidence limitations are in the research notes/ledger. All work remains uncommitted; no agents, installs, frontend, production, commit or push actions.

### Stop point B — Port Said consistent

Reviewed the prepared individual-entry evidence, closure/ownership holds and branch decisions. **20 discovery candidates → 4 excluded (1 closure, 2 government units, 1 manufacturer) + 2 held for pet-treatment evidence + 2 historical/page identity merges → 12 imported/retained: 9 active / 3 inactive (`no-phone`)**. Sama also has stale single-source evidence from 2018; no-phone remains its primary inactive reason. All **12 area / 0 street / 0 exact**, after the required cached Arabic/English street attempts; **1 explicit 24-hour emergency clinic**, **8/12 multi-domain sources**, **10/12 dated**. Sources support fewer than the expected dozen active clinics; the source reach and exclusions are documented in `vet-clinics-research-port-said.md`, with no unsupported quota filling. Only nine active clinics exist for the report sample.

Dataset, baseline report and **0068 regenerated**; vet-clinics suite **7 suites / 91 tests pass, 1 checklist skip**. Alexandria remains green and unchanged. Next: Cairo's 193 prepared candidates, including its unresolved catalog area.

### Stop point C — Cairo consistent

**193 authored candidates → 1 unresolved catalog area (Flamingo, El Malek El Saleh) → 192 imported**, plus 3 OSM records, no further release merges: **195 retained, 183 active / 12 inactive (3 no-phone, 9 stale-evidence)**. Alf Maskan was already resolved in the prepared inputs; the old partial import report was superseded. Applied the four optional source corroborations from their cached individual-page text. Required Arabic/English street attempts completed serially with checked-in responses. Precision **3 exact / 24 street / 168 area**; **20 explicit 24-hour**; **26/195 multi-domain**, **24/195 dated**. Held/excluded discovery decisions (19), attached source identities (14), and source limitations remain in the Cairo ledger/notes; those discovery decisions are separate from the 193 authored denominator.

Cairo exposed an origin bug when repeated-brand qualification changes an OSM source name: qualification now marks a changed `source` name `authored`, retains its original alias, and leaves existing transliteration provenance intact. Added a regression assertion (observed red before fix); the quality gate checks branch-only changes explicitly rather than calling them transliterations. Dataset, baseline report and **0068 regenerated**; complete vet-clinics suite **7 suites / 91 tests pass, 1 checklist skip**. Report generator also recognizes both evidence snapshot HTTP-status field spellings. Next: Giza.

### Stop point D — Giza and combined release consistent

**115 authored → 115 imported**, no catalog exclusions or release merges; plus 1 OSM record: **116 retained, 112 active / 4 inactive (`no-phone`)**. Precision **1 exact / 6 street / 109 area**; **16 explicit 24-hour**, **18/116 multi-domain**, **18/116 dated**. Arabic/English street attempts cached serially. The 50 non-import discovery decisions now have explicit reason codes: **26 excluded / 8 source-identity consolidations / 16 held**; detailed reasons remain intact in the ledger.

Combined-input phone review found five conflicts spanning Cairo/Giza. Withheld disputed contacts from nine records; primary inactive reason is no-phone where no other number survives. Pawia's own current page takes priority over Prime Shorouk's conflicting directory contact; the latter retains its other number. Similar Pets Choice names are insufficient to infer simultaneous branches, so each retains only its distinct number. Evidence and all withheld numbers are in `research-shared-phone-holds.json`. **Final Cairo now supersedes stop C: 181 active / 14 inactive (5 no-phone, 9 stale-evidence), 195 retained**; other Cairo precision/24h/multi-domain/dated counts unchanged.

Preserved Happy Pets Nasr City/Mohandessin as the two explicitly doctor-named/addressed listings with identical three contacts and Facebook identity. New York's own contact page explicitly lists Maadi and October; added it to October and preserved both documented branches. No unsupported shared-phone exception added. Final cross-source release merges remain **1 Alexandria identity**, not cross-governorate branch collapses.

Dataset, baseline report and **0068 regenerated**; complete vet-clinics suite **7 suites / 91 tests pass, 1 checklist skip**. All four stop points reached serially without agents. Final full checks and validation/report footer follow.

### Stage 2 final checks and report complete

Final release: **436 retained = 414 active / 22 inactive nationally**, with active coverage **6/27 governorates**. The four researched governorates contain **434 retained = 412 active / 22 inactive**. Final per-governorate figures are in stop A, stop B and stop D (stop D supersedes Cairo stop C).

- Lint passes. Fixed the geocoder's unsafe JSON-array assignment with an explicit response-boundary type; final changed TypeScript files also pass targeted lint.
- Production build passes. Full backend **105 suites / 1,337 tests pass**, one lead-checklist skip. Admin **449 tests pass**.
- Final vet-clinics suite after formatting/regeneration: **7 suites / 91 tests pass**, one checklist skip. Dataset, baseline report and **0068** regenerate byte-for-byte, verified by SHA-256 before/after rebuilding.
- `drizzle-kit generate`: **no schema changes**, no probe created; journal still ends at **68**.
- Standalone typecheck: **157 existing diagnostics**, exactly matching a clean **36543a1** archive at `/tmp/vets-stage2-typecheck-baseline/backend`; no added file/error-code multiplicities. Logs: `/tmp/vets-final-tsc.log`, `/tmp/vets-final-baseline-tsc.log`.
- Changed/new backend files formatted; `git diff --check` passes. Full logs are `/tmp/vets-final-{lint,build,unit,admin,clinics,drizzle,format}.log`.
- Integration specs remain unrun here (Docker unavailable); lead handoff names all four suites in the report. Independent checklist remains lead-owned and absent; final all-governorate enforcement remains stage 3 work.

`docs/vet-clinics-stage2-report.md` contains counts first, source-site consultation/retained-page counts, discovery/import/exclusion/merge accounting, precision, multi-domain/dated counts, and deterministic active samples (10 each, all 9 for Port Said). Its validation/decisions footer is maintained in `docs/vet-clinics-stage2-validation.md` and included by the report generator. Cross-governorate contact holds are reproducible from `data/research-shared-phone-holds.json`. No further stage 2 work remains in this brief; stage 3 is not started. All changes remain uncommitted on top of **36543a1**. No agents, commits, pushes, installs, frontend or production actions.

## Lead review fixes after e1b2a47 — stop point E (2026-11-12)

**440 retained = 419 active / 21 inactive nationally; independent checklist 80/83 = 96.4%, gate passes at the unchanged ≥90% threshold. Active coverage remains 6/27.** The checklist is byte-for-byte unchanged from the lead checkpoint. This supersedes the stage 2 counts above; stage 3 is not started.

E1–E8 complete. The matcher reads the lead's document wrapper/nullable names and accepts `accept[]`, ampersand/and and compact-space alternatives, with regression tests. Five individually researched additions: Pets Bay (Agouza), Animalista (6 October), Cat and Dog (Hadayek El Ahram), Pet Cure (Zayed, with the official-branch-list caveat below), Royal (Louran). Pets Care Nasr City reactivated from dated 2025-10-31 treatment evidence. Island is evidenced as a former name of existing Sheraton; no duplicate clinic added. New Sphinx Best For Pets excluded as `part-time-satellite-in-shop`; its URL remains on Best 4 Pets because it explicitly describes the main clinic too.

All ten checklist investigations, searches and dated evidence decisions are in `data/research-stage2-e-ledger.json`; the rejected satellite's complete input is archived in `data/research-stage2-e-exclusions.json`. Three remaining misses: **6th Of October Center For Veterinary Services** (pet treatment unestablished); **عيادة الشروق البيطرية, Mohandessin** (sourced Giza namesake is Ayat; qualifying locality/contact unestablished); **Portfouad Veterinary Clinic** (same number as current Modern branch, without proof of former-name identity). No closure or nonexistence claim inferred; no speculative alias added.

Geocoder URLs removed from clinic sources; provenance/cache retained and gated separately. Arabic address commas normalized/gated. Branch display names now use one bilingual spelling across the entire dataset and the selected catalog City names; source spellings retained as aliases. American Giza, New York, Vital Pets and Pets Mall Dokki corrected. Authored Arabic descriptors translated once, preserving documented source-origin base spellings. Royal Helwan's two pre-existing listings publish distinct streets and disjoint contacts; `distinct-address-decisions.json` explicitly preserves that separation when normalized City-level display names collide. This applies only to the name/proximity heuristic, never phone/website/OSM identities; unit and dataset gates cover it.

Serial Arabic/English Nominatim refreshes cached every result/error. Fixed query drift: queries use the authored address City, rather than a nearby City assigned by an earlier street result. Archived responses can be replayed only after matching the current street and district, with the exact response file recorded. All 35 previously accepted street points survive; three additional archived responses pass the same tests. Final national precision **7 exact / 38 street / 395 area**. No coordinates invented. Importing all four governorates again and rebuilding reproduces the dataset, baseline report and **0068** offline.

| Governorate | Active | Inactive: no phone / stale | Exact / street / area | Explicit 24h |
| ----------- | -----: | -------------------------- | --------------------- | -----------: |
| Alexandria  |    111 | 1 / 0                      | 1 / 6 / 105           |            7 |
| Cairo       |    182 | 5 / 8                      | 3 / 26 / 166          |           20 |
| Giza        |    115 | 4 / 0                      | 1 / 6 / 112           |           16 |
| Port Said   |      9 | 3 / 0                      | 0 / 0 / 12            |            1 |

Checks: complete vet-clinics suite **7 suites / 104 tests pass, no skips**; full backend **105 suites / 1,350 tests pass, no skips**; lint and production build pass; admin **449/449 pass**; Drizzle reports **no schema changes**, journal still ends at 68; changed backend files formatted; `git diff --check` passes; offline regeneration verified. Logs `/tmp/vets-e-*.log`. Lead already verified the stage 2 Docker integrations **30/30**; not rerun here. No schema/API/admin changes in E.

Full evidence table, all five addition spot-checks, gate changes and weaknesses: `docs/vet-clinics-stage2-review-fixes.md`. Pet Cure Zayed is absent from the current official branch list; two current individual directory entries corroborate treatment/address/phone under the existing multi-source rule, while its newest exact dated Zayed evidence remains 2020-08-09. Current first-party operation unconfirmed, not silently represented as recent. Royal Louran's malformed printed mobile rejected; valid landline retained. Directory update dates are explicitly distinguished from clinic activity and mirror sites are not independent witnesses.

**Stop point E is consistent and ready for lead checkpoint. Next: F1 — Kalyoubia, Sharkia, Dakahlia, Gharbia, Menoufia, Behera. F1–F4, the default all-governorate release gate and the stage 3 report remain pending.** All work serial in one agent; no agents, installs, frontend, production, commit or push actions. All E changes remain uncommitted on top of `e1b2a47`.

## Stop point E2 — 2026-11-12, after lead checkpoint 4616c81

**440 retained = 418 active / 22 inactive; checklist 79/83 (95.2%); coverage 6/27.** Pet Cure Sheikh Zayed retained with all evidence/contacts, inactive `unconfirmed-branch` by lead decision (official branch list omits Zayed, newest dated evidence 2020). Import input carries this override, so rebuilding cannot reactivate it. Admin has no inactive-reason list, so no admin text change needed.

Catalog subarea qualifiers now flatten to `(Sheikh Zayed, 7th District)` and the equivalent Arabic punctuation/order. Schema gates reject nested display-name parentheses and aliases containing the other script. Mixed source aliases were split into their Arabic/English parts in authored inputs; unsplit source titles/URLs remain archived in `research-stage2-e2-alias-originals.json`. Descriptor-only fragments discarded, no invented translated alias. Sources and names themselves retained. Added regression tests; complete vet-clinics suite **7 suites / 105 tests pass, no skips**. Four stage-2 imports, dataset, baseline and **0068** regenerated offline. No schema migration change. Stop E2 consistent; proceeding F1 serially.

## Stop point F1 — 2026-11-12

Kalyoubia: 2 active / 0 inactive, {'area': 2}; Sharkia: 3 active / 0 inactive, {'area': 3}; Dakahlia: 2 active / 0 inactive, {'area': 2}; Gharbia: 2 active / 0 inactive, {'area': 2}; Menoufia: 2 active / 0 inactive, {'area': 2}; Behera: 2 active / 0 inactive, {'area': 2}.

Dataset, baseline and **0068** regenerated; complete vet-clinics suite **7 suites / 105 tests pass**. Individual source snapshots are `web-evidence/stage3-*`; per-governorate inputs/import reports and stage3 ledgers record searches, evidence, holds, counts and limitations. Arabic/English street queries cached serially at >=1.1 seconds/request; no unsupported point accepted. All changes uncommitted, one agent, no frontend/production/install/commit/push actions.

## Stop point F2 — 2026-11-12

Ismailia: 2 active / 0 inactive, {'street': 1, 'area': 1}; Suez: 1 active / 0 inactive, {'area': 1}; Damietta: 1 active / 0 inactive, {'area': 1}; Kafr El-Shikh: 2 active / 0 inactive, {'exact': 1, 'area': 1}; Fayoum: 1 active / 0 inactive, {'area': 1}; Beni Suef: 1 active / 1 inactive, {'area': 2}.

Dataset, baseline and **0068** regenerated; complete vet-clinics suite **7 suites / 105 tests pass**. Individual source snapshots are `web-evidence/stage3-*`; per-governorate inputs/import reports and stage3 ledgers record searches, evidence, holds, counts and limitations. Arabic/English street queries cached serially at >=1.1 seconds/request; no unsupported point accepted. All changes uncommitted, one agent, no frontend/production/install/commit/push actions.

## Stop point F3 — 2026-11-12

Menia: 1 active / 0 inactive, {'area': 1}; Assiut: 1 active / 0 inactive, {'area': 1}; Suhag: 1 active / 0 inactive, {'area': 1}; Qena: 1 active / 0 inactive, {'area': 1}; Luxor: 1 active / 0 inactive, {'area': 1}; Aswan: 1 active / 0 inactive, {'area': 1}.

Dataset, baseline and **0068** regenerated; complete vet-clinics suite **7 suites / 105 tests pass**. Individual source snapshots are `web-evidence/stage3-*`; per-governorate inputs/import reports and stage3 ledgers record searches, evidence, holds, counts and limitations. Arabic/English street queries cached serially at >=1.1 seconds/request; no unsupported point accepted. All changes uncommitted, one agent, no frontend/production/install/commit/push actions.

## Stop point F4 — 2026-11-12

Red Sea: 2 active / 0 inactive, {'exact': 1, 'area': 1}; Matrouh: 1 active / 0 inactive, {'area': 1}; South Sinai: 2 active / 0 inactive, {'area': 2}; North Sinai: 2 active / 0 inactive, {'area': 2}; New Valley: 0 active / 0 inactive, {}.

Dataset, baseline and **0068** regenerated; complete vet-clinics suite **7 suites / 105 tests pass**. Individual source snapshots are `web-evidence/stage3-*`; per-governorate inputs/import reports and stage3 ledgers record searches, evidence, holds, counts and limitations. Arabic/English street queries cached serially at >=1.1 seconds/request; no unsupported point accepted. All changes uncommitted, one agent, no frontend/production/install/commit/push actions.

## Part G checks — 2026-11-12, release blocked

**473 retained = 450 active / 23 inactive; coverage 26/27; checklist 79/83 = 95.2%.** Inactive: **14 no-phone / 8 stale-evidence / 1 unconfirmed-branch**. Precision **7 exact / 39 street / 427 area**; **44 explicit 24-hour**. Stage 3 has **34 authored inputs, 34 imports, 1 merge into the existing Hurghada Ark OSM identity → 33 additional retained (32 active / 1 no-phone)** relative to E2. Checklist is byte-identical to lead checkpoint `4616c81`.

The final all-governorate gate is now **mandatory by default, with no opt-out**. It fails **only for New Valley**. Nine focused search patterns plus individually read Kharga/Dakhla/Farafra leads found government pet treatment, government units, generic private-clinic entries without pet evidence/contact, and university faculty documents without a public pet hospital. No sourceable qualifying clinic found in this pass; not a nonexistence claim. Do not release or weaken the gate to fill this gap.

Checks: lint and production build pass; admin **449/449 pass**; full backend **104 suites / 1,350 tests pass, 1 coverage test fails** (105 suites / 1,351 tests total); data quality **12 pass / 1 fails**, same New Valley gate. Drizzle reports **no schema changes**, no probe generated, journal ends at 68. Full formatter flags **318 pre-existing JSON snapshots, all byte-identical to HEAD**, no incidental rewrites; changed-file formatting separately passes after the progress-note format correction. `git diff --check` passes. Full logs `/tmp/vets-g-*.log`, command results `/tmp/vets-g-results.json`, baseline formatting proof `/tmp/vets-g-format-baseline.json`.

`docs/vet-clinics-stage3-report.md` contains the per-governorate table, ledgers, all available active spot-check records, remaining checklist misses, commands/results and decisions. **Stage 3 remains incomplete:** large-city breadth is sparse and every stage-3 governorate has fewer than the requested five active sample records. All available records are shown without inventing sample entries or claiming market exhaustion. Additional city research and the New Valley evidence gap remain for release acceptance. F1–F4 are consistent research checkpoints, not a declaration that these broader goals are achieved.

No integration specs changed; Docker integrations not rerun (lead previously verified stage-2 30/30). No database-schema/API/admin changes. All changes remain uncommitted on `feat/vet-clinics` after `4616c81`; no agents, installs, frontend edits, production actions, commits or pushes.

## Stop point D1 — 2026-11-12, continued after 3001d35

**516 retained = 490 active / 26 inactive.** Dataset, baseline and **0068 regenerated**; complete vet-clinics suite **8 suites / 109 tests pass**. This first restored the checkpoint to 473 retained with only the expected New Valley coverage failure, then imported the reviewed partial D1 inputs and finished city/category candidate review.

Dakahlia: 12 active / 0 inactive; precision {'area': 12}.

Sharkia: 7 active / 0 inactive; precision {'area': 7}.

Gharbia: 10 active / 1 inactive; precision {'area': 11}.

Kalyoubia: 8 active / 0 inactive; precision {'area': 8}.

Menoufia: 3 active / 1 inactive; precision {'area': 4}.

Behera: 13 active / 1 inactive; precision {'area': 14}.

City entry decisions/pages/snapshots and explicit holds are in `depth-D1-{discovery,decisions}.json` and each governorate stage3 ledger’s `depthPass`. Elzera’s own page identifies Mahalla, not Tanta; الزراعة is the square, not an attested Arabic brand. Display إلزيرا is a marked transliteration. No Google pins used.

Owner decision (2026-11-12): `coverage-exceptions.json` lists only New Valley with owner/date/reason/ledger. Coverage fails for every unexcepted gap and for an obsolete exception when active data arrives; four regression tests pass. Decision linked in New Valley ledger. Existing global distance queries preserve nearest clinics for New Valley users; no New Valley clinic data changed. All work serial in one agent; no commits, pushes, frontend, production or installs. D2 follows.

## Stop point FX — 2026-11-12, after bfbcafe

**523 retained = 497 active / 26 inactive.** Dataset, baseline and 0068 regenerated; complete vet-clinics suite **8 suites / 112 tests pass, no skips**. New Valley owner exception remains unchanged.

Nationwide fixes: administrative unit qualifiers replaced by bilingual human city names, neighbourhood numbers preserved, British Abo El Feda branches distinguished by sourced street; trailing catalog address segments removed in authored inputs; English display casing normalized with source spellings retained as aliases and deliberate mixed-case/short acronym styling preserved. Schema gates reject administrative qualifiers, malformed casing and post-governorate address segments; three regression tests plus nationwide dataset enforcement. Area provenance accepts the derived human City label while retaining reviewed citySourceCode and exact catalog centre.

Added Zoo Planet Zagazig (Gawish Hospital Street, Qism 2), Pet Espitalia Tanta (Sedky at El Helw), and Aleet Nozha from multi-branch pages; both branches qualified. Registry `depth-multibranch-review.json` records other branches/holds, relocations and nonliteral mentions. Four already-authored D2 entries from the checkpoint were imported consistently; the 12 D2 decisions remain unchanged. Logs/helpers live under ignored `backend/.tmp/vets-depth/` during execution. No commits, pushes, frontend, production, installs or sub-agents. FX consistent; resume D2.

## Stop point D2 — 2026-11-12

**535 retained = 507 active / 28 inactive.** Dataset, baseline and 0068 regenerated. Complete vet-clinics suite **8 suites / 112 tests pass, no skips**. New Valley owner exception unchanged.

Ismailia: 4 active / 0 inactive; precision {'street': 2, 'area': 2}.

Suez: 3 active / 0 inactive; precision {'area': 3}.

Damietta: 5 active / 1 inactive; precision {'area': 6}.

Kafr El-Shikh: 5 active / 1 inactive; precision {'exact': 1, 'area': 5}.

Fayoum: 3 active / 0 inactive; precision {'area': 3}.

Beni Suef: 2 active / 1 inactive; precision {'area': 3}.

City pages, every discovery disposition, individually read evidence snapshots and unresolved holds recorded in depth-D2-discovery.json, depth-D2-decisions.json and governorate ledgers. Directory mirrors are not independent witnesses; current retail/advice posts are not silently used as clinical case dates. One agent, serial work; no commit/push/install/frontend/production actions.

## Stop point D3 — 2026-11-12

**544 retained = 516 active / 28 inactive.** Dataset, baseline and 0068 regenerated. Complete vet-clinics suite **8 suites / 112 tests pass, no skips**. New Valley owner exception unchanged.

Menia: 1 active / 0 inactive; precision {'area': 1}.

Assiut: 5 active / 0 inactive; precision {'area': 5}.

Suhag: 3 active / 0 inactive; precision {'area': 3}.

Qena: 3 active / 0 inactive; precision {'area': 3}.

Luxor: 1 active / 0 inactive; precision {'area': 1}.

Aswan: 2 active / 0 inactive; precision {'area': 2}.

City pages, every discovery disposition, individually read evidence snapshots and unresolved holds recorded in depth-D3-discovery.json, depth-D3-decisions.json and governorate ledgers. Directory mirrors are not independent witnesses; current retail/advice posts are not silently used as clinical case dates. One agent, serial work; no commit/push/install/frontend/production actions.

## Stop point D4 — 2026-11-12

**551 retained = 522 active / 29 inactive.** Dataset, baseline and 0068 regenerated. Complete vet-clinics suite **8 suites / 114 tests pass, no skips**. New Valley owner exception unchanged.

Red Sea: 5 active / 0 inactive; precision {'exact': 1, 'area': 4}.

South Sinai: 3 active / 1 inactive; precision {'area': 4}.

Matrouh: 3 active / 0 inactive; precision {'area': 2, 'street': 1}.

North Sinai: 2 active / 0 inactive; precision {'area': 2}.

City pages, every discovery disposition, individually read evidence snapshots and unresolved holds recorded in depth-D4-discovery.json, depth-D4-decisions.json and governorate ledgers. Directory mirrors are not independent witnesses; current retail/advice posts are not silently used as clinical case dates. One agent, serial work; no commit/push/install/frontend/production actions.

## Stage 3 depth final — 2026-11-12, after bfbcafe

**551 retained = 522 active / 29 inactive; 35 additional retained identities since bfbcafe.** Inactive: **20 no-phone / 8 stale-evidence / 1 unconfirmed-branch**. Precision **7 exact / 41 street / 503 area**; **44 explicit 24-hour**. Active coverage **26/27 with the unchanged New Valley owner exception**; unchanged checklist **79/83 = 95.2%**.

FX, D2, D3 and D4 completed serially. Original 12 D2 decisions preserved exactly. Updated report has the 27-governorate totals, all 28 scoped city rows, five reproducibly random active samples per governorate with at least five (all available otherwise), owner decision, four fixes, gates, commands and material holds. Nationwide source-preserving casing, plain bilingual city qualifiers (street distinctions for the two British Abo El Feda records), and all **46 existing English post-governorate unit suffixes** corrected in durable authored inputs. Zoo Planet Zagazig, Pet Espitalia Tanta and Aleet Nozha added from multi-branch evidence. Branch audit additionally covers both Dr Ziad premises, Jungle Safaga, moves, shops and unconfirmed branches.

Final checks: **lint / production build pass; full unit 106 suites / 1,360 tests pass; vet-clinics 8 suites / 114 tests pass; admin-service 449/449 pass**. Drizzle: **no schema changes**, journal still ends at 68. All 26 nonempty governorate imports followed by rebuild reproduce dataset, baseline report and 0068 **byte for byte** offline. Changed/new file formatting and `git diff --check` pass. Durable command results and SHA-256 values are in `docs/vet-clinics-stage3-validation.json`. No integration tests rerun (Docker unavailable; lead previously verified stage-2 30/30); no integration/schema/API/admin behavior changed.

Holds remain explicit for unresolved district/street allocation, missing public pet-treatment evidence, missing contacts, unavailable individual sources, and named but unlocated branches. Pet Home Minya has a published closure flag; Kasseh’s doctor-away notices prevent activation. No guessed coordinates, duplicate branches, source-date promotion, Google pin copying or quota padding. This pass does not claim market exhaustion. New Valley data and owner decision remain untouched.

All changes remain uncommitted on the same branch. One agent, no sub-agents, commits, pushes, installs, frontend or production actions. Temporary helper scripts are cleaned up after final verification; resumable evidence/decisions/reports are in the repo.

## Lead fixes — 2026-11-12, after checkpoint 20be81d

codex-b hit its usage limit (reset 17 Nov) before starting the name-integrity brief; on the owner's instruction the lead implemented it. **549 retained = 520 active / 29 inactive**; checklist 79/83 (95.2%); coverage 26/27 with the New Valley owner exception. Brand spelling is shared only within a reviewed `chainKey`; similar unrelated names get place qualifiers (77 display names corrected); Dr. Ziad excluded as `pharmacy-primary`; 25 administrative-unit address endings removed. New gates and tests are listed in the stage 3 report under "Lead fixes after the FX/D2–D4 review".

# Round9 — 2026-11-11
Internet **HTTP/2 302**. **3,149 → 3,156 Cities** (351 districts +2,805 Neighbourhoods): **+10 real source places / −3 noise rows**. No frontend, reinstall, commit, push, PR or production action.

Added/restored (all use the original recorded OSM centre):
- **El Hammam City**, `OSM:way/101848506`; district EG3302 stays because its administrative centroid is about116km away.
- **Bank El Iskan Housing**: El Hammam `839901136`, Cairo/Nasr City `699912644`, New Damietta `792198968` (all `OSM:way/…`). All original Arabic names explicitly say مساكن بنك الإسكان والتعمير.
- **Abu Rawash Village**, `OSM:way/727261263`; distinct from the headline Abu Rawash node.
- **Social Housing (10th of Ramadan)** `OSM:way/879151658`; **Othman Housing (10th of Ramadan)** `OSM:way/699391781`; both are original named residential polygons.
- **Abis8 Villages1,4,12**: `OSM:way/660869901`, `741960643`, `660250153`; original village polygons plus independent [ITDA1/8](https://www.itda.gov.eg/crm/863/CRA106.pdf), [4/8](https://www.itda.gov.eg/CRM/857/CRA5.pdf), [12/8](https://www.itda.gov.eg/CRM/828/CRA4.pdf) address evidence (cached indexed excerpts, not full PDFs).

Removed **Cairo city node, Finance and Business Centre, Hod10**. Renamed Shorouk Club with its district qualifier and four explicitly residential institutional compounds as Housing; corrected Industrial spelling. Arabic display digits are Western; old forms remain aliases, and بنجر السكر29 puts the number last. The matching digit rule is now a data-quality gate.

| Area | Samples / uncovered / share | Retained floor | Grid |
|---|---|---:|---|
| greater-cairo | 8,469 /270 /96.812% | 97% | FAIL |
| alexandria | 2,146 /192 /91.053% | 91% | PASS |
| port-said-region | 734 /38 /94.823% | 94.5% | PASS |

**Cairo remains16 samples short** (270; maximum254). Restoring Abu Rawash Village reduces its nearby footprint from17 to15 gaps: its recorded point is outside that clipped residential polygon. The alternative recorded Nominatim label point is also outside; no point was moved to force coverage. New October has no verified new sub-area name. [All remaining features with original OSM names](../src/cities/data/neighbourhoods/round9-remaining-grid-features.json.gz) include176 Cairo footprints.
All65 previously changed cases re-reviewed: **22 now covered /43 remaining with current notes**. **360 exceptions,68 beyond4km**, all individually current; unreviewed0/0/0. Floors unchanged. [Measured/source audit](../src/cities/data/neighbourhoods/round9-grid-remeasurement.json.gz).
**Names PASS in all areas** (checklists418/268/85;14 known-missing entries). Three additions carry `approvedBy: lead 2026-11-11`; Cairo city was also removed from the Neighbourhood checklist with the lead’s granularity reason. **Headlines141/141; near/قرب qualifiers0; geographic/structural quality PASS; GPS30/30,30/30,29/30 PASS.**
**0066: 2,827,399 bytes; apply 1.031s / re-run 0.933s. REVIEW ONLY / NOT MERGEABLE** because Cairo’s floor fails. Publisher regenerated catalog, snapshot, SQL and journal together; all match staging; no0067. Default publication still rejects failed gates.
**Data 19.914 MiB; 334 source snapshots/raw hashes verified.** Point audit:2,805 rows,2,803 exact source points +1 source geometry +1 pre-existing documented correction. Offline decisions reproduce byte for byte.

Commands: `npx jest src/cities --testPathIgnorePatterns='.*\.integration\.spec\.ts$' --runInBand` **194 PASS**; `npx jest --testRegex='.*\.integration\.spec\.ts$' --runInBand src/cities` **17 Docker PASS**.
`npx eslint 'src/cities/**/*.ts'`, `npx tsc --noEmit -p tsconfig.build.json`, `python3 src/cities/scripts/verify-neighbourhood-sql.py`, `python3 src/cities/scripts/verify-source-points.py` **PASS**; `npm run cities:verify-coverage` **FAIL/exit1, Cairo floor only**. Candidate builder and offline Python rebuild/hash comparison pass; no required check skipped.

Conservative decisions: Bashteel ADM3 centre reverse locates Warraq El Hadar island, so its merge stays; Zawyet Abu Mosallam centres are0.43km apart, so its merge stays. Abis8 village8/8 was not restored because the exact source centre lies outside every pinned ADM1 polygon. Full source/name decisions: [catalog review](../src/cities/data/neighbourhoods/round9-catalog-review.json.gz).

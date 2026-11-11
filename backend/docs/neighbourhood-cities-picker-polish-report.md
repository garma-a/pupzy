# Final PR27 picker data polish — 2026-11-11

3,140 OFFICIAL Cities = 351 districts + 2,789 neighbourhoods (3,156 before; 16 duplicates merged). Normal publisher regenerated the catalog, combined snapshot, unshipped 0066 and journal; verified SQL before installation and matched all four installed byte streams to staging. No 0067, review-only publication, coordinate changes to survivors, source response changes, search.ts or frontend changes.

Aliases after merge union: 3,005 removed (2,985 restricted generated variants; 10 borrowed residential sub-phrases; 5 different-place Bolkly aliases; 5 merge/display/cap duplicates), 211 added, including Moqattam, Mokatam and Moqatam. Nine repeated alias occurrences also collapse during merge union. Total alias entries: 11,279 → 8,476. Arabic spacing, El/Al, -een/-in, ou/u and Mohandseen remain. The sub-phrase check runs after all alias producers and in the data-quality gate. Generic source descriptors are not treated as evidence that a bare alias names a separate City.

## Merges

Original source labels, coordinates and exact policy/decision deltas are in `picker-polish-review.json.gz`; per-City aliases and merge IDs are in `picker-polish-alias-audit.json.gz`. All are under `src/cities/data/neighbourhoods/`. Separate polygons without another independently established settlement identity did not justify duplicate Cities. Sharkia retains ways 879151658 and 699391781: removing them loses five/two covered samples; removing the older duplicates loses zero. Social Housing retains its 10th of Ramadan qualifier because another Social Housing row remains in Sharkia. Other now-unique names lose their district qualifier. Qism Embaba merges onto the official Imbaba identity; its qualified Arabic/English source spellings now refer to that single City.

| Before (both Cities) | After (one City) |
|---|---|
| Fayrouz (Borg El Arab) + Fayrouz | Fayrouz |
| El Haya (New Cairo Second) + Hayat | Hayat |
| Ibny Betak 3 (6th of October) + Ebni Betak 3 | Ebni Betak 3 |
| Othman Buildings + Othman Housing (10th of Ramadan) | Othman Housing |
| Social Housing + Social Housing (10th of Ramadan) | Social Housing (10th of Ramadan) |
| Barqash (Imbaba Markaz) + Birqash | Birqash |
| Iron and Steel Housing (Amreya) + Iron and Steel Housing | Iron and Steel Housing |
| Iron And Steel Housing (Dekheila) + Iron and Steel Housing | Iron and Steel Housing |
| Mubarak Youth Housing 70 Meter (Badr) + Mubarak Youth Housing 70 Meter | Mubarak Youth Housing 70 Meter |
| Qism Embaba + Imbaba | Imbaba |
| Beit Al Watan (New Damietta) + Beit Al Watan | Beit Al Watan |
| Al A'hlal Housing (Ismailiyya 3) + Al A'hlal Housing | Al A'hlal Housing |
| Abu Sir (Borg El Arab) + Abou Sir | Abou Sir |
| Al Akrishah (Kafr Al-Dawwar Kism) + Al Akrishah | Al Akrishah |
| Awqaf City (Agouza) + Al Awqaf City | Al Awqaf City |
| El Agami district + Agami | Agami |

The 3 km extension adds five removed rows beyond the 11 requested pairs: El Haya, Ibny Betak 3, the two Iron and Steel Housing rows, and Mubarak Youth Housing 70 Meter. Bilingual source identities and aliases are retained in the audit. Al Toub Al Ramli / الطوب الرملي and Cooperatives / التعاونيات remain separate: their source labels establish different named areas. An indirect source-alias bridge is rejected and recorded in the audit.

## Gates

| Area | Grid / floor | Names | GPS |
|---|---|---|---|
| greater-cairo | 96.812% / 96.8% PASS | 411 PASS | 30/30 PASS |
| alexandria | 91.053% / 91.0% PASS | 264 PASS | 30/30 PASS |
| port-said-region | 94.823% / 94.5% PASS | 85 PASS | 29/30 PASS |

Headlines 141/141, structural and geographic data quality pass with zero errors. Grid sample/gap counts remain 8469/270, 2146/192 and 734/38. One pre-existing researched >4 km feature has an updated nearest City and measured distance; its samples, original geometry and individual no-name research remain. All 360 exceptions remain reviewed; floors unchanged.

## Verification

Run from `backend/`; logs live under `output/neighbourhood-cities/polish-*`. Detailed commands, results and publication hashes are in `src/cities/data/neighbourhoods/picker-polish-status.json`.

| Command | Result |
|---|---|
| `npx jest src/cities --testPathIgnorePatterns='.*\.integration\.spec\.ts$' --runInBand` | PASS: 19 suites / 202 tests |
| `npm run cities:verify-coverage` | PASS |
| `python3 src/cities/scripts/verify-neighbourhood-sql.py` | PASS: staged and published; upgrade/re-run, names, UUIDs/references and hierarchy |
| `python3 src/cities/scripts/verify-source-points.py` | PASS: 2,787 exact + 1 source geometry + 1 documented correction |
| `npx jest --testRegex='.*\.integration\.spec\.ts$' --runInBand src/cities` | ENVIRONMENT BLOCKED: 3 suites / 17 tests fail before container setup; socket permission denied |
| `npm run format:check` | PASS |
| `npx eslint '{src,apps,libs,test}/**/*.ts'` | PASS |
| `npx tsc --noEmit -p tsconfig.build.json` | PASS |
| `npm run build` | PASS |

Node synchronous subprocess pipes fail with EPERM/EPIPE in this sandbox. Publisher, formatter and unit verification used a temporary `/tmp/pupzy-file-stdio.cjs` adapter with `NODE_OPTIONS=--require /tmp/pupzy-file-stdio.cjs`; it retains the same executable, arguments, input bytes and exit checks and communicates through disposable regular files. No repository runtime code or test gate changed. Temporary diagnostic TypeScript files were moved outside the build root after the build correctly rejected them.

Remaining: rerun cities Docker integration with socket access; lead commits and runs the complete `npm run verify:release`. No current full-release or clean-commit certification is claimed. Changes remain uncommitted; no push, PR, deploy or Railway action.

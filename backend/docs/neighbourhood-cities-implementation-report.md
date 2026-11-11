# Neighbourhood Cities — checkpoint cb40dee review, 2026-11-11

**Historical checkpoint report. Superseded by [round8 results](neighbourhood-cities-round9-report.md): 3,156 rows; current local 0066 is REVIEW ONLY with only Greater Cairo grid coverage failing.**

Internet: **available, HTTP/2 302** on the requested Nominatim probe. **3,366 Cities =351 districts +3,015 Neighbourhoods**. Candidate delta: **+27 / −130** from the previous 3,118 Neighbourhoods. All coverage/data gates pass; **186 unit tests and 17 Docker integration tests pass**. Replacement 0066 is **3,593,704 bytes**; measured final local apply **0.954 s**, re-run **0.915 s**. Data directory is **20,914,187 bytes (19.945 MiB)**. Git metadata is read-only: all changes and fetched gzip snapshots are left in the worktree for review/commit. No frontend edits, dependency reinstall, push, PR, production or Railway operation.

## Coverage before and after

| Area | Before samples / uncovered / share | Final samples / uncovered / share | Retained floor |
|---|---:|---:|---:|
| greater-cairo | 8,469 / 242 / 97.143% | 8,469 / 240 / 97.166% | 97% |
| alexandria | 2,146 / 189 / 91.193% | 2,146 / 190 / 91.146% | 91% |
| port-said-region | 721 / 38 / 94.730% | 734 / 38 / 94.823% | 94.5% |

**332 reviewed remaining footprints;65 beyond 4 km**, each with an individual research note. The previous accepted set had 344 exceptions and 70 far exceptions. Four newly exposed far footprints received fresh reverse queries:320492135,320492136,320492137,544239386. Generic New Capital/industrial-road results did not justify assigning R7/R8 or an industrial-zone name to them. Every other remaining footprint retains reviewed source context. The earlier 78-feature investigation found 4 full Banger El Sokkar village identities and 1 New October membership; that is a historical research classification, not 65 newly identified places. New October now has a recorded additional representative.

Floors remain 97/91/94.5, each also the final value rounded down to 0.5%. Sampling still uses only OSM residential polygons, with the 1.5 km-or-contained-OFFICIAL-point rule. The Port Said denominator increases by 13 after two explicit source-polygon scope extensions for requested Mostakbal Ismailia and Kafr El Battikh. A separate exact named Ras El Bar boundary supplements only 2017 OCHA water/coast gaps outside all existing governorate land; no buffer or land reassignment was used. Both changes are pinned in `coverage-extensions.json`, `boundary-supplements.json` and `reviewed-boundary-replacements.geojson.gz`.

## Arabic display rules

Counts are rule applications/distinct rows within each rule; rules overlap. Identity merges and exclusions are reported separately. Full before/after events are in `arabic-display-changes.json.gz`, summary in `arabic-display-review.json`. Raw source names, source codes and official coordinates stay unchanged. The SQL check preserves district UUIDs and user/post references.

| Rule | Rows / decisions |
|---|---:|
| A1 resident-facing district Arabic | 113 |
| A2 generic prefixes/suffixes removed, bilingual | 818 |
| A2 retained because removing would collide | 224 |
| A3 ADM3 primary resident name | 43 |
| A3 ordinal-only administrative rows excluded | 22 |
| A3 merged into an existing district | 5 |
| A3 merged into an existing OSM locality | 7 |
| A4 Arabic mirrors existing English context | 250 |
| A4 same bilingual qualifier for residual collision | 133 |
| A4 numbered district city context added | 6 |
| A5 restricted reviewed orthography/ordinal corrections | 1079 |
| A5 composite OSM labels reduced to primary + aliases | 15 |
| Institutional housing retained and qualified | 131 |

79 numeric Arabic district labels became ordinal words, with original digit forms retained as aliases. Qualifier changes affect 375 distinct rows across the three context/uniqueness rules. The gate now rejects duplicate Arabic displays within a governorate. No blanket finalه→ة orى→ي rewrite is used: proper names such asطه،عبده،موسى andمصطفى are protected. Missing spaces, standard hamza/ta marbuta/ya corrections come from the reviewed phrase/word dictionary. Prefix proposals are simultaneous and collision-checked against both languages. Institutional wording is preserved; English Housing/City/Village is retained where Arabic retains its actual meaning.

### Districts —10 examples

| Source | Before Arabic → final Arabic | Before English → final English |
|---|---|---|
| EG0104 | قسم المعادي → المعادي | Maadi → Maadi |
| EG0128 | قسم مصرالجديدة → مصر الجديدة | Heliopolis → Heliopolis |
| EG0123 | قسم حدائقالقبة → حدائق القبة | Hadayek El Qobba → Hadayek El Qobba |
| EG0106 | مصرالقديمة → مصر القديمة | Old Cairo → Old Cairo |
| EG1105 | قسم مدينه دمياط الجديده → دمياط الجديدة | New Damietta → New Damietta |
| EG3307 | قسم مارينا العلمين السياحية → مارينا العلمين | Marina Alamein → Marina Alamein |
| EG1104 | مركز كفر سعد → كفر سعد | Kafr Saad → Kafr Saad |
| EG1906 | مركز القنطرة → القنطرة غرب | Qantara Gharb → Qantara Gharb |
| EG0127 | قسم ثانمدينةنصر → مدينة نصر ثان | Nasr City Second → Nasr City Second |
| EG2104 | قسم الجيزة → الجيزة (قسم) | Giza (Kism) → Giza (Kism) |

### Generic prefixes —10 examples

| Source | Before Arabic → final Arabic | Before English → final English |
|---|---|---|
| OSM:way/724746906 | قرية نكلا → نكلا | Nakla Village → Nakla |
| OSM:way/723092193 | مدينة كفر غطاطي → كفر غطاطي | Kafr Ghataty City → Kafr Ghataty |
| OSM:way/682915586 | كمبوند النخيل → النخيل | Al Nakhil Compound → Al Nakhil |
| OSM:node/670235344 | حي الأشجار — السادس من أكتوبر → الأشجار — السادس من أكتوبر | Al-Ashgar Suburb (October) → Al-Ashgar Suburb (October) |
| OSM:node/769126854 | قرية التنمية → التنمية | Qaryat al Tanmiyah → al Tanmiyah |
| OSM:node/1139576842 | حي الفردوس — السادس من أكتوبر → الفردوس — السادس من أكتوبر | Al Fardous City (October) → Al Fardous (October) |
| OSM:node/1160384330 | كمبوند زايد 2000 → زايد 2000 | Zayed 2000 Compound → Zayed 2000 |
| OSM:node/1160384387 | كومباوند الندى → الندى | El Nada Compound → El Nada |
| OSM:node/2587409532 | كمبوند القطامية هايتس → القطامية هايتس | Katameya Heights Compound → Katameya Heights |
| OSM:node/2595126521 | حي الشويفات — القاهرة الجديدة → الشويفات — القاهرة الجديدة | El Showeifat District (New Cairo) → El Showeifat (New Cairo) |

### ADM3 names —10 examples

| Source | Before Arabic → final Arabic | Before English → final English |
|---|---|---|
| PUPZY:adm3-eg020507 | ابيس 7_8_9_10 → أبيس — محرم بك، قرب عزبة نادي الصيد | Abis 7 / 8 / 9 / 10 → Abis (Moharam Bek, near Izbat Nadi al Sayd) |
| PUPZY:adm3-eg211701 | مدينة الوراق و تشمل وراق العرب و وراق الحضر وأنبو* → الوراق [merged/excluded] | Warraq El Arab and Warraq El Hadar → Warraq [merged/excluded] |
| PUPZY:adm3-eg210501 | أبو قتادة و تشمل نوفل الجديدة ونوفل القديمة → أبو قتادة | Abu Qatada and New and Old Nofal → Abu Qatada |
| PUPZY:adm3-eg021701 | أبيس وخورشيد → أبيس — الرمل ثان | Abis and Khorshid → Abis (Raml Second) |
| PUPZY:adm3-eg013803 | اكاديميه الشرطه و الميراج → الميراج | Police Academy and Mirage → Mirage |
| PUPZY:adm3-eg020502 | البابالجديدومنشا → الباب الجديد | El Bab El Gedid and Manshaa → El Bab El Gedid |
| PUPZY:adm3-eg110202 | البستانوكفرطبيخة → البستان — دمياط (مركز)، قرب عزب النهضة | El Bostan and Kafr Tabikha → El Bostan (Dumyat, near Ezab El Nahda) |
| PUPZY:adm3-eg021101 | البورصةوكفرعشري → البورصة — مينا البصل، قرب غرب (الإسكندرية) | El Borsa and Kafr Ashry → El Borsa (Mina El Basal, near Western district, Alexandria) |
| PUPZY:adm3-eg013704 | الجامعه الامريكيه و روضه → الروضة | American University and Rawda → El Rawda |
| PUPZY:adm3-eg020901 | الجدد و اللبان - الورشه → اللبان [merged/excluded] | El Gedd and El Labban El Warsha → El Labban [merged/excluded] |

### Arabic uniqueness and qualifiers —10 examples

| Source | Before Arabic → final Arabic | Before English → final English |
|---|---|---|
| PUPZY:adm3-eg014102 | الحي الأول → الحي الأول — بدر | 1st District → 1st District (Badr) |
| OSM:way/252630351 | الحي الخامس — القاهرة الجديدة → الحي الخامس — القاهرة الجديدة أول | 5th District (New Cairo) (New Cairo First) → 5th District (New Cairo) (New Cairo First) |
| OSM:way/761286957 | شمال الحي السابع → شمال الحي السابع — بدر | Northern District 7 → Northern District 7 (Badr) |
| PUPZY:october-twelfth-district-residential-reference | الحي الثاني عشر → الحي الثاني عشر — 6 أكتوبر ثان، قرب البوليفارد | 12th District → 12th District (October) (6th of October Second, near Boulevard) |
| PUPZY:adm3-eg012701 | الحي السابع → الحي السابع — مدينة نصر ثان [merged/excluded] | Seventh District → Seventh District (Nasr City Second) [merged/excluded] |
| PUPZY:adm3-eg014104 | الحي الثالث → الحي الثالث — بدر | 3rd District → 3rd District (Badr) |
| PUPZY:adm3-eg014103 | الحي الثاني → الحي الثاني — بدر | 2nd District → 2nd District (Badr) |
| OSM:relation/13651336 | رأس التين → رأس التين — ميناء الإسكندرية | Ra's Al Tin (Alexandria Port) → Ra's Al Tin (Alexandria Port) |
| OSM:node/324282800 | السبتية → السبتية — بولاق، قرب سوق العصر | Al-Sabtiyya (Boulaq, near Souk El A'sr) → Al-Sabtiyya (Boulaq, near Souk El A'sr) |
| OSM:node/324567000 | ميت نما → ميت نما — قليوب (مركز)، قرب منطي | Mit Nama (Qalyub (Markaz), near Manty) → Mit Nama (Qalyub (Markaz), near Manty) |

## Noise and the 300-row review

**95 prior inclusions removed as separate selectable entries:83 exclusions and 12 phase-to-whole-place merges**. One additional whole-project name was corrected and one housing alias set stopped shadowing another real place. Two Zenhom project phases merge into the existing Zenhom record. All 131 institutional-housing rows have bilingual district qualifiers; original labels remain aliases unless a generic alias shadows a different real area.

| Exclusion/merge class | Rows |
|---|---:|
| reviewed-noise-nonresidential-institution-or-premises | 10 |
| reviewed-noise-single-private-villa | 1 |
| reviewed-whole-project-name | 1 |
| reviewed-noise-military-premises | 2 |
| reviewed-noise-bank-or-company-building-blocks | 12 |
| reviewed-noise-school-or-sports-premises | 6 |
| reviewed-noise-single-student-accommodation | 1 |
| reviewed-noise-industrial-premises | 19 |
| reviewed-noise-bare-coded-reclamation-village | 19 |
| reviewed-noise-bare-administrative-ordinal | 6 |
| reviewed-noise-bare-code-or-building-count | 6 |
| reviewed-whole-project-phase-merge | 12 |
| reviewed-noise-unreviewed-project-phase | 1 |
| institutional-housing-no-real-place-shadow | 1 |

The frozen seed 20261111 sample contains 300 included identities, personally read in three batches and rechecked after residue corrections. The initial sample had 4 classification errors (1.33%) and 55 spelling/qualification errors:59 flagged rows (19.67%). After applying reviewed class rules and residue fixes, **0/300 remaining observed errors (0%)**. This is a desktop source/display audit, not field validation. `included-sample-300.json.gz` preserves every reviewed identity/name/verdict and its hash is in `noise-review.json`. Olympic Village in New Damietta and Utilities Compound remain explicitly uncertain named residential estates; their actual housing/village/compound meaning is preserved.

## Aliases and names

Generator: **3,063 rows affected**, **24,705 generated aliases**, **4 canonical-name collisions excluded**. Eligible rows=3,128; average generated=7.90/eligible row, average all aliases=10.36/eligible row (9.63 across the full catalog). Cap 12; deduplicated, one fixed-table edit per candidate, no combinatorial feedback. Descriptive English words are protected. The generator has 4 unit specs, including bounds, collision exclusion and idempotence.

All 11 requested C1 spellings are explicit aliases: Geziret Mohamed, Nikla, Mansouriya, Moatamadiya, Kafr Ghattati, Abu El Nomros, Nazlet El Ashter, Bani Youssef, Bashayer El Kheir, Wadi El Qamar and El Araishiya.

| C2 requested sub-area | Final outcome |
|---|---|
| العصافرة بحري / قبلي | Arabic and English variants alias Asafra, WD:Q4803317. |
| الحضرة الجديدة | Aliases on newly sourced Hadara, PUPZY:hadara-alexandria, exact recorded Q5637597 point. |
| مارينا٥/٦/٧ | Alias official Marina Alamein EG3307; gates1–4 remain separate. |
| داون تاون العلمين / أبراج العلمين | Alias New Alamein WD:Q96395299. |
| جزيرة الوراق / Warraq Island | Alias the island Warraq El Hadar OSM:node/768590261. |

C3 has 17 locatable named outcomes,11 researched known-missing entries and 1 uncorroborated regional identity removed. Hadara is the additional C2 named outcome. Kafr El Battikh’s proposed Wikidata record is merged into the exact OSM city record, preserving checklist aliases.

| C3 name | Outcome / recorded location evidence |
|---|---|
| محطة مصر | Added MahatetMasr; Alexandria railway station proxy [Q958574](https://www.wikidata.org/wiki/Q958574). |
| ثروت | Added exact named locality [Q7710847](https://www.wikidata.org/wiki/Q7710847). |
| غبريال | Added railway-halt proxy [OSM node1892910381](https://www.openstreetmap.org/node/1892910381), cached reverse/search response. |
| السرايا | Added exact locality [Q4518634](https://www.wikidata.org/wiki/Q4518634). |
| صواري | Added approximate mainland location from [primary developer](https://se-developers.com/project/sawary/) recorded location-map centre. Lake-mask Wikidata points were rejected rather than moved. |
| الكافوري | Added locality/rail proxy [Q110835589](https://www.wikidata.org/wiki/Q110835589). |
| الإصلاح | Known missing: homonymous roads/mosques do not identify a unique requested area. |
| عزبة المطار | Known missing: no usable unambiguous named point in exact/bounded searches and original source context. |
| العميد | Added established Omayed area using recorded named approach-road [way1498183544](https://www.openstreetmap.org/way/1498183544); reserve centroid rejected. |
| الحاجر | Known missing in Alexandria: canal-road homonym insufficient to establish the intended area. |
| الكيلو٣٤ | Known missing: no defensible area point; arbitrary kilometre geometry not substituted. |
| منشية العمرا | Removed from Alexandria checklist pending regional attestation. Found Gharbia/Assiut homonyms; no credible Alexandria identity. Not counted as real known missing. |
| أغاخان | Added named NBE branch proxy; exact WazePlace JSON-LD coordinates in aghakhan-waze.json.gz, corroborated address research. |
| حدائق زايد | Known missing: same-name agricultural-investment project not proven to be the requested residential place; its point rejected. |
| الحزام الأخضر | Added Green Belt October; named lake [relation7777042](https://www.openstreetmap.org/relation/7777042) is explicitly a broad-area landmark proxy. |
| سفنكس الجديدة | Added exact named city [Q112110813](https://www.wikidata.org/wiki/Q112110813). |
| الحي السكني السابع R7 | Added sourced enclosing district; Pukka [way819189853](https://www.openstreetmap.org/way/819189853), corroborated by recorded MBG project material. |
| الحي السكني الثامن R8 | Added sourced enclosing district; DiploEast [way1366681574](https://www.openstreetmap.org/way/1366681574), corroborated by recorded project/developer material. |
| اللسان | Added سوقاللسان market proxy [node10899712521](https://www.openstreetmap.org/node/10899712521); exact recorded Ras El Bar boundary restores2017 coastal-mask gap. |
| كفر البطيخ | Added one OSM city [way790985328](https://www.openstreetmap.org/way/790985328), within recorded city scope extension, parentEG1104. Q6839370 aliases merged; KafrSaad is not an alias for this distinct city. |
| السبع بنات | Known missing in Ismailia: Cairo mausoleum/other-city homonyms rejected. |
| البلابسة | Known missing in Ismailia: recorded exact/bounded searches lack an unambiguous point. |
| الكفراوي | Added New Damietta area using named street [way97362994](https://www.openstreetmap.org/way/97362994), explicit proxy. |
| المستقبل | Added Mostakbal Ismailia with exact mosque proxy [Q138148800](https://www.wikidata.org/wiki/Q138148800) inside recorded enclosing residential footprint. |
| حي السلام | Known missing in Ismailia: Salam roads/mosques and southern rural names do not establish the requested district identity. |
| المحطة الجديدة | Known missing in Ismailia: no evidence equates it to the central station; no generic station centroid used. |
| مبارك | Added MubarakNew Damietta using named street [way585284216](https://www.openstreetmap.org/way/585284216), explicit proxy. |
| بحر البقر | Known missing in Port Said scope: Sharqia village/locality points rejected; a drain/treatmentplant does not locate the requested residential area. |
| الرحاب | Verified real El Dawahy/Port Said housing through governorate/register evidence, but still known missing for lack of a defensible point. CairoRehab rejected. |

**Rehab is real Port Said housing; Fayrouz is real Bor Fouad social housing**, not misfiled Cairo names. Rehab remains unlocated. Fayrouz keeps its recorded الفيروز١٥٣ apartment proxy (OSM:node/10628310605); [Port Said governorate evidence](https://portsaid.gov.eg/News/details/109694) was available as an indexed first-party excerpt, not a successfully extracted full page. The alias El Fayrouz remains on that City.

**Known missing: 11 entries /28 unmatched variants**, individually documented in [known-missing-names.json](../src/cities/data/neighbourhoods/known-missing-names.json). Cairo: Hadayek Zayed. Alexandria: Ezbet El Matar, El Islah, Kilo 34, Al Hagir. Port Said region: Rehab, Bahr El Baqar, Hay El Salam Ismailia, Mahatta El Gedida, Saba Banat, Balabsa. Missing variants remain visible in the report; reviewed research coverage lets the gate pass. Failed Overpass 502 responses are cached diagnostics, not evidence that no name exists.

Independent checklist sizes: **420 /268 /85**; minima **150 /150 /85**, with Port Said’s honest minimum retained under the lead decision dated 2026-11-10. Five nonresidential checklist entries were excluded this round (Industrial Area, Cairo Airport, Smart Village, Egypt Olympic Sports City, City OfArts And Culture); Manshiyet El Omara is the sixth removal for uncorroborated regional identity. No padding. Raw OCHA/WD labels and independently selected public lists remain separate from catalog matching.

Public source pages and their compressed responses are pinned in the manifest. The selected names are retained in `research-names/public-checklist.json`; downloaded/corroborating Arabic and English city/governorate pages include:

- Cairo/Giza: [cairo-ar](https://ar.wikipedia.org/wiki/%D8%A7%D9%84%D9%82%D8%A7%D9%87%D8%B1%D8%A9), [cairo-en](https://en.wikipedia.org/wiki/Cairo), [giza-ar](https://ar.wikipedia.org/wiki/%D8%A7%D9%84%D8%AC%D9%8A%D8%B2%D8%A9_%28%D9%85%D8%AF%D9%8A%D9%86%D8%A9%29), [giza-en](https://en.wikipedia.org/wiki/Giza), [cairo-gov-ar](https://ar.wikipedia.org/wiki/%D9%85%D8%AD%D8%A7%D9%81%D8%B8%D8%A9_%D8%A7%D9%84%D9%82%D8%A7%D9%87%D8%B1%D8%A9), [giza-gov-ar](https://ar.wikipedia.org/wiki/%D9%85%D8%AD%D8%A7%D9%81%D8%B8%D8%A9_%D8%A7%D9%84%D8%AC%D9%8A%D8%B2%D8%A9).
- Alexandria: [alex-ar](https://ar.wikipedia.org/wiki/%D8%A3%D8%AD%D9%8A%D8%A7%D8%A1_%D8%A7%D9%84%D8%A5%D8%B3%D9%83%D9%86%D8%AF%D8%B1%D9%8A%D8%A9), [alex-en](https://en.wikipedia.org/wiki/Alexandria).
- Port Said/Ismailia/Damietta: [port-ar](https://ar.wikipedia.org/wiki/%D8%A8%D9%88%D8%B1%D8%B3%D8%B9%D9%8A%D8%AF), [port-en](https://en.wikipedia.org/wiki/Port_Said), [ismailia-ar](https://ar.wikipedia.org/wiki/%D8%A7%D9%84%D8%A5%D8%B3%D9%85%D8%A7%D8%B9%D9%8A%D9%84%D9%8A%D8%A9_%28%D9%85%D8%AF%D9%8A%D9%86%D8%A9%29), [ismailia-en](https://en.wikipedia.org/wiki/Ismailia), [ismailia-gov-en](https://en.wikipedia.org/wiki/Ismailia_Governorate), [damietta-ar](https://ar.wikipedia.org/wiki/%D8%AF%D9%85%D9%8A%D8%A7%D8%B7), [damietta-en](https://en.wikipedia.org/wiki/Damietta), [damietta-gov-en](https://en.wikipedia.org/wiki/Damietta_Governorate).

## GPS, sources and release checks

GPS=**30/30,30/30,29/30**. Q138196168 remains at the untouched Wikidata coordinate among fish farms: nearest EG0308 about 2.0 km, own districtEG 0306 about 2.1 km. `gps-failure-review.json` binds the exact coordinate, actual/expected source codes, area, individual evidence and dated lead decision. No fixture was substituted; `gps-selection.json` pins all 90 identities. A second failure in an area or an undocumented failure fails the gate.

Final Neighbourhood counts by identity/source prefix (PUPZY means an explicit reviewed record, not an unsourced coordinate):

| Area | OSM | WD | PUPZY | Total |
|---|---:|---:|---:|---:|
| greater-cairo | 1891 | 10 | 173 | 2074 |
| alexandria | 542 | 19 | 148 | 709 |
| port-said-region | 191 | 3 | 38 | 232 |

Point/source provenance across the final release: **639 OCHA-backed rows** (351 districts,261 ADM3 and27 populated places), **2,655 OSM-backed rows** (2,624 direct objects,30 recorded object lookups and1 geometry representative), **70 Wikidata-backed rows**, and **2 recorded web-geo proxies**. These sum to3,366; the pre-existing coastal correction is separately disclosed below.

All 351 districts remain. New 27 rows use **18 recorded OSM coordinates** (15 reverse proxies/representatives,2 capital project points,1 city), **7 recorded Wikidata coordinates**, and **2 recorded web geo points** (Waze Place JSON-LD and developer map centre). Nine of the 27 are additional representatives of existing places: six Abis blocks, October 1st/12th Districts and New October. Each has explicit `representativeOf`; no bare block code was promoted. New-source identities:1 OSM +26 PUPZY.

Coordinate verifier: **3,015 rows, zero errors**; 3,013 exact raw points,1 recorded-source geometry point and 1 pre-existing reviewed coastal correction. District source integrity check confirms all 351 source names, P-codes, coordinates and governorate codes unchanged; SQL checks preserve UUIDs.

**280 snapshots**, **13,822,613 compressed source bytes**, all recorded compressed/raw hashes verified. Every newly fetched response is gzip-cached with exact URL, actual retrieval time, licence/rights and status. Nominatim was serial with descriptive User-Agent and 1.1-second pauses. Build, tests and migrations use only disk evidence. The full per-row audit is compressed once; catalog provenance points back to the pinned decision record.

| Check | Result |
|---|---|
| Structural and geographic/data quality, including Arabic uniqueness | PASS, zero errors |
| Residential grid / independent names / GPS, all3 areas | PASS |
| Cities unit specs |18 suites /186 tests PASS |
| Docker Cities integration |3 suites /17 tests PASS, PostGIS16 |
| Cities ESLint / TypeScript build check / Python compile | PASS |
| Exact source points /351 district source identities | PASS |
| Offline rebuild | Decision file byte-for-byte identical after publication; combined snapshot reproduces released catalog |
| Publisher / SQL upgrade and re-run | PASS, single replacement0066 and four coherent artifacts |

The existing publisher ran in isolated staging ending at 0065 against the original district-only catalog. Its validated catalog, combined snapshot, replacement 0066 and journal were installed together and revalidated. No 0067 was added. SQL is parent-first, offline and idempotent; verification checks bilingual/source names, exact state after re-run, retained legacy rows, UUID/user/post references, hierarchy and no-op redeploy revisions. Final socket-free local timing includes 0065+0066 transaction: apply/re-run above; total SQL workload 2.842 s. Docker timing is not claimed as a performance benchmark.

Commands run from `backend/` (existing dependencies):

```sh
curl -sI https://nominatim.openstreetmap.org/ | head -1
python3 src/cities/scripts/prepare-geographic-evidence.py
python3 src/cities/scripts/build-reviewed-dataset.py
python3 src/cities/scripts/build-independent-names.py
python3 src/cities/scripts/build-gps-fixtures.py
python3 src/cities/scripts/finalize-neighbourhood-review.py
python3 src/cities/scripts/verify-source-points.py
npx ts-node src/cities/scripts/build-neighbourhood-candidate.ts
npx ts-node src/cities/scripts/propose-residential-review.ts
npx ts-node src/cities/scripts/verify-coverage.ts output/neighbourhood-cities/candidate-catalog.json
npx ts-node src/cities/scripts/verify-coverage.ts
npx jest src/cities --testPathIgnorePatterns='.*\.integration\.spec\.ts$' --runInBand
npx jest --testRegex='.*\.integration\.spec\.ts$' --runInBand src/cities
npx eslint 'src/cities/**/*.ts'
npx tsc --noEmit -p tsconfig.build.json
python3 -m py_compile src/cities/scripts/*.py
python3 src/cities/scripts/verify-neighbourhood-sql.py --catalog output/neighbourhood-cities/release-stage/egypt-cities-catalog.json --migration output/neighbourhood-cities/release-stage/migrations/0066_release_city_catalog.sql
python3 src/cities/scripts/verify-neighbourhood-sql.py
```

Deliberate source/rule/hash signoff and the publisher staging invocation are recorded in `personal-review.json`, `round7-decision-delta.json.gz` and ignored `output/neighbourhood-cities/round7-publication.json`; regular builds cannot sign themselves. Historical ADR0002 integration scenarios use an isolated district-only fixture; the actual 0066/whole released catalog is exercised separately by Neighbourhood Docker integration. Seed/reconciliation defaults now retain reviewed catalog metadata instead of assuming 351.

## Thirty decisions most needing local review

These are review priorities, not 30 known errors. Exact research, rejected alternatives and points remain in the decision/known-missing source records.

1. Hadayek Zayed (greater-cairo): No defensible point tied to the client residential-area identity; similarly named farm/office is not sufficient.
2. Ezbet El Matar (alexandria): Airport/approachroad name alone does not identify the requested Ezbet; no coordinate borrowed from an airport.
3. El Islah (alexandria): Multiple homonyms; a point would choose an area without sufficient identity evidence.
4. Kilo 34 (alexandria): No interpolation along a road or point inferred from a kilometre number.
5. Al Hagir (alexandria): Canal-road homonym insufficient to locate the client area.
6. El Rehab (port-said-region): A real Port Said area remains unlocated; no Cairo point or general El Dawahy centroid substituted.
7. Bahr El Baqar (port-said-region): Do not move the Sharqia village into Port Said or name a sewageplant as a neighbourhood.
8. Hay El Salam Ismailia (port-said-region): A shared Salam street/mosque label is insufficient amid multiple homonyms.
9. El Mahatta El Gedida (port-said-region): No point inferred from the meaning of the name or substituted from Ismailia station.
10. El Saba Banat (port-said-region): A passing point cannot be borrowed from the Cairo monument or another city.
11. El Balabsa (port-said-region): No generic Ismailia coordinate or nearby ward centroid substituted.
12. Manshiyet El Omara removal: Alexandria regional identity uncorroborated; reinstate only with reliable local/source evidence.
13. Sawary: approximate developer-map-centre proxy beside the mainland project; source lake-mask disagreement remains explicit.
14. Aghakhan: established address area represented by a named bank branch, not a locality feature.
15. Omayed: named approach road is an approximate proxy; no nature-reserve centroid substituted.
16. Green Belt October: named lake is a broad-area proxy, not evidence that every nearby block belongs to it.
17. Capital R7: Pukka establishes enclosing district membership; chosen point is inside the project, not the whole district centre.
18. Capital R8: Diplo East/project-map corroboration; boundary/representative extent deserves local review.
19. El Lessan: named market proxy and restored coastal geography, not a surveyed neighbourhood centre.
20. El Kafrawy New Damietta: area name placed by its named main street.
21. Mubarak New Damietta: named-street proxy and potentially broad informal extent.
22. Fayrouz Bor Fouad: named apartment proxy backed by governorate indexed evidence; exact housing-district extent is approximate.
23. Hadara: exact recorded Wikidata point; New Hadara alias follows the lead decision rather than a surveyed sub-area boundary.
24. Kafoury: recorded railway/locality proxy; colloquial extent may be broader.
25. Six Abis representatives: recorded reverse addresses explicitly name Abis; point qualifiers describe location rather than inventing six distinct area names.
26. October 1st/12th District and New October representatives: exact enclosing-area address evidence; extra selectable points describe separate residential footprints.
27. Olympic Village New Damietta: source says residential and location differs from the Ismailia sports facility; retain full Village wording pending stronger evidence.
28. Utilities Compound: named residential-tagged estate; preserve Compound rather than the generic Utilities display.
29. Ras El Bar supplement: exact recorded modern city boundary fills 2017 water/coast gaps only; source-vintage difference needs geographic review.
30. Stanley: pre-existing individually reviewed coastal correction retained and separately counted, rather than presented as an exact raw point.

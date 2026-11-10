# Neighbourhoods as selectable Cities

Status: accepted; implementation pending

The ADM2-only catalog from ADR 0002 gives Greater Cairo, Alexandria and Port Said too few selectable places: clients and their users could not find the areas they live in (Smouha, Rehab, Mohandessin and similar), because those are commonly used names rather than official districts. We therefore add Neighbourhoods as Cities in their own right, each linked to exactly one official ADM2 district, sourced from OpenStreetMap with Wikidata filling missing Arabic or English names, with decisions reviewed under the source/rule audit below. Each City may also carry alternative spellings so that search finds it under common transliterations.

ADR 0002 still governs the official districts and everything else about the catalog: offline reviewed dataset releases, application UUIDs as identity, lifecycle states, no operator CRUD, and data migrations applied at pre-deploy. This decision only widens what a City may be.

Coverage is Greater Cairo (Cairo governorate, urban Giza and Qalyubia, the New Administrative Capital and 10th of Ramadan), Alexandria governorate with the North Coast strip and Kafr El-Dawwar, and Port Said governorate with Ismailia city and Damietta / New Damietta. Other governorates keep districts only until there is demand.

## Considered options

- **Official shiakha (ADM3) data**: rejected. It yields hundreds of formal names per city that residents do not use, and still misses compounds such as Madinaty and Rehab.
- **Free-text or operator-created places**: rejected. It breaks the reviewed-release authority of ADR 0002 and produces duplicates and misspellings.

## Consequences

- OpenStreetMap data is ODbL-licensed, so the app must display "© OpenStreetMap contributors".
- Nearest-City recognition from GPS may now resolve to a Neighbourhood instead of its district, and distance-based feeds centre on that Neighbourhood's point.
- A release is mergeable only when grid coverage, an independently researched name list, GPS spot checks and data-quality checks all pass.

## Dataset review amendment, 2026-11-09

The lead's dataset brief permits deterministic bulk inclusion/exclusion rules, with individual review of residue, curated names, merges and disambiguations, and random samples of at least 300 inclusions and 300 exclusions. Review signoff records errors found and binds the reviewed sources and rules; it does not imply the release gates pass.

Official ADM3 units are now permitted as coverage fill, alongside OSM neighbourhoods and compounds. Use their source centres and exact OCHA ADM2 P-code parents. Record units skipped for lack of residential or populated-place evidence. Built-up verification follows the amended 2026-11-10 decision below. ADM3 remains a supplement to familiar area names.

For a point in a Zemam Out unit, or outside every selectable ADM2 polygon, retain its containing OCHA ADM1 governorate. Prefer the corresponding named new city's selectable district, choosing the nearest polygon when that city has several districts. Otherwise choose the nearest selectable district polygon in the same governorate. Never use centroid distance. Record `parentRule`, original Zemam Out P-code (null if none), and polygon distance in kilometres. Distances over 40 km require lead review. Every other neighbourhood requires exact parent containment.

The 2026-11-10 continuation includes real named OSM hamlets/localities and OCHA populated places under the same bilingual-name and containment rules. Natural features, coded plots and private premises remain excluded. Explicitly reviewed Wikidata locality evidence may establish that an ADM3 unit is populated for City fill; its administrative polygon is not built-up evidence. A source landmark may supply a documented representative point for an established area; distinguish that proxy from an actual locality centre. No coordinate comes from memory.

Independent-name review has its own exact-list signature. An incomplete or unverified regional checklist must remain unreviewed; source/rule approval of the candidate does not approve its name checklist. The 30-GPS requirement remains. Independent-name minima and the residential grid gate follow the amended 2026-11-10 decision below. Explicit GPS adjacent-district approvals require real polygon adjacency and a recorded reason; they do not change the landmark's containing district.

## Lead correction, 2026-11-10

Built-up evidence comprises only the complete clipped OSM `landuse=residential` polygons. ADM3 City fill remains. A 500 m sample is covered within 1.5 km of any OFFICIAL City, or if its residential polygon contains an OFFICIAL City point. Remaining features require reviewed exceptions with identity, centre, sample count, worst distance, nearest City, research and reason no name was assigned; those beyond 4 km require individual research. Each area has a committed coverage floor at its final measured share rounded down to 0.5%. Later regressions below that floor fail.

Greater Cairo and Alexandria retain at least 150 independent names each. Port Said region uses the final defensible researched name count, without padding; the per-area minimum and this reviewed lead decision dated 2026-11-10 live in committed checklist metadata. Missing genuine names remain failures, even where the research itself is reviewed.

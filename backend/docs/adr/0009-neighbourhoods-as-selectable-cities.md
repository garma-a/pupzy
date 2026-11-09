# Neighbourhoods as selectable Cities

Status: accepted; implementation pending

The ADM2-only catalog from ADR 0002 gives Greater Cairo, Alexandria and Port Said too few selectable places: clients and their users could not find the areas they live in (Smouha, Rehab, Mohandessin and similar), because those are commonly used names rather than official districts. We therefore add Neighbourhoods as Cities in their own right, each linked to exactly one official ADM2 district, sourced from OpenStreetMap with Wikidata filling missing Arabic or English names, and every row reviewed by hand. Each City may also carry alternative spellings so that search finds it under common transliterations.

ADR 0002 still governs the official districts and everything else about the catalog: offline reviewed dataset releases, application UUIDs as identity, lifecycle states, no operator CRUD, and data migrations applied at pre-deploy. This decision only widens what a City may be.

Coverage is Greater Cairo (Cairo governorate, urban Giza and Qalyubia, the New Administrative Capital and 10th of Ramadan), Alexandria governorate with the North Coast strip and Kafr El-Dawwar, and Port Said governorate with Ismailia city and Damietta / New Damietta. Other governorates keep districts only until there is demand.

## Considered options

- **Official shiakha (ADM3) data**: rejected. It yields hundreds of formal names per city that residents do not use, and still misses compounds such as Madinaty and Rehab.
- **Free-text or operator-created places**: rejected. It breaks the reviewed-release authority of ADR 0002 and produces duplicates and misspellings.

## Consequences

- OpenStreetMap data is ODbL-licensed, so the app must display "© OpenStreetMap contributors".
- Nearest-City recognition from GPS may now resolve to a Neighbourhood instead of its district, and distance-based feeds centre on that Neighbourhood's point.
- A release is mergeable only when grid coverage, an independently researched name list, GPS spot checks and data-quality checks all pass.

City catalog source attribution

The official districts and administrative geometry are CAPMAS / Government of Egypt and UN OCHA COD-AB Egypt (HDX), CC BY-IGO. The original ADM2 snapshot remains in `src/cities/data/ocha-adm2-egypt-snapshot.json` (ADR 0002). Additional ADM1, ADM2, ADM3 and populated-place GeoJSON was downloaded by the lead on 2026-11-09 from:
https://data.humdata.org/dataset/b90d81ba-7c7a-4283-9899-827480d80a79/resource/2080e95f-51c7-45b6-b5ab-613ff1cfc041/download/egy_admin_boundaries.geojson.zip
Licence: http://creativecommons.org/licenses/by/3.0/igo/legalcode . ADM3 is an exact, coverage-filtered extract; the manifest preserves the full member's SHA-256 and the deterministic filter script. Boundaries have a 2017 source vintage and must not be described as newly surveyed in 2026.

OpenStreetMap source snapshots were fetched by the lead on 2026-11-09 and 2026-11-10 (small settlements, approximately 12:00 UTC). © OpenStreetMap contributors, Open Database Licence (ODbL) 1.0:
https://www.openstreetmap.org/copyright
https://opendatacommons.org/licenses/odbl/1-0/
Nine original place/residential/small-settlement responses are retained as deterministic gzip files, one copy each. The OSM administrative response is unused because OCHA supplies the authoritative P-code crosswalk. Derived neighbourhood decisions and built-up evidence retain source identities and attribution.

Wikidata structured data is CC0: https://www.wikidata.org/wiki/Wikidata:Licensing . The original response fetched on 2026-11-09 is retained as deterministic gzip. Source labels/aliases and P625 coordinates are distinguished from curated translations and landmark proxies.

Per-file retrieval dates, SHA-256, compressed/uncompressed sizes, licences and attribution are in `src/cities/data/neighbourhoods/source-manifest.json`. The build, tests and migrations run offline. The database release remains blocked until all coverage gates pass.

Before enabling an OSM-derived release, the client must display “© OpenStreetMap contributors” with the copyright link. The Flutter owner implements that attribution. Preserve source snapshots and attribution when distributing the derived database and observe the ODbL share-alike requirements.

The internet-enabled 2026-11-10 continuation adds cached Nominatim responses and attempted Overpass queries (© OpenStreetMap contributors, ODbL), selected Arabic/English Wikipedia pages (Wikimedia contributors, applicable CC BY-SA terms recorded per snapshot), public governorate/government evidence, indexed search excerpts, and a GPS investigation with Wikidata/OSM and Esri satellite imagery. These are research evidence, not a claim that every source is freely relicensable. Government pages and indexed excerpts retain their original rights; Esri export retains the provider's service/attribution terms. Exact URLs, retrieval timestamps, licences/rights limitations, HTTP failures and hashes are recorded in the source manifest. A failed fetch establishes no naming fact; a search excerpt is not a downloaded full article or PDF. Source-response landmark proxies are explicitly distinguished from locality centres.

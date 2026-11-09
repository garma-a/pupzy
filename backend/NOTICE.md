City catalog source attribution

The official ADM2 source is CAPMAS / UN OCHA COD-AB Egypt, licensed under CC BY-IGO. The untouched snapshot and its attribution remain in `src/cities/data/ocha-adm2-egypt-snapshot.json`; see ADR 0002.

Neighbourhood ingestion is prepared for OpenStreetMap data, © OpenStreetMap contributors, available under the Open Database Licence (ODbL) 1.0: https://www.openstreetmap.org/copyright and https://opendatacommons.org/licenses/odbl/1-0/ . The source manifest records the expected query, retrieval date and licence for every snapshot. No OSM response was retrieved in this sandbox on 2026-11-09 (DNS failed). Pending hand-curated names are explicitly marked and are not represented as OSM observations.

Wikidata structured data is CC0: https://www.wikidata.org/wiki/Wikidata:Licensing . No Wikidata response was retrieved in this sandbox.

Before a release incorporating OSM data is enabled, the client must display “© OpenStreetMap contributors” with the copyright link. The Flutter owner must implement that attribution; this backend change does not modify frontend files. Preserve source snapshots and attribution when distributing the derived database and review the ODbL share-alike requirements.

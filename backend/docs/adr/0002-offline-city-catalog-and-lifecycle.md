# 0002: Offline City Reference Catalog, Lifecycle Model, and Authority Decisions

- **Status:** Accepted
- **Date:** 2026-08-27
- **Context:** Establishing an authoritative, offline source of truth for Egyptian Cities across all 27 governorates, ensuring consistent geographic scoping, robust data integrity, and safe taxonomy evolution without breaking existing user and post references.

---

## Decision

We establish an **offline, reproducible reference catalog** for Egyptian Cities based on the United Nations Office for the Coordination of Humanitarian Affairs (OCHA) Common Operational Datasets for Administrative Boundaries (COD-AB) Egypt ADM2 dataset (provided by CAPMAS, Government of Egypt).

### Key Architectural Choices

1. **Offline Authority & Snapshot Integrity:**
   - The repository tracks the complete, untouched 365-row OCHA COD-AB Egypt ADM2 source snapshot along with full provenance and attribution metadata (`src/cities/data/ocha-adm2-egypt-snapshot.json`).
   - A deterministic transformation produces exactly 351 selectable Egyptian Cities by excluding 14 non-administrative "Zemam Out" (outside-zemam) units and applying canonical Kism/Markaz English-name disambiguation for duplicate names within the same governorate (`src/cities/data/egypt-cities-catalog.json`).
   - No production startup path, database migration, seeding routine, or test suite requires external network access.

2. **Identity Preservation (Application UUIDs vs. Source P-Codes):**
   - Application UUIDs (UUIDv7) remain the primary key and public-facing identity across all client APIs, database foreign keys (users, posts, saved searches, vet clinics), and cache keys.
   - Internal upstream P-codes (e.g. `EG2801`) are stored in `source_code` with a unique database index, providing an immutable anchor for upstream lineage, idempotent updates, and reconciliation.

3. **Explicit Lifecycle Semantics (`official`, `legacy`, `retired`):**
   - **`OFFICIAL`**: Active authoritative selectable cities in the current catalog (351 ADM2 units). Public dropdowns (`cities` GraphQL query) and spatial nearest-city resolution (`findNearest`) return only official cities.
   - **`LEGACY`**: Pre-existing or custom historical city records retained in the database to maintain referential integrity with older posts and users. Not selectable in public dropdowns or GPS resolution.
   - **`RETIRED`**: Former official cities that are removed or superseded by future upstream dataset releases. Retained with original UUIDs so historical references continue to resolve.
   - Direct lookup (`findById` and `findByIds` DataLoader) remains readable across all lifecycle states, guaranteeing that existing posts and profiles never fail to render their historical city.

4. **No Operator CRUD in AdminJS / APIs:**
   - City reference data represents an authoritative geographic standard and cannot be arbitrarily created, edited, deleted, or bulk-deleted by operators or super-administrators in AdminJS or through API endpoints.
   - Reference data changes are managed strictly via reviewed dataset releases, automated validation suites, and tracked data migrations.

5. **Approximate WGS84 Representative Points:**
   - PostGIS geometry enforces `POINT(longitude latitude)` with SRID 4326 (`center_point`).
   - Coordinates represent approximate WGS84 representative points (centroids / locality centers) for distance calculation and nearest-city ranking (`ST_Distance`), not geometric administrative boundary polygons.

6. **Process-Local Cache Coherence & Invalidation Lifecycle:**
   - City caching operates entirely within the pre-MVP single-replica, process-local architecture via `@nestjs/cache-manager` without Redis, distributed invalidation, or background polling.
   - `CitiesService` maintains generational cache versioning and key tracking: calling `clearCache()` invalidates both the cached official list (`findAll`) and all per-ID lookups (`findById`) across all lifecycle states in O(1) time by advancing internal cache generation immediately, while physical key cleanup is dispatched asynchronously on a best-effort basis.
   - Migration & Deployment Coherence: Railway pre-deploy execution (`preDeployCommand: node dist/database/migrate.js`) applies data migrations to PostgreSQL before new container activation; newly booted application instances start with cold in-memory cache and populate from the migrated database throughout restart and deployment overlap.
   - Transactional Post-Commit Invalidation: In runtime seeding and reconciliation workflows (`seedOfficialCities`, `reconcileCities`), cache invalidation executes strictly after transaction commit; failed reconciliation leaves the existing cache safe to reuse.

7. **Upstream Ingestion & Maintainer Verification Tooling:**
   - The default developer refresh workflow (`npm run cities:refresh -- --fetch`) directly ingests the authoritative upstream OCHA COD-AB Egypt release artifact (`egy_admin_boundaries.xlsx`), parses its native `egy_admin2` layer, validates complete provenance metadata, and outputs structured candidate diffs.
   - Maintainers can verify the live upstream resource availability at any time using `npm run cities:verify-upstream`, which validates the remote resource health, metadata, and schema in a read-only pass without altering repository artifacts.
   - All network calls, transport redirects, and archive extraction remain developer-time maintenance operations; runtime execution and migrations remain 100% offline.

---

## Consequences

- **Positive:**
  - 100% offline, deterministic, and reproducible taxonomy across all environments.
  - Complete 27-governorate coverage with zero duplicate English names per governorate.
  - Strict preservation of existing entity relationships and UUID stability.
  - Clear lifecycle model supporting seamless future dataset upgrades without breaking historical references.
  - Protected against accidental or unauthorized manual mutations by administrative staff.

- **Trade-offs & Mitigations:**
  - Representative point approximation: Points reflect locality centers rather than exact polygon boundaries; accepted as optimal for mobile nearest-city discovery without heavy polygonal geospatial overhead.
  - Multi-state database queries: Public selection queries must filter by `status = 'OFFICIAL'`; mitigated by indexing `idx_cities_status` and comprehensive repository test coverage.

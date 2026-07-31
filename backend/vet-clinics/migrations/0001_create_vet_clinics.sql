-- migrations/0001_create_vet_clinics.sql
--
-- Creates the vet_clinics table and all related indexes.
-- PostGIS must already be enabled (CREATE EXTENSION IF NOT EXISTS postgis).
-- Run BEFORE seed-vet-clinics.ts.

-- ─── Enum ──────────────────────────────────────────────────────────────────────

CREATE TYPE vet_clinic_source AS ENUM ('OSM', 'GOOGLE_PLACES', 'MANUAL');

-- ─── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE vet_clinics (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Names
  -- At least one will be non-null; Arabic shown first for Arabic-locale users.
  name_english      VARCHAR(200),
  name_arabic       VARCHAR(200),

  -- Location
  -- city_id is a soft FK resolved by KNN during seeding.
  -- Hard FK omitted intentionally — allows seeding before cities are fully stable.
  city_id           UUID          REFERENCES cities(id) ON DELETE SET NULL,
  area_name         VARCHAR(200),

  -- PostGIS POINT — same SRID=4326 as posts.coordinates
  coordinates       GEOMETRY(Point, 4326)  NOT NULL,

  -- Contact
  phone_number      TEXT,
  address           TEXT,
  website           TEXT,

  -- Metadata
  source            vet_clinic_source  NOT NULL DEFAULT 'OSM',
  osm_id            BIGINT,           -- NULL for MANUAL/GOOGLE_PLACES entries
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Indexes ───────────────────────────────────────────────────────────────────

-- Primary spatial index — powers <-> KNN operator in findNearest queries.
-- O(log n) scan even across thousands of clinics.
CREATE INDEX idx_vet_clinics_coordinates
  ON vet_clinics
  USING GIST (coordinates);

-- Dedup index for idempotent OSM re-seeding.
-- Partial: only OSM rows have osm_id; MANUAL/GOOGLE_PLACES rows are excluded.
CREATE UNIQUE INDEX idx_vet_clinics_osm_id
  ON vet_clinics (osm_id)
  WHERE osm_id IS NOT NULL;

-- Active + city filter for admin dashboards / city-level admin views.
CREATE INDEX idx_vet_clinics_active_city
  ON vet_clinics (is_active, city_id);

-- ─── Auto-update updated_at ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_vet_clinics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_vet_clinics_updated_at
  BEFORE UPDATE ON vet_clinics
  FOR EACH ROW
  EXECUTE FUNCTION update_vet_clinics_updated_at();

-- ─── Verification ──────────────────────────────────────────────────────────────
-- After seeding, run this to verify spatial index is being used:
--
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id, name_english,
--          ST_Distance(coordinates::geography,
--                      ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)::geography) / 1000 AS km
--   FROM vet_clinics
--   WHERE is_active = true
--   ORDER BY coordinates <-> ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)
--   LIMIT 3;
--
-- You should see "Index Scan using idx_vet_clinics_coordinates" — not a Seq Scan.

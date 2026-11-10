-- Additive; UUIDs and existing foreign keys are unchanged.
ALTER TABLE cities ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE cities ADD COLUMN IF NOT EXISTS district_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cities_district_fk' AND conrelid = 'cities'::regclass) THEN
    ALTER TABLE cities ADD CONSTRAINT cities_district_fk FOREIGN KEY (district_id) REFERENCES cities(id) ON DELETE RESTRICT;
    ALTER TABLE cities ADD CONSTRAINT cities_no_self_parent CHECK (district_id IS NULL OR district_id <> id);
    ALTER TABLE cities ADD CONSTRAINT cities_neighbourhood_namespace CHECK (district_id IS NULL OR (source_code IS NOT NULL AND source_code ~ '^(OSM:(node|way|relation)/[0-9]+|WD:Q[0-9]+|PUPZY:[a-z0-9-]+)$'));
    ALTER TABLE cities ADD CONSTRAINT cities_aliases_no_null CHECK (array_position(aliases, NULL) IS NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_cities_district_id ON cities(district_id);
-- Serialize catalog mutations before their statement snapshots are used. Normal reads remain concurrent.
CREATE OR REPLACE FUNCTION lock_city_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(726842109);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS cities_hierarchy_lock ON cities;
CREATE TRIGGER cities_hierarchy_lock BEFORE INSERT OR UPDATE OR DELETE ON cities
FOR EACH STATEMENT EXECUTE FUNCTION lock_city_hierarchy();
-- Deferred so an offline release can reparent/retire related rows in either order.
CREATE OR REPLACE FUNCTION check_city_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Check the row's final state and its direct children through indexed identity/parent lookups.
  IF EXISTS (
    SELECT 1 FROM cities child LEFT JOIN cities parent ON parent.id = child.district_id
    WHERE child.id = NEW.id AND (
      (child.source_code ~ '^(OSM:|WD:|PUPZY:)' AND child.district_id IS NULL) OR
      (child.district_id IS NOT NULL AND (parent.id IS NULL OR parent.district_id IS NOT NULL
        OR parent.status <> 'OFFICIAL' OR parent.governorate <> child.governorate))
    )
  ) OR EXISTS (
    SELECT 1 FROM cities parent JOIN cities child ON child.district_id = parent.id
    WHERE parent.id = NEW.id AND
      (parent.district_id IS NOT NULL OR parent.status <> 'OFFICIAL' OR parent.governorate <> child.governorate)
  ) THEN
    RAISE EXCEPTION 'Neighbourhood must belong to one OFFICIAL root district in the same governorate' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS cities_hierarchy_valid ON cities;
CREATE CONSTRAINT TRIGGER cities_hierarchy_valid AFTER INSERT OR UPDATE ON cities
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_city_hierarchy();

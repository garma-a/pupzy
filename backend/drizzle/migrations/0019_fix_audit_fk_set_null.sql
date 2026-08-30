-- Migration 0019: Fix vet_clinic_id FK to SET NULL and add append-only trigger.
--
-- Previously vet_clinic_location_audits.vet_clinic_id used ON DELETE CASCADE,
-- which would silently erase audit history when a clinic is deleted.
-- Ticket 06 requires SET NULL so the audit row survives clinic deletion.
-- Also makes vet_clinic_id nullable to accommodate the SET NULL behaviour, and
-- installs a trigger that prevents direct UPDATE / DELETE on committed audits.
-- FK ON DELETE SET NULL actions produce internal UPDATEs; the trigger permits
-- those by only blocking mutations that change non-FK columns or delete rows.

-- 1. Drop the old CASCADE foreign key
ALTER TABLE "vet_clinic_location_audits"
  DROP CONSTRAINT IF EXISTS "vet_clinic_location_audits_vet_clinic_id_vet_clinics_id_fk";
--> statement-breakpoint

-- 2. Make vet_clinic_id nullable (SET NULL requires the column to accept NULL)
ALTER TABLE "vet_clinic_location_audits"
  ALTER COLUMN "vet_clinic_id" DROP NOT NULL;
--> statement-breakpoint

-- 3. Re-add the FK with ON DELETE SET NULL ON UPDATE CASCADE
ALTER TABLE "vet_clinic_location_audits"
  ADD CONSTRAINT "vet_clinic_location_audits_vet_clinic_id_vet_clinics_id_fk"
    FOREIGN KEY ("vet_clinic_id")
    REFERENCES "public"."vet_clinics"("id")
    ON DELETE set null ON UPDATE cascade;
--> statement-breakpoint

-- 4. Also fix selected_city_id and nearest_city_id to be nullable
--    (declared NOT NULL in 0015 but referenced with ON DELETE SET NULL,
--     which is a logical contradiction – fix the nullability here).
ALTER TABLE "vet_clinic_location_audits"
  ALTER COLUMN "selected_city_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "vet_clinic_location_audits"
  ALTER COLUMN "nearest_city_id" DROP NOT NULL;
--> statement-breakpoint

-- 5. Append-only protection: prevent direct UPDATE / DELETE on committed audits.
--    FK ON DELETE SET NULL fires internal UPDATEs (permitted) but application-level
--    mutations are rejected.  We distinguish them by inspecting which columns changed:
--    an FK-driven nulling only touches the FK column(s) whose referencing row was deleted;
--    all other immutable columns remain identical (OLD.x = NEW.x).  Any update where a
--    non-FK immutable column differs is treated as a prohibited mutation.
CREATE OR REPLACE FUNCTION trg_prevent_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'vet_clinic_location_audits is append-only: direct updates and deletes are not permitted';
  END IF;

  -- For UPDATE: allow only FK SET NULL operations.
  -- An FK-driven SET NULL only sets the relevant FK column(s) to NULL; all other
  -- immutable payload columns (reason, coordinates, discrepancy_details, created_at, id)
  -- must remain byte-for-byte identical.
  IF (OLD.id                  IS DISTINCT FROM NEW.id) OR
     (OLD.reason              IS DISTINCT FROM NEW.reason) OR
     (OLD.coordinates::text   IS DISTINCT FROM NEW.coordinates::text) OR
     (OLD.discrepancy_details IS DISTINCT FROM NEW.discrepancy_details) OR
     (OLD.created_at          IS DISTINCT FROM NEW.created_at) THEN
    RAISE EXCEPTION 'vet_clinic_location_audits is append-only: direct updates and deletes are not permitted';
  END IF;

  -- Allow the FK-driven SET NULL to proceed
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_audit_append_only
  BEFORE UPDATE OR DELETE ON "vet_clinic_location_audits"
  FOR EACH ROW EXECUTE FUNCTION trg_prevent_audit_mutation();

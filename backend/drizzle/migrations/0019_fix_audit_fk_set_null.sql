-- Migration 0019: Preserve immutable Vet Clinic audit attribution and append-only trigger.
--
-- Retains non-null Vet Clinic, administrator, selected City, and nearest City
-- attribution with ON DELETE RESTRICT foreign keys, preventing deletion of referenced
-- entities while audit records depend on them, and installs a trigger that completely
-- rejects direct UPDATE and DELETE operations on committed audits.

-- 1. Refuse to invent or erase attribution from the immediately preceding schema.
-- The old administrator FK allowed NULL, but a committed audit with missing
-- attribution cannot be upgraded truthfully to the required immutable record.
DO $$
DECLARE
  missing_attribution text;
BEGIN
  SELECT string_agg(column_name, ', ')
    INTO missing_attribution
    FROM (
      SELECT 'vet_clinic_id' AS column_name
        WHERE EXISTS (SELECT 1 FROM "vet_clinic_location_audits" WHERE "vet_clinic_id" IS NULL)
      UNION ALL
      SELECT 'admin_user_id'
        WHERE EXISTS (SELECT 1 FROM "vet_clinic_location_audits" WHERE "admin_user_id" IS NULL)
      UNION ALL
      SELECT 'selected_city_id'
        WHERE EXISTS (SELECT 1 FROM "vet_clinic_location_audits" WHERE "selected_city_id" IS NULL)
      UNION ALL
      SELECT 'nearest_city_id'
        WHERE EXISTS (SELECT 1 FROM "vet_clinic_location_audits" WHERE "nearest_city_id" IS NULL)
    ) AS missing_columns;

  IF missing_attribution IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot safely preserve Vet Clinic audit attribution: committed audits have NULL %',
      missing_attribution
      USING ERRCODE = '23502',
        HINT = 'Restore the original Vet Clinic, administrator, selected City, and nearest City attribution before retrying this migration.';
  END IF;
END;
$$;
--> statement-breakpoint

-- 2. Drop old foreign keys if they exist
ALTER TABLE "vet_clinic_location_audits"
  DROP CONSTRAINT IF EXISTS "vet_clinic_location_audits_vet_clinic_id_vet_clinics_id_fk";
--> statement-breakpoint

ALTER TABLE "vet_clinic_location_audits"
  DROP CONSTRAINT IF EXISTS "vet_clinic_location_audits_admin_user_id_admin_users_id_fk";
--> statement-breakpoint

ALTER TABLE "vet_clinic_location_audits"
  DROP CONSTRAINT IF EXISTS "vet_clinic_location_audits_selected_city_id_cities_id_fk";
--> statement-breakpoint

ALTER TABLE "vet_clinic_location_audits"
  DROP CONSTRAINT IF EXISTS "vet_clinic_location_audits_nearest_city_id_cities_id_fk";
--> statement-breakpoint

-- 3. Enforce NOT NULL on all attribution columns
ALTER TABLE "vet_clinic_location_audits"
  ALTER COLUMN "vet_clinic_id" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "vet_clinic_location_audits"
  ALTER COLUMN "admin_user_id" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "vet_clinic_location_audits"
  ALTER COLUMN "selected_city_id" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "vet_clinic_location_audits"
  ALTER COLUMN "nearest_city_id" SET NOT NULL;
--> statement-breakpoint

-- 4. Re-add foreign keys with ON DELETE RESTRICT ON UPDATE CASCADE
ALTER TABLE "vet_clinic_location_audits"
  ADD CONSTRAINT "vet_clinic_location_audits_vet_clinic_id_vet_clinics_id_fk"
    FOREIGN KEY ("vet_clinic_id")
    REFERENCES "public"."vet_clinics"("id")
    ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint

ALTER TABLE "vet_clinic_location_audits"
  ADD CONSTRAINT "vet_clinic_location_audits_admin_user_id_admin_users_id_fk"
    FOREIGN KEY ("admin_user_id")
    REFERENCES "public"."admin_users"("id")
    ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint

ALTER TABLE "vet_clinic_location_audits"
  ADD CONSTRAINT "vet_clinic_location_audits_selected_city_id_cities_id_fk"
    FOREIGN KEY ("selected_city_id")
    REFERENCES "public"."cities"("id")
    ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint

ALTER TABLE "vet_clinic_location_audits"
  ADD CONSTRAINT "vet_clinic_location_audits_nearest_city_id_cities_id_fk"
    FOREIGN KEY ("nearest_city_id")
    REFERENCES "public"."cities"("id")
    ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint

-- 5. Append-only protection: prevent any direct UPDATE or DELETE on committed audits.
CREATE OR REPLACE FUNCTION trg_prevent_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'vet_clinic_location_audits is append-only: direct updates and deletes are not permitted';
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_audit_append_only ON "vet_clinic_location_audits";
--> statement-breakpoint

CREATE TRIGGER trg_audit_append_only
  BEFORE UPDATE OR DELETE ON "vet_clinic_location_audits"
  FOR EACH ROW EXECUTE FUNCTION trg_prevent_audit_mutation();

-- Use the same lock order as administrator mutations before taking schema/clinic locks.
SELECT revision FROM city_catalog_revisions WHERE id = 1 FOR UPDATE;
--> statement-breakpoint
-- Drizzle 0.45 executes ALL pending files in one transaction. Recreate the enum:
-- ALTER TYPE ADD VALUE, even in a separate file, cannot be consumed before commit.
ALTER TYPE public.vet_clinic_source RENAME TO vet_clinic_source_before_research;
--> statement-breakpoint
CREATE TYPE public.vet_clinic_source AS ENUM ('OSM', 'GOOGLE_PLACES', 'WEB_RESEARCH', 'MANUAL');
--> statement-breakpoint
ALTER TABLE vet_clinics ALTER COLUMN source DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE vet_clinics ALTER COLUMN source TYPE public.vet_clinic_source USING source::text::public.vet_clinic_source;
--> statement-breakpoint
ALTER TABLE vet_clinics ALTER COLUMN source SET DEFAULT 'OSM'::public.vet_clinic_source;
--> statement-breakpoint
DROP TYPE public.vet_clinic_source_before_research;
--> statement-breakpoint
ALTER TABLE vet_clinics ADD COLUMN is_24_hours boolean NOT NULL DEFAULT false,
 ADD COLUMN facebook_url text, ADD COLUMN source_key varchar(255);
--> statement-breakpoint
UPDATE vet_clinics SET source_key = 'OSM:' || osm_type || '/' || osm_id::text
 WHERE source = 'OSM' AND osm_id IS NOT NULL AND osm_type IS NOT NULL;
--> statement-breakpoint
ALTER TABLE vet_clinics ADD CONSTRAINT vet_clinics_source_key_unique UNIQUE (source_key);
--> statement-breakpoint
-- NOT VALID preserves administrator-owned legacy values; PostgreSQL still checks
-- every subsequent INSERT/UPDATE. Never silently rewrite administrator data.
ALTER TABLE vet_clinics ADD CONSTRAINT chk_vet_clinics_phone CHECK
 (phone_number IS NULL OR phone_number ~ '^\+20(1[0125][0-9]{8}|2[0-9]{8}|3[0-9]{7}|(13|40|45|46|47|48|50|55|57|62|64|65|66|68|69|82|84|86|88|92|93|95|96|97)[0-9]{7})$') NOT VALID;
--> statement-breakpoint
ALTER TABLE vet_clinics ADD CONSTRAINT chk_vet_clinics_website CHECK
 (website IS NULL OR website ~* '^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:]]*)?$') NOT VALID;
--> statement-breakpoint
ALTER TABLE vet_clinics ADD CONSTRAINT chk_vet_clinics_facebook CHECK
 (facebook_url IS NULL OR facebook_url ~* '^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:]]*)?$');

--> statement-breakpoint
-- Reviewed imports may use an address-matched catalog City centre.
ALTER TABLE vet_clinics ADD COLUMN location_precision varchar(10) NOT NULL DEFAULT 'street';
--> statement-breakpoint
ALTER TABLE vet_clinics ADD CONSTRAINT chk_vet_clinics_location_precision CHECK (location_precision IN ('exact', 'street', 'area'));

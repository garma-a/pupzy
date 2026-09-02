ALTER TABLE "vet_clinics" ADD COLUMN IF NOT EXISTS "address_english" text;--> statement-breakpoint
ALTER TABLE "vet_clinics" ADD COLUMN IF NOT EXISTS "address_arabic" text;--> statement-breakpoint
ALTER TABLE "vet_clinics" ADD COLUMN IF NOT EXISTS "location_provenance" varchar(50);--> statement-breakpoint
ALTER TABLE "vet_clinics" ADD COLUMN IF NOT EXISTS "location_captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vet_clinics" ADD COLUMN IF NOT EXISTS "osm_type" varchar(50);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vet_clinics" ADD CONSTRAINT "vet_clinics_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE set null ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

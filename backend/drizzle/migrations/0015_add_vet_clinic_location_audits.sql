CREATE TABLE IF NOT EXISTS "vet_clinic_location_audits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"vet_clinic_id" uuid NOT NULL,
	"admin_user_id" uuid,
	"selected_city_id" uuid NOT NULL,
	"nearest_city_id" uuid NOT NULL,
	"coordinates" geometry(Point, 4326) NOT NULL,
	"discrepancy_details" jsonb,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_vet_clinic_location_audits_reason_nonblank" CHECK (length(trim(reason)) > 0),
	CONSTRAINT "chk_vet_clinic_location_audits_coordinates_range" CHECK (
		ST_GeometryType(coordinates) = 'ST_Point'
		AND ST_SRID(coordinates) = 4326
		AND ST_X(coordinates) >= -180 AND ST_X(coordinates) <= 180
		AND ST_Y(coordinates) >= -90 AND ST_Y(coordinates) <= 90
	)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vet_clinic_location_audits" ADD CONSTRAINT "vet_clinic_location_audits_vet_clinic_id_vet_clinics_id_fk" FOREIGN KEY ("vet_clinic_id") REFERENCES "public"."vet_clinics"("id") ON DELETE cascade ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vet_clinic_location_audits" ADD CONSTRAINT "vet_clinic_location_audits_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vet_clinic_location_audits" ADD CONSTRAINT "vet_clinic_location_audits_selected_city_id_cities_id_fk" FOREIGN KEY ("selected_city_id") REFERENCES "public"."cities"("id") ON DELETE set null ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vet_clinic_location_audits" ADD CONSTRAINT "vet_clinic_location_audits_nearest_city_id_cities_id_fk" FOREIGN KEY ("nearest_city_id") REFERENCES "public"."cities"("id") ON DELETE set null ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vet_clinic_location_audits_clinic" ON "vet_clinic_location_audits" USING btree ("vet_clinic_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vet_clinic_location_audits_admin" ON "vet_clinic_location_audits" USING btree ("admin_user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vet_clinic_location_audits_created_at" ON "vet_clinic_location_audits" USING btree ("created_at");

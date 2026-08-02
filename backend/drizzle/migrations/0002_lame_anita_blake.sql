CREATE TYPE "public"."vet_clinic_source" AS ENUM('OSM', 'GOOGLE_PLACES', 'MANUAL');--> statement-breakpoint
CREATE TABLE "vet_clinics" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name_english" varchar(200),
	"name_arabic" varchar(200),
	"city_id" uuid,
	"area_name" varchar(200),
	"coordinates" geometry(point) NOT NULL,
	"phone_number" text,
	"address" text,
	"website" text,
	"source" "vet_clinic_source" DEFAULT 'OSM' NOT NULL,
	"osm_id" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_vet_clinics_coordinates" ON "vet_clinics" USING gist ("coordinates");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_vet_clinics_osm_id" ON "vet_clinics" USING btree ("osm_id") WHERE "vet_clinics"."osm_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_vet_clinics_active_city" ON "vet_clinics" USING btree ("is_active","city_id");
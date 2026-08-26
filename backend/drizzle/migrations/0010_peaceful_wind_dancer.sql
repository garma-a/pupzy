CREATE TYPE "public"."city_lifecycle_status" AS ENUM('OFFICIAL', 'LEGACY', 'RETIRED');--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "source_code" varchar(100);--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "source_name_english" varchar(100);--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "source_name_arabic" varchar(100);--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "status" "city_lifecycle_status" DEFAULT 'OFFICIAL' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_city_source_code" ON "cities" USING btree ("source_code");--> statement-breakpoint
CREATE INDEX "idx_cities_status" ON "cities" USING btree ("status");
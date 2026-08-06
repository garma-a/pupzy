ALTER TABLE "rescue_posts" ALTER COLUMN "species" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "lost_posts" ALTER COLUMN "species" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "adoption_posts" ALTER COLUMN "species" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "adoption_applications" ALTER COLUMN "species_preference" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "saved_searches" ALTER COLUMN "species" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."species_type";--> statement-breakpoint
CREATE TYPE "public"."species_type" AS ENUM('DOG', 'CAT', 'BIRD', 'OTHER');--> statement-breakpoint
ALTER TABLE "rescue_posts" ALTER COLUMN "species" SET DATA TYPE "public"."species_type" USING "species"::"public"."species_type";--> statement-breakpoint
ALTER TABLE "lost_posts" ALTER COLUMN "species" SET DATA TYPE "public"."species_type" USING "species"::"public"."species_type";--> statement-breakpoint
ALTER TABLE "adoption_posts" ALTER COLUMN "species" SET DATA TYPE "public"."species_type" USING "species"::"public"."species_type";--> statement-breakpoint
ALTER TABLE "adoption_applications" ALTER COLUMN "species_preference" SET DATA TYPE "public"."species_type" USING "species_preference"::"public"."species_type";--> statement-breakpoint
ALTER TABLE "saved_searches" ALTER COLUMN "species" SET DATA TYPE "public"."species_type" USING "species"::"public"."species_type";--> statement-breakpoint
ALTER TABLE "vet_clinics" ALTER COLUMN "coordinates" SET DATA TYPE geometry(Point, 4326);
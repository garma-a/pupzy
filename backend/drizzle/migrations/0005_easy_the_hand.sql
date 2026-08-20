DROP INDEX "uq_cities_name_english_governorate";--> statement-breakpoint
DROP INDEX "idx_posts_creator_created";--> statement-breakpoint
DROP INDEX "idx_posts_creator_status";--> statement-breakpoint
DROP INDEX "uq_post_media_cloudflare_storage_key";--> statement-breakpoint
DROP INDEX "uq_contact_request";--> statement-breakpoint
DROP INDEX "uq_adoption_application";--> statement-breakpoint
DROP INDEX "uq_post_report";--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "governorate" varchar(100);--> statement-breakpoint
ALTER TABLE "rescue_posts" ADD COLUMN "is_life_threatening" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "rescue_posts" ADD COLUMN "has_visible_serious_injury" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "rescue_posts" ADD COLUMN "is_in_dangerous_location" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "rescue_posts" ADD COLUMN "can_animal_move_or_escape" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "lost_posts" ADD COLUMN "has_medical_needs" boolean;--> statement-breakpoint
ALTER TABLE "lost_posts" ADD COLUMN "is_elderly_or_very_young" boolean;--> statement-breakpoint
ALTER TABLE "lost_posts" ADD COLUMN "last_seen_near_hazard" boolean;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_city_name_english_per_governorate" ON "cities" USING btree ("name_english","governorate");--> statement-breakpoint
CREATE INDEX "idx_posts_creator_post_type_id" ON "posts" USING btree ("creator_id","post_type","id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_post_media_cloudflare_storage_key" ON "post_media" USING btree ("cloudflare_storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_contact_request_per_post_and_requester" ON "contact_requests" USING btree ("post_id","requester_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_adoption_application_per_post_and_applicant" ON "adoption_applications" USING btree ("target_post_id","applicant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_post_report_per_post_and_reporter" ON "post_reports" USING btree ("post_id","reporter_id");
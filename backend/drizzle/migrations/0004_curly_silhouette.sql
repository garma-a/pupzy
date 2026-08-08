ALTER TYPE "public"."species_type" ADD VALUE 'RABBIT' BEFORE 'OTHER';--> statement-breakpoint
CREATE INDEX "idx_cities_center_point" ON "cities" USING gist ("center_point");--> statement-breakpoint
CREATE INDEX "idx_users_last_known_location" ON "users" USING gist ("last_known_location");--> statement-breakpoint
CREATE INDEX "idx_posts_coordinates" ON "posts" USING gist ("coordinates");--> statement-breakpoint
CREATE INDEX "idx_posts_help_feed" ON "posts" USING btree ("city_id","post_type","urgency","created_at") WHERE status='ACTIVE' AND post_type IN ('RESCUE','LOST');--> statement-breakpoint
CREATE INDEX "idx_adoption_personality_tags" ON "adoption_posts" USING gin ("personality_tags");--> statement-breakpoint
CREATE INDEX "idx_notifications_related_post" ON "notifications" USING btree ("related_post_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_related_contact_request" ON "notifications" USING btree ("related_contact_request_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_related_application" ON "notifications" USING btree ("related_application_id");
ALTER TABLE "users" ALTER COLUMN "phone_number" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_provider" varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_users_city_id" ON "users" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "idx_users_created_at" ON "users" USING btree ("created_at");
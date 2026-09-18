CREATE TYPE "public"."post_report_review_outcome" AS ENUM('NO_ACTION', 'ACTION_TAKEN');--> statement-breakpoint
ALTER TYPE "public"."moderation_action_type" ADD VALUE IF NOT EXISTS 'POST_REPORT_REVIEWED_NO_ACTION';--> statement-breakpoint
ALTER TYPE "public"."moderation_action_type" ADD VALUE IF NOT EXISTS 'ACCOUNT_REPORT_REVIEWED_NO_ACTION';--> statement-breakpoint
ALTER TABLE "post_reports" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "post_reports" ADD COLUMN IF NOT EXISTS "reviewed_by_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "post_reports" ADD COLUMN IF NOT EXISTS "review_outcome" "public"."post_report_review_outcome";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_reports" ADD CONSTRAINT "post_reports_reviewed_by_admin_id_admin_users_id_fk" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_post_reports_post_unreviewed" ON "post_reports" USING btree ("post_id") WHERE "reviewed_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_reports_reported_unreviewed" ON "account_reports" USING btree ("reported_user_id") WHERE "reviewed_at" IS NULL;

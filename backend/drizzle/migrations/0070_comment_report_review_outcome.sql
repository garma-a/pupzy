-- Comment Reports gain the same review outcome and reviewing administrator as
-- Post Reports and Pupzy Account Reports. The existing outcome enum fits
-- (NO_ACTION, ACTION_TAKEN). Rows already closed keep a NULL outcome and
-- reviewer (unknown), they are not invented. The mobile API never reads or
-- writes these columns. Administrators can also hide a Comment or only its
-- images from a report; the append-only audit records them with these types.
ALTER TYPE "public"."moderation_action_type" ADD VALUE IF NOT EXISTS 'COMMENT_HIDDEN';--> statement-breakpoint
ALTER TYPE "public"."moderation_action_type" ADD VALUE IF NOT EXISTS 'COMMENT_IMAGES_HIDDEN';--> statement-breakpoint
ALTER TABLE "comment_reports" ADD COLUMN IF NOT EXISTS "reviewed_by_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "comment_reports" ADD COLUMN IF NOT EXISTS "review_outcome" "public"."post_report_review_outcome";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_reviewed_by_admin_id_admin_users_id_fk" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

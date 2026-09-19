CREATE TYPE "public"."account_report_reason" AS ENUM('HARASSMENT', 'SPAM', 'SCAM_OR_FRAUD', 'IMPERSONATION', 'INAPPROPRIATE_CONDUCT', 'SAFETY_CONCERN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."account_report_source_type" AS ENUM('POST', 'COMMENT', 'CONTACT_REQUEST', 'ADOPTION_APPLICATION');--> statement-breakpoint
CREATE TYPE "public"."account_report_review_outcome" AS ENUM('NO_ACTION', 'ACTION_TAKEN');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reported_user_id" uuid NOT NULL,
	"reason" "public"."account_report_reason" NOT NULL,
	"details" text,
	"source_type" "public"."account_report_source_type",
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_admin_id" uuid,
	"review_outcome" "public"."account_report_review_outcome",
	CONSTRAINT "account_reports_no_self_report" CHECK ("reporter_id" <> "reported_user_id"),
	CONSTRAINT "account_reports_source_pair" CHECK (("source_type" IS NULL) = ("source_id" IS NULL))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_reports" ADD CONSTRAINT "account_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_reports" ADD CONSTRAINT "account_reports_reported_user_id_users_id_fk" FOREIGN KEY ("reported_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_reports" ADD CONSTRAINT "account_reports_reviewed_by_admin_id_admin_users_id_fk" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_open_account_report_per_reporter_and_reported" ON "account_reports" USING btree ("reporter_id","reported_user_id") WHERE "reviewed_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_reports_reported_created" ON "account_reports" USING btree ("reported_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_reports_reporter_created" ON "account_reports" USING btree ("reporter_id","created_at");

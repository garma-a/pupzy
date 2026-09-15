CREATE TABLE IF NOT EXISTS "comment_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"comment_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reason" "public"."report_reason" NOT NULL,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "comment_reports" ADD CONSTRAINT "comment_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_comment_report_per_comment_and_reporter" ON "comment_reports" USING btree ("comment_id", "reporter_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comment_reports_comment" ON "comment_reports" USING btree ("comment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comment_reports_reporter_created" ON "comment_reports" USING btree ("reporter_id", "created_at");

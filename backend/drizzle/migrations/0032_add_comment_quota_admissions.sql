CREATE TABLE IF NOT EXISTS "comment_quota_admissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" varchar(32) NOT NULL,
	"client_request_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "comment_quota_admissions" ADD CONSTRAINT "comment_quota_admissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "idx_comment_quota_admissions_user_action_created" ON "comment_quota_admissions" ("user_id", "action", "created_at");
CREATE INDEX IF NOT EXISTS "idx_comment_quota_admissions_user_client_request" ON "comment_quota_admissions" ("user_id", "client_request_id") WHERE "client_request_id" IS NOT NULL;

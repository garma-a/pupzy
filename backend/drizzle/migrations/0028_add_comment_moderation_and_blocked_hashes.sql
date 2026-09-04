ALTER TYPE "public"."moderation_action_type" ADD VALUE IF NOT EXISTS 'COMMENT_RESTORED';
--> statement-breakpoint
ALTER TYPE "public"."moderation_action_type" ADD VALUE IF NOT EXISTS 'COMMENT_REMOVED';
--> statement-breakpoint
ALTER TYPE "public"."moderation_target_type" ADD VALUE IF NOT EXISTS 'COMMENT';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blocked_media_hashes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sha256" text NOT NULL,
	"reason" text,
	"blocked_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "blocked_media_hashes" ADD CONSTRAINT "blocked_media_hashes_blocked_by_admin_id_admin_users_id_fk" FOREIGN KEY ("blocked_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_blocked_media_hashes_sha256" ON "blocked_media_hashes" USING btree ("sha256");

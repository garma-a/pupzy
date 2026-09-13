DO $$ BEGIN
 CREATE TYPE "public"."account_deletion_status" AS ENUM('PENDING', 'COMPLETED', 'FAILED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."account_deletion_step" AS ENUM('ACCEPTED', 'POSTS_DELETED', 'DATA_CLEANED', 'STORAGE_CLEANED', 'FIREBASE_USER_DELETED', 'COMPLETED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_deletions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"firebase_user_id" varchar(128) NOT NULL,
	"email" varchar(255) NOT NULL,
	"status" "account_deletion_status" DEFAULT 'PENDING' NOT NULL,
	"step" "account_deletion_step" DEFAULT 'ACCEPTED' NOT NULL,
	"progress_token_hash" varchar(128) NOT NULL,
	"media_cleanup_scope" jsonb,
	"storage_cleanup_attempts" integer DEFAULT 0 NOT NULL,
	"firebase_cleanup_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_retry_at" timestamp with time zone,
	"staged_upload_grace_until" timestamp with time zone,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"purge_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_deletions_firebase_user" ON "account_deletions" ("firebase_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_deletions_user_id" ON "account_deletions" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_deletions_status_retry" ON "account_deletions" ("status", "next_retry_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_account_deletions_purge" ON "account_deletions" ("purge_at");

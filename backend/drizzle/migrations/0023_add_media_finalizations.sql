DO $$ BEGIN
 CREATE TYPE "public"."media_finalization_status" AS ENUM('IN_FLIGHT', 'COMPENSATION_REQUIRED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_finalizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"media_id" varchar(64) NOT NULL,
	"staging_key" text NOT NULL,
	"final_key" text NOT NULL,
	"status" "media_finalization_status" DEFAULT 'IN_FLIGHT' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_media_finalizations_user_id" ON "media_finalizations" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_media_finalizations_status_updated" ON "media_finalizations" ("status", "updated_at");

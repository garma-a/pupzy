DO $$ BEGIN
  CREATE TYPE "public"."media_deletion_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "public"."staged_upload_status" ADD VALUE IF NOT EXISTS 'EXPIRED';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_deletion_work" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"storage_key" text NOT NULL,
	"cdn_url" text NOT NULL,
	"status" "public"."media_deletion_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_media_deletion_work_status" ON "media_deletion_work" USING btree ("status");

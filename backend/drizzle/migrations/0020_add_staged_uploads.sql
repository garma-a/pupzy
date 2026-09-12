DO $$ BEGIN
  CREATE TYPE "public"."staged_upload_purpose" AS ENUM('POST_MEDIA', 'COMMENT_IMAGE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."staged_upload_status" AS ENUM('ISSUED', 'CLAIMED', 'FINALIZED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staged_uploads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "public"."staged_upload_purpose" DEFAULT 'POST_MEDIA' NOT NULL,
	"staging_key" text NOT NULL,
	"declared_content_type" varchar(100) NOT NULL,
	"declared_file_size_bytes" integer NOT NULL,
	"status" "public"."staged_upload_status" DEFAULT 'ISSUED' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"post_id" uuid,
	"final_storage_key" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staged_uploads_staging_key_unique" UNIQUE("staging_key")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "staged_uploads" ADD CONSTRAINT "staged_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "staged_uploads" ADD CONSTRAINT "staged_uploads_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_staged_uploads_user_purpose" ON "staged_uploads" USING btree ("user_id", "purpose");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_staged_uploads_status_expires_at" ON "staged_uploads" USING btree ("status", "expires_at");

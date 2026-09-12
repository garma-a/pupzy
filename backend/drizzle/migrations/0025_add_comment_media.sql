CREATE TABLE IF NOT EXISTS "comment_media" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"comment_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"file_content_type" text DEFAULT 'image/webp' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "comment_media" ADD CONSTRAINT "comment_media_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comment_media_comment_id" ON "comment_media" USING btree ("comment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comment_media_sha256" ON "comment_media" USING btree ("sha256");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comment_media_comment_display_order" ON "comment_media" USING btree ("comment_id", "display_order");

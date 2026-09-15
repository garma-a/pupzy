CREATE TABLE IF NOT EXISTS "post_pins" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"post_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "post_pins" ADD CONSTRAINT "post_pins_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "post_pins" ADD CONSTRAINT "post_pins_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_post_pins_post_id" ON "post_pins" USING btree ("post_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_post_pins_comment_id" ON "post_pins" USING btree ("comment_id");

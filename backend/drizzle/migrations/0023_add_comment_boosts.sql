ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "boost_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comment_boosts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_comment_boosts_user_comment" UNIQUE("user_id", "comment_id")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "comment_boosts" ADD CONSTRAINT "comment_boosts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "comment_boosts" ADD CONSTRAINT "comment_boosts_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comment_boosts_comment_id" ON "comment_boosts" USING btree ("comment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comments_post_status_boost_created" ON "comments" USING btree ("post_id", "status", "boost_count" DESC, "created_at" DESC, "id" DESC);

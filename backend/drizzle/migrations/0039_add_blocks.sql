CREATE TABLE IF NOT EXISTS "blocks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_no_self_block" CHECK ("blocker_id" <> "blocked_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_block_ordered_pair" ON "blocks" USING btree ("blocker_id", "blocked_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blocks_blocked" ON "blocks" USING btree ("blocked_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blocks_blocker_created" ON "blocks" USING btree ("blocker_id", "created_at" DESC, "id" DESC);

-- Ticket 03: Notify rescue participants of closure and reopening.
--
-- Durable post completion notification events and audience snapshot recipients.
-- Captures stable closure-time audience (boosters, savers, comment/reply authors,
-- contact requesters) atomically in the post closure transaction, and supports
-- bounded restartable batch delivery and reopening corrections.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'POST_COMPLETED';
--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'POST_REOPENED';
--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'RESCUE_COMPLETED';
--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'RESCUE_REOPENED';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_completion_notification_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"post_id" uuid NOT NULL,
	"post_type" varchar(32) NOT NULL,
	"outcome" varchar(32) NOT NULL,
	"closing_actor_id" uuid,
	"type" "notification_type" NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"title_arabic" varchar(200) NOT NULL,
	"body_arabic" text NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"total_recipients" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_completion_recipients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"notification_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_completion_notification_events" ADD CONSTRAINT "post_completion_notification_events_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_completion_notification_events" ADD CONSTRAINT "post_completion_notification_events_closing_actor_id_users_id_fk" FOREIGN KEY ("closing_actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_completion_recipients" ADD CONSTRAINT "post_completion_recipients_event_id_post_completion_notification_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."post_completion_notification_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_completion_recipients" ADD CONSTRAINT "post_completion_recipients_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_completion_recipients" ADD CONSTRAINT "post_completion_recipients_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_completion_recipients" ADD CONSTRAINT "post_completion_recipients_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_post_completion_events_post_status" ON "post_completion_notification_events" USING btree ("post_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_post_completion_recipients_event_user" ON "post_completion_recipients" USING btree ("event_id","recipient_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_post_completion_recipients_due" ON "post_completion_recipients" USING btree ("status","next_attempt_at","id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_post_completion_recipients_post_status" ON "post_completion_recipients" USING btree ("post_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_post_completion_recipients_lease" ON "post_completion_recipients" USING btree ("lease_expires_at");

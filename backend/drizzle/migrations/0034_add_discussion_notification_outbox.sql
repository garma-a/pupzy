-- Transactional outbox for discussion notifications. Source mutations insert
-- one durable event in their own transaction; the always-on API drains it.
CREATE TABLE IF NOT EXISTS "discussion_notification_events" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "source_event_id" varchar(160) NOT NULL,
  "recipient_id" uuid NOT NULL,
  "actor_id" uuid,
  "type" "notification_type" NOT NULL,
  "title" varchar(200) NOT NULL,
  "body" text NOT NULL,
  "related_post_id" uuid,
  "related_comment_id" uuid,
  "status" varchar(16) NOT NULL DEFAULT 'PENDING',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "next_attempt_at" timestamp with time zone NOT NULL DEFAULT now(),
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "uq_discussion_notification_events_source" UNIQUE("source_event_id"),
  CONSTRAINT "discussion_notification_events_status_check"
    CHECK ("status" IN ('PENDING', 'PROCESSING', 'DELIVERED')),
  CONSTRAINT "discussion_notification_events_attempts_check" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "discussion_notification_events"
    ADD CONSTRAINT "discussion_notification_events_recipient_id_users_id_fk"
    FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "discussion_notification_events"
    ADD CONSTRAINT "discussion_notification_events_actor_id_users_id_fk"
    FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "discussion_notification_events"
    ADD CONSTRAINT "discussion_notification_events_related_post_id_posts_id_fk"
    FOREIGN KEY ("related_post_id") REFERENCES "public"."posts"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "discussion_notification_events"
    ADD CONSTRAINT "discussion_notification_events_related_comment_id_comments_id_fk"
    FOREIGN KEY ("related_comment_id") REFERENCES "public"."comments"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_discussion_notification_events_due"
  ON "discussion_notification_events" ("status", "next_attempt_at", "created_at", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_discussion_notification_events_processing_lease"
  ON "discussion_notification_events" ("lease_expires_at")
  WHERE "status" = 'PROCESSING';
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "discussion_event_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_discussion_event_id_discussion_notification_events_id_fk"
    FOREIGN KEY ("discussion_event_id") REFERENCES "public"."discussion_notification_events"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notifications_discussion_event_id"
  ON "notifications" ("discussion_event_id")
  WHERE "discussion_event_id" IS NOT NULL;

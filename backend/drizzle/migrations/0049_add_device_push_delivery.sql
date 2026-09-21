-- Ticket 11: device registration and durable push delivery.
--
-- `device_registrations` owns one row per provider token. The global token
-- uniqueness makes registration idempotent and supports token rotation or
-- reassignment to another account. `push_deliveries` is the durable intent
-- outbox: one row per (notification, device), written in the same transaction
-- as its notification, so a rolled-back notification can never be pushed.
CREATE TABLE IF NOT EXISTS "device_registrations" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "user_id" uuid NOT NULL,
  "token" varchar(512) NOT NULL,
  "platform" varchar(16) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "uq_device_registrations_token" UNIQUE("token"),
  CONSTRAINT "device_registrations_platform_check" CHECK ("platform" IN ('ANDROID', 'IOS'))
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "device_registrations"
    ADD CONSTRAINT "device_registrations_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_device_registrations_user" ON "device_registrations" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "notification_id" uuid NOT NULL,
  "recipient_id" uuid NOT NULL,
  "actor_id" uuid,
  "device_id" uuid NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'PENDING',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "next_attempt_at" timestamp with time zone NOT NULL DEFAULT now(),
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "uq_push_deliveries_notification_device" UNIQUE("notification_id", "device_id"),
  CONSTRAINT "push_deliveries_status_check"
    CHECK ("status" IN ('PENDING', 'PROCESSING', 'DELIVERED', 'SUPPRESSED', 'FAILED')),
  CONSTRAINT "push_deliveries_attempts_check" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "push_deliveries"
    ADD CONSTRAINT "push_deliveries_notification_id_notifications_id_fk"
    FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "push_deliveries"
    ADD CONSTRAINT "push_deliveries_recipient_id_users_id_fk"
    FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "push_deliveries"
    ADD CONSTRAINT "push_deliveries_actor_id_users_id_fk"
    FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "push_deliveries"
    ADD CONSTRAINT "push_deliveries_device_id_device_registrations_id_fk"
    FOREIGN KEY ("device_id") REFERENCES "public"."device_registrations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_deliveries_due"
  ON "push_deliveries" ("status", "next_attempt_at", "created_at", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_deliveries_processing_lease"
  ON "push_deliveries" ("lease_expires_at")
  WHERE "status" = 'PROCESSING';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_deliveries_device" ON "push_deliveries" ("device_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_deliveries_recipient" ON "push_deliveries" ("recipient_id");

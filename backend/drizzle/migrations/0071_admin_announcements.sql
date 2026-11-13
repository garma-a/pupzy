-- Admin Announcements: a SUPER_ADMIN writes one durable `announcements` row (and an
-- audit row); the Nest backend fans it out in bounded batches. The new notification
-- type, the audit action/target values, the per-recipient uniqueness guard that makes
-- fan-out idempotent, a (home_city_id, id) index for the City keyset walk, a unique request key that makes
-- sending idempotent, and a priority on push delivery intents.
-- ADD VALUE only adds labels; nothing here uses a new label inside this migration.
CREATE TYPE "public"."announcement_audience" AS ENUM('ALL', 'CITY');--> statement-breakpoint
CREATE TYPE "public"."announcement_status" AS ENUM('PENDING', 'SENDING', 'SENT', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'ADMIN_ANNOUNCEMENT';--> statement-breakpoint
ALTER TYPE "public"."moderation_action_type" ADD VALUE IF NOT EXISTS 'ANNOUNCEMENT_SENT';--> statement-breakpoint
ALTER TYPE "public"."moderation_target_type" ADD VALUE IF NOT EXISTS 'ANNOUNCEMENT';--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sent_by_admin_id" uuid,
	"request_key" uuid NOT NULL,
	"audience" "announcement_audience" NOT NULL,
	"audience_city_id" uuid,
	"audience_city_name" varchar(200),
	"title_en" varchar(80) NOT NULL,
	"body_en" varchar(500) NOT NULL,
	"title_ar" varchar(80) NOT NULL,
	"body_ar" varchar(500) NOT NULL,
	"status" "announcement_status" DEFAULT 'PENDING' NOT NULL,
	"failure_reason" text,
	"audience_cutoff_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_recipients" integer NOT NULL,
	"cursor_user_id" uuid,
	"in_app_count" integer DEFAULT 0 NOT NULL,
	"push_intent_count" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_audience_city" CHECK ("announcements"."audience" <> 'ALL' OR "announcements"."audience_city_id" IS NULL),
	CONSTRAINT "announcements_text_not_blank" CHECK (btrim("announcements"."title_en") <> '' AND btrim("announcements"."body_en") <> '' AND btrim("announcements"."title_ar") <> '' AND btrim("announcements"."body_ar") <> '')
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "announcement_id" uuid;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_sent_by_admin_id_admin_users_id_fk" FOREIGN KEY ("sent_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_audience_city_id_cities_id_fk" FOREIGN KEY ("audience_city_id") REFERENCES "public"."cities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_announcements_work" ON "announcements" USING btree ("next_attempt_at","created_at") WHERE status IN ('PENDING', 'SENDING');--> statement-breakpoint
CREATE INDEX "idx_announcements_created" ON "announcements" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_announcements_request_key" ON "announcements" USING btree ("request_key");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_users_home_city_id" ON "users" USING btree ("home_city_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notifications_announcement_recipient" ON "notifications" USING btree ("announcement_id","recipient_id") WHERE announcement_id IS NOT NULL;
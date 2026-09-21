-- Durable inactivity-expiry state on the canonical Post row.
-- `renewed_at` enforces the seven-day owner renewal cooldown; `reminder_sent_at`
-- makes the one-reminder-per-inactivity-cycle guarantee survive retries and
-- multi-instance execution. Both are nullable and carry no default, so existing
-- Posts keep their current behavior until an expiry or renewal actually runs.
ALTER TABLE "posts" ADD COLUMN "renewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "reminder_sent_at" timestamp with time zone;

-- Ticket 07: explicit ar/en language synchronization and bilingual notifications.
--
-- The historic `language_preference` default 'ar' was never an explicit user
-- decision. Legacy rows are cleared and the column keeps no default, so an
-- unsynchronized account stays NULL and falls back to English until the user
-- explicitly synchronizes a language. Replaying this migration is harmless.
ALTER TABLE "users" ALTER COLUMN "language_preference" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "language_preference" DROP NOT NULL;--> statement-breakpoint
UPDATE "users" SET "language_preference" = NULL WHERE "language_preference" = 'ar';--> statement-breakpoint
-- Arabic content is produced by the centralized template contract at creation
-- time. Legacy rows stay NULL and safely render their English columns.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "title_arabic" varchar(200);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "body_arabic" text;--> statement-breakpoint
ALTER TABLE "discussion_notification_events" ADD COLUMN IF NOT EXISTS "title_arabic" varchar(200);--> statement-breakpoint
ALTER TABLE "discussion_notification_events" ADD COLUMN IF NOT EXISTS "body_arabic" text;

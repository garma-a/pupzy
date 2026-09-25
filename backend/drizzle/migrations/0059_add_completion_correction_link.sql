-- Reopening corrections are durable events delivered by the completion
-- worker, so the correction must stay durably linked to the closure event it
-- corrects. Nullable for closure events; ON DELETE SET NULL preserves the
-- correction if its closure event is ever removed.
ALTER TABLE "post_completion_notification_events"
  ADD COLUMN IF NOT EXISTS "corrects_event_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_completion_notification_events" ADD CONSTRAINT "post_completion_notification_events_corrects_event_id_post_completion_notification_events_id_fk" FOREIGN KEY ("corrects_event_id") REFERENCES "public"."post_completion_notification_events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

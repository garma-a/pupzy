-- Suppressed discussion notifications are terminal: when an active Block
-- isolates the source actor from the recipient, delayed delivery stops
-- retrying without creating an inbox row or deleting the durable event.
ALTER TABLE "discussion_notification_events"
  DROP CONSTRAINT IF EXISTS "discussion_notification_events_status_check";--> statement-breakpoint
ALTER TABLE "discussion_notification_events"
  ADD CONSTRAINT "discussion_notification_events_status_check"
  CHECK ("status" IN ('PENDING', 'PROCESSING', 'DELIVERED', 'SUPPRESSED'));

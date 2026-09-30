CREATE TABLE post_notification_preferences (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
--> statement-breakpoint
CREATE INDEX idx_post_notification_preferences_user ON post_notification_preferences (user_id);
--> statement-breakpoint
CREATE INDEX idx_discussion_notifications_pending_recipient_post
  ON discussion_notification_events (recipient_id, related_post_id)
  WHERE status IN ('PENDING', 'PROCESSING');

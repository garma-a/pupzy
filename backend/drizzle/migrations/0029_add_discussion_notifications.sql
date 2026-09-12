-- Migration 0029: Add discussion notification types and related_comment_id column
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'NEW_COMMENT';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'NEW_REPLY';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'COMMENT_BOOSTED';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'COMMENT_PINNED';

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "related_comment_id" uuid REFERENCES "comments"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_notifications_related_comment" ON "notifications" ("related_comment_id");

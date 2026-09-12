ALTER TABLE "comment_reports" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "idx_comment_reports_comment_unreviewed" ON "comment_reports" ("comment_id") WHERE "reviewed_at" IS NULL;

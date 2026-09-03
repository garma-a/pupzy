ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "reply_count" integer DEFAULT 0 NOT NULL;

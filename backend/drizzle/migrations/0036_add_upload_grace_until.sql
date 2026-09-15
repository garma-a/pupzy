ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "upload_grace_until" timestamp with time zone;

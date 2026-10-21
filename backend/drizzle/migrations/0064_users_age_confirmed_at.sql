-- Age confirmation (Terms of Service: Pupzy is for people aged 18 and over).
--
-- Recorded when the account accepts the Terms and confirms it is 18 or older.
-- Nullable and intentionally not backfilled: a NULL value means the account
-- has never confirmed its age, so it is asked once before it can publish or
-- submit, even if it already accepted the current Terms version. Account
-- Deletion removes the row, and therefore this record, with the account.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "age_confirmed_at" timestamp with time zone;

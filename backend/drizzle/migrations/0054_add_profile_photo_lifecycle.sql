-- Owned profile photos: the durable Staged Upload pipeline gains a dedicated
-- purpose so an avatar ticket can never be attached to a Post or Comment.
-- `profile_photo_storage_key` records the owned R2 object (NULL for a
-- provider-synced or absent picture) and `profile_photo_changed_at` marks the
-- user's explicit set/remove decision so provider synchronization can no
-- longer restore a picture the user removed.
ALTER TYPE "public"."staged_upload_purpose" ADD VALUE IF NOT EXISTS 'PROFILE_PHOTO';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profile_photo_storage_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profile_photo_changed_at" timestamp with time zone;

-- An administrator can remove a User's profile photo from the admin service
-- with the same effects as the app's own removal (clear the picture and owned
-- key, set the change marker, queue the stored object for deletion). The
-- append-only moderation audit records it with this action type.
ALTER TYPE "public"."moderation_action_type" ADD VALUE IF NOT EXISTS 'USER_PROFILE_PHOTO_REMOVED';

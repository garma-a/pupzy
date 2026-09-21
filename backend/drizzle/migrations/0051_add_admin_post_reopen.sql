-- Administrator Post reopening records its actor, internal reason and the
-- corrected outcome in the append-only moderation audit, and notifies the Post
-- owner with the localized POST_REOPENED_BY_ADMIN content. Both values are
-- added alone so a later migration may safely reference them in the same
-- deployment.
ALTER TYPE "public"."moderation_action_type" ADD VALUE IF NOT EXISTS 'POST_REOPENED';
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'POST_REOPENED_BY_ADMIN';

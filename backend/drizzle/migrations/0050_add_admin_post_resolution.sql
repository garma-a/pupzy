-- Administrator Post Resolution records its actor, internal reason and outcome
-- in the append-only moderation audit, and notifies the Post owner with the
-- localized POST_RESOLVED_BY_ADMIN content. Both values are added alone so a
-- later migration may safely reference them in the same deployment.
ALTER TYPE "public"."moderation_action_type" ADD VALUE IF NOT EXISTS 'POST_RESOLVED';
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'POST_RESOLVED_BY_ADMIN';

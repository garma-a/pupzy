CREATE TABLE IF NOT EXISTS "user_ban_post_cascades" (
  "action_id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "ban_marker" varchar(40) NOT NULL,
  "cursor_post_id" uuid,
  "cascaded_post_count" integer NOT NULL DEFAULT 0,
  "state" varchar(16) NOT NULL DEFAULT 'PENDING',
  "notification_sent_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone,
  CONSTRAINT "user_ban_post_cascades_state_check" CHECK ("state" IN ('PENDING', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT "user_ban_post_cascades_count_check" CHECK ("cascaded_post_count" >= 0)
);

DO $$ BEGIN
  ALTER TABLE "user_ban_post_cascades"
    ADD CONSTRAINT "user_ban_post_cascades_action_id_moderation_actions_id_fk"
    FOREIGN KEY ("action_id") REFERENCES "moderation_actions"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "user_ban_post_cascades"
    ADD CONSTRAINT "user_ban_post_cascades_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "idx_user_ban_post_cascades_pending"
  ON "user_ban_post_cascades" ("created_at", "action_id")
  WHERE "state" = 'PENDING';

-- A ban cascade resumes by creator, ACTIVE state, and an ascending UUID
-- cursor. The older creator/status/created_at and creator/post_type/id
-- indexes cannot retain that ordering, so they would make every later page
-- sort or rescan the account's earlier Posts.
CREATE INDEX IF NOT EXISTS "idx_posts_active_creator_id_id"
  ON public."posts" ("creator_id", "id")
  WHERE "status" = 'ACTIVE';

-- The ordinary Firebase guard is intentionally not the sole ban boundary:
-- an already-authorized request can be in flight while AdminJS bans its user.
-- This trigger serializes every ACTIVE Post insertion/restoration with the
-- ban's user-row lock. If creation wins, the ban scans/removes it after the
-- user lock is released; if the ban wins, ACTIVE persistence is rejected.
CREATE OR REPLACE FUNCTION public.prevent_banned_creator_active_post()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  creator_is_banned boolean;
BEGIN
  IF NEW.status = 'ACTIVE' THEN
    SELECT is_banned
      INTO creator_is_banned
      FROM public.users
      WHERE public.users.id = NEW.creator_id
      FOR SHARE;

    IF creator_is_banned THEN
      RAISE EXCEPTION 'ACTIVE_POST_CREATOR_BANNED' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_banned_creator_active_post ON public.posts;
CREATE TRIGGER trg_prevent_banned_creator_active_post
  BEFORE INSERT OR UPDATE OF status, creator_id ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_banned_creator_active_post();

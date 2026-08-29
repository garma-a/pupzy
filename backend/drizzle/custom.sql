-- Repeatable post-migration SQL is limited to idempotent performance indexes.
-- Structural DDL, constraints, functions, and triggers belong in ordered files
-- under drizzle/migrations so a deploy never drops and recreates them on every
-- start.

-- Match active feed predicates and keyset ordering without changing returned rows.
CREATE INDEX IF NOT EXISTS idx_posts_help_city_ordered
  ON posts (city_id, urgency ASC, created_at DESC, id DESC)
  WHERE status = 'ACTIVE' AND post_type IN ('RESCUE', 'LOST');

CREATE INDEX IF NOT EXISTS idx_posts_help_governorate_ordered
  ON posts (governorate, urgency ASC, created_at DESC, id DESC)
  WHERE status = 'ACTIVE' AND post_type IN ('RESCUE', 'LOST');

CREATE INDEX IF NOT EXISTS idx_posts_adopt_city_newest
  ON posts (city_id, id DESC)
  WHERE status = 'ACTIVE' AND post_type = 'ADOPTION';

CREATE INDEX IF NOT EXISTS idx_posts_adopt_governorate_newest
  ON posts (governorate, id DESC)
  WHERE status = 'ACTIVE' AND post_type = 'ADOPTION';

CREATE INDEX IF NOT EXISTS idx_posts_market_city_newest
  ON posts (city_id, id DESC)
  WHERE status = 'ACTIVE' AND post_type = 'PRODUCT';

CREATE INDEX IF NOT EXISTS idx_posts_market_governorate_newest
  ON posts (governorate, id DESC)
  WHERE status = 'ACTIVE' AND post_type = 'PRODUCT';

CREATE INDEX IF NOT EXISTS idx_posts_market_city_category_newest
  ON posts (city_id, market_category, id DESC)
  WHERE status = 'ACTIVE' AND post_type = 'PRODUCT';

CREATE INDEX IF NOT EXISTS idx_posts_home_governorate_newest
  ON posts (governorate, id DESC)
  WHERE status = 'ACTIVE';

-- Operator support for AdminJS SQL filter compatibility with enum columns.
CREATE OR REPLACE FUNCTION city_lifecycle_status_ilike(val city_lifecycle_status, pattern text)
RETURNS boolean AS $$
  SELECT val::text ILIKE pattern;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION city_lifecycle_status_like(val city_lifecycle_status, pattern text)
RETURNS boolean AS $$
  SELECT val::text LIKE pattern;
$$ LANGUAGE sql IMMUTABLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_operator
    WHERE oprname = '~~*'
      AND oprleft = 'city_lifecycle_status'::regtype
      AND oprright = 'text'::regtype
  ) THEN
    CREATE OPERATOR ~~* (
      LEFTARG = city_lifecycle_status,
      RIGHTARG = text,
      PROCEDURE = city_lifecycle_status_ilike
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_operator
    WHERE oprname = '~~'
      AND oprleft = 'city_lifecycle_status'::regtype
      AND oprright = 'text'::regtype
  ) THEN
    CREATE OPERATOR ~~ (
      LEFTARG = city_lifecycle_status,
      RIGHTARG = text,
      PROCEDURE = city_lifecycle_status_like
    );
  END IF;
END $$;

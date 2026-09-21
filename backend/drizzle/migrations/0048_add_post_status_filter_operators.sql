-- Operator support for AdminJS SQL filter compatibility on the post_status
-- enum, matching migration 0017's city_lifecycle_status pattern. The SQL
-- adapter filters enum columns with ILIKE, so without these operators a
-- lifecycle filter such as status=EXPIRED fails at the database level. The
-- Post History/status filter therefore could not reach expired listings.
CREATE OR REPLACE FUNCTION post_status_ilike(val post_status, pattern text)
RETURNS boolean AS $$
  SELECT val::text ILIKE pattern;
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint
CREATE OR REPLACE FUNCTION post_status_like(val post_status, pattern text)
RETURNS boolean AS $$
  SELECT val::text LIKE pattern;
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_operator
    WHERE oprname = '~~*'
      AND oprleft = 'post_status'::regtype
      AND oprright = 'text'::regtype
  ) THEN
    CREATE OPERATOR ~~* (
      LEFTARG = post_status,
      RIGHTARG = text,
      PROCEDURE = post_status_ilike
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_operator
    WHERE oprname = '~~'
      AND oprleft = 'post_status'::regtype
      AND oprright = 'text'::regtype
  ) THEN
    CREATE OPERATOR ~~ (
      LEFTARG = post_status,
      RIGHTARG = text,
      PROCEDURE = post_status_like
    );
  END IF;
END $$;

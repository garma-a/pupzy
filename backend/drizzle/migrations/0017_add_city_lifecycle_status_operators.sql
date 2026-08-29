-- Operator support for AdminJS SQL filter compatibility with enum columns.
CREATE OR REPLACE FUNCTION city_lifecycle_status_ilike(val city_lifecycle_status, pattern text)
RETURNS boolean AS $$
  SELECT val::text ILIKE pattern;
$$ LANGUAGE sql IMMUTABLE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION city_lifecycle_status_like(val city_lifecycle_status, pattern text)
RETURNS boolean AS $$
  SELECT val::text LIKE pattern;
$$ LANGUAGE sql IMMUTABLE;
--> statement-breakpoint
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

-- Give posts.coordinates the SRID the schema has always declared.
--
-- 0001 converted the column to `geometry(point)` without an SRID, and no later
-- migration corrected it (vet_clinics got the equivalent fix in 0003). Posts
-- are inserted from a [longitude, latitude] tuple, which arrives with SRID 0,
-- so on any database built from these migrations every post was stored with
-- SRID 0. Radius filters compare against SRID 4326 points, and PostGIS
-- rejects the mix: helpFeed / homeFeed / adoptFeed / marketFeed with a city
-- or viewer location failed with "Operation on mixed SRID geometries".
--
-- Databases that already have geometry(Point, 4326) (for example ones created
-- with drizzle-kit push from the schema) are left untouched. On affected
-- databases this rewrites `posts` under an ACCESS EXCLUSIVE lock and rebuilds
-- idx_posts_coordinates; schedule it like any other table rewrite.
DO $$
BEGIN
  IF (
    SELECT format_type(a.atttypid, a.atttypmod)
    FROM pg_attribute a
    WHERE a.attrelid = 'public.posts'::regclass AND a.attname = 'coordinates'
  ) IS DISTINCT FROM 'geometry(Point,4326)' THEN
    ALTER TABLE "posts"
      ALTER COLUMN "coordinates" TYPE geometry(Point, 4326)
      USING ST_SetSRID("coordinates", 4326);
  END IF;
END
$$;

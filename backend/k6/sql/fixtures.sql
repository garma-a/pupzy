-- k6/sql/fixtures.sql
--
-- Run against your TEST database to generate k6/fixtures.json:
--
--   psql $TEST_DATABASE_URL -t -A -c "$(cat k6/sql/fixtures.sql)" > k6/fixtures.json
--
-- Or with a file redirect (avoids shell quoting issues):
--
--   psql $TEST_DATABASE_URL -t -A -f k6/sql/fixtures.sql > k6/fixtures.json
--
-- Requirements before running:
--   • At least 300 ACTIVE RESCUE posts in the `posts` table
--   • At least 300 ACTIVE ADOPTION posts
--   • At least 200 ACTIVE PRODUCT posts
--   • At least 200 ACTIVE LOST posts
--   • Cities seeded in the `cities` table
--
-- The output is a single JSON object (no array wrapper).
-- fixtures.js wraps it in [{ ... }] when loading via SharedArray.

SELECT json_build_object(

  -- ── Post ID pools ──────────────────────────────────────────────────────────
  'rescuePostIds',
  (
    SELECT json_agg(id)
    FROM (
      SELECT id
      FROM   posts
      WHERE  post_type = 'RESCUE'
        AND  status    = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT  300
    ) t
  ),

  'adoptionPostIds',
  (
    SELECT json_agg(id)
    FROM (
      SELECT id
      FROM   posts
      WHERE  post_type = 'ADOPTION'
        AND  status    = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT  300
    ) t
  ),

  'productPostIds',
  (
    SELECT json_agg(id)
    FROM (
      SELECT id
      FROM   posts
      WHERE  post_type = 'PRODUCT'
        AND  status    = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT  200
    ) t
  ),

  'lostPostIds',
  (
    SELECT json_agg(id)
    FROM (
      SELECT id
      FROM   posts
      WHERE  post_type = 'LOST'
        AND  status    = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT  200
    ) t
  ),

  -- ── City IDs (all seeded cities) ───────────────────────────────────────────
  'cityIds',
  (
    SELECT json_agg(id)
    FROM   cities
  ),

  -- ── Static governorate list (matches your seed data) ──────────────────────
  'governorates',
  json_build_array(
    'Cairo',
    'Alexandria',
    'Giza',
    'Luxor',
    'Aswan'
  ),

  -- ── Geographic centres used for PostGIS tests ──────────────────────────────
  -- Cairo city centre (Tahrir Square area)
  'cairoCenter',
  json_build_object(
    'latitude',  30.0444,
    'longitude', 31.2357
  ),

  -- Alexandria city centre (Corniche area)
  'alexCenter',
  json_build_object(
    'latitude',  31.2001,
    'longitude', 29.9187
  )

);

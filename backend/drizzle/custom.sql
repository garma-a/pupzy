-- =============================================================================
-- Pupzy — Custom Migration SQL
-- =============================================================================
-- This file contains SQL that Drizzle ORM cannot generate automatically:
--   1. CHECK constraints
--   2. Partial indexes (WHERE clauses)
--   3. GIST / GIN spatial and array indexes
--   4. DB triggers for counter maintenance
--
-- Run AFTER `drizzle-kit push` or `drizzle-kit migrate` completes.
-- Command: psql $DATABASE_URL -f drizzle/custom.sql
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CHECK CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────

-- RESCUE and LOST posts must have urgency.
-- ADOPTION and PRODUCT posts must NOT have urgency.
ALTER TABLE posts ADD CONSTRAINT chk_posts_urgency_by_type
  CHECK (
    (post_type IN ('RESCUE', 'LOST') AND urgency IS NOT NULL)
    OR
    (post_type IN ('ADOPTION', 'PRODUCT') AND urgency IS NULL)
  );

-- PRODUCT: is_free=true requires price_amount=NULL; is_free=false requires price_amount IS NOT NULL.
ALTER TABLE product_posts ADD CONSTRAINT chk_product_price_by_free
  CHECK (
    (is_free = TRUE AND price_amount IS NULL)
    OR
    (is_free = FALSE AND price_amount IS NOT NULL)
  );

-- ADOPTION: age_value and age_unit must both be set or both be NULL.
ALTER TABLE adoption_posts ADD CONSTRAINT chk_adoption_age_pairing
  CHECK (
    (age_value IS NULL AND age_unit IS NULL)
    OR
    (age_value IS NOT NULL AND age_unit IS NOT NULL)
  );

-- LOST: field-set integrity between LOST_PET and FOUND_STRAY.
-- LOST_PET  → current_condition, is_currently_safe_with_reporter, date_found must be NULL
-- FOUND_STRAY → pet_name, date_last_seen must be NULL
ALTER TABLE lost_posts ADD CONSTRAINT chk_lost_posts_report_fields
  CHECK (
    (
      report_type = 'LOST_PET'
      AND current_condition IS NULL
      AND is_currently_safe_with_reporter IS NULL
      AND date_found IS NULL
    )
    OR
    (
      report_type = 'FOUND_STRAY'
      AND pet_name IS NULL
      AND date_last_seen IS NULL
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PARTIAL INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

-- Help feed: sorted by (urgency ASC, created_at DESC) — RESCUE and LOST only.
CREATE INDEX IF NOT EXISTS idx_posts_help_feed
  ON posts (city_id, post_type, urgency, created_at)
  WHERE status = 'ACTIVE' AND post_type IN ('RESCUE', 'LOST');

-- Adoption feed: sorted by effective_score DESC.
CREATE INDEX IF NOT EXISTS idx_posts_adopt_score
  ON posts (city_id, effective_score DESC, created_at DESC)
  WHERE status = 'ACTIVE' AND post_type = 'ADOPTION';

-- Market feed: sorted by effective_score DESC.
CREATE INDEX IF NOT EXISTS idx_posts_market_score
  ON posts (city_id, effective_score DESC, created_at DESC)
  WHERE status = 'ACTIVE' AND post_type = 'PRODUCT';

-- Market feed — category filter without joining product_posts.
CREATE INDEX IF NOT EXISTS idx_posts_market_category
  ON posts (city_id, market_category, effective_score DESC)
  WHERE status = 'ACTIVE' AND post_type = 'PRODUCT';

-- AdminJS moderation queue: most-reported FLAGGED posts first.
CREATE INDEX IF NOT EXISTS idx_posts_moderation
  ON posts (report_count DESC, created_at DESC)
  WHERE moderation_status = 'FLAGGED';

-- Auto-removal cron: find stale ADOPTION and PRODUCT posts.
CREATE INDEX IF NOT EXISTS idx_posts_last_engaged
  ON posts (post_type, last_engaged_at)
  WHERE status = 'ACTIVE' AND post_type IN ('ADOPTION', 'PRODUCT');

-- Unread notification badge count (partial index avoids scanning all read rows).
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (recipient_id, created_at DESC)
  WHERE is_read = FALSE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. GIST INDEXES (spatial — PostGIS)
-- ─────────────────────────────────────────────────────────────────────────────

-- Nearest-city resolution: ST_Distance(center_point, user_gps).
CREATE INDEX IF NOT EXISTS idx_cities_center_point
  ON cities USING GIST (center_point);

-- Functional GIST index on posts.coordinates (stored as text EWKT — must cast to geometry).
CREATE INDEX IF NOT EXISTS idx_posts_coordinates
  ON posts USING GIST (ST_GeomFromEWKT(coordinates));

-- User proximity sort: last_known_location stored as text EWKT.
-- Requires a functional GIST index. Uncomment once there is data to index.
-- CREATE INDEX IF NOT EXISTS idx_users_last_known_location
--   ON users USING GIST (ST_GeomFromEWKT(last_known_location))
--   WHERE last_known_location IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. GIN INDEX (array containment — personality tags)
-- ─────────────────────────────────────────────────────────────────────────────

-- Personality tag filter: WHERE personality_tags @> ARRAY['GOOD_WITH_KIDS'].
CREATE INDEX IF NOT EXISTS idx_adoption_personality_tags
  ON adoption_posts USING GIN (personality_tags);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. DB TRIGGERS
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 5a. updated_at auto-update ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_posts_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 5b. User post counters ────────────────────────────────────────────────────
-- Maintained by trigger so they stay correct even when posts are mutated
-- directly via AdminJS (which bypasses NestJS service layer).

CREATE OR REPLACE FUNCTION sync_user_post_counts()
RETURNS TRIGGER AS $$
DECLARE
  delta_total INTEGER;
  delta_rescue INTEGER;
  delta_lost INTEGER;
  delta_adoption INTEGER;
  delta_product INTEGER;
  target_user_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    delta_total := 1; target_user_id := NEW.creator_id;
    delta_rescue   := CASE WHEN NEW.post_type = 'RESCUE'   THEN 1 ELSE 0 END;
    delta_lost     := CASE WHEN NEW.post_type = 'LOST'     THEN 1 ELSE 0 END;
    delta_adoption := CASE WHEN NEW.post_type = 'ADOPTION' THEN 1 ELSE 0 END;
    delta_product  := CASE WHEN NEW.post_type = 'PRODUCT'  THEN 1 ELSE 0 END;
  ELSIF TG_OP = 'DELETE' THEN
    delta_total := -1; target_user_id := OLD.creator_id;
    delta_rescue   := CASE WHEN OLD.post_type = 'RESCUE'   THEN -1 ELSE 0 END;
    delta_lost     := CASE WHEN OLD.post_type = 'LOST'     THEN -1 ELSE 0 END;
    delta_adoption := CASE WHEN OLD.post_type = 'ADOPTION' THEN -1 ELSE 0 END;
    delta_product  := CASE WHEN OLD.post_type = 'PRODUCT'  THEN -1 ELSE 0 END;
  ELSE
    RETURN NEW;
  END IF;

  UPDATE users
  SET
    post_count         = post_count         + delta_total,
    rescue_post_count  = rescue_post_count  + delta_rescue,
    lost_post_count    = lost_post_count    + delta_lost,
    adoption_post_count = adoption_post_count + delta_adoption,
    product_post_count = product_post_count + delta_product
  WHERE id = target_user_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_user_post_counts
  AFTER INSERT OR DELETE ON posts
  FOR EACH ROW EXECUTE FUNCTION sync_user_post_counts();

-- ── 5c. Post report_count denormalization ────────────────────────────────────
-- Increments posts.report_count when a new report row is inserted.

CREATE OR REPLACE FUNCTION increment_post_report_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts
  SET report_count = report_count + 1
  WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_post_report_count
  AFTER INSERT ON post_reports
  FOR EACH ROW EXECUTE FUNCTION increment_post_report_count();

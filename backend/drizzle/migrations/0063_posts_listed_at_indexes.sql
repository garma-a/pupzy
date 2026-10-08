-- Adopt and Market Newest feeds order by listed_at, so a renewed listing is
-- new again (see 0062_posts_listed_at.sql). These indexes lived in
-- drizzle/custom.sql, which also runs against schemas older than 0062 (the
-- city reconciliation upgrade path) where listed_at does not exist yet; as an
-- ordered migration they are only built once the column is there. IF NOT
-- EXISTS keeps databases that already built them from custom.sql unchanged.
CREATE INDEX IF NOT EXISTS idx_posts_adopt_city_listed
  ON posts (city_id, listed_at DESC, id DESC)
  WHERE status = 'ACTIVE' AND post_type = 'ADOPTION';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_posts_adopt_governorate_listed
  ON posts (governorate, listed_at DESC, id DESC)
  WHERE status = 'ACTIVE' AND post_type = 'ADOPTION';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_posts_market_city_listed
  ON posts (city_id, listed_at DESC, id DESC)
  WHERE status = 'ACTIVE' AND post_type = 'PRODUCT';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_posts_market_governorate_listed
  ON posts (governorate, listed_at DESC, id DESC)
  WHERE status = 'ACTIVE' AND post_type = 'PRODUCT';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_posts_market_city_category_listed
  ON posts (city_id, market_category, listed_at DESC, id DESC)
  WHERE status = 'ACTIVE' AND post_type = 'PRODUCT';

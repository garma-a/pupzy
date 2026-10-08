-- When a listing was last published: its creation, or its latest renewal.
--
-- Renewing an expired Adoption or Market listing set it back to ACTIVE but left
-- it ranked by its original creation: the Hot score decayed from created_at
-- and the Newest order followed the time-ordered id, so a renewed listing sat
-- at the bottom of its feed. Both now count from listed_at, which renewal
-- moves to now().
--
-- Millisecond precision so the Newest feed cursor round-trips it exactly.
ALTER TABLE posts ADD COLUMN listed_at timestamp(3) with time zone;
--> statement-breakpoint
UPDATE posts SET listed_at = COALESCE(renewed_at, created_at);
--> statement-breakpoint
ALTER TABLE posts ALTER COLUMN listed_at SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE posts ALTER COLUMN listed_at SET NOT NULL;
--> statement-breakpoint
-- Listings renewed before this migration still carry a Hot score decayed from
-- their creation; recompute it from listed_at with the feed formulas.
UPDATE posts SET effective_score = CASE
    WHEN post_type = 'ADOPTION' THEN
      (upvote_count * 3 + save_count * 2 + view_count * 0.1 + 1)
      / POWER(EXTRACT(EPOCH FROM (now() - listed_at)) / 3600.0 + 2, 1.5)
    ELSE
      (view_count * 1 + save_count * 5 + 1)
      / POWER(EXTRACT(EPOCH FROM (now() - listed_at)) / 3600.0 + 2, 1.5)
  END
WHERE renewed_at IS NOT NULL AND post_type IN ('ADOPTION', 'PRODUCT');
--> statement-breakpoint
-- The Newest feed indexes keyed on id are replaced by listed_at ones in
-- drizzle/custom.sql, which runs after the migrations.
DROP INDEX IF EXISTS idx_posts_adopt_city_newest;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_posts_adopt_governorate_newest;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_posts_market_city_newest;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_posts_market_governorate_newest;
--> statement-breakpoint
DROP INDEX IF EXISTS idx_posts_market_city_category_newest;

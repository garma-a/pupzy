-- Inactivity reminder and expiry candidates.
--
-- Migration 0009's `idx_posts_last_engaged` partial predicate only covered
-- ADOPTION and PRODUCT, so the stand-alone RESCUE/LOST reminder query
-- (`status='ACTIVE' AND post_type=… AND last_engaged_at <= … ORDER BY
-- last_engaged_at, id LIMIT 100`) could not use it and fell back to scanning
-- every active Post. The key columns stay `(post_type, last_engaged_at)`; the
-- predicate now names every type the expiry processor can select.
DROP INDEX IF EXISTS "idx_posts_last_engaged";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_posts_last_engaged"
  ON "posts" ("post_type", "last_engaged_at")
  WHERE "status" = 'ACTIVE' AND "post_type" IN ('ADOPTION', 'PRODUCT', 'RESCUE', 'LOST');

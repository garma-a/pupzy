-- EXPIRED is the inactivity lifecycle state for renewable ADOPTION/PRODUCT
-- listings. It is intentionally separate from administrative REMOVED: an
-- Expired Post keeps its direct detail, owner history, media and discussion
-- until its owner explicitly renews it. The value is added alone so a later
-- migration may safely reference it in the same deployment.
ALTER TYPE "public"."post_status" ADD VALUE IF NOT EXISTS 'EXPIRED';

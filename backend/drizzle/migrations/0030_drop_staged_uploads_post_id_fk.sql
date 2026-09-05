-- Migration 0030: Drop foreign key constraint on staged_uploads.post_id
-- Media tickets are claimed for an intended post before the post row is inserted,
-- so staged_uploads.post_id must not enforce a foreign key referencing posts(id).
ALTER TABLE "staged_uploads" DROP CONSTRAINT IF EXISTS "staged_uploads_post_id_posts_id_fk";

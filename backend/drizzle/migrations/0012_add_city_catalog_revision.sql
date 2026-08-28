--
-- City catalog revision fence for cache coherence during Railway deployment overlap.
--
CREATE TABLE "city_catalog_revisions" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "city_catalog_revisions_singleton_id" CHECK ("id" = 1)
);
--> statement-breakpoint
INSERT INTO "city_catalog_revisions" ("id", "revision") VALUES (1, 1);

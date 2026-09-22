-- Versioned Terms Acceptance (ticket 10).
--
-- Acceptance lives on the account row because the agreed scope requires one
-- current acceptance per account, not a separate acceptance-history product.
-- Both columns are nullable and intentionally not backfilled: a NULL version
-- means the account has never accepted any published terms, and fabricated
-- consent is never created. Account Deletion removes the row, and therefore
-- the acceptance record, together with the rest of the account.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "terms_accepted_version" varchar(64);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "terms_accepted_at" timestamp with time zone;

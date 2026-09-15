DROP INDEX IF EXISTS "idx_account_deletions_firebase_user";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_account_deletions_firebase_user" ON "account_deletions" ("firebase_user_id");

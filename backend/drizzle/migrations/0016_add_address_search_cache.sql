CREATE TABLE IF NOT EXISTS "address_search_cache" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"normalized_query" text NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "address_search_cache_normalized_query_unique" UNIQUE("normalized_query"),
	CONSTRAINT "chk_address_search_cache_query_nonblank" CHECK (length(trim(normalized_query)) > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_address_search_cache_normalized_query" ON "address_search_cache" USING btree ("normalized_query");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_address_search_cache_created_at" ON "address_search_cache" USING btree ("created_at");

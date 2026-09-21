-- Server-side English/Arabic search for the Home Feed and help discovery.
--
-- `pupzy_search_normalize` is the one normalization applied to both stored
-- Post text and the submitted query text: it lowercases, strips Arabic
-- diacritics and tatweel, unifies alef/yeh/waw-hamza/teh-marbuta letter forms,
-- and collapses whitespace. The GIN trigram index over the normalized search
-- document (title, description, market category, area name) lets `%…%` phrases
-- use Postgres text-search capabilities instead of scanning every active Post.
--
-- `pupzy_search_enum_text` exists only so the category enum can participate in
-- that functional index: PostgreSQL's enum-to-text I/O cast is stable rather
-- than immutable, and an immutable wrapper is the supported way to index it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE OR REPLACE FUNCTION pupzy_search_normalize(input text)
RETURNS text AS $$
  SELECT btrim(
    regexp_replace(
      translate(
        lower(regexp_replace(input, U&'[\064B-\065F\0670\0640]', '', 'g')),
        'أإآٱىئؤة',
        'ااااييوه'
      ),
      '\s+',
      ' ',
      'g'
    )
  );
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;--> statement-breakpoint
CREATE OR REPLACE FUNCTION pupzy_search_enum_text(value anyenum)
RETURNS text AS $$
  SELECT value::text;
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_posts_search_document_trgm
  ON posts USING gin (
    pupzy_search_normalize(
      title || ' ' || description || ' ' || COALESCE(area_name, '') || ' ' || COALESCE(pupzy_search_enum_text(market_category), '')
    ) gin_trgm_ops
  )
  WHERE status = 'ACTIVE';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_cities_search_name_english_trgm
  ON cities USING gin (pupzy_search_normalize(name_english) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_cities_search_name_arabic_trgm
  ON cities USING gin (pupzy_search_normalize(name_arabic) gin_trgm_ops);

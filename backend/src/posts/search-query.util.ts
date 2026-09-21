import { ValidationError } from '../common/errors/app.errors';

/** Minimum length of the normalized search text, in Unicode characters. */
export const SEARCH_QUERY_MIN_LENGTH = 2;

/** Maximum length of the submitted `search` text after trimming, in Unicode characters. */
export const SEARCH_QUERY_MAX_LENGTH = 100;

const ARABIC_DIACRITICS_AND_TATWEEL = /[\u064B-\u065F\u0670\u0640]/g;
const ALEF_VARIANTS = /[أإآٱ]/g;
const YEH_VARIANTS = /[ىئ]/g;
const WAW_HAMZA = /ؤ/g;
const TEH_MARBUTA = /ة/g;
const WHITESPACE_RUN = /\s+/g;
const LIKE_METACHARACTERS = /[\\%_]/g;

/**
 * Canonical English/Arabic normalization for feed search.
 *
 * This is the query-side twin of the database function
 * `pupzy_search_normalize` (migration `0052_add_normalized_feed_search`), which
 * normalizes every stored Post title, description, category, area and City
 * name before it is indexed. Both sides lowercase, strip Arabic diacritics and
 * tatweel, unify alef/yeh/waw-hamza/teh-marbuta letter forms, and collapse
 * whitespace, so a match means the same thing for stored and submitted text.
 *
 * A Postgres-backed integration test compares this function against the SQL
 * function for every normalization case, so the two cannot silently drift.
 */
export function normalizeSearchText(input: string): string {
  return input
    .toLowerCase()
    .replace(ARABIC_DIACRITICS_AND_TATWEEL, '')
    .replace(ALEF_VARIANTS, 'ا')
    .replace(YEH_VARIANTS, 'ي')
    .replace(WAW_HAMZA, 'و')
    .replace(TEH_MARBUTA, 'ه')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
}

/**
 * Turns an optional raw `search` argument into the LIKE pattern matched
 * against the normalized search document.
 *
 * Documented behavior:
 * - omitted, null, empty or whitespace-only text, and text that normalizes to
 *   nothing (for example diacritics only) → `null`: the feed behaves exactly
 *   as it does without a search argument.
 * - text shorter than {@link SEARCH_QUERY_MIN_LENGTH} non-whitespace characters
 *   after normalization → {@link ValidationError}.
 * - text longer than {@link SEARCH_QUERY_MAX_LENGTH} characters after trimming
 *   → {@link ValidationError}.
 * - otherwise → the normalized, LIKE-escaped `%…%` pattern used by every
 *   searchable feed.
 */
export function buildFeedSearchPattern(raw: string | null | undefined): string | null {
  if (raw == null) return null;

  const trimmed = raw.trim();
  if (trimmed.length > SEARCH_QUERY_MAX_LENGTH) {
    throw new ValidationError(`search must be at most ${SEARCH_QUERY_MAX_LENGTH} characters`);
  }

  const normalized = normalizeSearchText(trimmed);
  if (normalized.length === 0) return null;
  if (normalized.length < SEARCH_QUERY_MIN_LENGTH) {
    throw new ValidationError(`search must be at least ${SEARCH_QUERY_MIN_LENGTH} characters`);
  }

  return `%${normalized.replace(LIKE_METACHARACTERS, (match) => `\\${match}`)}%`;
}

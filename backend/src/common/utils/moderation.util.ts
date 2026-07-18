/**
 * Basic keyword blocklist for post content moderation.
 *
 * ## Purpose
 * First-pass content filter that runs at post creation time.
 * Returns `true` if the post's title + description contain keywords
 * that are clearly unrelated to animals, indicating the post should
 * be flagged for AdminJS review.
 *
 * ## Limitations
 * - Case-insensitive substring match only — no stemming or NLP.
 * - Intentionally conservative for MVP — catches obvious spam.
 * - AdminJS handles final review via `moderation_status = FLAGGED`.
 *
 * ## Future improvements
 * - AI moderation endpoint (e.g., OpenAI moderation API)
 * - Configurable blocklist via admin panel instead of hardcoded
 * - Arabic morphological analysis for better Arabic keyword matching
 */

/**
 * Keywords clearly unrelated to animals.
 * Separated into categories for easier maintenance.
 */
const BLOCKLIST: readonly string[] = [
  // ── Vehicles ────────────────────────────────────────────────────────────
  'سيارة',
  'سيارات',
  'موتوسيكل',

  // ── Real estate ─────────────────────────────────────────────────────────
  'شقة',
  'عقار',
  'ارض للبيع',
  'شقة للبيع',
  'شقة للايجار',
  'apartment for rent',
  'real estate',
  'land for sale',
  'property for sale',

  // ── Electronics ─────────────────────────────────────────────────────────
  'موبايل',
  'لاب توب',
  'ايفون',
  'سامسونج',
  'iphone',
  'laptop',
  'samsung',
  'playstation',
  'xbox',

  // ── Spam / scam / adult ─────────────────────────────────────────────────
  'casino',
  'betting',
  'viagra',
  'cryptocurrency',
  'forex',
  'binary options',
  'earn money fast',
  'work from home',
  'اربح فلوس',
] as const;

/**
 * Checks whether the post content contains keywords that suggest
 * the post is unrelated to animals and should be flagged.
 *
 * @param title - Post title
 * @param description - Post description/body
 * @returns `true` if the content should be flagged for moderation
 *
 * @example
 * shouldFlagContent('iPhone 15 for sale', 'Brand new in box')
 * // → true (flagged — unrelated to animals)
 *
 * shouldFlagContent('Cat needs rescue', 'Injured cat near mosque')
 * // → false (legitimate animal post)
 */
export function shouldFlagContent(title: string, description: string): boolean {
  const combined = `${title} ${description}`.toLowerCase();
  return BLOCKLIST.some((keyword) => combined.includes(keyword.toLowerCase()));
}

/**
 * Limits for the announcement form. The server validates with the shared
 * contract (`src/notifications/admin-announcement.contract.ts`); these two
 * numbers only drive the character counters in the browser, and a unit test
 * keeps them equal to the contract.
 */
export const TITLE_MAX_LENGTH = 80;
export const BODY_MAX_LENGTH = 500;

/** Characters as a person counts them (an emoji is one). */
export function characterCount(value) {
  return Array.from(value ?? '').length;
}

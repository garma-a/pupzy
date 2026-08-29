/**
 * Format a UUID for concise display in lists while preserving the full value on record views.
 *
 * @param {string|unknown} value
 * @param {boolean} [isList=true]
 * @returns {string}
 */
export function formatShortUuid(value, isList = true) {
  if (value === undefined || value === null || value === '') return '';
  const str = String(value);
  if (isList && str.length > 12) {
    return `${str.slice(0, 8)}…${str.slice(-4)}`;
  }
  return str;
}

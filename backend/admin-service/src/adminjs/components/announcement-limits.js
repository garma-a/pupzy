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

/**
 * A fresh idempotency key for one send. The compose page makes one per draft and
 * sends it with the confirm POST, so a double click or a replay cannot send twice.
 * `crypto.randomUUID` needs a secure context, so fall back to random bytes.
 */
export function newRequestKey() {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

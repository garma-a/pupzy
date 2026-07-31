/**
 * UUIDv7 generator — time-ordered UUIDs for database primary keys.
 *
 * ## Why UUIDv7 over UUIDv4?
 * - **B-tree friendly**: monotonically increasing, avoids random page splits
 * - **Time-ordered**: natural sort by creation time without an extra column
 * - **Keyset pagination**: cursor-based feeds rely on ID ordering = time ordering
 *
 * ## Implementation
 * Uses the RFC 9562 UUIDv7 specification:
 * - 48 bits: Unix timestamp in milliseconds
 * - 4 bits: version (0111 = 7)
 * - 12 bits: random
 * - 2 bits: variant (10)
 * - 62 bits: random
 *
 * @see https://www.rfc-editor.org/rfc/rfc9562#name-uuid-version-7
 */
import { randomBytes } from 'crypto';

export function generateUuidV7(): string {
  const now = Date.now();

  // 6 bytes for 48-bit millisecond timestamp
  const timeBytes = Buffer.alloc(6);
  timeBytes.writeUIntBE(now, 0, 6);

  // 10 bytes of random data for the remaining fields
  const randBytes = randomBytes(10);

  // Build the 16-byte UUID
  const uuid = Buffer.alloc(16);

  // Bytes 0-5: timestamp
  timeBytes.copy(uuid, 0);

  // Bytes 6-7: version (0111) + 12 bits random
  uuid[6] = (0x70 | (randBytes[0] & 0x0f)); // version 7
  uuid[7] = randBytes[1];

  // Bytes 8-9: variant (10) + 14 bits random
  uuid[8] = (0x80 | (randBytes[2] & 0x3f)); // variant 10xx
  uuid[9] = randBytes[3];

  // Bytes 10-15: 48 bits random
  randBytes.copy(uuid, 10, 4, 10);

  // Format as standard UUID string
  const hex = uuid.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Encrypts a string using AES-256-GCM.
 *
 * @param plaintext - The text to encrypt (e.g. phone number).
 * @param base64Key - The 256-bit key encoded in base64.
 * @returns The encrypted string in the format: `iv:authTag:encryptedText`.
 */
export function encryptString(plaintext: string, base64Key: string): string {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes (256 bits).');
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  const tag = cipher.getAuthTag();

  // Return the IV, the auth tag, and the encrypted text combined
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypts a string that was encrypted with `encryptString`.
 *
 * @param ciphertext - The encrypted string in the format: `iv:authTag:encryptedText`.
 * @param base64Key - The 256-bit key encoded in base64.
 * @returns The original plaintext.
 */
export function decryptString(ciphertext: string, base64Key: string): string {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes (256 bits).');
  }

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format.');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const encrypted = Buffer.from(parts[2], 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return decrypted.toString('utf8');
}

import { encryptString, decryptString } from './crypto.util';

describe('Crypto Utility (AES-256-GCM)', () => {
  // 32-byte key base64 encoded
  const validBase64Key = Buffer.from('01234567890123456789012345678901').toString('base64');
  const invalidBase64Key = Buffer.from('short-key').toString('base64');

  it('encrypts and decrypts string back to original plaintext', () => {
    const phone = '+201012345678';
    const ciphertext = encryptString(phone, validBase64Key);

    expect(ciphertext).toBeDefined();
    expect(ciphertext).toContain(':');

    const decrypted = decryptString(ciphertext, validBase64Key);
    expect(decrypted).toBe(phone);
  });

  it('throws error when key is not 32 bytes', () => {
    expect(() => encryptString('text', invalidBase64Key)).toThrow('Encryption key must be exactly 32 bytes');
    expect(() => decryptString('iv:tag:text', invalidBase64Key)).toThrow('Encryption key must be exactly 32 bytes');
  });

  it('throws error when ciphertext format is invalid', () => {
    expect(() => decryptString('invalid-ciphertext', validBase64Key)).toThrow('Invalid ciphertext format.');
  });
});

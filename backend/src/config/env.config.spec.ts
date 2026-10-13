import { validateEnv } from './env.config';

describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/pupzy_test',
    PHONE_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    FIREBASE_PROJECT_ID: 'demo-project',
    FIREBASE_CLIENT_EMAIL: 'svc@demo-project.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: 'unused-in-this-test',
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET_NAME: 'bucket',
    R2_PUBLIC_URL: 'https://media.example.org',
  };

  describe('ACCOUNT_DELETION_ENABLED', () => {
    it('defaults to enabled when unset', () => {
      expect(validateEnv(base).ACCOUNT_DELETION_ENABLED).toBe(true);
    });

    // Regression: z.coerce.boolean() is Boolean(value), so "false" and "0"
    // used to parse as true and the kill-switch could never be turned off.
    it.each(['false', 'FALSE', '0', 'no', 'off'])('treats %p as disabled', (value) => {
      expect(validateEnv({ ...base, ACCOUNT_DELETION_ENABLED: value }).ACCOUNT_DELETION_ENABLED).toBe(false);
    });

    it.each(['true', '1', 'yes', 'on'])('treats %p as enabled', (value) => {
      expect(validateEnv({ ...base, ACCOUNT_DELETION_ENABLED: value }).ACCOUNT_DELETION_ENABLED).toBe(true);
    });

    it('rejects a value that is not a recognisable boolean instead of guessing', () => {
      expect(() => validateEnv({ ...base, ACCOUNT_DELETION_ENABLED: 'maybe' })).toThrow();
    });
  });

  it('rejects encryption keys with the right string length but invalid AES-256 bytes', () => {
    expect(() => validateEnv({ ...base, PHONE_ENCRYPTION_KEY: 'a'.repeat(44) })).toThrow('exactly 32 bytes');
    expect(() => validateEnv({ ...base, PHONE_ENCRYPTION_KEY: '!'.repeat(44) })).toThrow('exactly 32 bytes');
  });

  it('rejects the signature-bypassing Firebase emulator in production while allowing isolated tests', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' }),
    ).toThrow('emulator must not');
    expect(
      validateEnv({ ...base, NODE_ENV: 'test', FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' })
        .FIREBASE_AUTH_EMULATOR_HOST,
    ).toBe('localhost:9099');
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).not.toThrow();
  });
});

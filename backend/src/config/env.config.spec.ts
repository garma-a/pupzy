import { validateEnv } from './env.config';

describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/pupzy_test',
    PHONE_ENCRYPTION_KEY: 'a'.repeat(44),
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
});

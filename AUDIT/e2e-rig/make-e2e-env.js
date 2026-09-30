// Throwaway secrets for the local e2e backend. Nothing here is a real credential:
// the Firebase key is a freshly generated RSA key (only the Auth *emulator* is used),
// storage points at a local s3rver, and the phone key encrypts fake seed numbers only.
const crypto = require('crypto');
const fs = require('fs');
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const env = {
  NODE_ENV: 'development',
  PORT: '8080',
  DATABASE_URL: process.argv[2],
  PHONE_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIREBASE_PROJECT_ID: 'pupzy-app-5f707',
  FIREBASE_CLIENT_EMAIL: 'e2e-local@pupzy-app-5f707.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: pem.replace(/\n/g, '\n'),
  FIREBASE_WEB_API_KEY: 'e2e-fake-web-api-key',
  R2_ACCOUNT_ID: 'e2e-local',
  R2_ACCESS_KEY_ID: 'S3RVER',
  R2_SECRET_ACCESS_KEY: 'S3RVER',
  R2_BUCKET_NAME: 'pupzy-e2e',
  R2_ENDPOINT: 'http://localhost:4568',
  R2_PUBLIC_URL: 'http://localhost:4568/pupzy-e2e',
  TERMS_URL: 'https://example.org/pupzy-terms-e2e',
  TERMS_VERSION: '2026-09-e2e',
  THROTTLE_LIMIT: '1000',
};
fs.writeFileSync('e2e.env.json', JSON.stringify(env, null, 2));
console.log('wrote e2e.env.json with keys:', Object.keys(env).join(', '));

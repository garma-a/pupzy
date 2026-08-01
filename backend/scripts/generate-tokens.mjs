#!/usr/bin/env node
// scripts/generate-tokens.mjs
// Usage: node scripts/generate-tokens.mjs --count=50 --out=../k6/tokens.json
//
// Requires: npm install firebase-admin node-fetch dotenv
// Requires env vars (in .env or exported):
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY
//   FIREBASE_WEB_API_KEY  ← from Firebase Console → Project settings → General → Web API Key

import { createRequire } from 'module';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env from the backend root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

try {
  const { config } = await import('dotenv');
  config({ path: path.join(__dirname, '..', '.env') });
} catch {
  // dotenv not installed — expect env vars to be set externally
}

// ── CLI args ──────────────────────────────────────────────────────────────────
const COUNT = parseInt(
  process.argv.find((a) => a.startsWith('--count='))?.split('=')[1] ?? '50',
);
const OUT = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1]
  ?? path.join(__dirname, '..', '..', 'k6', 'tokens.json');

// ── Validate required env vars ────────────────────────────────────────────────
const REQUIRED = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_WEB_API_KEY',
];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
  console.error('   Set them in backend/.env or export them before running this script.');
  process.exit(1);
}

const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;

// ── Firebase Admin init ───────────────────────────────────────────────────────
initializeApp({
  credential: cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
});

const auth = getAuth();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a custom token for `uid` and exchange it for a Firebase ID token
 * via the Identity Toolkit REST API.
 *
 * @param {string} uid
 * @returns {Promise<{ idToken: string; refreshToken: string; expiresIn: number }>}
 */
async function getIdTokenForUid(uid) {
  // Step 1: Admin SDK issues a custom (signed JWT) token
  const customToken = await auth.createCustomToken(uid);

  // Step 2: Exchange custom token → ID token via REST
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Token exchange failed for uid=${uid}: ${body}`);
  }

  const data = await resp.json();
  return {
    idToken:      data.idToken,
    refreshToken: data.refreshToken,
    expiresIn:    parseInt(data.expiresIn, 10), // seconds, typically 3600
  };
}

/**
 * Ensure a Firebase test user with the given index exists.
 * Creates it if absent. Returns the uid.
 *
 * @param {number} index
 * @returns {Promise<string>} uid
 */
async function ensureTestUser(index) {
  const uid   = `k6-test-user-${index}`;
  const email = `k6-${index}@pupzy-test.internal`;

  try {
    await auth.getUser(uid);
    // User already exists — nothing to do
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      await auth.createUser({
        uid,
        email,
        emailVerified: true,
        displayName:   `K6 User ${index}`,
      });
      console.log(`  ✨ Created Firebase user: ${uid}`);
    } else {
      throw err;
    }
  }

  return uid;
}

/**
 * Refresh an existing ID token using the refresh_token grant.
 * Useful for soak tests > 60 min.
 *
 * @param {string} refreshToken
 * @returns {Promise<{ idToken: string; refreshToken: string; expiresIn: number }>}
 */
export async function refreshIdToken(refreshToken) {
  const resp = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${WEB_API_KEY}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    },
  );

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Token refresh failed: ${body}`);
  }

  const data = await resp.json();
  return {
    idToken:      data.id_token,
    refreshToken: data.refresh_token,
    expiresIn:    parseInt(data.expires_in, 10),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔑 Generating ${COUNT} Firebase test tokens...`);
  console.log(`   Project: ${process.env.FIREBASE_PROJECT_ID}`);
  console.log(`   Output:  ${OUT}\n`);

  const tokens = [];

  for (let i = 0; i < COUNT; i++) {
    process.stdout.write(`  [${String(i + 1).padStart(String(COUNT).length)}/${COUNT}] `);
    const uid = await ensureTestUser(i);
    const { idToken, refreshToken, expiresIn } = await getIdTokenForUid(uid);
    tokens.push({
      uid,
      idToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
    });
    console.log(`✓ ${uid}`);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(tokens, null, 2));

  const expiresInMin = Math.floor(tokens[0] ? (tokens[0].expiresAt - Date.now()) / 60000 : 60);
  console.log(`\n✅ Wrote ${tokens.length} tokens → ${OUT}`);
  console.log(`   ⏱  Tokens expire in ~${expiresInMin} min.`);
  console.log(`   📌 Re-run this script (or use refreshIdToken()) for soak tests > 45 min.\n`);
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});

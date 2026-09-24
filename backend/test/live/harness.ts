/**
 * Harness for the live end-to-end suite. Talks HTTP to a running backend that
 * verifies tokens against the Firebase Auth Emulator and stores media in a
 * local S3-compatible fake (see AUDIT/e2e-rig). Nothing here touches a real
 * Firebase project or bucket.
 *
 *   E2E_API_URL   default http://127.0.0.1:8080   (backend origin)
 *   E2E_AUTH_URL  default http://127.0.0.1:9099   (Auth Emulator origin)
 *   E2E_PROJECT   default pupzy-app-5f707
 */
import request from 'supertest';
import sharp from 'sharp';

export const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:8080';
export const AUTH_URL = process.env.E2E_AUTH_URL ?? 'http://127.0.0.1:9099';
const PROJECT = process.env.E2E_PROJECT ?? 'pupzy-app-5f707';
const PASSWORD = 'E2e-only-Passw0rd!';

/** Unique per process so repeated runs never collide in the shared e2e database. */
export const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export interface GqlResult<T = Record<string, any>> {
  status: number;
  data: T | null;
  errors: Array<{ message: string; extensions?: { code?: string } }> | undefined;
  /** First error code, or null when the call succeeded. */
  code: string | null;
}

/**
 * The backend rate-limits per client IP (and trusts one proxy hop), so every
 * simulated user gets its own X-Forwarded-For address — the same way distinct
 * real devices look to it. Without this, one test run exhausts per-IP limits
 * such as createMatingPost's 5 per hour.
 */
const clientIpByToken = new Map<string, string>();
let nextIp = 1;
const allocateIp = () => {
  const n = nextIp++;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
};
const anonymousIp = allocateIp();

export async function gql<T = Record<string, any>>(
  token: string | null,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<GqlResult<T>> {
  let req = request(API_URL)
    .post('/graphql')
    .set('Content-Type', 'application/json')
    .set('X-Forwarded-For', (token && clientIpByToken.get(token)) || anonymousIp);
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  const res = await req.send({ query, variables });
  const body = res.body ?? {};
  return {
    status: res.status,
    data: body.data ?? null,
    errors: body.errors,
    code: body.errors?.[0]?.extensions?.code ?? (body.errors ? 'UNKNOWN' : null),
  };
}

/** Like gql() but fails the test with the server's message on any error. */
export async function ok<T = Record<string, any>>(
  token: string | null,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const r = await gql<T>(token, query, variables);
  if (r.errors) throw new Error(`${query.trim().split(/\s+/).slice(0, 3).join(' ')} → ${JSON.stringify(r.errors)}`);
  return r.data as T;
}

async function authPost(path: string, body: unknown, admin = false) {
  const res = await fetch(`${AUTH_URL}/identitytoolkit.googleapis.com/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: 'Bearer owner' } : {}) },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, any>>;
}

export interface Account {
  label: string;
  email: string;
  token: string;
  id: string;
  firebaseUid: string;
}

/** Signs up a fresh emulator account, verifies its email, completes the profile and accepts the Terms. */
export async function createAccount(label: string, cityId: string, opts: { completeProfile?: boolean } = {}): Promise<Account> {
  const email = `${label}-${RUN_ID}@pupzy.test`;
  const signUp = await authPost('accounts:signUp?key=fake', { email, password: PASSWORD, returnSecureToken: true });
  if (!signUp.localId) throw new Error(`emulator sign-up failed: ${JSON.stringify(signUp)}`);
  await authPost(`projects/${PROJECT}/accounts:update`, { localId: signUp.localId, emailVerified: true }, true);
  const session = await authPost('accounts:signInWithPassword?key=fake', { email, password: PASSWORD, returnSecureToken: true });
  const token = session.idToken as string;
  clientIpByToken.set(token, `${allocateIp()}`);
  const { me } = await ok<{ me: { id: string } }>(token, `{ me { id } }`);
  if (opts.completeProfile !== false) {
    const phone = `+2010${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    await ok(token, `mutation($i: CompleteProfileInput!) { completeProfile(input: $i) { id } }`, {
      i: { fullName: `${label} ${RUN_ID}`, phoneNumber: phone, cityId, languagePreference: 'en' },
    });
    const { terms } = await ok<{ terms: { currentVersion: string | null; acceptanceRequired: boolean } }>(
      token,
      `{ terms { currentVersion acceptanceRequired } }`,
    );
    if (terms.acceptanceRequired && terms.currentVersion) {
      await ok(token, `mutation($v: String!) { acceptTerms(input: { version: $v }) { acceptedVersion } }`, {
        v: terms.currentVersion,
      });
    }
  }
  return { label, email, token, id: me.id, firebaseUid: signUp.localId };
}

let jpegCache: Buffer | null = null;
/** A small, valid JPEG generated locally (no network). */
export async function jpeg(): Promise<Buffer> {
  jpegCache ??= await sharp({ create: { width: 64, height: 64, channels: 3, background: '#c4622d' } })
    .jpeg({ quality: 80 })
    .toBuffer();
  return jpegCache;
}

export interface UploadTicket {
  mediaId: string;
  uploadUrl: string;
}

export async function requestUpload(token: string, contentType: string, fileSizeBytes: number) {
  return gql<{ requestMediaUploadUrl: UploadTicket }>(
    token,
    `mutation($i: RequestMediaUploadInput!) { requestMediaUploadUrl(input: $i) { mediaId uploadUrl } }`,
    { i: { contentType, fileSizeBytes } },
  );
}

/** Full presigned upload: ticket → PUT bytes to the S3 fake → mediaId ready for a create mutation. */
export async function upload(token: string, bytes?: Buffer, contentType = 'image/jpeg'): Promise<string> {
  const body = bytes ?? (await jpeg());
  const ticket = await requestUpload(token, contentType, body.length);
  if (ticket.errors) throw new Error(`upload ticket → ${JSON.stringify(ticket.errors)}`);
  const { mediaId, uploadUrl } = ticket.data!.requestMediaUploadUrl;
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body });
  if (!put.ok) throw new Error(`PUT → ${put.status}`);
  return mediaId;
}

export async function uploads(token: string, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await upload(token));
  return ids;
}

export async function cityId(name: string): Promise<string> {
  const { cities } = await ok<{ cities: Array<{ id: string; nameEnglish: string }> }>(null, `{ cities { id nameEnglish } }`);
  const hit = cities.find((c) => c.nameEnglish === name);
  if (!hit) throw new Error(`city ${name} not seeded — run db:seed against the e2e database`);
  return hit.id;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

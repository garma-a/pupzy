/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- GraphQL responses are untyped JSON */
/**
 * Cross-cutting API edges, end to end: upload validation, ownership of media,
 * IDOR on contact/adoption links, pagination and id validation, auth failures.
 * See post-matrix.live-spec.ts for how to run and what `it.failing` means.
 */
import sharp from 'sharp';
import { Account, cityId, createAccount, gql, ok, requestUpload, upload } from './harness';
import { POST_TYPES } from './post-types';

const RESCUE = POST_TYPES.find((t) => t.key === 'RESCUE')!;
const MATING = POST_TYPES.find((t) => t.key === 'MATING')!;
const codeOf = (e: unknown) => String((e as Error).message).match(/"code":"(\w+)"/)?.[1] ?? 'UNKNOWN';
/** Resolves to 'OK' or the GraphQL error code a create attempt failed with. */
const outcome = (attempt: Promise<unknown>) => attempt.then(() => 'OK', codeOf);

let home: string;
let owner: Account;
let other: Account;

beforeAll(async () => {
  home = await cityId('Qasr Al-Nile');
  owner = await createAccount('edge-owner', home);
  other = await createAccount('edge-other', home);
});

describe('upload tickets', () => {
  it.each([
    ['a GIF', 'image/gif', 1_000],
    ['a PDF', 'application/pdf', 1_000],
    ['an oversized file', 'image/jpeg', 50_000_000],
    ['a zero-byte file', 'image/jpeg', 0],
    ['a negative size', 'image/jpeg', -5],
  ])('refuses %s', async (_label, contentType, size) => {
    expect((await requestUpload(owner.token, contentType, size)).code).toBe('VALIDATION_ERROR');
  });

  it('issues tickets for JPEG, PNG and WebP', async () => {
    for (const ct of ['image/jpeg', 'image/png', 'image/webp']) {
      expect((await requestUpload(owner.token, ct, 10_000)).code).toBeNull();
    }
  });

  it('requires a signed-in user', async () => {
    const r = await gql(
      null,
      `mutation { requestMediaUploadUrl(input: { contentType: "image/jpeg", fileSizeBytes: 1000 }) { mediaId } }`,
    );
    expect(r.code).toBe('UNAUTHENTICATED');
  });
});

describe('attaching media to a post', () => {
  it("rejects another user's upload", async () => {
    const theirs = await upload(other.token);
    await expect(outcome(RESCUE.create(owner.token, home, [theirs]))).resolves.toBe('NOT_FOUND');
  });

  it('rejects an upload that was already used by another post', async () => {
    const once = await upload(owner.token);
    await RESCUE.create(owner.token, home, [once]);
    await expect(outcome(RESCUE.create(owner.token, home, [once]))).resolves.toBe('NOT_FOUND');
  });

  it('rejects a ticket whose file was never uploaded', async () => {
    const never = (await requestUpload(owner.token, 'image/jpeg', 1_000)).data!.requestMediaUploadUrl.mediaId;
    await expect(outcome(RESCUE.create(owner.token, home, [never]))).resolves.toBe('NOT_FOUND');
  });

  it('rejects duplicate and malformed media ids', async () => {
    const m = await upload(owner.token);
    await expect(outcome(RESCUE.create(owner.token, home, [m, m]))).resolves.toBe('VALIDATION_ERROR');
    await expect(outcome(RESCUE.create(owner.token, home, ['not-a-uuid']))).resolves.toBe('VALIDATION_ERROR');
  });

  // Finding F-08: post media is copied from staging to public storage without
  // inspecting the bytes (comment images, by contrast, are fully validated).
  it.failing('rejects a non-image uploaded as image/jpeg', async () => {
    const text = Buffer.from('plain text pretending to be a photograph, not an image at all');
    const id = await upload(owner.token, text, 'image/jpeg');
    await expect(outcome(RESCUE.create(owner.token, home, [id]))).resolves.toBe('VALIDATION_ERROR');
  });

  it.failing('rejects a PNG declared as image/jpeg', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    const id = await upload(owner.token, png, 'image/jpeg');
    await expect(outcome(RESCUE.create(owner.token, home, [id]))).resolves.toBe('VALIDATION_ERROR');
  });
});

describe('ownership of contact and adoption links (IDOR)', () => {
  let requestId: string;
  let postId: string;
  let requester: Account;

  beforeAll(async () => {
    requester = await createAccount('edge-requester', home);
    postId = await MATING.create(owner.token, home, [await upload(owner.token)]);
    requestId = (
      await ok<any>(
        requester.token,
        `mutation($p: ID!) { requestContact(postId: $p, message: "Hello, is Duke available?") { id } }`,
        {
          p: postId,
        },
      )
    ).requestContact.id;
  });

  it("a third party cannot fetch someone else's WhatsApp link", async () => {
    await ok(owner.token, `mutation($r: ID!) { approveContactRequest(requestId: $r) { id } }`, { r: requestId });
    expect((await gql(other.token, `query($r: ID!) { getWhatsAppLink(requestId: $r) }`, { r: requestId })).code).toBe(
      'FORBIDDEN',
    );
  });

  it('a requester cannot approve or reject their own request', async () => {
    const second = await createAccount('edge-self-approve', home);
    const r = await ok<any>(
      second.token,
      `mutation($p: ID!) { requestContact(postId: $p, message: "Hi, still looking for a match?") { id } }`,
      {
        p: postId,
      },
    );
    const id = r.requestContact.id;
    expect(
      (await gql(second.token, `mutation($r: ID!) { approveContactRequest(requestId: $r) { id } }`, { r: id })).code,
    ).toBe('FORBIDDEN');
    expect(
      (await gql(second.token, `mutation($r: ID!) { rejectContactRequest(requestId: $r) { id } }`, { r: id })).code,
    ).toBe('FORBIDDEN');
  });

  it('only the owner can list the requests on a post', async () => {
    const r = await gql(other.token, `query($p: ID!) { postContactRequests(postId: $p) { edges { node { id } } } }`, {
      p: postId,
    });
    expect(r.code).toBe('FORBIDDEN');
  });
});

describe('pagination and identifiers', () => {
  // Out-of-range page sizes never crash, but the two feed families disagree
  // (finding F-12): the post feeds validate first ∈ 1..50, while matingFeed
  // clamps it with common/utils/pagination.util.ts.
  it.each([
    [0, 1],
    [-1, 1],
    [1000, 50],
  ])('first: %p — helpFeed rejects it, matingFeed clamps it to %p', async (first, max) => {
    const help = await gql(
      owner.token,
      `query($f: Int, $c: ID) { helpFeed(cityId: $c, first: $f) { edges { node { id } } } }`,
      { f: first, c: home },
    );
    expect(help.code).toBe('VALIDATION_ERROR');
    const mating = await ok<any>(owner.token, `query($f: Int) { matingFeed(first: $f) { edges { node { id } } } }`, {
      f: first,
    });
    expect(mating.matingFeed.edges.length).toBeLessThanOrEqual(max);
  });

  it('rejects a malformed cursor with a validation error, never a crash', async () => {
    const help = await gql(
      owner.token,
      `query($c: ID) { helpFeed(cityId: $c, first: 5, after: "garbage") { edges { node { id } } } }`,
      { c: home },
    );
    const mating = await gql(owner.token, `{ matingFeed(first: 5, after: "garbage") { edges { node { id } } } }`);
    expect([help.code, mating.code]).toEqual(['VALIDATION_ERROR', 'VALIDATION_ERROR']);
  });

  it('requires a location for the help feed', async () => {
    expect((await gql(owner.token, `{ helpFeed(first: 5) { edges { node { id } } } }`)).code).toBe('VALIDATION_ERROR');
  });

  it('pages through a feed without repeating or skipping posts', async () => {
    const author = await createAccount('edge-pager', home);
    const created: string[] = [];
    for (let i = 0; i < 3; i++) created.push(await RESCUE.create(author.token, home, []));
    const seen: string[] = [];
    let after: string | null = null;
    for (let page = 0; page < 50; page++) {
      const d: any = await ok(
        author.token,
        `query($a: String, $c: ID) { helpFeed(cityId: $c, first: 2, after: $a) { edges { node { id } } pageInfo { hasNextPage endCursor } } }`,
        {
          a: after,
          c: home,
        },
      );
      seen.push(...d.helpFeed.edges.map((e: any) => e.node.id));
      if (!d.helpFeed.pageInfo.hasNextPage) break;
      after = d.helpFeed.pageInfo.endCursor;
    }
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of created) expect(seen).toContain(id);
  });

  it('returns an empty page (not an error) when nothing matches', async () => {
    const d = await ok<any>(
      owner.token,
      `query($c: ID) { helpFeed(cityId: $c, first: 5, search: "zzqq-no-such-post-anywhere") { edges { node { id } } pageInfo { hasNextPage } } }`,
      { c: home },
    );
    expect(d.helpFeed).toEqual({ edges: [], pageInfo: { hasNextPage: false } });
  });

  it('rejects a malformed post id and returns null for an unknown one', async () => {
    expect((await gql(owner.token, `{ post(id: "not-a-uuid") { id } }`)).code).toBe('VALIDATION_ERROR');
    const unknown = await gql<any>(owner.token, `{ post(id: "01a0d4b5-0000-7000-8000-000000000000") { id } }`);
    expect(unknown.code).toBeNull();
    expect(unknown.data?.post).toBeNull();
  });
});

describe('authentication', () => {
  it('rejects a malformed token', async () => {
    expect((await gql('garbage.token.value', `{ me { id } }`)).code).toBe('UNAUTHENTICATED');
  });

  it('keeps public reference data public', async () => {
    expect((await gql(null, `{ cities { id } }`)).code).toBeNull();
  });

  it('blocks publishing until the Terms are accepted', async () => {
    const fresh = await createAccount('edge-noterms', home, { completeProfile: false });
    const code = await RESCUE.create(fresh.token, home, []).then(() => 'OK', codeOf);
    expect(code).toBe('TERMS_ACCEPTANCE_REQUIRED');
  });
});

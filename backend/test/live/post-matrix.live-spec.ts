/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- GraphQL responses are untyped JSON */
/**
 * Post type × role matrix, end to end over HTTP.
 *
 * For every PostType (RESCUE, LOST_PET, FOUND_STRAY, ADOPTION, PRODUCT, MATING)
 * this exercises the OWNER, a VIEWER, a LOGGED-OUT caller and an account the
 * owner has BLOCKED, against a running backend using Firebase Auth Emulator
 * tokens and real presigned uploads to a local S3 fake.
 *
 * Run with the rig up (see AUDIT/e2e-rig):  npm run test:live
 *
 * `it.failing` marks a test that asserts the CORRECT behaviour and currently
 * fails because of a known, reported defect — it keeps the suite green while
 * documenting the bug, and turns red once the bug is fixed so it can be flipped.
 */
import { Account, cityId, createAccount, gql, ok, sleep, uploads } from './harness';
import { POST_TYPES, PostTypeCase } from './post-types';

const HOME = 'Qasr Al-Nile';
const FAR = 'Al Attarin'; // Alexandria, ~180 km away — outside every feed radius

let home: string;
let far: string;

beforeAll(async () => {
  home = await cityId(HOME);
  far = await cityId(FAR);
});

const POST_Q = `query($p: ID!) {
  post(id: $p) {
    id status postType title
    coordinates { latitude longitude }
    media { publicUrl displayOrder }
    creator { id fullName email phoneNumber homeCityId languagePreference notificationsEnabled lastSeenAt city { id } }
  }
}`;

async function myPostIds(a: Account, t: PostTypeCase) {
  const d = await ok<any>(
    a.token,
    `query($t: PostType!) { myPosts(postType: $t, first: 50) { edges { node { id } } } }`,
    {
      t: t.postType,
    },
  );
  return d.myPosts.edges.map((e: any) => e.node.id as string);
}

async function savedIds(a: Account) {
  const d = await ok<any>(a.token, `{ mySavedPosts(first: 50) { edges { node { id } } } }`);
  return d.mySavedPosts.edges.map((e: any) => e.node.id as string);
}

const closeMutation = `mutation($p: ID!, $s: PostStatus!) { updatePostStatus(postId: $p, status: $s) { status } }`;

describe.each(POST_TYPES)('$key', (t) => {
  let owner: Account;
  let viewer: Account;
  let blocked: Account;
  let postId: string;

  beforeAll(async () => {
    owner = await createAccount(`own-${t.key.toLowerCase()}`, home);
    viewer = await createAccount(`view-${t.key.toLowerCase()}`, home);
    blocked = await createAccount(`blk-${t.key.toLowerCase()}`, home);
    await ok(owner.token, `mutation($u: ID!) { blockUser(userId: $u) }`, { u: blocked.id });
    postId = await t.create(owner.token, home, await uploads(owner.token, 1));
  });

  describe('owner', () => {
    it('creates it with every field and one photo', async () => {
      const { post } = await ok<any>(owner.token, POST_Q, { p: postId });
      expect(post).toMatchObject({ id: postId, status: 'ACTIVE', postType: t.postType });
      expect(post.media).toHaveLength(1);
    });

    it('creates it with only the required fields', async () => {
      const author = await createAccount(`min-${t.key.toLowerCase()}`, home);
      const media = t.photoRequired ? await uploads(author.token, 1) : [];
      await expect(t.create(author.token, home, media, true)).resolves.toEqual(expect.any(String));
    });

    it('accepts the maximum of 4 photos and rejects a fifth', async () => {
      const author = await createAccount(`max-${t.key.toLowerCase()}`, home);
      const four = await t.create(author.token, home, await uploads(author.token, 4));
      const { post } = await ok<any>(author.token, POST_Q, { p: four });
      expect(post.media.map((m: any) => m.displayOrder)).toEqual([0, 1, 2, 3]);
      await expect(t.create(author.token, home, await uploads(author.token, 5))).rejects.toThrow(/VALIDATION_ERROR/);
    });

    it(t.photoRequired ? 'refuses to publish without a photo' : 'can publish without a photo', async () => {
      const author = await createAccount(`nophoto-${t.key.toLowerCase()}`, home);
      const attempt = t.create(author.token, home, []);
      if (t.photoRequired) await expect(attempt).rejects.toThrow(/VALIDATION_ERROR/);
      else await expect(attempt).resolves.toEqual(expect.any(String));
    });

    it('sees it in My Posts', async () => {
      expect(await myPostIds(owner, t)).toContain(postId);
    });

    it('sees it in its own feed for its city, and not in a distant city', async () => {
      expect(await t.feedIds(owner.token, home)).toContain(postId);
      expect(await t.feedIds(owner.token, far)).not.toContain(postId);
    });

    it('opens the detail view', async () => {
      const d = await t.detail(owner.token, postId);
      expect(d.code).toBeNull();
      expect(d.data).not.toBeNull();
    });

    it.todo('edits the post — no update mutation exists for any post type (finding F-03)');
  });

  describe('viewer', () => {
    it('sees it in the feed with the owner name and photos', async () => {
      expect(await t.feedIds(viewer.token, home)).toContain(postId);
      const { post } = await ok<any>(viewer.token, POST_Q, { p: postId });
      expect(post.creator.fullName).toContain('own-');
      expect(post.media[0].publicUrl).toMatch(/^https?:\/\//);
    });

    it("cannot read the owner's account-private fields (regression for F-01)", async () => {
      const { post } = await ok<any>(viewer.token, POST_Q, { p: postId });
      expect(post.creator).toMatchObject({
        email: null,
        phoneNumber: null,
        homeCityId: null,
        languagePreference: null,
        notificationsEnabled: null,
        lastSeenAt: null,
        city: null,
      });
    });

    it(t.coordinatesPublic ? 'sees the exact location' : 'never sees the exact location (city only)', async () => {
      const { post } = await ok<any>(viewer.token, POST_Q, { p: postId });
      if (t.coordinatesPublic)
        expect(post.coordinates).toEqual({ latitude: expect.any(Number), longitude: expect.any(Number) });
      else expect(post.coordinates).toBeNull();
    });

    it('opens the detail view', async () => {
      const d = await t.detail(viewer.token, postId);
      expect(d.code).toBeNull();
      expect(d.data).not.toBeNull();
    });

    if (t.postType === 'PRODUCT') {
      it('cannot upvote a marketplace listing', async () => {
        const r = await gql(viewer.token, `mutation($p: ID!) { toggleUpvote(postId: $p) { id } }`, { p: postId });
        expect(r.code).toBe('VALIDATION_ERROR');
      });
    } else {
      it('upvotes and un-upvotes it', async () => {
        const on = await ok<any>(
          viewer.token,
          `mutation($p: ID!) { toggleUpvote(postId: $p) { isUpvotedByMe upvoteCount } }`,
          { p: postId },
        );
        expect(on.toggleUpvote).toEqual({ isUpvotedByMe: true, upvoteCount: 1 });
        const off = await ok<any>(
          viewer.token,
          `mutation($p: ID!) { toggleUpvote(postId: $p) { isUpvotedByMe upvoteCount } }`,
          { p: postId },
        );
        expect(off.toggleUpvote).toEqual({ isUpvotedByMe: false, upvoteCount: 0 });
      });
    }

    it('saves it and finds it in Saved', async () => {
      const r = await ok<any>(viewer.token, `mutation($p: ID!) { toggleSave(postId: $p) { isSavedByMe } }`, {
        p: postId,
      });
      expect(r.toggleSave.isSavedByMe).toBe(true);
      expect(await savedIds(viewer)).toContain(postId);
    });

    it('comments, and a retried submission returns the same comment', async () => {
      const input = { clientRequestId: `c-${t.key}-${Date.now()}`, postId, text: 'Is this still available?' };
      const first = await ok<any>(
        viewer.token,
        `mutation($i: CreateCommentInput!) { createComment(input: $i) { id } }`,
        { i: input },
      );
      const retry = await ok<any>(
        viewer.token,
        `mutation($i: CreateCommentInput!) { createComment(input: $i) { id } }`,
        { i: input },
      );
      expect(retry.createComment.id).toBe(first.createComment.id);
      const list = await ok<any>(owner.token, `query($p: ID!) { comments(postId: $p) { edges { node { id } } } }`, {
        p: postId,
      });
      expect(list.comments.edges.map((e: any) => e.node.id)).toContain(first.createComment.id);
    });

    if (t.interaction === 'contactRequest') {
      it('requests contact; the owner sees and approves it; the viewer gets the WhatsApp link', async () => {
        const req = await ok<any>(
          viewer.token,
          `mutation($p: ID!) { requestContact(postId: $p, message: "Hello! Is this still open?") { id status } }`,
          { p: postId },
        );
        expect(req.requestContact.status).toBe('PENDING');
        const dup = await gql(
          viewer.token,
          `mutation($p: ID!) { requestContact(postId: $p, message: "Hello again, second try.") { id } }`,
          { p: postId },
        );
        expect(dup.code).toBe('CONFLICT');
        const early = await gql(viewer.token, `query($r: ID!) { getWhatsAppLink(requestId: $r) }`, {
          r: req.requestContact.id,
        });
        expect(early.errors).toBeDefined();
        const list = await ok<any>(
          owner.token,
          `query($p: ID!) { postContactRequests(postId: $p) { edges { node { id } } } }`,
          { p: postId },
        );
        expect(list.postContactRequests.edges.map((e: any) => e.node.id)).toContain(req.requestContact.id);
        await ok(owner.token, `mutation($r: ID!) { approveContactRequest(requestId: $r) { id } }`, {
          r: req.requestContact.id,
        });
        const link = await ok<any>(viewer.token, `query($r: ID!) { getWhatsAppLink(requestId: $r) }`, {
          r: req.requestContact.id,
        });
        expect(link.getWhatsAppLink).toMatch(/^https:\/\/wa\.me\/\d+/);
      });
    }

    if (t.interaction === 'adoptionApplication') {
      it('applies to adopt; the owner sees and approves it; the applicant gets the WhatsApp link', async () => {
        const app = await ok<any>(
          viewer.token,
          `mutation($i: SubmitAdoptionApplicationInput!) { submitAdoptionApplication(input: $i) { id status } }`,
          {
            i: {
              targetPostId: postId,
              livingSituation: 'APARTMENT',
              hasOutdoorAccess: false,
              hasOtherPetsAtHome: false,
              hasChildrenAtHome: false,
              whyAdopt: 'Quiet home, lots of time and a vet nearby.',
              consentHomeVisit: true,
              canProvideVetReference: true,
            },
          },
        );
        expect(app.submitAdoptionApplication.status).toBe('PENDING');
        const list = await ok<any>(
          owner.token,
          `query($p: ID!) { postAdoptionApplications(postId: $p) { edges { node { id } } } }`,
          { p: postId },
        );
        expect(list.postAdoptionApplications.edges.map((e: any) => e.node.id)).toContain(
          app.submitAdoptionApplication.id,
        );
        await ok(owner.token, `mutation($a: ID!) { approveAdoptionApplication(applicationId: $a) { id } }`, {
          a: app.submitAdoptionApplication.id,
        });
        const link = await ok<any>(viewer.token, `query($a: ID!) { getAdoptionWhatsAppLink(applicationId: $a) }`, {
          a: app.submitAdoptionApplication.id,
        });
        expect(link.getAdoptionWhatsAppLink).toMatch(/^https:\/\/wa\.me\/\d+/);
      });
    }

    if (t.interaction === 'sellerContact') {
      it('gets the seller contact directly (no approval step for listings)', async () => {
        const r = await ok<any>(viewer.token, `query($p: ID!) { getProductSellerContact(postId: $p) }`, { p: postId });
        expect(r.getProductSellerContact).toMatch(/^https:\/\/wa\.me\/\d+/);
      });
    }

    it('reports it once; a second report says it is already reported', async () => {
      const first = await ok<any>(
        viewer.token,
        `mutation($p: ID!) { reportPost(input: { postId: $p, reason: SPAM }) }`,
        { p: postId },
      );
      expect(first.reportPost).toBe(true);
      const again = await gql(viewer.token, `mutation($p: ID!) { reportPost(input: { postId: $p, reason: SPAM }) }`, {
        p: postId,
      });
      expect(again.code).toBe('POST_ALREADY_REPORTED');
    });

    it('cannot close, delete or renew it, or list its requests — and the post is unchanged', async () => {
      const attempts = [
        gql(viewer.token, closeMutation, { p: postId, s: t.closeTo }),
        gql(viewer.token, `mutation($p: ID!) { deletePost(postId: $p) }`, { p: postId }),
        gql(viewer.token, `mutation($p: ID!) { renewPost(postId: $p) { id } }`, { p: postId }),
        gql(viewer.token, `query($p: ID!) { postContactRequests(postId: $p) { edges { node { id } } } }`, {
          p: postId,
        }),
      ];
      for (const r of await Promise.all(attempts)) expect(r.code).toBe('FORBIDDEN');
      if (t.interaction === 'adoptionApplication') {
        const apps = await gql(
          viewer.token,
          `query($p: ID!) { postAdoptionApplications(postId: $p) { edges { node { id } } } }`,
          { p: postId },
        );
        expect(apps.code).toBe('FORBIDDEN');
      }
      const { post } = await ok<any>(owner.token, POST_Q, { p: postId });
      expect(post.status).toBe('ACTIVE');
    });
  });

  describe('logged out', () => {
    it('cannot read the post, its detail or its feed, or act on it', async () => {
      const reads = [
        gql(null, POST_Q, { p: postId }),
        gql(null, `query($id: ID!) { post(id: $id) { id } }`, { id: postId }),
        gql(null, `mutation($p: ID!) { toggleSave(postId: $p) { id } }`, { p: postId }),
        gql(null, `mutation($p: ID!) { deletePost(postId: $p) }`, { p: postId }),
      ];
      for (const r of await Promise.all(reads)) expect(r.code).toBe('UNAUTHENTICATED');
      expect((await t.detail('', postId)).code).toBe('UNAUTHENTICATED');
    });
  });

  describe('blocked account', () => {
    it("never sees the owner's post in the feed, by id, or in detail", async () => {
      expect(await t.feedIds(blocked.token, home)).not.toContain(postId);
      const byId = await gql<any>(blocked.token, POST_Q, { p: postId });
      expect(byId.code).toBeNull();
      expect(byId.data?.post).toBeNull();
      expect((await t.detail(blocked.token, postId)).code).toBe('NOT_FOUND');
    });

    it('cannot save, comment on or request contact about it', async () => {
      const results = await Promise.all([
        gql(blocked.token, `mutation($p: ID!) { toggleSave(postId: $p) { id } }`, { p: postId }),
        gql(blocked.token, `mutation($i: CreateCommentInput!) { createComment(input: $i) { id } }`, {
          i: { clientRequestId: `blk-${t.key}-${Date.now()}`, postId, text: 'hello from a blocked account' },
        }),
        gql(
          blocked.token,
          `mutation($p: ID!) { requestContact(postId: $p, message: "Hi, are you still around?") { id } }`,
          { p: postId },
        ),
      ]);
      for (const r of results) expect(r.code).toMatch(/NOT_FOUND|VALIDATION_ERROR/);
      expect(results[0].code).toBe('NOT_FOUND');
    });

    it('is hidden from the owner in the other direction too', async () => {
      const theirs = await t.create(blocked.token, home, await uploads(blocked.token, 1));
      expect(await t.feedIds(owner.token, home)).not.toContain(theirs);
      const byId = await gql<any>(owner.token, POST_Q, { p: theirs });
      expect(byId.data?.post).toBeNull();
    });
  });

  describe('owner lifecycle', () => {
    it(t.renewable ? 'renews an active listing' : 'cannot renew (only ADOPTION and PRODUCT renew)', async () => {
      const r = await gql(owner.token, `mutation($p: ID!) { renewPost(postId: $p) { id } }`, { p: postId });
      if (t.renewable) expect(r.code).toBeNull();
      else expect(r.code).toBe('VALIDATION_ERROR');
    });

    it(`closes it as ${t.closeTo}: it leaves the feed but stays readable, and cannot be closed twice`, async () => {
      const r = await ok<any>(owner.token, closeMutation, { p: postId, s: t.closeTo });
      expect(r.updatePostStatus.status).toBe(t.closeTo);
      expect(await t.feedIds(viewer.token, home)).not.toContain(postId);
      const { post } = await ok<any>(viewer.token, POST_Q, { p: postId });
      expect(post.status).toBe(t.closeTo);
      expect((await gql(owner.token, closeMutation, { p: postId, s: t.closeTo })).code).toBe('VALIDATION_ERROR');
    });

    it('deletes a post: gone from feeds, My Posts, Saved and detail; a second delete is NOT_FOUND', async () => {
      const doomed = await t.create(owner.token, home, await uploads(owner.token, 1));
      await ok(viewer.token, `mutation($p: ID!) { toggleSave(postId: $p) { id } }`, { p: doomed });
      expect(
        (await ok<any>(owner.token, `mutation($p: ID!) { deletePost(postId: $p) }`, { p: doomed })).deletePost,
      ).toBe(true);
      expect(await t.feedIds(viewer.token, home)).not.toContain(doomed);
      expect(await myPostIds(owner, t)).not.toContain(doomed);
      expect(await savedIds(viewer)).not.toContain(doomed);
      // A stale link or feed entry resolves cleanly to "not found", never a crash.
      const stale = await gql<any>(viewer.token, POST_Q, { p: doomed });
      expect(stale.code).toBeNull();
      expect(stale.data?.post).toBeNull();
      expect((await t.detail(viewer.token, doomed)).code).toBe('NOT_FOUND');
      expect((await gql(owner.token, `mutation($p: ID!) { deletePost(postId: $p) }`, { p: doomed })).code).toBe(
        'NOT_FOUND',
      );
    });
  });
});

describe('photos of an owner-removed post', () => {
  // Finding F-09: OWNER_REMOVE retains media by contract, and no deletion work
  // is enqueued, so a removed post's photo stays publicly downloadable.
  it.failing(
    'become unreachable within two minutes of deletion',
    async () => {
      const author = await createAccount('photo-cleanup', home);
      const RESCUE = POST_TYPES[0];
      const id = await RESCUE.create(author.token, home, await uploads(author.token, 1));
      const { post } = await ok<any>(author.token, POST_Q, { p: id });
      const url: string = post.media[0].publicUrl;
      expect((await fetch(url)).status).toBe(200);
      await ok(author.token, `mutation($p: ID!) { deletePost(postId: $p) }`, { p: id });
      const deadline = Date.now() + 120_000;
      let status = 200;
      while (Date.now() < deadline && status === 200) {
        await sleep(10_000);
        status = (await fetch(url)).status;
      }
      expect(status).not.toBe(200);
    },
    180_000,
  );
});

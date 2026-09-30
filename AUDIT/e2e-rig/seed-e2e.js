// Seeds pupzy_e2e through the real GraphQL API, exactly as the app would:
// Auth Emulator sign-up → email verification → completeProfile → acceptTerms →
// presigned photo upload to the local s3rver → create posts of every type →
// viewer engagement → owner blocks the "blocked" account.
//
// Requires the rig to be running: `npm run s3`, `npm run auth`, `npm run backend`.
// Writes seed-output.json (user ids + post ids) for the e2e tests to reuse.
const fs = require('fs');
const path = require('path');

const AUTH = 'http://127.0.0.1:9099';
const API = 'http://127.0.0.1:8080/graphql';
const PROJECT = 'pupzy-app-5f707';
const PASSWORD = 'E2e-only-Passw0rd!'; // Auth Emulator account, not a real credential

const USERS = {
  owner: { email: 'owner@pupzy.test', fullName: 'Olivia Owner', phone: '+201000000001' },
  viewer: { email: 'viewer@pupzy.test', fullName: 'Victor Viewer', phone: '+201000000002' },
  blocked: { email: 'blocked@pupzy.test', fullName: 'Bruno Blocked', phone: '+201000000003' },
};

const PHOTOS = {
  dog1: 'https://images.dog.ceo/breeds/german-shepherd/n02106662_104.jpg',
  dog2: 'https://images.dog.ceo/breeds/husky/n02110185_9712.jpg',
  dog3: 'https://images.dog.ceo/breeds/pomeranian/n02112018_7127.jpg',
  dog4: 'https://images.dog.ceo/breeds/maltese/n02085936_3677.jpg',
  cat1: 'https://s3.us-west-2.amazonaws.com/cdn2.thecatapi.com/images/lZOJKmkxY.jpg',
};

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${res.status} non-JSON response: ${text.slice(0, 200)}`);
  }
}

async function emulatorAccount(email) {
  const signUp = await json(
    await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    }),
  );
  let localId = signUp.localId;
  if (!localId) {
    if (!String(signUp.error?.message).includes('EMAIL_EXISTS')) throw new Error(JSON.stringify(signUp));
    const existing = await signIn(email);
    localId = existing.localId;
  }
  // The backend rejects unverified emails (EMAIL_NOT_VERIFIED), so verify via the emulator admin API.
  await json(
    await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ localId, emailVerified: true }),
    }),
  );
  return signIn(email);
}

async function signIn(email) {
  const r = await json(
    await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    }),
  );
  if (!r.idToken) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(r)}`);
  return r;
}

async function gql(token, query, variables = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const body = await json(res);
  if (body.errors) throw new Error(`${query.trim().split('\n')[0]} → ${JSON.stringify(body.errors)}`);
  return body.data;
}

async function photo(name) {
  const dir = path.join(__dirname, 'photos');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.jpg`);
  if (!fs.existsSync(file)) {
    const res = await fetch(PHOTOS[name], { headers: { 'User-Agent': 'PupzyE2E/1.0' } });
    if (!res.ok) throw new Error(`photo ${name}: HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return fs.readFileSync(file);
}

async function upload(token, name) {
  const bytes = await photo(name);
  const { requestMediaUploadUrl: ticket } = await gql(
    token,
    `mutation($input: RequestMediaUploadInput!) { requestMediaUploadUrl(input: $input) { mediaId uploadUrl } }`,
    { input: { contentType: 'image/jpeg', fileSizeBytes: bytes.length } },
  );
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: bytes });
  if (!put.ok) throw new Error(`PUT ${name} → ${put.status} ${await put.text()}`);
  return ticket.mediaId;
}

async function main() {
  const { cities } = await gql(null, `{ cities { id nameEnglish } }`);
  const city = cities.find((c) => c.nameEnglish === 'Qasr Al-Nile');
  if (!city) throw new Error('Qasr Al-Nile missing — run the backend db:seed against pupzy_e2e first');
  const coords = { latitude: 30.0444, longitude: 31.2357 };

  const out = { cityId: city.id, cityName: city.nameEnglish, users: {}, posts: {} };
  const tokens = {};

  for (const [role, u] of Object.entries(USERS)) {
    const session = await emulatorAccount(u.email);
    tokens[role] = session.idToken;
    const { me } = await gql(tokens[role], `{ me { id fullName } }`);
    if (!me.fullName) {
      await gql(
        tokens[role],
        `mutation($input: CompleteProfileInput!) { completeProfile(input: $input) { id } }`,
        { input: { fullName: u.fullName, phoneNumber: u.phone, cityId: city.id, languagePreference: 'en' } },
      );
    }
    const { terms } = await gql(tokens[role], `{ terms { currentVersion acceptanceRequired } }`);
    if (terms.acceptanceRequired) {
      await gql(tokens[role], `mutation($v: String!) { acceptTerms(input: { version: $v }) { acceptedVersion } }`, {
        v: terms.currentVersion,
      });
    }
    out.users[role] = { id: me.id, email: u.email, firebaseUid: session.localId, fullName: u.fullName };
    console.log(`✓ ${role.padEnd(7)} ${u.email}  (${me.id})`);
  }

  const T = tokens.owner;
  const base = (title, description) => ({ title, description, cityId: city.id, coordinates: coords });

  out.posts.rescue = (
    await gql(T, `mutation($i: CreateRescuePostInput!) { createRescuePost(input: $i) { id } }`, {
      i: {
        ...base('Injured dog near Tahrir Square', 'Limping German Shepherd mix near the metro exit, looks hungry and scared.'),
        species: 'DOG',
        conditionSummary: 'Limping on the back left leg, no visible bleeding.',
        reporterRole: 'REPORTING',
        isLifeThreatening: false,
        hasVisibleSeriousInjury: true,
        isInDangerousLocation: true,
        canAnimalMoveOrEscape: true,
        mediaIds: [await upload(T, 'dog1')],
      },
    })
  ).createRescuePost.id;

  out.posts.lostPet = (
    await gql(T, `mutation($i: CreateLostPostInput!) { createLostPost(input: $i) { id } }`, {
      i: {
        ...base('Lost husky — Storm', 'Our husky slipped his collar in Garden City on Tuesday evening. Very friendly.'),
        reportType: 'LOST_PET',
        species: 'DOG',
        breed: 'Siberian Husky',
        petName: 'Storm',
        colorAndMarkings: 'Grey and white, blue eyes',
        hasCollarWithIdentificationTag: false,
        circumstances: 'Ran after a cat while on a walk near the Corniche.',
        dateLastSeen: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
        hasMedicalNeeds: false,
        isElderlyOrVeryYoung: false,
        lastSeenNearHazard: true,
        mediaIds: [await upload(T, 'dog2')],
      },
    })
  ).createLostPost.id;

  out.posts.foundStray = (
    await gql(T, `mutation($i: CreateLostPostInput!) { createLostPost(input: $i) { id } }`, {
      i: {
        ...base('Found small white dog', 'Found this little one wandering near Qasr El Nil bridge, now safe with me.'),
        reportType: 'FOUND_STRAY',
        species: 'DOG',
        colorAndMarkings: 'White, fluffy, pink collar without a tag',
        circumstances: 'Was wandering alone near the bridge at night.',
        currentCondition: 'HEALTHY',
        isCurrentlySafeWithReporter: true,
        dateFound: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
        mediaIds: [await upload(T, 'dog4')],
      },
    })
  ).createLostPost.id;

  out.posts.adoption = (
    await gql(T, `mutation($i: CreateAdoptionPostInput!) { createAdoptionPost(input: $i) { id } }`, {
      i: {
        ...base('Luna needs a loving home', 'Calm Himalayan cat, fully vaccinated, great with kids.'),
        petName: 'Luna',
        species: 'CAT',
        breed: 'Himalayan',
        ageValue: 2,
        ageUnit: 'YEARS',
        gender: 'FEMALE',
        vaccinated: true,
        neutered: true,
        personalityTags: ['CALM', 'GOOD_WITH_KIDS'],
        priorPetExperienceRequired: false,
        mediaIds: [await upload(T, 'cat1')],
      },
    })
  ).createAdoptionPost.id;

  out.posts.product = (
    await gql(T, `mutation($i: CreateProductPostInput!) { createProductPost(input: $i) { id } }`, {
      i: {
        ...base('Large dog crate, barely used', 'Metal crate 90cm, folds flat, includes tray.'),
        category: 'TRANSPORT',
        condition: 'LIKE_NEW',
        priceAmount: 1200,
        priceCurrency: 'EGP',
        isFree: false,
        openToOffers: true,
        mediaIds: [await upload(T, 'dog3')],
      },
    })
  ).createProductPost.id;

  const matingInput = (petName, breed, gender, mediaIds) => ({
    petName,
    species: 'DOG',
    breed,
    gender,
    ageValue: 3,
    ageUnit: 'YEARS',
    isPurebred: true,
    hasPedigreeCertificate: true,
    vaccinated: true,
    dewormed: true,
    termsSummary: 'First pick of the litter',
    matingConditions: 'Vaccination records required.',
    cityId: city.id,
    mediaIds,
  });
  out.posts.mating = (
    await gql(T, `mutation($i: CreateMatingPostInput!) { createMatingPost(input: $i) { id } }`, {
      i: matingInput('Rex', 'German Shepherd', 'MALE', [await upload(T, 'dog1')]),
    })
  ).createMatingPost.id;
  out.posts.matingMaxPhotos = (
    await gql(T, `mutation($i: CreateMatingPostInput!) { createMatingPost(input: $i) { id } }`, {
      i: matingInput('Snow', 'Maltese', 'FEMALE', [
        await upload(T, 'dog4'),
        await upload(T, 'dog3'),
        await upload(T, 'dog2'),
        await upload(T, 'dog1'),
      ]),
    })
  ).createMatingPost.id;

  // The account the owner will block also posts, so isolation can be checked both ways.
  out.posts.blockedMating = (
    await gql(tokens.blocked, `mutation($i: CreateMatingPostInput!) { createMatingPost(input: $i) { id } }`, {
      i: matingInput('Bruno', 'Rottweiler', 'MALE', [await upload(tokens.blocked, 'dog2')]),
    })
  ).createMatingPost.id;

  // Viewer engagement on the owner's posts.
  const V = tokens.viewer;
  await gql(V, `mutation($p: ID!) { toggleUpvote(postId: $p) { id } }`, { p: out.posts.rescue });
  await gql(V, `mutation($p: ID!) { toggleSave(postId: $p) { id } }`, { p: out.posts.mating });
  await gql(V, `mutation($i: CreateCommentInput!) { createComment(input: $i) { id } }`, {
    i: { clientRequestId: `seed-${Date.now()}`, postId: out.posts.rescue, text: 'On my way with a carrier, 10 minutes.' },
  });
  await gql(V, `mutation($p: ID!, $m: String!) { requestContact(postId: $p, message: $m) { id } }`, {
    p: out.posts.mating,
    m: 'Hi! I have a female German Shepherd, interested in mating.',
  });

  await gql(T, `mutation($u: ID!) { blockUser(userId: $u) }`, { u: out.users.blocked.id });

  fs.writeFileSync(path.join(__dirname, 'seed-output.json'), JSON.stringify(out, null, 2));
  console.log('✓ posts:', Object.keys(out.posts).join(', '));
  console.log('✓ owner blocked', out.users.blocked.email);
  console.log('wrote seed-output.json');
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});

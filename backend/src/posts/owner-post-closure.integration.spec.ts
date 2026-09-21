import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import DataLoader from 'dataloader';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  adoptionApplications,
  blocks,
  cities,
  contactRequests,
  lostPosts,
  postMedia,
  posts,
  users,
  type AdoptionApplication,
  type City,
  type ContactRequest,
  type Post,
  type User,
} from '../database/schema';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';
import { PostsResolver } from './posts.resolver';
import { ContactsRepository } from '../contacts/contacts.repository';
import { ContactsService } from '../contacts/contacts.service';
import { ContactsResolver } from '../contacts/contacts.resolver';
import { AdoptionsRepository } from '../adoptions/adoptions.repository';
import { AdoptionsService } from '../adoptions/adoptions.service';
import { AdoptionsResolver } from '../adoptions/adoptions.resolver';
import { UsersRepository } from '../users/users.repository';
import { AccountDeletionRepository } from '../users/account-deletion.repository';
import { CitiesRepository } from '../cities/cities.repository';
import { CitiesService } from '../cities/cities.service';
import { UsersService } from '../users/users.service';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import { NotificationsService } from '../notifications/notifications.service';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { encryptString } from '../common/utils/crypto.util';
import type { GqlContext } from '../common/types/gql-context.type';

type PostType = 'RESCUE' | 'LOST' | 'ADOPTION' | 'PRODUCT' | 'MATING';
type LostReportType = 'LOST_PET' | 'FOUND_STRAY';

const PHONE_KEY = 'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=';
const OWNER_PHONE = '+201012345678';
const OWNER_WA_LINK = 'https://wa.me/201012345678';
const NONEXISTENT_POST_ID = '0192ffff-0000-7000-8000-000000000000';
const NONEXISTENT_REQUEST_ID = '0192ffff-0000-7000-8000-000000000001';

const UPDATE_POST_STATUS = `mutation UpdatePostStatus($postId: ID!, $status: PostStatus!) {
  updatePostStatus(postId: $postId, status: $status) { id status postType }
}`;

const DELETE_POST = `mutation DeletePost($postId: ID!) {
  deletePost(postId: $postId)
}`;

const MY_POSTS = `query Mine($postType: PostType!, $first: Int) {
  myPosts(postType: $postType, first: $first) { edges { node { id status postType } } }
}`;

const REQUEST_CONTACT = `mutation RequestContact($postId: ID!, $message: String!) {
  requestContact(postId: $postId, message: $message) { id status }
}`;

const APPROVE_CONTACT = `mutation ApproveContact($requestId: ID!) {
  approveContactRequest(requestId: $requestId) { id status }
}`;

const GET_WHATSAPP = `query GetWhatsApp($requestId: ID!) { getWhatsAppLink(requestId: $requestId) }`;

const MY_CONTACT_REQUESTS = `query MyContacts($status: RequestStatus, $first: Int) {
  myContactRequests(status: $status, first: $first) { edges { node { id status } } }
}`;

const SUBMIT_APPLICATION = `mutation SubmitApplication($input: SubmitAdoptionApplicationInput!) {
  submitAdoptionApplication(input: $input) { id status }
}`;

const APPROVE_APPLICATION = `mutation ApproveApplication($applicationId: ID!) {
  approveAdoptionApplication(applicationId: $applicationId) { id status }
}`;

const GET_ADOPTION_WHATSAPP = `query GetAdoptionWhatsApp($applicationId: ID!) {
  getAdoptionWhatsAppLink(applicationId: $applicationId)
}`;

const APPLICATION_INPUT = {
  livingSituation: 'APARTMENT',
  hasOutdoorAccess: false,
  hasOtherPetsAtHome: false,
  hasChildrenAtHome: false,
  hoursAtHomePerDay: 6,
  previousPetExperience: 'Grew up with dogs and cats',
  whyAdopt: 'I have a stable home and plenty of love to give a rescued pet.',
  consentHomeVisit: true,
  canProvideVetReference: true,
};

interface PostNode {
  id: string;
  status: Post['status'];
  postType: Post['postType'];
}

interface UpdateStatusData {
  updatePostStatus: PostNode;
}

interface MyPostsData {
  myPosts: { edges: Array<{ node: PostNode }> };
}

interface ContactNode {
  id: string;
  status: string;
}

interface ContactConnection {
  edges: Array<{ node: ContactNode }>;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('Owner Post closure and pending interactions (Ticket 03)', () => {
  jest.setTimeout(240_000);

  let dbHelper: TestDatabaseHelper;
  let executableSchema: GraphQLSchema;
  let postsService: PostsService;
  let postsResolver: PostsResolver;
  let contactsService: ContactsService;
  let contactsResolver: ContactsResolver;
  let adoptionsService: AdoptionsService;
  let adoptionsResolver: AdoptionsResolver;
  let isolationPolicy: AccountIsolationPolicy;
  let fireNotification: jest.Mock;

  let testCity: City;
  let owner: User;
  let requester: User;
  let other: User;

  let postSequence = 0;

  function nextPostId(): string {
    postSequence += 1;
    return `0192f3c0-0000-7000-8000-${String(postSequence).padStart(12, '0')}`;
  }

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    const cacheStore = new Map<string, unknown>();
    const mockCache = {
      get: jest.fn((key: string) => Promise.resolve(cacheStore.get(key))),
      set: jest.fn((key: string, value: unknown) => {
        cacheStore.set(key, value);
        return Promise.resolve();
      }),
      del: jest.fn((key: string) => {
        cacheStore.delete(key);
        return Promise.resolve();
      }),
      reset: jest.fn(() => {
        cacheStore.clear();
        return Promise.resolve();
      }),
    } as unknown as Cache;

    const mockConfig = {
      get: jest.fn((key: string) => (key === 'PHONE_ENCRYPTION_KEY' ? PHONE_KEY : undefined)),
    } as unknown as ConfigService;

    const postsRepository = new PostsRepository(dbHelper.db);
    const contactsRepository = new ContactsRepository(dbHelper.db);
    const adoptionsRepository = new AdoptionsRepository(dbHelper.db);
    const usersRepository = new UsersRepository(dbHelper.db);
    const accountDeletionRepository = new AccountDeletionRepository(dbHelper.db);
    const citiesService = new CitiesService(new CitiesRepository(dbHelper.db), mockCache);
    const usersService = new UsersService(
      usersRepository,
      citiesService,
      accountDeletionRepository,
      mockConfig,
      mockCache,
    );

    isolationPolicy = new AccountIsolationPolicy(dbHelper.db);
    fireNotification = jest.fn().mockResolvedValue(undefined);
    const notificationsService = { fireNotification } as unknown as NotificationsService;

    postsService = new PostsService(
      postsRepository,
      citiesService,
      {} as never,
      {} as never,
      usersService,
      notificationsService,
      mockCache,
    );
    contactsService = new ContactsService(
      contactsRepository,
      postsRepository,
      usersService,
      notificationsService,
      dbHelper.db,
      isolationPolicy,
    );
    adoptionsService = new AdoptionsService(
      adoptionsRepository,
      postsRepository,
      usersService,
      notificationsService,
      dbHelper.db,
      isolationPolicy,
    );

    postsResolver = new PostsResolver(postsService);
    contactsResolver = new ContactsResolver(contactsService);
    adoptionsResolver = new AdoptionsResolver(adoptionsService);

    const schemaFiles = [
      'src/common/graphql/enums.graphql',
      'src/users/users.graphql',
      'src/cities/cities.graphql',
      'src/posts/posts-enums.graphql',
      'src/posts/posts.graphql',
      'src/mating/mating.graphql',
      'src/comments/comments.graphql',
      'src/notifications/notifications.graphql',
      'src/contacts/contacts.graphql',
      'src/adoptions/adoptions.graphql',
    ];
    const typeDefs = schemaFiles.map((relPath) => fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf8'));

    executableSchema = makeExecutableSchema({
      typeDefs,
      resolvers: {
        DateTime: {
          __parseValue: (value: unknown) => value,
          __serialize: (value: unknown) => (value instanceof Date ? value.toISOString() : value),
        },
        Query: {
          post: (_root: unknown, args: { id: string }, ctx: GqlContext) => postsResolver.post(args.id, ctx),
          myPosts: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) => postsResolver.myPosts(args, ctx),
          myContactRequests: (
            _root: unknown,
            args: { postId?: string; status?: string; first?: number; after?: string },
            ctx: GqlContext,
          ) => contactsResolver.myContactRequests(args.postId, args.status, args.first, args.after, ctx),
          getWhatsAppLink: (_root: unknown, args: { requestId: string }, ctx: GqlContext) =>
            contactsResolver.getWhatsAppLink(args.requestId, ctx),
          getAdoptionWhatsAppLink: (_root: unknown, args: { applicationId: string }, ctx: GqlContext) =>
            adoptionsResolver.getAdoptionWhatsAppLink(args.applicationId, ctx),
        },
        Mutation: {
          updatePostStatus: (_root: unknown, args: { postId: string; status: string }, ctx: GqlContext) =>
            postsResolver.updatePostStatus(args.postId, args.status, ctx),
          deletePost: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.deletePost(args.postId, ctx),
          requestContact: (_root: unknown, args: { postId: string; message: string }, ctx: GqlContext) =>
            contactsResolver.requestContact(args.postId, args.message, ctx),
          approveContactRequest: (_root: unknown, args: { requestId: string }, ctx: GqlContext) =>
            contactsResolver.approveContactRequest(args.requestId, ctx),
          submitAdoptionApplication: (_root: unknown, args: { input: unknown }, ctx: GqlContext) =>
            adoptionsResolver.submitAdoptionApplication(args.input, ctx),
          approveAdoptionApplication: (_root: unknown, args: { applicationId: string }, ctx: GqlContext) =>
            adoptionsResolver.approveAdoptionApplication(args.applicationId, ctx),
        },
        ContactRequest: {
          requester: (root: ContactRequest, _args: unknown, ctx: GqlContext) => contactsResolver.requester(root, ctx),
        },
        AdoptionApplication: {
          applicant: (root: AdoptionApplication, _args: unknown, ctx: GqlContext) =>
            adoptionsResolver.applicant(root, ctx),
        },
      },
    });
  });

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();
    fireNotification.mockClear();

    const [city] = await dbHelper.db
      .insert(cities)
      .values({
        nameEnglish: 'Cairo',
        nameArabic: 'القاهرة',
        governorate: 'Cairo',
        status: 'OFFICIAL',
        centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    testCity = city;

    owner = await insertUser('owner', OWNER_PHONE);
    requester = await insertUser('requester');
    other = await insertUser('other');
  });

  async function insertUser(label: string, phone?: string): Promise<User> {
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${label}-${generateUuidV7()}`,
        email: `${label}-${generateUuidV7()}@pupzy.dev`,
        fullName: `Closure ${label}`,
        phoneNumber: phone ? encryptString(phone, PHONE_KEY) : null,
      })
      .returning();
    return user;
  }

  async function seedPost(params: { postType: PostType; creatorId?: string; status?: Post['status'] }): Promise<Post> {
    const isUrgencyType = params.postType === 'RESCUE' || params.postType === 'LOST';
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        id: nextPostId(),
        creatorId: params.creatorId ?? owner.id,
        postType: params.postType,
        title: `Closure ${params.postType} ${generateUuidV7().slice(-4)}`,
        description: 'Owner closure fixture',
        status: params.status ?? 'ACTIVE',
        moderationStatus: 'CLEAN',
        urgency: isUrgencyType ? 'URGENT' : undefined,
        cityId: testCity.id,
        governorate: testCity.governorate,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
        effectiveScore: 0,
      })
      .returning();
    return post;
  }

  async function seedLostPost(reportType: LostReportType, creatorId = owner.id): Promise<Post> {
    const post = await seedPost({ postType: 'LOST', creatorId });
    await dbHelper.db.insert(lostPosts).values({
      postId: post.id,
      reportType,
      species: 'DOG',
      ...(reportType === 'LOST_PET'
        ? { dateLastSeen: '2026-08-01' }
        : { currentCondition: 'HEALTHY', isCurrentlySafeWithReporter: true, dateFound: '2026-08-02' }),
    });
    return post;
  }

  function createContext(user: User): GqlContext {
    const userLoader = new DataLoader<string, User | null>(async (ids: readonly string[]) => {
      const rows = await dbHelper.db
        .select()
        .from(users)
        .where(inArray(users.id, ids as string[]));
      const map = new Map(rows.map((row) => [row.id, row]));
      return ids.map((id) => map.get(id) ?? null);
    });

    return {
      req: {} as unknown as GqlContext['req'],
      user,
      loaders: { userById: userLoader } as unknown as GqlContext['loaders'],
    };
  }

  function runGql<TData>(
    source: string,
    variables: Record<string, unknown>,
    user: User,
  ): Promise<ExecutionResult<TData>> {
    return graphql({
      schema: executableSchema,
      source,
      variableValues: variables,
      contextValue: createContext(user),
    }) as Promise<ExecutionResult<TData>>;
  }

  function errorCode(result: ExecutionResult<unknown>): string | undefined {
    return (result.errors?.[0].originalError as { code?: string } | undefined)?.code;
  }

  function firstError<TData>(result: ExecutionResult<TData>): string {
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    return result.errors![0].message;
  }

  async function closePost(post: Post, status: string, user: User = owner) {
    return runGql<UpdateStatusData>(UPDATE_POST_STATUS, { postId: post.id, status }, user);
  }

  async function removePost(post: Post, user: User = owner) {
    return runGql<{ deletePost: boolean }>(DELETE_POST, { postId: post.id }, user);
  }

  async function requestContact(post: Post, user: User = requester): Promise<string> {
    const result = await runGql<{ requestContact: ContactNode }>(
      REQUEST_CONTACT,
      { postId: post.id, message: 'I would love to help.' },
      user,
    );
    expect(result.errors).toBeUndefined();
    return result.data!.requestContact.id;
  }

  async function approveContact(requestId: string, user: User = owner) {
    return runGql<{ approveContactRequest: ContactNode }>(APPROVE_CONTACT, { requestId }, user);
  }

  async function submitApplication(post: Post, user: User = other): Promise<string> {
    const result = await runGql<{ submitAdoptionApplication: ContactNode }>(
      SUBMIT_APPLICATION,
      { input: { ...APPLICATION_INPUT, targetPostId: post.id } },
      user,
    );
    expect(result.errors).toBeUndefined();
    return result.data!.submitAdoptionApplication.id;
  }

  async function approveApplication(applicationId: string, user: User = owner) {
    return runGql<{ approveAdoptionApplication: ContactNode }>(APPROVE_APPLICATION, { applicationId }, user);
  }

  async function storedPost(postId: string): Promise<Post | undefined> {
    const [row] = await dbHelper.db.select().from(posts).where(eq(posts.id, postId));
    return row;
  }

  async function contactRow(requestId: string): Promise<ContactRequest | undefined> {
    const [row] = await dbHelper.db.select().from(contactRequests).where(eq(contactRequests.id, requestId));
    return row;
  }

  async function applicationRow(applicationId: string): Promise<AdoptionApplication | undefined> {
    const [row] = await dbHelper.db
      .select()
      .from(adoptionApplications)
      .where(eq(adoptionApplications.id, applicationId));
    return row;
  }

  async function allContactRows(postId: string): Promise<ContactRequest[]> {
    return dbHelper.db.select().from(contactRequests).where(eq(contactRequests.postId, postId));
  }

  async function allApplicationRows(postId: string): Promise<AdoptionApplication[]> {
    return dbHelper.db.select().from(adoptionApplications).where(eq(adoptionApplications.targetPostId, postId));
  }

  async function setBlock(blocker: User, blocked: User): Promise<void> {
    await dbHelper.db.delete(blocks);
    await dbHelper.db.insert(blocks).values({ blockerId: blocker.id, blockedId: blocked.id });
  }

  async function clearBlocks(): Promise<void> {
    await dbHelper.db.delete(blocks);
  }

  async function waitForWaitingAdvisoryLock(expectedWaiters = 1, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let observed = 0;
    while (Date.now() < deadline) {
      const result = await dbHelper.pool.query<{ waiting: number }>(
        `SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`,
      );
      observed = Math.max(observed, result.rows[0]?.waiting ?? 0);
      if (observed >= expectedWaiters) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${expectedWaiters} transaction(s) to block on an advisory lock`);
  }

  // ─── Owner closure outcomes ─────────────────────────────────────────────

  describe('owner closure outcomes', () => {
    it.each([
      ['RESCUE', 'RESOLVED'],
      ['LOST_PET', 'REUNITED'],
      ['FOUND_STRAY', 'RESOLVED'],
      ['FOUND_STRAY', 'REUNITED'],
      ['ADOPTION', 'ADOPTED'],
      ['PRODUCT', 'SOLD'],
      ['MATING', 'RESOLVED'],
    ] as Array<[LostReportType | PostType, Post['status']]>)(
      'closes an ACTIVE %s Post as %s',
      async (kind, outcome) => {
        const post =
          kind === 'LOST_PET' || kind === 'FOUND_STRAY' ? await seedLostPost(kind) : await seedPost({ postType: kind });

        const result = await closePost(post, outcome);

        expect(result.errors).toBeUndefined();
        expect(result.data?.updatePostStatus).toMatchObject({ id: post.id, status: outcome });
        expect((await storedPost(post.id))?.status).toBe(outcome);
      },
    );

    it('rejects closure targets outside the LOST direction', async () => {
      const lostPet = await seedLostPost('LOST_PET');
      const foundStray = await seedLostPost('FOUND_STRAY');

      const lostPetResult = await closePost(lostPet, 'RESOLVED');
      expect(errorCode(lostPetResult)).toBe('VALIDATION_ERROR');
      expect(lostPetResult.errors?.[0].message).toContain('LOST posts can only transition to: REUNITED');

      const foundStrayResult = await closePost(foundStray, 'ADOPTED');
      expect(errorCode(foundStrayResult)).toBe('VALIDATION_ERROR');
      expect(foundStrayResult.errors?.[0].message).toContain('LOST posts can only transition to: RESOLVED, REUNITED');

      expect((await storedPost(lostPet.id))?.status).toBe('ACTIVE');
      expect((await storedPost(foundStray.id))?.status).toBe('ACTIVE');
    });

    it('keeps other type-specific outcomes unchanged', async () => {
      const rescue = await seedPost({ postType: 'RESCUE' });
      const mating = await seedPost({ postType: 'MATING' });

      expect(errorCode(await closePost(rescue, 'SOLD'))).toBe('VALIDATION_ERROR');
      expect(errorCode(await closePost(mating, 'REUNITED'))).toBe('VALIDATION_ERROR');
      expect((await storedPost(rescue.id))?.status).toBe('ACTIVE');
      expect((await storedPost(mating.id))?.status).toBe('ACTIVE');
    });

    it('rejects closure by anyone but the owner in either Block direction', async () => {
      const foundStray = await seedLostPost('FOUND_STRAY');

      for (const direction of ['owner-blocks', 'other-blocks'] as const) {
        if (direction === 'owner-blocks') {
          await setBlock(owner, other);
        } else {
          await setBlock(other, owner);
        }

        const result = await closePost(foundStray, 'RESOLVED', other);
        expect(errorCode(result)).toBe('FORBIDDEN');
        expect((await storedPost(foundStray.id))?.status).toBe('ACTIVE');
      }

      await clearBlocks();
      const ownerResult = await closePost(foundStray, 'RESOLVED');
      expect(ownerResult.errors).toBeUndefined();
    });

    it('treats missing and Removed Posts as not found and rejects repeat closure', async () => {
      const removed = await seedPost({ postType: 'MATING', status: 'REMOVED' });
      expect(errorCode(await closePost(removed, 'RESOLVED'))).toBe('NOT_FOUND');

      const missing = { id: NONEXISTENT_POST_ID } as Post;
      expect(errorCode(await closePost(missing, 'RESOLVED'))).toBe('NOT_FOUND');

      const mating = await seedPost({ postType: 'MATING' });
      expect((await closePost(mating, 'RESOLVED')).errors).toBeUndefined();
      const repeated = await closePost(mating, 'RESOLVED');
      expect(errorCode(repeated)).toBe('VALIDATION_ERROR');
      expect(repeated.errors?.[0].message).toContain('already in "RESOLVED" status');
    });

    it('retains Post media rows when the owner closes the Post', async () => {
      const post = await seedPost({ postType: 'MATING' });
      await dbHelper.db.insert(postMedia).values({
        postId: post.id,
        publicUrl: 'https://cdn.pupzy.net/posts/closure.webp',
        cloudflareStorageKey: `posts/${post.id}/closure.webp`,
        displayOrder: 0,
      });

      expect((await closePost(post, 'RESOLVED')).errors).toBeUndefined();

      const retained = await dbHelper.db.select().from(postMedia).where(eq(postMedia.postId, post.id));
      expect(retained).toHaveLength(1);
    });
  });

  // ─── Mating owner history ───────────────────────────────────────────────

  describe('mating owner history', () => {
    it('lists only the owner’s MATING Posts, newest first, including closed outcomes', async () => {
      const first = await seedPost({ postType: 'MATING' });
      const second = await seedPost({ postType: 'MATING' });
      const foreign = await seedPost({ postType: 'MATING', creatorId: other.id });
      expect((await closePost(first, 'RESOLVED')).errors).toBeUndefined();

      const mine = await runGql<MyPostsData>(MY_POSTS, { postType: 'MATING', first: 20 }, owner);
      expect(mine.errors).toBeUndefined();
      expect(mine.data?.myPosts.edges.map((edge) => edge.node.id)).toEqual([second.id, first.id]);
      expect(mine.data?.myPosts.edges.map((edge) => edge.node.status)).toEqual(['ACTIVE', 'RESOLVED']);

      const foreignMine = await runGql<MyPostsData>(MY_POSTS, { postType: 'MATING', first: 20 }, other);
      expect(foreignMine.data?.myPosts.edges.map((edge) => edge.node.id)).toEqual([foreign.id]);
    });

    it('keeps Removed MATING Posts out of owner history', async () => {
      const post = await seedPost({ postType: 'MATING' });
      expect((await removePost(post)).errors).toBeUndefined();

      const mine = await runGql<MyPostsData>(MY_POSTS, { postType: 'MATING', first: 20 }, owner);
      expect(mine.data?.myPosts.edges.map((edge) => edge.node.id)).not.toContain(post.id);
    });
  });

  // ─── Pending interaction termination ────────────────────────────────────

  describe('pending interaction termination on closure', () => {
    it('closes an ADOPTION listing by terminating pending requests and applications atomically', async () => {
      const post = await seedPost({ postType: 'ADOPTION' });
      const requestId = await requestContact(post);
      const applicationId = await submitApplication(post);

      fireNotification.mockClear();
      const closed = await closePost(post, 'ADOPTED');
      expect(closed.errors).toBeUndefined();

      const request = await contactRow(requestId);
      expect(request?.status).toBe('REJECTED');
      expect(request?.respondedAt).not.toBeNull();
      const application = await applicationRow(applicationId);
      expect(application?.status).toBe('REJECTED');
      expect(application?.respondedAt).not.toBeNull();

      // Records are preserved, not deleted.
      expect(await allContactRows(post.id)).toHaveLength(1);
      expect(await allApplicationRows(post.id)).toHaveLength(1);

      // Terminated interactions can never be approved afterwards.
      expect(firstError(await approveContact(requestId))).toMatch(/no longer active|already REJECTED/);
      expect(firstError(await approveApplication(applicationId))).toMatch(/no longer active|already REJECTED/);

      // The requester still sees the preserved record in their own history.
      const mine = await runGql<{ myContactRequests: ContactConnection }>(
        MY_CONTACT_REQUESTS,
        { first: 10 },
        requester,
      );
      expect(mine.data?.myContactRequests.edges.map((edge) => edge.node.id)).toContain(requestId);

      // Closing itself emits no direct-interaction notifications.
      expect(fireNotification).not.toHaveBeenCalled();
    });

    it('retains approved contact and application access after closure', async () => {
      const post = await seedPost({ postType: 'ADOPTION' });
      const requestId = await requestContact(post);
      expect((await approveContact(requestId)).errors).toBeUndefined();
      const applicationId = await submitApplication(post);
      expect((await approveApplication(applicationId)).errors).toBeUndefined();

      expect((await closePost(post, 'ADOPTED')).errors).toBeUndefined();

      expect((await contactRow(requestId))?.status).toBe('APPROVED');
      expect((await applicationRow(applicationId))?.status).toBe('APPROVED');

      const contactLink = await runGql<{ getWhatsAppLink: string }>(GET_WHATSAPP, { requestId }, requester);
      expect(contactLink.errors).toBeUndefined();
      expect(contactLink.data?.getWhatsAppLink).toBe(OWNER_WA_LINK);

      const adoptionLink = await runGql<{ getAdoptionWhatsAppLink: string }>(
        GET_ADOPTION_WHATSAPP,
        { applicationId },
        other,
      );
      expect(adoptionLink.errors).toBeUndefined();
      expect(adoptionLink.data?.getAdoptionWhatsAppLink).toBe(OWNER_WA_LINK);
    });

    it.each([
      ['RESCUE', 'RESOLVED'],
      ['LOST_PET', 'REUNITED'],
      ['MATING', 'RESOLVED'],
    ] as Array<[PostType | LostReportType, Post['status']]>)(
      'terminates pending Contact Requests when a %s listing closes',
      async (kind, outcome) => {
        const post =
          kind === 'LOST_PET' || kind === 'FOUND_STRAY' ? await seedLostPost(kind) : await seedPost({ postType: kind });
        const pending = await requestContact(post);
        const otherPending = await requestContact(post, other);

        const closed = await closePost(post, outcome);
        expect(closed.errors).toBeUndefined();

        for (const requestId of [pending, otherPending]) {
          const row = await contactRow(requestId);
          expect(row?.status).toBe('REJECTED');
          expect(row?.respondedAt).not.toBeNull();
        }
        expect(await allContactRows(post.id)).toHaveLength(2);
      },
    );

    it('retains an approved Contact Request on a closed MATING listing', async () => {
      const post = await seedPost({ postType: 'MATING' });
      const requestId = await requestContact(post);
      expect((await approveContact(requestId)).errors).toBeUndefined();

      expect((await closePost(post, 'RESOLVED')).errors).toBeUndefined();

      expect((await contactRow(requestId))?.status).toBe('APPROVED');
      const link = await runGql<{ getWhatsAppLink: string }>(GET_WHATSAPP, { requestId }, requester);
      expect(link.errors).toBeUndefined();
      expect(link.data?.getWhatsAppLink).toBe(OWNER_WA_LINK);
    });

    it('rejects new interactions on a closed listing and leaves other posts untouched', async () => {
      const closedContact = await seedPost({ postType: 'MATING' });
      const closedApplication = await seedPost({ postType: 'ADOPTION' });
      const untouched = await seedPost({ postType: 'MATING', creatorId: other.id });
      const untouchedRequest = await requestContact(untouched);

      expect((await closePost(closedContact, 'RESOLVED')).errors).toBeUndefined();
      expect((await closePost(closedApplication, 'ADOPTED')).errors).toBeUndefined();

      const newRequest = await runGql<{ requestContact: ContactNode }>(
        REQUEST_CONTACT,
        { postId: closedContact.id, message: 'Too late to help.' },
        requester,
      );
      expect(firstError(newRequest)).toMatch(/inactive post/i);

      const newApplication = await runGql<{ submitAdoptionApplication: ContactNode }>(
        SUBMIT_APPLICATION,
        { input: { ...APPLICATION_INPUT, targetPostId: closedApplication.id } },
        other,
      );
      expect(firstError(newApplication)).toMatch(/inactive adoption listing/i);

      expect((await contactRow(untouchedRequest))?.status).toBe('PENDING');
    });

    it('keeps manual removal usable without terminating pending interactions', async () => {
      const post = await seedPost({ postType: 'MATING' });
      const pending = await requestContact(post);
      const approved = await requestContact(post, other);
      expect((await approveContact(approved, owner)).errors).toBeUndefined();

      const removed = await removePost(post);
      expect(removed.errors).toBeUndefined();
      expect(removed.data?.deletePost).toBe(true);
      expect((await storedPost(post.id))?.status).toBe('REMOVED');
      expect((await contactRow(pending))?.status).toBe('PENDING');

      const approvedLink = await runGql<{ getWhatsAppLink: string }>(GET_WHATSAPP, { requestId: approved }, other);
      expect(errorCode(approvedLink)).toBe('NOT_FOUND');
    });
  });

  // ─── Block directions and approved-access continuity ────────────────────

  describe('Block directions and approved-access continuity', () => {
    it('lets the owner close a listing while a Block exists with another account', async () => {
      const post = await seedLostPost('FOUND_STRAY');
      await setBlock(owner, other);

      const closed = await closePost(post, 'RESOLVED');
      expect(closed.errors).toBeUndefined();
      expect((await storedPost(post.id))?.status).toBe('RESOLVED');
    });

    it('keeps an approved connection on a closed Post subject to the existing Block restrictions', async () => {
      const post = await seedPost({ postType: 'MATING' });
      const requestId = await requestContact(post);
      expect((await approveContact(requestId)).errors).toBeUndefined();
      expect((await closePost(post, 'RESOLVED')).errors).toBeUndefined();

      const unknownMessage = firstError(
        await runGql<{ getWhatsAppLink: string }>(GET_WHATSAPP, { requestId: NONEXISTENT_REQUEST_ID }, requester),
      );

      for (const direction of ['requester-blocks', 'owner-blocks'] as const) {
        if (direction === 'requester-blocks') {
          await setBlock(requester, owner);
        } else {
          await setBlock(owner, requester);
        }

        const link = await runGql<{ getWhatsAppLink: string }>(GET_WHATSAPP, { requestId }, requester);
        const message = firstError(link);
        expect(message.split(requestId).join('<id>')).toBe(unknownMessage.split(NONEXISTENT_REQUEST_ID).join('<id>'));
        expect(message).not.toMatch(/block/i);
        expect(message).not.toContain(OWNER_WA_LINK);

        await clearBlocks();
      }

      const restored = await runGql<{ getWhatsAppLink: string }>(GET_WHATSAPP, { requestId }, requester);
      expect(restored.errors).toBeUndefined();
      expect(restored.data?.getWhatsAppLink).toBe(OWNER_WA_LINK);
    });
  });

  // ─── Concurrency ────────────────────────────────────────────────────────

  describe('concurrent requests and closures', () => {
    it('a closure committing while a Contact Request is in flight leaves no pending interaction', async () => {
      const post = await seedLostPost('FOUND_STRAY');

      const pairLocked = deferred();
      const releasePair = deferred();
      const holder = dbHelper.db.transaction(async (tx) => {
        await isolationPolicy.lockPair(tx, requester.id, owner.id);
        pairLocked.resolve();
        await releasePair.promise;
      });

      await pairLocked.promise;
      let race!: Promise<ExecutionResult<{ requestContact: ContactNode }>>;
      try {
        race = runGql<{ requestContact: ContactNode }>(
          REQUEST_CONTACT,
          { postId: post.id, message: 'Racing the closure.' },
          requester,
        );
        await waitForWaitingAdvisoryLock(1);

        const closed = await closePost(post, 'RESOLVED');
        expect(closed.errors).toBeUndefined();
      } finally {
        releasePair.resolve();
        await holder;
      }

      const raceResult = await race;
      expect(firstError(raceResult)).toMatch(/inactive post/i);
      expect(await allContactRows(post.id)).toHaveLength(0);
    });

    it('a closure committing while an Adoption Application is in flight leaves no pending application', async () => {
      const post = await seedPost({ postType: 'ADOPTION' });

      const pairLocked = deferred();
      const releasePair = deferred();
      const holder = dbHelper.db.transaction(async (tx) => {
        await isolationPolicy.lockPair(tx, other.id, owner.id);
        pairLocked.resolve();
        await releasePair.promise;
      });

      await pairLocked.promise;
      let race!: Promise<ExecutionResult<{ submitAdoptionApplication: ContactNode }>>;
      try {
        race = runGql<{ submitAdoptionApplication: ContactNode }>(
          SUBMIT_APPLICATION,
          { input: { ...APPLICATION_INPUT, targetPostId: post.id } },
          other,
        );
        await waitForWaitingAdvisoryLock(1);

        const closed = await closePost(post, 'ADOPTED');
        expect(closed.errors).toBeUndefined();
      } finally {
        releasePair.resolve();
        await holder;
      }

      expect(firstError(await race)).toMatch(/inactive adoption listing/i);
      expect(await allApplicationRows(post.id)).toHaveLength(0);
    });

    it('a closure that commits first rejects a concurrent in-flight approval', async () => {
      const post = await seedPost({ postType: 'MATING' });
      const requestId = await requestContact(post);

      const pairLocked = deferred();
      const releasePair = deferred();
      const holder = dbHelper.db.transaction(async (tx) => {
        await isolationPolicy.lockPair(tx, requester.id, owner.id);
        pairLocked.resolve();
        await releasePair.promise;
      });

      await pairLocked.promise;
      let race!: Promise<ExecutionResult<{ approveContactRequest: ContactNode }>>;
      try {
        race = approveContact(requestId);
        await waitForWaitingAdvisoryLock(1);

        const closed = await closePost(post, 'RESOLVED');
        expect(closed.errors).toBeUndefined();
      } finally {
        releasePair.resolve();
        await holder;
      }

      expect(firstError(await race)).toMatch(/already REJECTED/);
      const row = await contactRow(requestId);
      expect(row?.status).toBe('REJECTED');
      expect(row?.respondedAt).not.toBeNull();
    });

    it('a concurrent approval and closure settle in exactly one serial order', async () => {
      const post = await seedPost({ postType: 'MATING' });
      const requestId = await requestContact(post);

      const [closure, approval] = await Promise.all([closePost(post, 'RESOLVED'), approveContact(requestId)]);

      expect(closure.errors).toBeUndefined();
      const persisted = await contactRow(requestId);
      if (approval.errors === undefined) {
        // The approval serialized first; the closure cleanup left it approved.
        expect(approval.data?.approveContactRequest.status).toBe('APPROVED');
        expect(persisted?.status).toBe('APPROVED');
      } else {
        // The closure serialized first; the approval lost the race and no
        // pending interaction survived.
        expect(firstError(approval)).toMatch(/already REJECTED/);
        expect(persisted?.status).toBe('REJECTED');
      }
      expect(persisted?.status).not.toBe('PENDING');
    });

    it('concurrent competing closures settle with exactly one committed outcome', async () => {
      const post = await seedLostPost('FOUND_STRAY');

      const [first, second] = await Promise.all([closePost(post, 'RESOLVED'), closePost(post, 'REUNITED')]);
      const outcomes = [errorCode(first), errorCode(second)];
      expect(outcomes.filter((code) => code === undefined)).toHaveLength(1);
      expect(['VALIDATION_ERROR', 'NOT_FOUND']).toContain(outcomes.find((code) => code !== undefined));

      const persisted = await storedPost(post.id);
      expect(['RESOLVED', 'REUNITED']).toContain(persisted?.status);
    });
  });
});

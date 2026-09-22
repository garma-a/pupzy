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
  accountDeletions,
  adoptionApplications,
  blocks,
  cities,
  posts,
  users,
  type AdoptionApplication,
  type City,
  type Post,
  type User,
} from '../database/schema';
import { AdoptionsRepository } from './adoptions.repository';
import { AdoptionsService } from './adoptions.service';
import { AdoptionsResolver } from './adoptions.resolver';
import { PostsRepository } from '../posts/posts.repository';
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

const PHONE_KEY = 'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=';
const OWNER_PHONE = '+201012345678';
const OWNER_WA_LINK = 'https://wa.me/201012345678';
const REPLACEMENT_PHONE = '+201098765432';
const REPLACEMENT_WA_LINK = 'https://wa.me/201098765432';
const NONEXISTENT_ID = '0192ffff-0000-7000-8000-000000000000';

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('Approved adoption contact access (Ticket 02)', () => {
  jest.setTimeout(240_000);

  let dbHelper: TestDatabaseHelper;
  let executableSchema: GraphQLSchema;
  let adoptionsService: AdoptionsService;
  let adoptionsResolver: AdoptionsResolver;
  let isolationPolicy: AccountIsolationPolicy;
  let fireNotification: jest.Mock;

  let testCity: City;
  let owner: User;
  let applicant: User;
  let unrelated: User;

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

    const adoptionsRepository = new AdoptionsRepository(dbHelper.db);
    const postsRepository = new PostsRepository(dbHelper.db);
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

    adoptionsService = new AdoptionsService(
      adoptionsRepository,
      postsRepository,
      usersService,
      notificationsService,
      dbHelper.db,
      isolationPolicy,
    );
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
          getAdoptionWhatsAppLink: (_root: unknown, args: { applicationId: string }, ctx: GqlContext) =>
            adoptionsResolver.getAdoptionWhatsAppLink(args.applicationId, ctx),
        },
        Mutation: {
          submitAdoptionApplication: (_root: unknown, args: { input: unknown }, ctx: GqlContext) =>
            adoptionsResolver.submitAdoptionApplication(args.input, ctx),
          approveAdoptionApplication: (_root: unknown, args: { applicationId: string }, ctx: GqlContext) =>
            adoptionsResolver.approveAdoptionApplication(args.applicationId, ctx),
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
    applicant = await insertUser('applicant', '+201099999999');
    unrelated = await insertUser('unrelated');
  });

  async function insertUser(label: string, phone?: string): Promise<User> {
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${label}-${generateUuidV7()}`,
        email: `${label}-${generateUuidV7()}@pupzy.dev`,
        fullName: `Adoption ${label}`,
        phoneNumber: phone ? encryptString(phone, PHONE_KEY) : null,
      })
      .returning();
    return user;
  }

  async function insertAdoptionPost(creatorId: string): Promise<Post> {
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId,
        postType: 'ADOPTION',
        title: `Adoption post ${generateUuidV7().slice(-4)}`,
        description: 'Approved adoption contact fixture',
        cityId: testCity.id,
        governorate: testCity.governorate,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
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

  function firstError<TData>(result: ExecutionResult<TData>): string {
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    return result.errors![0].message;
  }

  /** Replaces a fixture id so errors can be compared regardless of id. */
  function neutralized(message: string, id: string): string {
    return message.split(id).join('<id>');
  }

  async function submitApplication(targetPostId: string): Promise<string> {
    const res = await runGql<{ submitAdoptionApplication: { id: string; status: string } }>(
      SUBMIT_APPLICATION,
      { input: { ...APPLICATION_INPUT, targetPostId } },
      applicant,
    );
    expect(res.errors).toBeUndefined();
    return res.data!.submitAdoptionApplication.id;
  }

  async function approveApplication(
    applicationId: string,
    approver: User = owner,
  ): Promise<ExecutionResult<{ approveAdoptionApplication: { id: string; status: string } }>> {
    return runGql<{ approveAdoptionApplication: { id: string; status: string } }>(
      APPROVE_APPLICATION,
      { applicationId },
      approver,
    );
  }

  async function getAdoptionWhatsAppLink(
    caller: User,
    applicationId: string,
  ): Promise<ExecutionResult<{ getAdoptionWhatsAppLink: string }>> {
    return runGql<{ getAdoptionWhatsAppLink: string }>(GET_ADOPTION_WHATSAPP, { applicationId }, caller);
  }

  async function approvedApplicationOnNewPost(): Promise<{ post: Post; applicationId: string }> {
    const post = await insertAdoptionPost(owner.id);
    const applicationId = await submitApplication(post.id);
    const approved = await approveApplication(applicationId);
    expect(approved.errors).toBeUndefined();
    expect(approved.data!.approveAdoptionApplication.status).toBe('APPROVED');
    return { post, applicationId };
  }

  async function applicationRow(id: string): Promise<AdoptionApplication | undefined> {
    const [row] = await dbHelper.db.select().from(adoptionApplications).where(eq(adoptionApplications.id, id));
    return row;
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

  it("returns the owner's current WhatsApp link to the approved applicant and preserves approval behavior", async () => {
    const { applicationId } = await approvedApplicationOnNewPost();
    expect(fireNotification).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: applicant.id, type: 'ADOPTION_APPLICATION_APPROVED' }),
      owner.id,
    );

    const link = await getAdoptionWhatsAppLink(applicant, applicationId);
    expect(link.errors).toBeUndefined();
    expect(link.data!.getAdoptionWhatsAppLink).toBe(OWNER_WA_LINK);

    // The link reflects the owner's current phone, not a value captured at approval time.
    await dbHelper.db
      .update(users)
      .set({ phoneNumber: encryptString(REPLACEMENT_PHONE, PHONE_KEY) })
      .where(eq(users.id, owner.id));

    const refreshed = await getAdoptionWhatsAppLink(applicant, applicationId);
    expect(refreshed.errors).toBeUndefined();
    expect(refreshed.data!.getAdoptionWhatsAppLink).toBe(REPLACEMENT_WA_LINK);
  });

  it('refuses pending, rejected, owner, and unrelated callers without disclosing the link', async () => {
    const pendingPost = await insertAdoptionPost(owner.id);
    const pendingApplicationId = await submitApplication(pendingPost.id);

    const pendingCall = await getAdoptionWhatsAppLink(applicant, pendingApplicationId);
    expect(firstError(pendingCall)).toMatch(/has not been approved yet/i);

    const rejectedPost = await insertAdoptionPost(owner.id);
    const rejectedApplicationId = await submitApplication(rejectedPost.id);
    await dbHelper.db
      .update(adoptionApplications)
      .set({ status: 'REJECTED', respondedAt: sql`now()` })
      .where(eq(adoptionApplications.id, rejectedApplicationId));

    const rejectedCall = await getAdoptionWhatsAppLink(applicant, rejectedApplicationId);
    expect(firstError(rejectedCall)).toMatch(/has not been approved yet/i);

    const { applicationId } = await approvedApplicationOnNewPost();

    const ownerCall = await getAdoptionWhatsAppLink(owner, applicationId);
    expect(firstError(ownerCall)).toMatch(/only view your own approved applications/i);

    const unrelatedCall = await getAdoptionWhatsAppLink(unrelated, applicationId);
    expect(firstError(unrelatedCall)).toMatch(/only view your own approved applications/i);

    for (const message of [
      firstError(pendingCall),
      firstError(rejectedCall),
      firstError(ownerCall),
      firstError(unrelatedCall),
    ]) {
      expect(message).not.toMatch(/block/i);
      expect(message).not.toContain(OWNER_WA_LINK);
      expect(message).not.toContain(OWNER_PHONE);
    }
  });

  it('treats an isolated pair as unavailable in both Block directions without leaking the link', async () => {
    const { applicationId } = await approvedApplicationOnNewPost();
    const unknownApplicationMessage = firstError(await getAdoptionWhatsAppLink(applicant, NONEXISTENT_ID));

    for (const direction of ['applicant-blocks', 'owner-blocks'] as const) {
      if (direction === 'applicant-blocks') {
        await setBlock(applicant, owner);
      } else {
        await setBlock(owner, applicant);
      }

      const res = await getAdoptionWhatsAppLink(applicant, applicationId);
      const message = firstError(res);
      expect(neutralized(message, applicationId)).toBe(neutralized(unknownApplicationMessage, NONEXISTENT_ID));
      expect(message).not.toMatch(/block/i);
      expect(message).not.toContain(OWNER_WA_LINK);
      expect(message).not.toContain(OWNER_PHONE);

      await clearBlocks();
    }

    // Preserved approval remains retrievable after Unblock.
    const restored = await getAdoptionWhatsAppLink(applicant, applicationId);
    expect(restored.errors).toBeUndefined();
    expect(restored.data!.getAdoptionWhatsAppLink).toBe(OWNER_WA_LINK);
  });

  it('follows established active-account and missing-phone behavior', async () => {
    const missingPhoneOwner = await insertUser('owner-no-phone');
    const missingPhonePost = await insertAdoptionPost(missingPhoneOwner.id);
    const missingPhoneApplicationId = await submitApplication(missingPhonePost.id);
    expect((await approveApplication(missingPhoneApplicationId, missingPhoneOwner)).errors).toBeUndefined();

    const missingPhoneCall = await getAdoptionWhatsAppLink(applicant, missingPhoneApplicationId);
    expect(firstError(missingPhoneCall)).toMatch(/Owner contact information is not available/i);

    const { applicationId } = await approvedApplicationOnNewPost();

    await dbHelper.db.update(users).set({ isBanned: true }).where(eq(users.id, owner.id));
    const bannedOwnerCall = await getAdoptionWhatsAppLink(applicant, applicationId);
    expect(firstError(bannedOwnerCall)).toMatch(/Owner contact information is not available/i);

    await dbHelper.db.update(users).set({ isBanned: false }).where(eq(users.id, owner.id));
    await dbHelper.db.insert(accountDeletions).values({
      userId: owner.id,
      firebaseUserId: owner.firebaseUserId,
      email: owner.email,
      status: 'PENDING',
      progressTokenHash: 'hash',
    });
    const deletingOwnerCall = await getAdoptionWhatsAppLink(applicant, applicationId);
    expect(firstError(deletingOwnerCall)).toMatch(/Owner contact information is not available/i);

    for (const message of [firstError(missingPhoneCall), firstError(bannedOwnerCall), firstError(deletingOwnerCall)]) {
      expect(message).not.toMatch(/block/i);
      expect(message).not.toContain(OWNER_WA_LINK);
    }
  });

  it('fails with established not-found behavior when the post is removed, and keeps approved access after closure', async () => {
    const { post, applicationId } = await approvedApplicationOnNewPost();

    await dbHelper.db.update(posts).set({ status: 'ADOPTED' }).where(eq(posts.id, post.id));
    const closed = await getAdoptionWhatsAppLink(applicant, applicationId);
    expect(closed.errors).toBeUndefined();
    expect(closed.data!.getAdoptionWhatsAppLink).toBe(OWNER_WA_LINK);

    await dbHelper.db.update(posts).set({ status: 'REMOVED' }).where(eq(posts.id, post.id));
    const removed = await getAdoptionWhatsAppLink(applicant, applicationId);
    expect(firstError(removed)).toMatch(new RegExp(`Post with id "${post.id}" was not found`));
    expect(firstError(removed)).not.toContain(OWNER_WA_LINK);
  });

  it('a Block committing first rejects a concurrent disclosure neutrally and never leaks', async () => {
    const { applicationId } = await approvedApplicationOnNewPost();

    const blockLocked = deferred();
    const completeBlock = deferred();
    const blocking = dbHelper.db.transaction(async (tx) => {
      // Hold the canonical pair lock before writing the Block so the racing
      // disclosure completes its preflight against the unblocked state and must
      // rely on the in-transaction recheck to fail neutrally.
      await isolationPolicy.lockPair(tx, applicant.id, owner.id);
      blockLocked.resolve();
      await completeBlock.promise;
      await tx.insert(blocks).values({ blockerId: applicant.id, blockedId: owner.id });
      await adoptionsService.rejectPendingAdoptionApplicationsBetweenAccounts(tx, applicant.id, owner.id);
    });

    let disclosureRace!: Promise<ExecutionResult<{ getAdoptionWhatsAppLink: string }>>;
    await blockLocked.promise;
    try {
      disclosureRace = getAdoptionWhatsAppLink(applicant, applicationId);
      await waitForWaitingAdvisoryLock(1);
    } finally {
      completeBlock.resolve();
      await blocking;
    }

    const message = firstError(await disclosureRace);
    expect(neutralized(message, applicationId)).toBe(
      neutralized(firstError(await getAdoptionWhatsAppLink(applicant, NONEXISTENT_ID)), NONEXISTENT_ID),
    );
    expect(message).not.toMatch(/block/i);
    expect(message).not.toContain(OWNER_WA_LINK);
    expect((await applicationRow(applicationId))?.status).toBe('APPROVED');

    await clearBlocks();
    const restored = await getAdoptionWhatsAppLink(applicant, applicationId);
    expect(restored.errors).toBeUndefined();
    expect(restored.data!.getAdoptionWhatsAppLink).toBe(OWNER_WA_LINK);
  });

  it('a concurrent approval and disclosure settle in exactly one serial order', async () => {
    const post = await insertAdoptionPost(owner.id);
    const applicationId = await submitApplication(post.id);

    const [approval, disclosure] = await Promise.all([
      approveApplication(applicationId),
      getAdoptionWhatsAppLink(applicant, applicationId),
    ]);

    if (disclosure.errors === undefined) {
      // The disclosure serialized after the approval committed.
      expect(disclosure.data!.getAdoptionWhatsAppLink).toBe(OWNER_WA_LINK);
    } else {
      // The disclosure read the still-pending application; no contact leaked.
      expect(firstError(disclosure)).toMatch(/has not been approved yet/i);
      expect(firstError(disclosure)).not.toContain(OWNER_WA_LINK);
    }
    expect(approval.errors).toBeUndefined();
    expect((await applicationRow(applicationId))?.status).toBe('APPROVED');

    const after = await getAdoptionWhatsAppLink(applicant, applicationId);
    expect(after.errors).toBeUndefined();
    expect(after.data!.getAdoptionWhatsAppLink).toBe(OWNER_WA_LINK);
  });
});

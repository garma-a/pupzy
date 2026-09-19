import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import DataLoader from 'dataloader';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  adoptionApplications,
  blocks,
  cities,
  contactRequests,
  posts,
  users,
  type AdoptionApplication,
  type City,
  type ContactRequest,
  type Post,
  type User,
} from '../database/schema';
import { ContactsRepository } from './contacts.repository';
import { ContactsService } from './contacts.service';
import { ContactsResolver } from './contacts.resolver';
import { AdoptionsRepository } from '../adoptions/adoptions.repository';
import { AdoptionsService } from '../adoptions/adoptions.service';
import { AdoptionsResolver } from '../adoptions/adoptions.resolver';
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

type PostType = 'RESCUE' | 'LOST' | 'ADOPTION' | 'PRODUCT' | 'MATING';

interface ContactNode {
  id: string;
  status: string;
  postId: string;
  requester?: { id: string } | null;
}

interface ContactConnection {
  edges: Array<{ node: ContactNode; cursor: string }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface ApplicationNode {
  id: string;
  status: string;
  targetPostId: string;
  applicant?: { id: string } | null;
}

interface ApplicationConnection {
  edges: Array<{ node: ApplicationNode; cursor: string }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

const PHONE_KEY = 'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=';
const OWNER_PHONE = '+201012345678';
const OWNER_WA_LINK = 'https://wa.me/201012345678';
const NONEXISTENT_ID = '0192ffff-0000-7000-8000-000000000000';

const REQUEST_CONTACT = `mutation RequestContact($postId: ID!, $message: String!) {
  requestContact(postId: $postId, message: $message) { id status }
}`;

const APPROVE_CONTACT = `mutation ApproveContact($requestId: ID!) {
  approveContactRequest(requestId: $requestId) { id status whatsappLink }
}`;

const REJECT_CONTACT = `mutation RejectContact($requestId: ID!) {
  rejectContactRequest(requestId: $requestId) { id status }
}`;

const GET_WHATSAPP = `query GetWhatsApp($requestId: ID!) { getWhatsAppLink(requestId: $requestId) }`;

const SELLER_CONTACT = `query SellerContact($postId: ID!) { getProductSellerContact(postId: $postId) }`;

const MY_CONTACT_REQUESTS = `query MyContacts($postId: ID, $status: RequestStatus, $first: Int, $after: String) {
  myContactRequests(postId: $postId, status: $status, first: $first, after: $after) {
    edges { node { id status postId requester { id } } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const POST_CONTACT_REQUESTS = `query PostContacts($postId: ID!, $status: RequestStatus, $first: Int, $after: String) {
  postContactRequests(postId: $postId, status: $status, first: $first, after: $after) {
    edges { node { id status postId requester { id } } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const SUBMIT_APPLICATION = `mutation SubmitApplication($input: SubmitAdoptionApplicationInput!) {
  submitAdoptionApplication(input: $input) { id status }
}`;

const APPROVE_APPLICATION = `mutation ApproveApplication($applicationId: ID!) {
  approveAdoptionApplication(applicationId: $applicationId) { id status }
}`;

const MY_APPLICATIONS = `query MyApplications($first: Int, $after: String) {
  myAdoptionApplications(first: $first, after: $after) {
    edges { node { id status targetPostId applicant { id } } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const POST_APPLICATIONS = `query PostApplications($postId: ID!, $status: RequestStatus, $first: Int, $after: String) {
  postAdoptionApplications(postId: $postId, status: $status, first: $first, after: $after) {
    edges { node { id status targetPostId applicant { id } } cursor }
    pageInfo { hasNextPage endCursor }
  }
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

describe('Direct-contact account isolation (Ticket 09)', () => {
  jest.setTimeout(180_000);

  let dbHelper: TestDatabaseHelper;
  let executableSchema: GraphQLSchema;
  let contactsService: ContactsService;
  let adoptionsService: AdoptionsService;
  let contactsResolver: ContactsResolver;
  let adoptionsResolver: AdoptionsResolver;
  let isolationPolicy: AccountIsolationPolicy;
  let notificationsService: NotificationsService;
  let fireNotification: jest.Mock;

  let testCity: City;
  let viewer: User;
  let author: User;
  let other: User;

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

    const contactsRepository = new ContactsRepository(dbHelper.db);
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
    notificationsService = { fireNotification } as unknown as NotificationsService;

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
          myContactRequests: (
            _root: unknown,
            args: { postId?: string; status?: string; first?: number; after?: string },
            ctx: GqlContext,
          ) => contactsResolver.myContactRequests(args.postId, args.status, args.first, args.after, ctx),
          postContactRequests: (
            _root: unknown,
            args: { postId: string; status?: string; first?: number; after?: string },
            ctx: GqlContext,
          ) => contactsResolver.postContactRequests(args.postId, args.status, args.first, args.after, ctx),
          getWhatsAppLink: (_root: unknown, args: { requestId: string }, ctx: GqlContext) =>
            contactsResolver.getWhatsAppLink(args.requestId, ctx),
          getProductSellerContact: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            contactsResolver.getProductSellerContact(args.postId, ctx),
          myAdoptionApplications: (_root: unknown, args: { first?: number; after?: string }, ctx: GqlContext) =>
            adoptionsResolver.myAdoptionApplications(args.first, args.after, ctx),
          postAdoptionApplications: (
            _root: unknown,
            args: { postId: string; status?: string; first?: number; after?: string },
            ctx: GqlContext,
          ) => adoptionsResolver.postAdoptionApplications(args.postId, args.status, args.first, args.after, ctx),
        },
        Mutation: {
          requestContact: (_root: unknown, args: { postId: string; message: string }, ctx: GqlContext) =>
            contactsResolver.requestContact(args.postId, args.message, ctx),
          approveContactRequest: (_root: unknown, args: { requestId: string }, ctx: GqlContext) =>
            contactsResolver.approveContactRequest(args.requestId, ctx),
          rejectContactRequest: (_root: unknown, args: { requestId: string }, ctx: GqlContext) =>
            contactsResolver.rejectContactRequest(args.requestId, ctx),
          submitAdoptionApplication: (_root: unknown, args: { input: unknown }, ctx: GqlContext) =>
            adoptionsResolver.submitAdoptionApplication(args.input, ctx),
          approveAdoptionApplication: (_root: unknown, args: { applicationId: string }, ctx: GqlContext) =>
            adoptionsResolver.approveAdoptionApplication(args.applicationId, ctx),
          rejectAdoptionApplication: (_root: unknown, args: { applicationId: string }, ctx: GqlContext) =>
            adoptionsResolver.rejectAdoptionApplication(args.applicationId, ctx),
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

    viewer = await insertUser('viewer', OWNER_PHONE);
    author = await insertUser('author', OWNER_PHONE);
    other = await insertUser('other', OWNER_PHONE);
  });

  async function insertUser(label: string, phone?: string): Promise<User> {
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${label}-${generateUuidV7()}`,
        email: `${label}-${generateUuidV7()}@pupzy.dev`,
        fullName: `Direct ${label}`,
        phoneNumber: phone ? encryptString(phone, PHONE_KEY) : null,
      })
      .returning();
    return user;
  }

  async function insertPost(creatorId: string, postType: PostType): Promise<Post> {
    const isUrgencyType = postType === 'RESCUE' || postType === 'LOST';
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId,
        postType,
        title: `Direct ${postType} ${generateUuidV7().slice(-4)}`,
        description: 'Direct interaction isolation fixture',
        urgency: isUrgencyType ? 'URGENT' : undefined,
        marketCategory: postType === 'PRODUCT' ? 'FOOD' : undefined,
        cityId: testCity.id,
        governorate: testCity.governorate,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    return post;
  }

  function createContext(user?: User): GqlContext {
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

  async function requestContact(requester: User, postId: string, message = 'I would love to help.'): Promise<string> {
    const res = await runGql<{ requestContact: { id: string; status: string } }>(
      REQUEST_CONTACT,
      { postId, message },
      requester,
    );
    expect(res.errors).toBeUndefined();
    return res.data!.requestContact.id;
  }

  async function submitApplication(applicant: User, targetPostId: string): Promise<string> {
    const res = await runGql<{ submitAdoptionApplication: { id: string; status: string } }>(
      SUBMIT_APPLICATION,
      { input: { ...APPLICATION_INPUT, targetPostId } },
      applicant,
    );
    expect(res.errors).toBeUndefined();
    return res.data!.submitAdoptionApplication.id;
  }

  async function approveContact(
    owner: User,
    requestId: string,
  ): Promise<ExecutionResult<{ approveContactRequest: ContactNode }>> {
    return runGql<{ approveContactRequest: ContactNode }>(APPROVE_CONTACT, { requestId }, owner);
  }

  async function approveApplication(
    owner: User,
    applicationId: string,
  ): Promise<ExecutionResult<{ approveAdoptionApplication: ApplicationNode }>> {
    return runGql<{ approveAdoptionApplication: ApplicationNode }>(APPROVE_APPLICATION, { applicationId }, owner);
  }

  async function contactRow(id: string): Promise<ContactRequest | undefined> {
    const [row] = await dbHelper.db.select().from(contactRequests).where(eq(contactRequests.id, id));
    return row;
  }

  async function applicationRow(id: string): Promise<AdoptionApplication | undefined> {
    const [row] = await dbHelper.db.select().from(adoptionApplications).where(eq(adoptionApplications.id, id));
    return row;
  }

  async function sentContactIds(user: User, first = 10): Promise<string[]> {
    const res = await runGql<{ myContactRequests: ContactConnection }>(MY_CONTACT_REQUESTS, { first }, user);
    expect(res.errors).toBeUndefined();
    return res.data!.myContactRequests.edges.map((edge) => edge.node.id);
  }

  async function receivedContactIds(user: User, postId: string, first = 10): Promise<string[]> {
    const res = await runGql<{ postContactRequests: ContactConnection }>(
      POST_CONTACT_REQUESTS,
      { postId, first },
      user,
    );
    expect(res.errors).toBeUndefined();
    return res.data!.postContactRequests.edges.map((edge) => edge.node.id);
  }

  async function sentApplicationIds(user: User, first = 10): Promise<string[]> {
    const res = await runGql<{ myAdoptionApplications: ApplicationConnection }>(MY_APPLICATIONS, { first }, user);
    expect(res.errors).toBeUndefined();
    return res.data!.myAdoptionApplications.edges.map((edge) => edge.node.id);
  }

  async function receivedApplicationIds(user: User, postId: string, first = 10): Promise<string[]> {
    const res = await runGql<{ postAdoptionApplications: ApplicationConnection }>(
      POST_APPLICATIONS,
      { postId, first },
      user,
    );
    expect(res.errors).toBeUndefined();
    return res.data!.postAdoptionApplications.edges.map((edge) => edge.node.id);
  }

  async function setBlock(blocker: User, blocked: User): Promise<void> {
    await dbHelper.db.delete(blocks);
    await dbHelper.db.insert(blocks).values({ blockerId: blocker.id, blockedId: blocked.id });
  }

  async function clearBlocks(): Promise<void> {
    await dbHelper.db.delete(blocks);
  }

  /**
   * Mirrors the `blockUser` contract ticket 11 will implement: one transaction
   * that serializes the pair, inserts the Block, and rejects pending direct
   * interactions between the pair.
   */
  async function commitBlock(blocker: User, blocked: User): Promise<void> {
    await dbHelper.db.transaction(async (tx) => {
      await isolationPolicy.lockPair(tx, blocker.id, blocked.id);
      await tx.insert(blocks).values({ blockerId: blocker.id, blockedId: blocked.id }).onConflictDoNothing();
      await contactsService.rejectPendingContactRequestsBetweenAccounts(tx, blocker.id, blocked.id);
      await adoptionsService.rejectPendingAdoptionApplicationsBetweenAccounts(tx, blocker.id, blocked.id);
    });
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
    const waiters = await dbHelper.pool.query<{ pid: number; wait_event: string; query: string }>(
      `SELECT pid, wait_event, query FROM pg_stat_activity WHERE state <> 'idle' AND pid <> pg_backend_pid()`,
    );
    throw new Error(
      `Timed out waiting for ${expectedWaiters} transaction(s) to block on an advisory lock (observed ${observed}): ${JSON.stringify(
        waiters.rows,
      )}`,
    );
  }

  it('preserves non-isolated contact and adoption behavior end to end', async () => {
    const rescue = await insertPost(author.id, 'RESCUE');
    const adoption = await insertPost(author.id, 'ADOPTION');
    const product = await insertPost(author.id, 'PRODUCT');

    const requestId = await requestContact(viewer, rescue.id);
    expect((await contactRow(requestId))?.status).toBe('PENDING');
    expect(await sentContactIds(viewer)).toEqual([requestId]);
    expect(await receivedContactIds(author, rescue.id)).toEqual([requestId]);

    const approvedContact = await approveContact(author, requestId);
    expect(approvedContact.errors).toBeUndefined();
    expect(approvedContact.data!.approveContactRequest.status).toBe('APPROVED');
    expect(fireNotification).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: viewer.id, type: 'CONTACT_REQUEST_APPROVED' }),
      author.id,
    );

    const link = await runGql<{ getWhatsAppLink: string }>(GET_WHATSAPP, { requestId }, viewer);
    expect(link.errors).toBeUndefined();
    expect(link.data!.getWhatsAppLink).toBe(OWNER_WA_LINK);

    const seller = await runGql<{ getProductSellerContact: string }>(SELLER_CONTACT, { postId: product.id }, viewer);
    expect(seller.errors).toBeUndefined();
    expect(seller.data!.getProductSellerContact).toBe(OWNER_WA_LINK);

    const applicationId = await submitApplication(viewer, adoption.id);
    expect((await applicationRow(applicationId))?.status).toBe('PENDING');
    expect(await sentApplicationIds(viewer)).toEqual([applicationId]);
    expect(await receivedApplicationIds(author, adoption.id)).toEqual([applicationId]);

    const approvedApplication = await approveApplication(author, applicationId);
    expect(approvedApplication.errors).toBeUndefined();
    expect(approvedApplication.data!.approveAdoptionApplication.status).toBe('APPROVED');

    const rejectedId = await requestContact(other, rescue.id);
    const rejected = await runGql<{ rejectContactRequest: ContactNode }>(
      REJECT_CONTACT,
      { requestId: rejectedId },
      author,
    );
    expect(rejected.errors).toBeUndefined();
    expect(rejected.data!.rejectContactRequest.status).toBe('REJECTED');
  });

  it('new Contact Requests fail neutrally in both Block directions and create no row', async () => {
    const post = await insertPost(author.id, 'RESCUE');
    const missingMessage = firstError(
      await runGql<{ requestContact: ContactNode }>(
        REQUEST_CONTACT,
        { postId: NONEXISTENT_ID, message: 'I would love to help.' },
        viewer,
      ),
    );

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const res = await runGql<{ requestContact: ContactNode }>(
        REQUEST_CONTACT,
        { postId: post.id, message: 'I would love to help.' },
        viewer,
      );
      const message = firstError(res);
      expect(neutralized(message, post.id)).toBe(neutralized(missingMessage, NONEXISTENT_ID));
      expect(message).not.toMatch(/block/i);

      const rows = await dbHelper.db
        .select()
        .from(contactRequests)
        .where(and(eq(contactRequests.postId, post.id), eq(contactRequests.requesterId, viewer.id)));
      expect(rows).toHaveLength(0);
      expect(fireNotification).not.toHaveBeenCalled();
    }

    await clearBlocks();
    const restoredId = await requestContact(viewer, post.id);
    expect((await contactRow(restoredId))?.status).toBe('PENDING');
  });

  it('new Adoption Applications fail neutrally in both Block directions and create no row', async () => {
    const post = await insertPost(author.id, 'ADOPTION');
    const missingMessage = firstError(
      await runGql<{ submitAdoptionApplication: ApplicationNode }>(
        SUBMIT_APPLICATION,
        { input: { ...APPLICATION_INPUT, targetPostId: NONEXISTENT_ID } },
        viewer,
      ),
    );

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const res = await runGql<{ submitAdoptionApplication: ApplicationNode }>(
        SUBMIT_APPLICATION,
        { input: { ...APPLICATION_INPUT, targetPostId: post.id } },
        viewer,
      );
      const message = firstError(res);
      expect(neutralized(message, post.id)).toBe(neutralized(missingMessage, NONEXISTENT_ID));
      expect(message).not.toMatch(/block/i);

      const rows = await dbHelper.db
        .select()
        .from(adoptionApplications)
        .where(and(eq(adoptionApplications.targetPostId, post.id), eq(adoptionApplications.applicantId, viewer.id)));
      expect(rows).toHaveLength(0);
      expect(fireNotification).not.toHaveBeenCalled();
    }

    await clearBlocks();
    const restoredId = await submitApplication(viewer, post.id);
    expect((await applicationRow(restoredId))?.status).toBe('PENDING');
  });

  it('blocking rejects pending direct interactions atomically, preserves them, and they cannot be approved', async () => {
    const authorContactPost = await insertPost(author.id, 'RESCUE');
    const viewerContactPost = await insertPost(viewer.id, 'LOST');
    const authorAdoptionPost = await insertPost(author.id, 'ADOPTION');
    const viewerAdoptionPost = await insertPost(viewer.id, 'ADOPTION');

    const viewerSentRequest = await requestContact(viewer, authorContactPost.id);
    const authorSentRequest = await requestContact(author, viewerContactPost.id);
    const viewerApplication = await submitApplication(viewer, authorAdoptionPost.id);
    const authorApplication = await submitApplication(author, viewerAdoptionPost.id);

    // Creation notifications are expected; the Block cleanup itself must be silent.
    fireNotification.mockClear();
    await commitBlock(viewer, author);

    const contactRows = await dbHelper.db.select().from(contactRequests);
    expect(contactRows).toHaveLength(2);
    for (const row of contactRows) {
      expect(row.status).toBe('REJECTED');
      expect(row.respondedAt).not.toBeNull();
    }

    const applicationRows = await dbHelper.db.select().from(adoptionApplications);
    expect(applicationRows).toHaveLength(2);
    for (const row of applicationRows) {
      expect(row.status).toBe('REJECTED');
      expect(row.respondedAt).not.toBeNull();
    }

    const approveViewerSent = firstError(await approveContact(author, viewerSentRequest));
    expect(approveViewerSent).toMatch(/already REJECTED/);
    const approveAuthorSent = firstError(await approveContact(viewer, authorSentRequest));
    expect(approveAuthorSent).toMatch(/already REJECTED/);
    const approveViewerApplication = firstError(await approveApplication(author, viewerApplication));
    expect(approveViewerApplication).toMatch(/already REJECTED/);
    const approveAuthorApplication = firstError(await approveApplication(viewer, authorApplication));
    expect(approveAuthorApplication).toMatch(/already REJECTED/);

    expect((await contactRow(viewerSentRequest))?.status).toBe('REJECTED');
    expect((await contactRow(authorSentRequest))?.status).toBe('REJECTED');
    expect((await applicationRow(viewerApplication))?.status).toBe('REJECTED');
    expect((await applicationRow(authorApplication))?.status).toBe('REJECTED');

    // Rejecting due to a Block is silent: no rejection notification is created.
    expect(fireNotification).not.toHaveBeenCalled();
  });

  it('sent and received lists omit records involving an isolated account while blocked', async () => {
    const authorContactPost = await insertPost(author.id, 'RESCUE');
    const otherContactPost = await insertPost(other.id, 'RESCUE');
    const viewerContactPost = await insertPost(viewer.id, 'LOST');

    const viewerToAuthor = await requestContact(viewer, authorContactPost.id);
    const viewerToOther = await requestContact(viewer, otherContactPost.id);
    const authorToViewer = await requestContact(author, viewerContactPost.id);
    const otherToViewer = await requestContact(other, viewerContactPost.id);

    const authorAdoptionPost = await insertPost(author.id, 'ADOPTION');
    const otherAdoptionPost = await insertPost(other.id, 'ADOPTION');
    const viewerAdoptionPost = await insertPost(viewer.id, 'ADOPTION');

    const viewerToAuthorApp = await submitApplication(viewer, authorAdoptionPost.id);
    const viewerToOtherApp = await submitApplication(viewer, otherAdoptionPost.id);
    const authorToViewerApp = await submitApplication(author, viewerAdoptionPost.id);
    const otherToViewerApp = await submitApplication(other, viewerAdoptionPost.id);

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      expect(await sentContactIds(viewer)).toEqual([viewerToOther]);
      expect(await sentContactIds(author)).toEqual([]);
      expect(await receivedContactIds(viewer, viewerContactPost.id)).toEqual([otherToViewer]);
      expect(await receivedContactIds(author, authorContactPost.id)).toEqual([]);

      expect(await sentApplicationIds(viewer)).toEqual([viewerToOtherApp]);
      expect(await sentApplicationIds(author)).toEqual([]);
      expect(await receivedApplicationIds(viewer, viewerAdoptionPost.id)).toEqual([otherToViewerApp]);
      expect(await receivedApplicationIds(author, authorAdoptionPost.id)).toEqual([]);

      // Filtering happens before the limit, so pages stay dense over the visible set.
      const limited = await runGql<{ myContactRequests: ContactConnection }>(MY_CONTACT_REQUESTS, { first: 1 }, viewer);
      expect(limited.errors).toBeUndefined();
      expect(limited.data!.myContactRequests.edges.map((edge) => edge.node.id)).toEqual([viewerToOther]);
      expect(limited.data!.myContactRequests.pageInfo.hasNextPage).toBe(false);

      await clearBlocks();
    }

    // Preserved history is visible again after Unblocking.
    expect(await sentContactIds(viewer)).toHaveLength(2);
    expect(await sentContactIds(author)).toEqual([authorToViewer]);
    expect(await receivedContactIds(viewer, viewerContactPost.id)).toEqual([otherToViewer, authorToViewer]);
    expect(await receivedContactIds(author, authorContactPost.id)).toEqual([viewerToAuthor]);
    expect(await sentApplicationIds(viewer)).toHaveLength(2);
    expect(await sentApplicationIds(author)).toEqual([authorToViewerApp]);
    expect(await receivedApplicationIds(viewer, viewerAdoptionPost.id)).toEqual([otherToViewerApp, authorToViewerApp]);
    expect(await receivedApplicationIds(author, authorAdoptionPost.id)).toEqual([viewerToAuthorApp]);
  });

  it('approvals and disclosures recheck isolation in both Block directions without cleanup', async () => {
    const contactPost = await insertPost(author.id, 'RESCUE');
    const approvedRequest = await requestContact(viewer, contactPost.id);
    expect((await approveContact(author, approvedRequest)).errors).toBeUndefined();

    const productPost = await insertPost(author.id, 'PRODUCT');

    const adoptionPost = await insertPost(author.id, 'ADOPTION');
    const approvedApplication = await submitApplication(viewer, adoptionPost.id);
    expect((await approveApplication(author, approvedApplication)).errors).toBeUndefined();

    const pendingContactPost = await insertPost(author.id, 'RESCUE');
    const pendingRequest = await requestContact(viewer, pendingContactPost.id);
    const pendingAdoptionPost = await insertPost(author.id, 'ADOPTION');
    const pendingApplication = await submitApplication(viewer, pendingAdoptionPost.id);

    const nonexistentRequestMessage = firstError(
      await runGql<{ approveContactRequest: ContactNode }>(APPROVE_CONTACT, { requestId: NONEXISTENT_ID }, author),
    );
    const nonexistentApplicationMessage = firstError(
      await runGql<{ approveAdoptionApplication: ApplicationNode }>(
        APPROVE_APPLICATION,
        { applicationId: NONEXISTENT_ID },
        author,
      ),
    );
    const nonexistentPostMessage = firstError(
      await runGql<{ getProductSellerContact: string }>(SELLER_CONTACT, { postId: NONEXISTENT_ID }, viewer),
    );

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const disclosure = await runGql<{ getWhatsAppLink: string }>(
        GET_WHATSAPP,
        { requestId: approvedRequest },
        viewer,
      );
      const disclosureMessage = firstError(disclosure);
      expect(neutralized(disclosureMessage, approvedRequest)).toBe(
        neutralized(nonexistentRequestMessage, NONEXISTENT_ID),
      );
      expect(disclosureMessage).not.toMatch(/block/i);

      const seller = await runGql<{ getProductSellerContact: string }>(
        SELLER_CONTACT,
        { postId: productPost.id },
        viewer,
      );
      const sellerMessage = firstError(seller);
      expect(neutralized(sellerMessage, productPost.id)).toBe(neutralized(nonexistentPostMessage, NONEXISTENT_ID));
      expect(sellerMessage).not.toMatch(/block/i);

      // A pending row that a Block did not clean up (direct insert) still cannot be approved.
      const pendingContactApproval = await approveContact(author, pendingRequest);
      const pendingContactMessage = firstError(pendingContactApproval);
      expect(neutralized(pendingContactMessage, pendingRequest)).toBe(
        neutralized(nonexistentRequestMessage, NONEXISTENT_ID),
      );
      expect(pendingContactMessage).not.toMatch(/block/i);

      const pendingApplicationApproval = await approveApplication(author, pendingApplication);
      const pendingApplicationMessage = firstError(pendingApplicationApproval);
      expect(neutralized(pendingApplicationMessage, pendingApplication)).toBe(
        neutralized(nonexistentApplicationMessage, NONEXISTENT_ID),
      );
      expect(pendingApplicationMessage).not.toMatch(/block/i);

      expect((await contactRow(pendingRequest))?.status).toBe('PENDING');
      expect((await applicationRow(pendingApplication))?.status).toBe('PENDING');

      await clearBlocks();
    }

    // After Unblocking, preserved pending records approve normally again.
    expect((await approveContact(author, pendingRequest)).errors).toBeUndefined();
    expect((await approveApplication(author, pendingApplication)).errors).toBeUndefined();
    expect((await contactRow(pendingRequest))?.status).toBe('APPROVED');
    expect((await applicationRow(pendingApplication))?.status).toBe('APPROVED');
  });

  it('cleanup rejects only the blocked pair, and rejected records stay rejected after Unblocking', async () => {
    const blockedContactPost = await insertPost(author.id, 'RESCUE');
    const unaffectedContactPost = await insertPost(other.id, 'RESCUE');
    const viewerContactPost = await insertPost(viewer.id, 'RESCUE');

    const rejectedRequest = await requestContact(viewer, blockedContactPost.id);
    const untargetedRequest = await requestContact(viewer, unaffectedContactPost.id);
    const rejectedRequestFromAuthor = await requestContact(author, viewerContactPost.id);

    const blockedAdoptionPost = await insertPost(author.id, 'ADOPTION');
    const unaffectedAdoptionPost = await insertPost(other.id, 'ADOPTION');
    const viewerAdoptionPost = await insertPost(viewer.id, 'ADOPTION');

    const rejectedApplication = await submitApplication(viewer, blockedAdoptionPost.id);
    const untargetedApplication = await submitApplication(viewer, unaffectedAdoptionPost.id);
    const rejectedApplicationFromAuthor = await submitApplication(author, viewerAdoptionPost.id);

    await commitBlock(viewer, author);

    expect((await contactRow(rejectedRequest))?.status).toBe('REJECTED');
    expect((await contactRow(rejectedRequestFromAuthor))?.status).toBe('REJECTED');
    expect((await contactRow(untargetedRequest))?.status).toBe('PENDING');
    expect((await applicationRow(rejectedApplication))?.status).toBe('REJECTED');
    expect((await applicationRow(rejectedApplicationFromAuthor))?.status).toBe('REJECTED');
    expect((await applicationRow(untargetedApplication))?.status).toBe('PENDING');

    await clearBlocks();

    // Preserved rows are visible again but remain REJECTED.
    expect((await contactRow(rejectedRequest))?.status).toBe('REJECTED');
    expect(firstError(await approveContact(author, rejectedRequest))).toMatch(/already REJECTED/);
    expect(firstError(await approveApplication(author, rejectedApplication))).toMatch(/already REJECTED/);

    // Historical uniqueness still prevents a duplicate for the same Post.
    const duplicateContact = firstError(
      await runGql<{ requestContact: ContactNode }>(
        REQUEST_CONTACT,
        { postId: blockedContactPost.id, message: 'Trying again after unblock.' },
        viewer,
      ),
    );
    expect(duplicateContact).toMatch(/already sent a contact request/i);
    const duplicateApplication = firstError(
      await runGql<{ submitAdoptionApplication: ApplicationNode }>(
        SUBMIT_APPLICATION,
        { input: { ...APPLICATION_INPUT, targetPostId: blockedAdoptionPost.id } },
        viewer,
      ),
    );
    expect(duplicateApplication).toMatch(/already submitted an application/i);

    const rejectedContactRows = await dbHelper.db
      .select()
      .from(contactRequests)
      .where(and(eq(contactRequests.postId, blockedContactPost.id), eq(contactRequests.requesterId, viewer.id)));
    expect(rejectedContactRows).toHaveLength(1);
    const rejectedApplicationRows = await dbHelper.db
      .select()
      .from(adoptionApplications)
      .where(
        and(
          eq(adoptionApplications.targetPostId, blockedAdoptionPost.id),
          eq(adoptionApplications.applicantId, viewer.id),
        ),
      );
    expect(rejectedApplicationRows).toHaveLength(1);

    // Unrelated pairs are untouched and still approvable.
    expect((await approveContact(other, untargetedRequest)).errors).toBeUndefined();
    expect((await contactRow(untargetedRequest))?.status).toBe('APPROVED');
  });

  it('a Block committing first rejects concurrent create, approval, and disclosure without leaking', async () => {
    const pendingContactPost = await insertPost(author.id, 'RESCUE');
    const pendingRequest = await requestContact(viewer, pendingContactPost.id);

    const createRacePost = await insertPost(author.id, 'RESCUE');
    const approvedPost = await insertPost(author.id, 'RESCUE');
    const approvedRequest = await requestContact(viewer, approvedPost.id);
    expect((await approveContact(author, approvedRequest)).errors).toBeUndefined();

    const productPost = await insertPost(author.id, 'PRODUCT');
    const adoptionPost = await insertPost(author.id, 'ADOPTION');
    const pendingApplication = await submitApplication(viewer, adoptionPost.id);

    const nonexistentRequestMessage = firstError(
      await runGql<{ approveContactRequest: ContactNode }>(APPROVE_CONTACT, { requestId: NONEXISTENT_ID }, author),
    );
    const nonexistentApplicationMessage = firstError(
      await runGql<{ approveAdoptionApplication: ApplicationNode }>(
        APPROVE_APPLICATION,
        { applicationId: NONEXISTENT_ID },
        author,
      ),
    );
    const nonexistentPostMessage = firstError(
      await runGql<{ requestContact: ContactNode }>(
        REQUEST_CONTACT,
        { postId: NONEXISTENT_ID, message: 'I would love to help.' },
        viewer,
      ),
    );
    const nonexistentSellerMessage = firstError(
      await runGql<{ getProductSellerContact: string }>(SELLER_CONTACT, { postId: NONEXISTENT_ID }, viewer),
    );

    const blockLocked = deferred();
    const completeBlock = deferred();
    const blocking = dbHelper.db.transaction(async (tx) => {
      // Hold the canonical pair lock before writing the Block so every racing
      // interaction completes its preflight against the unblocked state and
      // must rely on the in-transaction recheck to fail neutrally.
      await isolationPolicy.lockPair(tx, viewer.id, author.id);
      blockLocked.resolve();
      await completeBlock.promise;
      await tx.insert(blocks).values({ blockerId: viewer.id, blockedId: author.id });
      await contactsService.rejectPendingContactRequestsBetweenAccounts(tx, viewer.id, author.id);
      await adoptionsService.rejectPendingAdoptionApplicationsBetweenAccounts(tx, viewer.id, author.id);
    });

    let createRace!: Promise<ExecutionResult<{ requestContact: ContactNode }>>;
    let approveContactRace!: Promise<ExecutionResult<{ approveContactRequest: ContactNode }>>;
    let approveApplicationRace!: Promise<ExecutionResult<{ approveAdoptionApplication: ApplicationNode }>>;
    let disclosureRace!: Promise<ExecutionResult<{ getWhatsAppLink: string }>>;
    let sellerRace!: Promise<ExecutionResult<{ getProductSellerContact: string }>>;

    await blockLocked.promise;
    try {
      createRace = runGql<{ requestContact: ContactNode }>(
        REQUEST_CONTACT,
        { postId: createRacePost.id, message: 'Racing the block.' },
        viewer,
      );
      approveContactRace = runGql<{ approveContactRequest: ContactNode }>(
        APPROVE_CONTACT,
        { requestId: pendingRequest },
        author,
      );
      approveApplicationRace = runGql<{ approveAdoptionApplication: ApplicationNode }>(
        APPROVE_APPLICATION,
        { applicationId: pendingApplication },
        author,
      );
      disclosureRace = runGql<{ getWhatsAppLink: string }>(GET_WHATSAPP, { requestId: approvedRequest }, viewer);
      sellerRace = runGql<{ getProductSellerContact: string }>(SELLER_CONTACT, { postId: productPost.id }, viewer);

      await waitForWaitingAdvisoryLock(5);
    } finally {
      completeBlock.resolve();
      await blocking;
    }

    const createMessage = firstError(await createRace);
    expect(neutralized(createMessage, createRacePost.id)).toBe(neutralized(nonexistentPostMessage, NONEXISTENT_ID));
    expect(createMessage).not.toMatch(/block/i);

    const approveContactMessage = firstError(await approveContactRace);
    expect(neutralized(approveContactMessage, pendingRequest)).toBe(
      neutralized(nonexistentRequestMessage, NONEXISTENT_ID),
    );
    expect(approveContactMessage).not.toMatch(/block/i);

    const approveApplicationMessage = firstError(await approveApplicationRace);
    expect(neutralized(approveApplicationMessage, pendingApplication)).toBe(
      neutralized(nonexistentApplicationMessage, NONEXISTENT_ID),
    );
    expect(approveApplicationMessage).not.toMatch(/block/i);

    const disclosureMessage = firstError(await disclosureRace);
    expect(neutralized(disclosureMessage, approvedRequest)).toBe(
      neutralized(nonexistentRequestMessage, NONEXISTENT_ID),
    );
    expect(disclosureMessage).not.toMatch(/block/i);

    const sellerMessage = firstError(await sellerRace);
    expect(neutralized(sellerMessage, productPost.id)).toBe(neutralized(nonexistentSellerMessage, NONEXISTENT_ID));
    expect(sellerMessage).not.toMatch(/block/i);

    // Once Block returns, no pending direct interaction survives and no new one commits.
    const pendingContacts = await dbHelper.db
      .select()
      .from(contactRequests)
      .where(eq(contactRequests.status, 'PENDING'));
    expect(pendingContacts).toHaveLength(0);
    const pendingApplications = await dbHelper.db
      .select()
      .from(adoptionApplications)
      .where(eq(adoptionApplications.status, 'PENDING'));
    expect(pendingApplications).toHaveLength(0);
    expect((await contactRow(pendingRequest))?.status).toBe('REJECTED');
    expect((await applicationRow(pendingApplication))?.status).toBe('REJECTED');
    expect((await contactRow(approvedRequest))?.status).toBe('APPROVED');
  });

  it('a concurrent create and Block settle in exactly one serial order', async () => {
    const contactPost = await insertPost(author.id, 'RESCUE');

    const [createResult] = await Promise.all([
      runGql<{ requestContact: ContactNode }>(
        REQUEST_CONTACT,
        { postId: contactPost.id, message: 'Race against block.' },
        viewer,
      ),
      commitBlock(viewer, author),
    ]);

    const rows = await dbHelper.db
      .select()
      .from(contactRequests)
      .where(and(eq(contactRequests.postId, contactPost.id), eq(contactRequests.requesterId, viewer.id)));

    if (createResult.errors === undefined) {
      // The create serialized first; the Block that followed hid and rejected it.
      expect(createResult.data!.requestContact.status).toBe('PENDING');
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('REJECTED');
    } else {
      // The Block serialized first; the create never committed.
      expect(rows).toHaveLength(0);
      expect(firstError(createResult)).not.toMatch(/block/i);
    }

    const sentIds = await sentContactIds(viewer);
    expect(sentIds).toHaveLength(0);
  });

  it('a concurrent approval, disclosure, and Block settle in exactly one serial order', async () => {
    const contactPost = await insertPost(author.id, 'RESCUE');
    const pendingRequest = await requestContact(viewer, contactPost.id);
    const adoptionPost = await insertPost(author.id, 'ADOPTION');
    const pendingApplication = await submitApplication(viewer, adoptionPost.id);

    const approvedPost = await insertPost(author.id, 'RESCUE');
    const approvedRequest = await requestContact(viewer, approvedPost.id);
    expect((await approveContact(author, approvedRequest)).errors).toBeUndefined();

    const nonexistentRequestMessage = firstError(
      await runGql<{ getWhatsAppLink: string }>(GET_WHATSAPP, { requestId: NONEXISTENT_ID }, viewer),
    );

    const [contactRace, applicationRace, disclosureRace] = await Promise.all([
      approveContact(author, pendingRequest),
      approveApplication(author, pendingApplication),
      runGql<{ getWhatsAppLink: string }>(GET_WHATSAPP, { requestId: approvedRequest }, viewer),
      commitBlock(viewer, author),
    ]);

    // Whichever order the pair lock produced, the committed state is consistent:
    // an approval that serialized first stays APPROVED (hidden by the Block),
    // and one that serialized after the Block is REJECTED with a neutral error.
    const contactAfterRace = await contactRow(pendingRequest);
    if (contactRace.errors === undefined) {
      expect(contactRace.data!.approveContactRequest.status).toBe('APPROVED');
      expect(contactAfterRace?.status).toBe('APPROVED');
    } else {
      expect(contactAfterRace?.status).toBe('REJECTED');
      expect(firstError(contactRace)).not.toMatch(/block/i);
    }

    const applicationAfterRace = await applicationRow(pendingApplication);
    if (applicationRace.errors === undefined) {
      expect(applicationRace.data!.approveAdoptionApplication.status).toBe('APPROVED');
      expect(applicationAfterRace?.status).toBe('APPROVED');
    } else {
      expect(applicationAfterRace?.status).toBe('REJECTED');
      expect(firstError(applicationRace)).not.toMatch(/block/i);
    }

    if (disclosureRace.errors === undefined) {
      // Disclosure serialized before the Block committed; the Block cannot
      // revoke information already read, and nothing is returned after it.
      expect(disclosureRace.data!.getWhatsAppLink).toBe(OWNER_WA_LINK);
    } else {
      const message = firstError(disclosureRace);
      expect(neutralized(message, approvedRequest)).toBe(neutralized(nonexistentRequestMessage, NONEXISTENT_ID));
      expect(message).not.toMatch(/block/i);
    }

    // Once the Block has committed, no disclosure is possible for the pair and
    // no pending direct interaction survives, regardless of which side won.
    const postBlockDisclosure = firstError(
      await runGql<{ getWhatsAppLink: string }>(GET_WHATSAPP, { requestId: approvedRequest }, viewer),
    );
    expect(postBlockDisclosure).not.toMatch(/block/i);
    expect(postBlockDisclosure).not.toContain(OWNER_WA_LINK);
    expect(await sentContactIds(viewer)).toEqual([]);
    expect(await sentApplicationIds(viewer)).toEqual([]);

    const survivingPendingContacts = await dbHelper.db
      .select()
      .from(contactRequests)
      .where(eq(contactRequests.status, 'PENDING'));
    expect(survivingPendingContacts).toHaveLength(0);
    const survivingPendingApplications = await dbHelper.db
      .select()
      .from(adoptionApplications)
      .where(eq(adoptionApplications.status, 'PENDING'));
    expect(survivingPendingApplications).toHaveLength(0);
  });
});

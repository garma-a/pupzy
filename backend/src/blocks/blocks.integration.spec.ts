import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLObjectType, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import DataLoader from 'dataloader';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  accountReports,
  adoptionApplications,
  blocks,
  cities,
  comments,
  contactRequests,
  notifications,
  postReports,
  posts,
  users,
  type City,
  type Comment,
  type Post,
  type User,
} from '../database/schema';
import { BlocksRepository } from './blocks.repository';
import { BlocksService } from './blocks.service';
import { BlocksResolver } from './blocks.resolver';
import { AccountIsolationPolicy, canonicalAccountPairKey } from './account-isolation.policy';
import { PostsRepository } from '../posts/posts.repository';
import { PostsService } from '../posts/posts.service';
import { PostsResolver } from '../posts/posts.resolver';
import { CommentsRepository } from '../comments/comments.repository';
import { CommentsService } from '../comments/comments.service';
import { CommentsResolver } from '../comments/comments.resolver';
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
import { UploadService } from '../upload/upload.service';
import { ViewFlushCron } from '../posts/view-flush.cron';
import { NotificationsService } from '../notifications/notifications.service';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { encryptString } from '../common/utils/crypto.util';
import type { GqlContext } from '../common/types/gql-context.type';

type PostType = 'RESCUE' | 'LOST' | 'ADOPTION' | 'PRODUCT' | 'MATING';

const PHONE_KEY = 'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=';
const OWNER_PHONE = '+201012345678';
const OWNER_WA_LINK = 'https://wa.me/201012345678';
const NONEXISTENT_ID = '0192ffff-0000-7000-8000-000000000000';

const BLOCK_USER = `mutation BlockUser($userId: ID!) { blockUser(userId: $userId) }`;
const UNBLOCK_USER = `mutation UnblockUser($userId: ID!) { unblockUser(userId: $userId) }`;

const BLOCKED_USERS = `query BlockedUsers($first: Int, $after: String) {
  blockedUsers(first: $first, after: $after) {
    edges { node { id fullName fullNameArabic profilePictureUrl isVerified } blockedAt cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const HOME_FEED = `query Home($cityId: ID, $first: Int, $after: String) {
  homeFeed(cityId: $cityId, first: $first, after: $after) {
    edges { node { id creator { id } } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const POST_QUERY = `query Post($id: ID!) {
  post(id: $id) { id creator { id } isUpvotedByMe isSavedByMe upvoteCount saveCount commentCount }
}`;

const COMMENTS_QUERY = `query Comments($postId: ID!, $sort: CommentSort, $first: Int) {
  comments(postId: $postId, sort: $sort, first: $first) {
    edges { node { id text author { id } replyCount } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const TOGGLE_UPVOTE = `mutation ToggleUpvote($postId: ID!) {
  toggleUpvote(postId: $postId) { id upvoteCount isUpvotedByMe }
}`;

const TOGGLE_SAVE = `mutation ToggleSave($postId: ID!) {
  toggleSave(postId: $postId) { id saveCount isSavedByMe }
}`;

const CREATE_COMMENT = `mutation CreateComment($input: CreateCommentInput!) {
  createComment(input: $input) { id postId text }
}`;

const REQUEST_CONTACT = `mutation RequestContact($postId: ID!, $message: String!) {
  requestContact(postId: $postId, message: $message) { id status }
}`;

const APPROVE_CONTACT = `mutation ApproveContact($requestId: ID!) {
  approveContactRequest(requestId: $requestId) { id status whatsappLink }
}`;

const GET_WHATSAPP = `query GetWhatsApp($requestId: ID!) { getWhatsAppLink(requestId: $requestId) }`;

const MY_CONTACT_REQUESTS = `query MyContacts($first: Int) {
  myContactRequests(first: $first) {
    edges { node { id status } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const POST_CONTACT_REQUESTS = `query PostContacts($postId: ID!, $first: Int) {
  postContactRequests(postId: $postId, first: $first) {
    edges { node { id status } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const SUBMIT_APPLICATION = `mutation SubmitApplication($input: SubmitAdoptionApplicationInput!) {
  submitAdoptionApplication(input: $input) { id status }
}`;

const APPROVE_APPLICATION = `mutation ApproveApplication($applicationId: ID!) {
  approveAdoptionApplication(applicationId: $applicationId) { id status }
}`;

const MY_APPLICATIONS = `query MyApplications($first: Int) {
  myAdoptionApplications(first: $first) {
    edges { node { id status } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const POST_APPLICATIONS = `query PostApplications($postId: ID!, $first: Int) {
  postAdoptionApplications(postId: $postId, first: $first) {
    edges { node { id status } cursor }
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

interface GqlErrorBody {
  message: string;
  extensions?: { code?: string };
}

interface BlockedUserNode {
  id: string;
  fullName: string | null;
  fullNameArabic: string | null;
  profilePictureUrl: string | null;
  isVerified: boolean;
}

interface BlockedUsersPage {
  edges: Array<{ node: BlockedUserNode; blockedAt: string; cursor: string }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface FeedPage {
  edges: Array<{ node: { id: string; creator?: { id: string } }; cursor: string }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

describe('Block, Unblock, and Blocked Accounts (Ticket 11)', () => {
  jest.setTimeout(240_000);

  let dbHelper: TestDatabaseHelper;
  let executableSchema: GraphQLSchema;
  let blocksRepository: BlocksRepository;
  let blocksService: BlocksService;
  let blocksResolver: BlocksResolver;
  let contactsService: ContactsService;
  let contactsResolver: ContactsResolver;
  let adoptionsService: AdoptionsService;
  let adoptionsResolver: AdoptionsResolver;
  let postsRepository: PostsRepository;
  let postsService: PostsService;
  let postsResolver: PostsResolver;
  let commentsRepository: CommentsRepository;
  let commentsService: CommentsService;
  let commentsResolver: CommentsResolver;
  let citiesService: CitiesService;
  let isolationPolicy: AccountIsolationPolicy;
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

    const citiesRepository = new CitiesRepository(dbHelper.db);
    const usersRepository = new UsersRepository(dbHelper.db);
    const accountDeletionRepository = new AccountDeletionRepository(dbHelper.db);
    postsRepository = new PostsRepository(dbHelper.db);
    commentsRepository = new CommentsRepository(dbHelper.db);
    const contactsRepository = new ContactsRepository(dbHelper.db);
    const adoptionsRepository = new AdoptionsRepository(dbHelper.db);

    citiesService = new CitiesService(citiesRepository, mockCache);
    const usersService = new UsersService(
      usersRepository,
      citiesService,
      accountDeletionRepository,
      mockConfig,
      mockCache,
    );
    const uploadService = new UploadService(mockConfig, mockCache, dbHelper.db);
    const viewFlushCron = new ViewFlushCron(postsRepository, mockCache);
    fireNotification = jest.fn().mockResolvedValue(undefined);
    const notificationsService = { fireNotification } as unknown as NotificationsService;

    isolationPolicy = new AccountIsolationPolicy(dbHelper.db);
    postsService = new PostsService(
      postsRepository,
      citiesService,
      uploadService,
      viewFlushCron,
      usersService,
      notificationsService,
      mockCache,
    );
    commentsService = new CommentsService(
      commentsRepository,
      postsRepository,
      uploadService,
      mockConfig,
      undefined,
      undefined,
      usersService,
      isolationPolicy,
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
    blocksRepository = new BlocksRepository(dbHelper.db);
    blocksService = new BlocksService(
      blocksRepository,
      isolationPolicy,
      contactsService,
      adoptionsService,
      dbHelper.db,
    );

    postsResolver = new PostsResolver(postsService);
    commentsResolver = new CommentsResolver(commentsService);
    contactsResolver = new ContactsResolver(contactsService);
    adoptionsResolver = new AdoptionsResolver(adoptionsService);
    blocksResolver = new BlocksResolver(blocksService);

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
      'src/blocks/blocks.graphql',
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
          blockedUsers: (_root: unknown, args: { first?: number; after?: string }, ctx: GqlContext) =>
            blocksResolver.blockedUsers(args.first, args.after, ctx),
          post: (_root: unknown, args: { id: string }, ctx: GqlContext) => postsResolver.post(args.id, ctx),
          homeFeed: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) =>
            postsResolver.homeFeed(args, ctx),
          comments: (
            _root: unknown,
            args: { postId: string; sort?: string; first?: number; after?: string },
            ctx: GqlContext,
          ) => commentsResolver.comments(args.postId, args.sort, args.first, args.after, ctx),
          myContactRequests: (_root: unknown, args: { first?: number }, ctx: GqlContext) =>
            contactsResolver.myContactRequests(undefined, undefined, args.first, undefined, ctx),
          postContactRequests: (_root: unknown, args: { postId: string; first?: number }, ctx: GqlContext) =>
            contactsResolver.postContactRequests(args.postId, undefined, args.first, undefined, ctx),
          getWhatsAppLink: (_root: unknown, args: { requestId: string }, ctx: GqlContext) =>
            contactsResolver.getWhatsAppLink(args.requestId, ctx),
          myAdoptionApplications: (_root: unknown, args: { first?: number }, ctx: GqlContext) =>
            adoptionsResolver.myAdoptionApplications(args.first, undefined, ctx),
          postAdoptionApplications: (_root: unknown, args: { postId: string; first?: number }, ctx: GqlContext) =>
            adoptionsResolver.postAdoptionApplications(args.postId, undefined, args.first, undefined, ctx),
        },
        Mutation: {
          blockUser: (_root: unknown, args: { userId: string }, ctx: GqlContext) =>
            blocksResolver.blockUser(args.userId, ctx),
          unblockUser: (_root: unknown, args: { userId: string }, ctx: GqlContext) =>
            blocksResolver.unblockUser(args.userId, ctx),
          toggleUpvote: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.toggleUpvote(args.postId, ctx),
          toggleSave: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.toggleSave(args.postId, ctx),
          createComment: (_root: unknown, args: { input: unknown }, ctx: GqlContext) =>
            commentsResolver.createComment(args.input, ctx),
          requestContact: (_root: unknown, args: { postId: string; message: string }, ctx: GqlContext) =>
            contactsResolver.requestContact(args.postId, args.message, ctx),
          approveContactRequest: (_root: unknown, args: { requestId: string }, ctx: GqlContext) =>
            contactsResolver.approveContactRequest(args.requestId, ctx),
          submitAdoptionApplication: (_root: unknown, args: { input: unknown }, ctx: GqlContext) =>
            adoptionsResolver.submitAdoptionApplication(args.input, ctx),
          approveAdoptionApplication: (_root: unknown, args: { applicationId: string }, ctx: GqlContext) =>
            adoptionsResolver.approveAdoptionApplication(args.applicationId, ctx),
        },
        Post: {
          coordinates: (root: Post) => postsResolver.coordinates(root),
          city: (root: Post, _args: unknown, ctx: GqlContext) => postsResolver.city(root, ctx),
          creator: (root: Post, _args: unknown, ctx: GqlContext) => postsResolver.creator(root, ctx),
          media: (root: Post, _args: unknown, ctx: GqlContext) => postsResolver.media(root, ctx),
          isUpvotedByMe: (root: Post, _args: unknown, ctx: GqlContext) => postsResolver.isUpvotedByMe(root, ctx),
          isSavedByMe: (root: Post, _args: unknown, ctx: GqlContext) => postsResolver.isSavedByMe(root, ctx),
          commentCount: (root: Post, _args: unknown, ctx: GqlContext) => postsResolver.commentCount(root, ctx),
        },
        Comment: {
          author: (root: Comment, _args: unknown, ctx: GqlContext) => commentsResolver.author(root, ctx),
          text: (root: Comment) => commentsResolver.text(root),
          media: (root: Comment, _args: unknown, ctx: GqlContext) => commentsResolver.media(root, ctx),
          isBoostedByMe: (root: Comment, _args: unknown, ctx: GqlContext) => commentsResolver.isBoostedByMe(root, ctx),
          boostCount: (root: Comment) => commentsResolver.boostCount(root),
          isPinned: (root: Comment, _args: unknown, ctx: GqlContext) => commentsResolver.isPinned(root, ctx),
          replyCount: (root: Comment, _args: unknown, ctx: GqlContext) => commentsResolver.replyCount(root, ctx),
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

  // ─── Fixtures ────────────────────────────────────────────────────────────

  async function insertUser(label: string, phone?: string, display?: Partial<User>): Promise<User> {
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${label}-${generateUuidV7()}`,
        email: `${label}-${generateUuidV7()}@pupzy.dev`,
        fullName: `Block ${label}`,
        phoneNumber: phone ? encryptString(phone, PHONE_KEY) : null,
        ...display,
      })
      .returning();
    return user;
  }

  async function insertPost(creatorId: string, postType: PostType, createdAt?: Date): Promise<Post> {
    const isUrgencyType = postType === 'RESCUE' || postType === 'LOST';
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId,
        postType,
        title: `Block ${postType} ${generateUuidV7().slice(-4)}`,
        description: 'Block management fixture',
        urgency: isUrgencyType ? 'URGENT' : undefined,
        marketCategory: postType === 'PRODUCT' ? 'FOOD' : undefined,
        cityId: testCity.id,
        governorate: testCity.governorate,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
        ...(createdAt ? { createdAt } : {}),
      })
      .returning();
    return post;
  }

  async function insertComment(params: {
    postId: string;
    authorId: string;
    text: string;
    parentId?: string | null;
  }): Promise<Comment> {
    const [comment] = await dbHelper.db
      .insert(comments)
      .values({
        postId: params.postId,
        authorId: params.authorId,
        parentId: params.parentId ?? null,
        text: params.text,
      })
      .returning();
    return comment;
  }

  async function insertBlock(blockerId: string, blockedId: string, createdAt?: Date) {
    const [block] = await dbHelper.db
      .insert(blocks)
      .values({ blockerId, blockedId, ...(createdAt ? { createdAt } : {}) })
      .returning();
    return block;
  }

  async function contactRow(id: string) {
    const [row] = await dbHelper.db.select().from(contactRequests).where(eq(contactRequests.id, id));
    return row;
  }

  async function applicationRow(id: string) {
    const [row] = await dbHelper.db.select().from(adoptionApplications).where(eq(adoptionApplications.id, id));
    return row;
  }

  async function blockRowsBetween(firstId: string, secondId: string) {
    return dbHelper.db
      .select()
      .from(blocks)
      .where(
        sql`(${blocks.blockerId} = ${firstId} AND ${blocks.blockedId} = ${secondId})
         OR (${blocks.blockerId} = ${secondId} AND ${blocks.blockedId} = ${firstId})`,
      );
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
      loaders: {
        cityById: citiesService.createCityByIdLoader(),
        userById: userLoader,
        mediaByPostId: postsRepository.createMediaByPostIdLoader(),
        upvotedByMe: postsRepository.createUpvotedByMeLoader(),
        savedByMe: postsRepository.createSavedByMeLoader(),
        commentBoostedByMe: commentsRepository.createCommentBoostedByMeLoader(),
        pinnedCommentIdByPostId: commentsRepository.createPinnedCommentIdByPostIdLoader(),
        commentMediaByCommentId: commentsRepository.createCommentMediaByCommentIdLoader(),
        reachableCommentCountByPostId: commentsRepository.createReachableCommentCountByPostIdLoader(),
        reachableReplyCountByCommentId: commentsRepository.createReachableReplyCountByCommentIdLoader(),
      },
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

  async function runMutation<TData>(
    source: string,
    variables: Record<string, unknown>,
    user: User,
  ): Promise<ExecutionResult<TData>> {
    return runGql<TData>(source, variables, user);
  }

  async function blockUser(blocker: User, targetId: string): Promise<ExecutionResult<{ blockUser: boolean }>> {
    return runMutation<{ blockUser: boolean }>(BLOCK_USER, { userId: targetId }, blocker);
  }

  async function unblockUser(blocker: User, targetId: string): Promise<ExecutionResult<{ unblockUser: boolean }>> {
    return runMutation<{ unblockUser: boolean }>(UNBLOCK_USER, { userId: targetId }, blocker);
  }

  async function blockedUsers(user: User, first?: number, after?: string): Promise<BlockedUsersPage> {
    const res = await runGql<{ blockedUsers: BlockedUsersPage }>(BLOCKED_USERS, { first, after }, user);
    expect(res.errors).toBeUndefined();
    return res.data!.blockedUsers;
  }

  async function homeFeed(user: User, first = 20): Promise<FeedPage> {
    const res = await runGql<{ homeFeed: FeedPage }>(HOME_FEED, { cityId: testCity.id, first }, user);
    expect(res.errors).toBeUndefined();
    return res.data!.homeFeed;
  }

  function firstError(result: ExecutionResult<unknown>): GqlErrorBody {
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    return result.errors![0];
  }

  function errorMessage(result: ExecutionResult<unknown>): string {
    return firstError(result).message;
  }

  function ids(page: FeedPage): string[] {
    return page.edges.map((edge) => edge.node.id);
  }

  async function waitForUngrantedAdvisoryLock(classId: number, objectId: number, minimum = 1): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const { rows } = await dbHelper.pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM pg_locks
         WHERE locktype = 'advisory' AND NOT granted AND classid = $1 AND objid = $2`,
        [classId, objectId],
      );
      if (Number(rows[0]?.count ?? 0) >= minimum) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('expected advisory lock contention was not observed');
  }

  // ─── Block API ───────────────────────────────────────────────────────────

  it('blockUser persists a directional Block visible only to its owner', async () => {
    const result = await blockUser(viewer, author.id);
    expect(result.errors).toBeUndefined();
    expect(result.data?.blockUser).toBe(true);

    const rows = await blockRowsBetween(viewer.id, author.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].blockerId).toBe(viewer.id);
    expect(rows[0].blockedId).toBe(author.id);

    // The blocker sees the edge; the blocked and unrelated accounts see nothing.
    const viewerPage = await blockedUsers(viewer);
    expect(viewerPage.edges.map((edge) => edge.node.id)).toEqual([author.id]);
    expect(viewerPage.pageInfo.hasNextPage).toBe(false);

    expect((await blockedUsers(author)).edges).toHaveLength(0);
    expect((await blockedUsers(other)).edges).toHaveLength(0);
  });

  it('blockUser is idempotent and repeats no cleanup for an already-owned Block', async () => {
    const rescue = await insertPost(author.id, 'RESCUE');
    const adoption = await insertPost(author.id, 'ADOPTION');
    const requestId = (
      await runMutation<{ requestContact: { id: string } }>(
        REQUEST_CONTACT,
        { postId: rescue.id, message: 'First request' },
        viewer,
      )
    ).data!.requestContact.id;
    const applicationId = (
      await runMutation<{ submitAdoptionApplication: { id: string } }>(
        SUBMIT_APPLICATION,
        { input: { ...APPLICATION_INPUT, targetPostId: adoption.id } },
        viewer,
      )
    ).data!.submitAdoptionApplication.id;

    expect((await blockUser(viewer, author.id)).data?.blockUser).toBe(true);
    expect((await contactRow(requestId))?.status).toBe('REJECTED');
    expect((await applicationRow(applicationId))?.status).toBe('REJECTED');

    // Replace the rejected fixtures with fresh pending rows so the retry's
    // cleanup (or lack of it) is observable at the database level.
    await dbHelper.db.delete(contactRequests).where(eq(contactRequests.id, requestId));
    await dbHelper.db.delete(adoptionApplications).where(eq(adoptionApplications.id, applicationId));
    const [freshContact] = await dbHelper.db
      .insert(contactRequests)
      .values({ postId: rescue.id, requesterId: viewer.id, message: 'Fresh' })
      .returning();
    const [freshApplication] = await dbHelper.db
      .insert(adoptionApplications)
      .values({
        targetPostId: adoption.id,
        applicantId: viewer.id,
        livingSituation: 'APARTMENT',
        hasOutdoorAccess: false,
        hasOtherPetsAtHome: false,
        hasChildrenAtHome: false,
        whyAdopt: 'Fresh application',
      })
      .returning();

    fireNotification.mockClear();
    const retry = await blockUser(viewer, author.id);
    expect(retry.errors).toBeUndefined();
    expect(retry.data?.blockUser).toBe(true);

    // No duplicate row, and the idempotent retry did not re-run cleanup.
    const rows = await blockRowsBetween(viewer.id, author.id);
    expect(rows).toHaveLength(1);
    expect((await contactRow(freshContact.id))?.status).toBe('PENDING');
    expect((await applicationRow(freshApplication.id))?.status).toBe('PENDING');
    expect(fireNotification).not.toHaveBeenCalled();
  });

  it('blockUser rejects self, malformed, and nonexistent targets without creating rows', async () => {
    const self = await blockUser(viewer, viewer.id);
    expect(errorMessage(self)).toBe('You cannot block your own Pupzy Account');

    // A case-variant self target must not reach the database self-Block check.
    const letteredId = '01916327-0000-7000-8000-0000000000ab';
    const [caseSelf] = await dbHelper.db
      .insert(users)
      .values({
        id: letteredId,
        firebaseUserId: `fb-case-self-${generateUuidV7()}`,
        email: `case-self-${generateUuidV7()}@pupzy.dev`,
        fullName: 'Case Self',
      })
      .returning();
    const caseSelfBlock = await blockUser(caseSelf, letteredId.toUpperCase());
    expect(errorMessage(caseSelfBlock)).toBe('You cannot block your own Pupzy Account');

    const malformed = await blockUser(viewer, 'not-a-uuid');
    expect(errorMessage(malformed)).toContain('userId must be a valid UUID');

    const missing = await blockUser(viewer, NONEXISTENT_ID);
    expect(errorMessage(missing)).toBe(`User with id "${NONEXISTENT_ID}" was not found`);
    expect(errorMessage(missing)).not.toMatch(/block/i);

    expect(await dbHelper.db.select().from(blocks)).toHaveLength(0);
  });

  it('supports mutual Block rows and restricts Unblock to the owning party', async () => {
    await insertBlock(author.id, viewer.id);
    await insertBlock(viewer.id, author.id);

    expect((await blockedUsers(viewer)).edges.map((edge) => edge.node.id)).toEqual([author.id]);
    expect((await blockedUsers(author)).edges.map((edge) => edge.node.id)).toEqual([viewer.id]);

    // Author can only remove the row author owns; viewer's Block survives.
    const authorUnblock = await unblockUser(author, viewer.id);
    expect(authorUnblock.errors).toBeUndefined();
    expect(authorUnblock.data?.unblockUser).toBe(true);
    expect((await blockedUsers(author)).edges).toHaveLength(0);
    expect((await blockedUsers(viewer)).edges.map((edge) => edge.node.id)).toEqual([author.id]);

    // Unblocking again is a successful no-op.
    const repeat = await unblockUser(author, viewer.id);
    expect(repeat.errors).toBeUndefined();
    expect(repeat.data?.unblockUser).toBe(true);

    const viewerUnblock = await unblockUser(viewer, author.id);
    expect(viewerUnblock.data?.unblockUser).toBe(true);
    expect(await dbHelper.db.select().from(blocks)).toHaveLength(0);
  });

  it('unblockUser rejects self, malformed, and nonexistent targets', async () => {
    expect(errorMessage(await unblockUser(viewer, viewer.id))).toBe('You cannot unblock your own Pupzy Account');

    const letteredId = '01916327-0000-7000-8000-0000000000cd';
    const [caseSelf] = await dbHelper.db
      .insert(users)
      .values({
        id: letteredId,
        firebaseUserId: `fb-case-unblock-${generateUuidV7()}`,
        email: `case-unblock-${generateUuidV7()}@pupzy.dev`,
        fullName: 'Case Unblock',
      })
      .returning();
    expect(errorMessage(await unblockUser(caseSelf, letteredId.toUpperCase()))).toBe(
      'You cannot unblock your own Pupzy Account',
    );

    expect(errorMessage(await unblockUser(viewer, 'not-a-uuid'))).toContain('userId must be a valid UUID');
    expect(errorMessage(await unblockUser(viewer, NONEXISTENT_ID))).toBe(
      `User with id "${NONEXISTENT_ID}" was not found`,
    );
  });

  // ─── Atomic cleanup ──────────────────────────────────────────────────────

  it('atomically rejects pending Contact Requests and Adoption Applications and hides them from both parties', async () => {
    const rescue = await insertPost(author.id, 'RESCUE');
    const adoption = await insertPost(author.id, 'ADOPTION');

    const requestId = (
      await runMutation<{ requestContact: { id: string } }>(
        REQUEST_CONTACT,
        { postId: rescue.id, message: 'Please share contact details' },
        viewer,
      )
    ).data!.requestContact.id;
    const applicationId = (
      await runMutation<{ submitAdoptionApplication: { id: string } }>(
        SUBMIT_APPLICATION,
        { input: { ...APPLICATION_INPUT, targetPostId: adoption.id } },
        viewer,
      )
    ).data!.submitAdoptionApplication.id;

    expect((await contactRow(requestId))?.status).toBe('PENDING');
    expect((await applicationRow(applicationId))?.status).toBe('PENDING');

    fireNotification.mockClear();
    expect((await blockUser(viewer, author.id)).data?.blockUser).toBe(true);

    // Same transaction: both pending records are rejected, not deleted.
    expect((await contactRow(requestId))?.status).toBe('REJECTED');
    expect((await applicationRow(applicationId))?.status).toBe('REJECTED');
    expect((await contactRow(requestId))?.respondedAt).toBeInstanceOf(Date);
    expect((await applicationRow(applicationId))?.respondedAt).toBeInstanceOf(Date);

    // Hidden from both parties while the Block remains.
    const sentContacts = await runGql<{ myContactRequests: { edges: unknown[] } }>(
      MY_CONTACT_REQUESTS,
      { first: 10 },
      viewer,
    );
    expect(sentContacts.data?.myContactRequests.edges).toHaveLength(0);
    const receivedContacts = await runGql<{ postContactRequests: { edges: unknown[] } }>(
      POST_CONTACT_REQUESTS,
      { postId: rescue.id, first: 10 },
      author,
    );
    expect(receivedContacts.data?.postContactRequests.edges).toHaveLength(0);
    const sentApplications = await runGql<{ myAdoptionApplications: { edges: unknown[] } }>(
      MY_APPLICATIONS,
      { first: 10 },
      viewer,
    );
    expect(sentApplications.data?.myAdoptionApplications.edges).toHaveLength(0);
    const receivedApplications = await runGql<{ postAdoptionApplications: { edges: unknown[] } }>(
      POST_APPLICATIONS,
      { postId: adoption.id, first: 10 },
      author,
    );
    expect(receivedApplications.data?.postAdoptionApplications.edges).toHaveLength(0);

    // Rejected records can never be approved afterwards; disclosure stays neutral.
    const approveContact = await runMutation(APPROVE_CONTACT, { requestId }, author);
    expect(errorMessage(approveContact)).toBe('Request is already REJECTED');
    expect(errorMessage(approveContact)).not.toMatch(/block/i);
    expect((await contactRow(requestId))?.status).toBe('REJECTED');

    const approveApplication = await runMutation(APPROVE_APPLICATION, { applicationId }, author);
    expect(errorMessage(approveApplication)).toBe('Application is already REJECTED');
    expect(errorMessage(approveApplication)).not.toMatch(/block/i);
    expect((await applicationRow(applicationId))?.status).toBe('REJECTED');

    const disclosure = await runGql<{ getWhatsAppLink: string }>(GET_WHATSAPP, { requestId }, viewer);
    expect(errorMessage(disclosure)).toBe('Contact request has not been approved yet');
    expect(errorMessage(disclosure)).not.toMatch(/block/i);

    // Blocking itself never notified the other party.
    expect(fireNotification).not.toHaveBeenCalled();
  });

  it('hides already-approved direct interactions after a Block and restores disclosure after Unblock', async () => {
    const rescue = await insertPost(author.id, 'RESCUE');
    const adoption = await insertPost(author.id, 'ADOPTION');

    const requestId = (
      await runMutation<{ requestContact: { id: string } }>(
        REQUEST_CONTACT,
        { postId: rescue.id, message: 'Approved contact fixture' },
        viewer,
      )
    ).data!.requestContact.id;
    const applicationId = (
      await runMutation<{ submitAdoptionApplication: { id: string } }>(
        SUBMIT_APPLICATION,
        { input: { ...APPLICATION_INPUT, targetPostId: adoption.id } },
        viewer,
      )
    ).data!.submitAdoptionApplication.id;

    const approvedContact = await runMutation<{ approveContactRequest: { whatsappLink: string | null } }>(
      APPROVE_CONTACT,
      { requestId },
      author,
    );
    expect(approvedContact.errors).toBeUndefined();
    expect(approvedContact.data!.approveContactRequest.whatsappLink).toBe(OWNER_WA_LINK);

    const approvedApplication = await runMutation(APPROVE_APPLICATION, { applicationId }, author);
    expect(approvedApplication.errors).toBeUndefined();

    expect((await runGql<{ getWhatsAppLink: string }>(GET_WHATSAPP, { requestId }, viewer)).data!.getWhatsAppLink).toBe(
      OWNER_WA_LINK,
    );

    expect((await blockUser(viewer, author.id)).data?.blockUser).toBe(true);

    // The interaction committed before the Block: statuses survive, access does not.
    expect((await contactRow(requestId))?.status).toBe('APPROVED');
    expect((await applicationRow(applicationId))?.status).toBe('APPROVED');
    expect(errorMessage(await runGql(GET_WHATSAPP, { requestId }, viewer))).toBe(
      `ContactRequest with id "${requestId}" was not found`,
    );

    const sentContacts = await runGql<{ myContactRequests: { edges: unknown[] } }>(
      MY_CONTACT_REQUESTS,
      { first: 10 },
      viewer,
    );
    expect(sentContacts.data?.myContactRequests.edges).toHaveLength(0);

    // Unblock restores disclosure for the preserved approval.
    expect((await unblockUser(viewer, author.id)).data?.unblockUser).toBe(true);
    expect((await runGql<{ getWhatsAppLink: string }>(GET_WHATSAPP, { requestId }, viewer)).data!.getWhatsAppLink).toBe(
      OWNER_WA_LINK,
    );
  });

  // ─── Immediate isolation through the public API ───────────────────────────

  it('enforces mutual isolation immediately after blockUser across posts, discussion, engagement, and notifications', async () => {
    const authorRescue = await insertPost(author.id, 'RESCUE');
    const authorWritePost = await insertPost(author.id, 'RESCUE');
    const viewerRescue = await insertPost(viewer.id, 'RESCUE');
    const otherPost = await insertPost(other.id, 'RESCUE');
    const authorComment = await insertComment({
      postId: otherPost.id,
      authorId: author.id,
      text: 'Author discussion contribution',
    });
    const viewerComment = await insertComment({
      postId: otherPost.id,
      authorId: viewer.id,
      text: 'Viewer contribution',
    });

    // Engagement that must be preserved internally but masked while blocked.
    const upvote = await runMutation<{ toggleUpvote: { isUpvotedByMe: boolean } }>(
      TOGGLE_UPVOTE,
      { postId: authorRescue.id },
      viewer,
    );
    expect(upvote.data!.toggleUpvote.isUpvotedByMe).toBe(true);

    // Block itself must not notify the other party; the interactions above did.
    fireNotification.mockClear();
    expect((await blockUser(viewer, author.id)).data?.blockUser).toBe(true);

    // Feeds and direct retrieval omit the blocked author.
    const feed = await homeFeed(viewer);
    expect(ids(feed)).not.toContain(authorRescue.id);
    expect(ids(feed)).toContain(otherPost.id);

    const direct = await runGql<{ post: unknown }>(POST_QUERY, { id: authorRescue.id }, viewer);
    expect(direct.data?.post).toBeNull();

    // Discussion contributions from the blocked author are omitted while the
    // third-party Post itself remains readable.
    const discussion = await runGql<{ comments: { edges: Array<{ node: { id: string } }> } }>(
      COMMENTS_QUERY,
      { postId: otherPost.id, first: 10 },
      viewer,
    );
    expect(discussion.errors).toBeUndefined();
    const visibleCommentIds = discussion.data!.comments.edges.map((edge) => edge.node.id);
    expect(visibleCommentIds).not.toContain(authorComment.id);
    expect(visibleCommentIds).toContain(viewerComment.id);

    // Cross-block writes fail with neutral errors, and no notification is created.
    // (The write target has no preserved engagement, so removal-while-blocked is
    // not applicable and the pair lock rejects the new relationship.)
    const blockedUpvote = await runMutation(TOGGLE_UPVOTE, { postId: authorWritePost.id }, viewer);
    const blockedSave = await runMutation(TOGGLE_SAVE, { postId: authorWritePost.id }, viewer);
    for (const result of [blockedUpvote, blockedSave]) {
      expect(errorMessage(result)).toBe(`Post with id "${authorWritePost.id}" was not found`);
      expect(errorMessage(result)).not.toMatch(/block/i);
      expect(errorMessage(result)).not.toContain(author.fullName!);
    }

    const blockedComment = await runMutation(
      CREATE_COMMENT,
      { input: { clientRequestId: generateUuidV7(), postId: viewerRescue.id, text: 'Blocked attempt' } },
      author,
    );
    expect(errorMessage(blockedComment)).toBe(`Post with id "${viewerRescue.id}" was not found`);
    expect(fireNotification).not.toHaveBeenCalled();
    expect(await dbHelper.db.select().from(notifications)).toHaveLength(0);

    // Unrelated third-party content stays fully reachable.
    expect((await runGql<{ post: { id: string } }>(POST_QUERY, { id: otherPost.id }, viewer)).data?.post.id).toBe(
      otherPost.id,
    );

    // Unblock restores visibility; preserved engagement and discussion return.
    expect((await unblockUser(viewer, author.id)).data?.unblockUser).toBe(true);
    const restoredFeed = await homeFeed(viewer);
    expect(ids(restoredFeed)).toContain(authorRescue.id);

    const restoredPost = await runGql<{ post: { id: string; isUpvotedByMe: boolean; upvoteCount: number } }>(
      POST_QUERY,
      { id: authorRescue.id },
      viewer,
    );
    expect(restoredPost.errors).toBeUndefined();
    expect(restoredPost.data!.post.isUpvotedByMe).toBe(true);
    expect(restoredPost.data!.post.upvoteCount).toBe(1);

    const restoredComments = await runGql<{
      comments: { edges: Array<{ node: { id: string; author: { id: string } | null } }> };
    }>(COMMENTS_QUERY, { postId: otherPost.id, first: 10 }, viewer);
    expect(restoredComments.errors).toBeUndefined();
    const restoredCommentIds = restoredComments.data!.comments.edges.map((edge) => edge.node.id);
    expect(restoredCommentIds).toContain(authorComment.id);
    expect(restoredCommentIds).toContain(viewerComment.id);
  });

  it('a Block that commits first prevents new contact requests and applications from committing', async () => {
    const rescue = await insertPost(author.id, 'RESCUE');
    const adoption = await insertPost(author.id, 'ADOPTION');

    expect((await blockUser(viewer, author.id)).data?.blockUser).toBe(true);

    const contact = await runMutation(REQUEST_CONTACT, { postId: rescue.id, message: 'Should fail' }, viewer);
    expect(errorMessage(contact)).toBe(`Post with id "${rescue.id}" was not found`);
    expect(errorMessage(contact)).not.toMatch(/block/i);

    const application = await runMutation(
      SUBMIT_APPLICATION,
      { input: { ...APPLICATION_INPUT, targetPostId: adoption.id } },
      viewer,
    );
    expect(errorMessage(application)).toBe(`Post with id "${adoption.id}" was not found`);
    expect(errorMessage(application)).not.toMatch(/block/i);

    expect(await dbHelper.db.select().from(contactRequests)).toHaveLength(0);
    expect(await dbHelper.db.select().from(adoptionApplications)).toHaveLength(0);
  });

  it('serializes blockUser against a pending approval so the Block wins the race', async () => {
    const rescue = await insertPost(author.id, 'RESCUE');
    const requestId = (
      await runMutation<{ requestContact: { id: string } }>(
        REQUEST_CONTACT,
        { postId: rescue.id, message: 'Race fixture' },
        viewer,
      )
    ).data!.requestContact.id;

    const pairKey = canonicalAccountPairKey(viewer.id, author.id);
    const { rows } = await dbHelper.pool.query<{ classid: number; objid: number }>(
      `SELECT hashtext('account_pair')::int AS classid, hashtext($1)::int AS objid`,
      [pairKey],
    );
    const gate = await dbHelper.pool.connect();
    let committed = false;
    try {
      await gate.query('BEGIN');
      await gate.query(`SELECT pg_advisory_xact_lock(hashtext('account_pair'), hashtext($1))`, [pairKey]);

      // Both the Block and the approval queue behind the held pair lock.
      const blockCall = blockUser(viewer, author.id);
      await waitForUngrantedAdvisoryLock(rows[0].classid, rows[0].objid);
      const approvalCall = runMutation(APPROVE_CONTACT, { requestId }, author);
      await waitForUngrantedAdvisoryLock(rows[0].classid, rows[0].objid, 2);

      await gate.query('COMMIT');
      committed = true;

      const [blockResult, approvalResult] = await Promise.all([blockCall, approvalCall]);

      expect(blockResult.errors).toBeUndefined();
      expect(blockResult.data?.blockUser).toBe(true);

      const row = await contactRow(requestId);
      expect(row?.status).not.toBe('PENDING');
      if (approvalResult.errors) {
        expect(approvalResult.errors[0].message).toBe(`ContactRequest with id "${requestId}" was not found`);
        expect(row?.status).toBe('REJECTED');
      } else {
        // The approval committed first; the Block then hid the preserved approval.
        expect(row?.status).toBe('APPROVED');
      }

      // Once the Block is committed, disclosure and later approvals stay neutral
      // and never mention the Block.
      const disclosure = await runGql(GET_WHATSAPP, { requestId }, viewer);
      const disclosureMessage = errorMessage(disclosure);
      if (row?.status === 'APPROVED') {
        expect(disclosureMessage).toBe(`ContactRequest with id "${requestId}" was not found`);
      } else {
        expect(disclosureMessage).toBe('Contact request has not been approved yet');
      }
      expect(disclosureMessage).not.toMatch(/block/i);

      const lateApproval = await runMutation(APPROVE_CONTACT, { requestId }, author);
      expect(errorMessage(lateApproval)).toBe(`Request is already ${row?.status}`);
      expect(errorMessage(lateApproval)).not.toMatch(/block/i);
      expect((await contactRow(requestId))?.status).toBe(row?.status);
    } finally {
      if (!committed) await gate.query('ROLLBACK').catch(() => {});
      gate.release();
    }
  });

  // ─── Privacy and Reports ─────────────────────────────────────────────────

  it('Block and Unblock never create Reports, never notify the other party, and leak no direction', async () => {
    expect((await blockUser(viewer, author.id)).data?.blockUser).toBe(true);
    expect((await blockUser(viewer, author.id)).data?.blockUser).toBe(true);
    expect((await unblockUser(viewer, author.id)).data?.unblockUser).toBe(true);

    expect(await dbHelper.db.select().from(accountReports)).toHaveLength(0);
    expect(await dbHelper.db.select().from(postReports)).toHaveLength(0);
    expect(await dbHelper.db.select().from(notifications)).toHaveLength(0);
    expect(fireNotification).not.toHaveBeenCalled();

    // The blocked account cannot observe the relationship or its direction.
    expect((await blockedUsers(author)).edges).toHaveLength(0);
    const unblockByAuthor = await unblockUser(author, viewer.id);
    expect(unblockByAuthor.data?.unblockUser).toBe(true);
    expect(await dbHelper.db.select().from(blocks)).toHaveLength(0);
  });

  // ─── Blocked Accounts query ──────────────────────────────────────────────

  it('blockedUsers orders newest first, paginates with opaque cursors, and keeps a unique tie-breaker', async () => {
    const first = await insertUser('first');
    const second = await insertUser('second');
    const third = await insertUser('third');
    const fourth = await insertUser('fourth');

    const t1 = new Date('2026-02-01T10:00:00.000Z');
    const t2 = new Date('2026-02-02T10:00:00.000Z');
    const t3 = new Date('2026-02-03T10:00:00.000Z');
    await insertBlock(viewer.id, first.id, t1);
    await insertBlock(viewer.id, second.id, t2);
    // Two Blocks share one timestamp: the Block id is the unique tie-breaker.
    const tiedA = await insertBlock(viewer.id, third.id, t3);
    const tiedB = await insertBlock(viewer.id, fourth.id, t3);
    const tiedOrder = [tiedA.id, tiedB.id].sort().reverse();

    const page1 = await blockedUsers(viewer, 2);
    expect(page1.edges.map((edge) => edge.node.id)).toEqual([
      tiedOrder[0] === tiedA.id ? third.id : fourth.id,
      tiedOrder[0] === tiedA.id ? fourth.id : third.id,
    ]);
    expect(page1.pageInfo.hasNextPage).toBe(true);
    expect(page1.edges[0].blockedAt).toBe(t3.toISOString());
    expect(page1.edges[0].cursor).not.toContain(first.id);
    expect(Buffer.from(page1.edges[0].cursor, 'base64url').toString('utf8')).toContain('createdAt');

    const page2 = await blockedUsers(viewer, 2, page1.pageInfo.endCursor ?? undefined);
    expect(page2.edges.map((edge) => edge.node.id)).toEqual([second.id, first.id]);
    expect(page2.pageInfo.hasNextPage).toBe(false);
    expect(page2.edges.map((edge) => edge.blockedAt)).toEqual([t2.toISOString(), t1.toISOString()]);

    // Cursor continuation is stable and never repeats an edge.
    const allIds = [...page1.edges, ...page2.edges].map((edge) => edge.node.id);
    expect(new Set(allIds).size).toBe(allIds.length);

    const invalidCursor = await runGql(BLOCKED_USERS, { first: 2, after: 'not-a-cursor' }, viewer);
    expect(errorMessage(invalidCursor)).toBe('Invalid cursor format');

    // A well-formed cursor whose id is not a UUID must fail validation rather
    // than reaching the uuid comparison in SQL.
    const nonUuidIdCursor = Buffer.from(
      JSON.stringify({ createdAt: t1.toISOString(), id: 'not-a-uuid' }),
      'utf8',
    ).toString('base64url');
    const invalidIdCursor = await runGql(BLOCKED_USERS, { first: 2, after: nonUuidIdCursor }, viewer);
    expect(errorMessage(invalidIdCursor)).toBe('Invalid cursor format');
  });

  it('exposes only minimal display identity on every Blocked Accounts edge', async () => {
    const display = await insertUser('display', undefined, {
      fullName: 'Display Name',
      fullNameArabic: 'اسم العرض',
      profilePictureUrl: 'https://cdn.pupzy.net/avatar.png',
      isVerified: true,
    });
    expect((await blockUser(viewer, display.id)).data?.blockUser).toBe(true);

    const blockedUserType = executableSchema.getType('BlockedUser');
    expect(blockedUserType).toBeInstanceOf(GraphQLObjectType);
    expect(Object.keys((blockedUserType as GraphQLObjectType).getFields()).sort()).toEqual([
      'fullName',
      'fullNameArabic',
      'id',
      'isVerified',
      'profilePictureUrl',
    ]);

    const page = await blockedUsers(viewer);
    expect(page.edges).toHaveLength(1);
    expect(page.edges[0].node).toEqual({
      id: display.id,
      fullName: 'Display Name',
      fullNameArabic: 'اسم العرض',
      profilePictureUrl: 'https://cdn.pupzy.net/avatar.png',
      isVerified: true,
    });
    expect(Object.keys(page.edges[0].node)).not.toContain('phoneNumber');
    expect(Object.keys(page.edges[0].node)).not.toContain('city');
  });

  // ─── Unblock restoration ────────────────────────────────────────────────

  it('Unblock restores visibility and preserved engagement without reopening rejected records', async () => {
    const rescue = await insertPost(author.id, 'RESCUE');
    const adoption = await insertPost(author.id, 'ADOPTION');
    const authorComment = await insertComment({
      postId: rescue.id,
      authorId: author.id,
      text: 'Preserved discussion',
    });

    const requestId = (
      await runMutation<{ requestContact: { id: string } }>(
        REQUEST_CONTACT,
        { postId: rescue.id, message: 'Rejected then blocked' },
        viewer,
      )
    ).data!.requestContact.id;
    const applicationId = (
      await runMutation<{ submitAdoptionApplication: { id: string } }>(
        SUBMIT_APPLICATION,
        { input: { ...APPLICATION_INPUT, targetPostId: adoption.id } },
        viewer,
      )
    ).data!.submitAdoptionApplication.id;

    await runMutation(TOGGLE_UPVOTE, { postId: rescue.id }, viewer);

    // Block and Unblock must not notify the other party; the fixtures above did.
    fireNotification.mockClear();
    expect((await blockUser(viewer, author.id)).data?.blockUser).toBe(true);
    expect((await contactRow(requestId))?.status).toBe('REJECTED');
    expect((await applicationRow(applicationId))?.status).toBe('REJECTED');
    expect((await homeFeed(viewer)).edges.map((edge) => edge.node.id)).not.toContain(rescue.id);

    expect((await unblockUser(viewer, author.id)).data?.unblockUser).toBe(true);

    // Visibility, discussion, and preserved engagement return.
    expect(ids(await homeFeed(viewer))).toContain(rescue.id);
    const restored = await runGql<{ post: { isUpvotedByMe: boolean; upvoteCount: number } }>(
      POST_QUERY,
      { id: rescue.id },
      viewer,
    );
    expect(restored.errors).toBeUndefined();
    expect(restored.data!.post.isUpvotedByMe).toBe(true);
    expect(restored.data!.post.upvoteCount).toBe(1);

    const restoredComments = await runGql<{ comments: { edges: Array<{ node: { id: string } }> } }>(
      COMMENTS_QUERY,
      { postId: rescue.id, first: 10 },
      viewer,
    );
    expect(restoredComments.data!.comments.edges.map((edge) => edge.node.id)).toContain(authorComment.id);

    // Rejected records stay rejected and cannot be resubmitted for the same Post.
    expect((await contactRow(requestId))?.status).toBe('REJECTED');
    expect((await applicationRow(applicationId))?.status).toBe('REJECTED');

    const resubmitContact = await runMutation(REQUEST_CONTACT, { postId: rescue.id, message: 'Again please' }, viewer);
    expect(errorMessage(resubmitContact)).toBe('You have already sent a contact request for this post');
    const resubmitApplication = await runMutation(
      SUBMIT_APPLICATION,
      { input: { ...APPLICATION_INPUT, targetPostId: adoption.id } },
      viewer,
    );
    expect(errorMessage(resubmitApplication)).toBe('You have already submitted an application for this post');

    // No notification was produced by Block or Unblock.
    expect(fireNotification).not.toHaveBeenCalled();
  });

  // ─── Account Deletion ────────────────────────────────────────────────────

  it('Account Deletion cascades inbound and outbound Blocks and leaves unrelated relationships intact', async () => {
    const a = await insertUser('delete-a');
    const b = await insertUser('keep-b');
    const c = await insertUser('keep-c');
    const d = await insertUser('keep-d');

    await insertBlock(a.id, b.id);
    await insertBlock(b.id, a.id);
    await insertBlock(c.id, d.id);
    expect(await dbHelper.db.select().from(blocks)).toHaveLength(3);

    // The Pupzy Account deletion sweep removes the users row; both Block FKs cascade.
    await dbHelper.db.delete(users).where(eq(users.id, a.id));

    const remaining = await dbHelper.db.select().from(blocks);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].blockerId).toBe(c.id);
    expect(remaining[0].blockedId).toBe(d.id);
    expect(await blockRowsBetween(a.id, b.id)).toHaveLength(0);

    // Survivors keep their accounts and relationships.
    expect(await dbHelper.db.select().from(users).where(eq(users.id, b.id))).toHaveLength(1);
    const bPage = await blockedUsers(b);
    expect(bPage.edges).toHaveLength(0);
  });
});

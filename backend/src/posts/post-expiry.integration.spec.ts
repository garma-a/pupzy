import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { and, eq, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import DataLoader from 'dataloader';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  adoptionApplications,
  adoptionPosts,
  blocks,
  cities,
  contactRequests,
  notifications,
  postMedia,
  posts,
  productPosts,
  users,
  type City,
  type ContactRequest,
  type Post,
  type User,
} from '../database/schema';
import { encryptString } from '../common/utils/crypto.util';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';
import { PostsResolver } from './posts.resolver';
import { PostExpiryProcessor, POST_EXPIRY_CANDIDATE_BATCH_SIZE } from './post-expiry.processor';
import { ViewFlushCron } from './view-flush.cron';
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
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import { NotificationsService } from '../notifications/notifications.service';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import type { GqlContext } from '../common/types/gql-context.type';

type PostType = 'RESCUE' | 'LOST' | 'ADOPTION' | 'PRODUCT' | 'MATING';

const PHONE_KEY = 'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=';
const DAY_MINUTES = 24 * 60;

const RENEW_POST = `mutation RenewPost($postId: ID!) {
  renewPost(postId: $postId) { id status postType }
}`;

const UPDATE_POST_STATUS = `mutation UpdatePostStatus($postId: ID!, $status: PostStatus!) {
  updatePostStatus(postId: $postId, status: $status) { id status }
}`;

const POST_DETAIL = `query Post($id: ID!) {
  post(id: $id) { id status postType viewCount media { id } }
}`;

const MARKET_FEED = `query Market($cityId: ID) {
  marketFeed(cityId: $cityId, first: 20) { edges { node { id status } } }
}`;

const ADOPT_FEED = `query Adopt($cityId: ID) {
  adoptFeed(cityId: $cityId, first: 20) { edges { node { id status } } }
}`;

const HOME_FEED = `query Home($cityId: ID) {
  homeFeed(cityId: $cityId, first: 20) { edges { node { id status } } }
}`;

const MY_POSTS = `query Mine($postType: PostType!) {
  myPosts(postType: $postType, first: 20) { edges { node { id status postType } } }
}`;

const PRODUCT_DETAIL = `query ProductDetail($postId: ID!) {
  productPostDetail(postId: $postId) { postId category condition isFree }
}`;

const ADOPTION_DETAIL = `query AdoptionDetail($postId: ID!) {
  adoptionPostDetail(postId: $postId) { postId petName }
}`;

const TOGGLE_UPVOTE = `mutation ToggleUpvote($postId: ID!) {
  toggleUpvote(postId: $postId) { id status }
}`;

const CREATE_COMMENT = `mutation CreateComment($input: CreateCommentInput!) {
  createComment(input: $input) { id postId text }
}`;

const COMMENTS = `query Comments($postId: ID!) {
  comments(postId: $postId, first: 20) { edges { node { id text status } } }
}`;

const REQUEST_CONTACT = `mutation RequestContact($postId: ID!, $message: String!) {
  requestContact(postId: $postId, message: $message) { id status }
}`;

const APPROVE_CONTACT = `mutation ApproveContact($requestId: ID!) {
  approveContactRequest(requestId: $requestId) { id status }
}`;

const PRODUCT_SELLER_CONTACT = `query SellerContact($postId: ID!) {
  getProductSellerContact(postId: $postId)
}`;

const SUBMIT_APPLICATION = `mutation SubmitApplication($input: SubmitAdoptionApplicationInput!) {
  submitAdoptionApplication(input: $input) { id status }
}`;

const APPROVE_APPLICATION = `mutation ApproveApplication($applicationId: ID!) {
  approveAdoptionApplication(applicationId: $applicationId) { id status }
}`;

const ADOPTION_WHATSAPP_LINK = `query AdoptionWhatsAppLink($applicationId: ID!) {
  getAdoptionWhatsAppLink(applicationId: $applicationId)
}`;

const RECORD_VIEW = `mutation RecordView($postId: ID!) {
  recordView(postId: $postId)
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
  viewCount?: number;
  media?: Array<{ id: string }>;
}

interface PostConnectionData {
  edges: Array<{ node: PostNode }>;
}

interface StatusMutationData {
  updatePostStatus: PostNode;
  renewPost: PostNode;
}

interface CommentNode {
  id: string;
  postId: string;
  text: string;
  status: string;
}

interface CommentConnectionData {
  edges: Array<{ node: CommentNode }>;
}

describe('Post inactivity expiry, reminders and renewal (Tickets 12–13)', () => {
  jest.setTimeout(240_000);

  let dbHelper: TestDatabaseHelper;
  let executableSchema: GraphQLSchema;
  let postsRepository: PostsRepository;
  let postsService: PostsService;
  let postsResolver: PostsResolver;
  let commentsResolver: CommentsResolver;
  let contactsResolver: ContactsResolver;
  let adoptionsResolver: AdoptionsResolver;
  let processor: PostExpiryProcessor;
  let viewFlushCron: ViewFlushCron;
  let fireNotification: jest.Mock;

  let testCity: City;
  let owner: User;
  let requester: User;
  let other: User;

  let postSequence = 0;

  function nextPostId(): string {
    postSequence += 1;
    return `0192f4c0-0000-7000-8000-${String(postSequence).padStart(12, '0')}`;
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

    postsRepository = new PostsRepository(dbHelper.db);
    const commentsRepository = new CommentsRepository(dbHelper.db);
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

    const isolationPolicy = new AccountIsolationPolicy(dbHelper.db);
    fireNotification = jest.fn().mockResolvedValue(undefined);
    const notificationsService = { fireNotification } as unknown as NotificationsService;

    viewFlushCron = new ViewFlushCron(postsRepository);
    postsService = new PostsService(
      postsRepository,
      citiesService,
      {} as never,
      viewFlushCron,
      usersService,
      notificationsService,
      mockCache,
    );
    const commentsService = new CommentsService(
      commentsRepository,
      postsRepository,
      {} as never,
      mockConfig,
      undefined,
      undefined,
      undefined,
      isolationPolicy,
    );
    const contactsService = new ContactsService(
      contactsRepository,
      postsRepository,
      usersService,
      notificationsService,
      dbHelper.db,
      isolationPolicy,
    );
    const adoptionsService = new AdoptionsService(
      adoptionsRepository,
      postsRepository,
      usersService,
      notificationsService,
      dbHelper.db,
      isolationPolicy,
    );

    postsResolver = new PostsResolver(postsService);
    commentsResolver = new CommentsResolver(commentsService);
    contactsResolver = new ContactsResolver(contactsService);
    adoptionsResolver = new AdoptionsResolver(adoptionsService);

    processor = new PostExpiryProcessor(postsRepository, dbHelper.db);

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
          marketFeed: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) =>
            postsResolver.marketFeed(args, ctx),
          adoptFeed: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) =>
            postsResolver.adoptFeed(args, ctx),
          homeFeed: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) =>
            postsResolver.homeFeed(args, ctx),
          myPosts: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) => postsResolver.myPosts(args, ctx),
          productPostDetail: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.productPostDetail(args.postId, ctx),
          adoptionPostDetail: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.adoptionPostDetail(args.postId, ctx),
          getAdoptionWhatsAppLink: (_root: unknown, args: { applicationId: string }, ctx: GqlContext) =>
            adoptionsResolver.getAdoptionWhatsAppLink(args.applicationId, ctx),
          comments: (
            _root: unknown,
            args: { postId: string; sort?: string; first?: number; after?: string },
            ctx: GqlContext,
          ) => commentsResolver.comments(args.postId, args.sort, args.first, args.after, ctx),
          getProductSellerContact: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            contactsResolver.getProductSellerContact(args.postId, ctx),
        },
        Mutation: {
          renewPost: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.renewPost(args.postId, ctx),
          updatePostStatus: (_root: unknown, args: { postId: string; status: string }, ctx: GqlContext) =>
            postsResolver.updatePostStatus(args.postId, args.status, ctx),
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
          toggleUpvote: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.toggleUpvote(args.postId, ctx),
          recordView: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.recordView(args.postId, ctx),
        },
        Post: {
          media: (root: Post) => postsRepository.findMediaByPostIds([root.id]).then((rows) => rows[0]),
        },
        ContactRequest: {
          requester: (root: ContactRequest, _args: unknown, ctx: GqlContext) => contactsResolver.requester(root, ctx),
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

    owner = await insertUser('owner', '+201000000001');
    requester = await insertUser('requester');
    other = await insertUser('other');
  });

  async function insertUser(label: string, phone?: string): Promise<User> {
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${label}-${generateUuidV7()}`,
        email: `${label}-${generateUuidV7()}@pupzy.dev`,
        fullName: `Expiry ${label}`,
        phoneNumber: phone ? encryptString(phone, PHONE_KEY) : null,
      })
      .returning();
    return user;
  }

  function inactiveTimestamp(inactiveMinutes: number) {
    return sql`now() - make_interval(mins => ${inactiveMinutes}::int)`;
  }

  async function seedPost(params: {
    postType: PostType;
    status?: Post['status'];
    creatorId?: string;
    inactiveMinutes?: number;
    title?: string;
  }): Promise<Post> {
    const isUrgencyType = params.postType === 'RESCUE' || params.postType === 'LOST';
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        id: nextPostId(),
        creatorId: params.creatorId ?? owner.id,
        postType: params.postType,
        title: params.title ?? `Expiry ${params.postType} ${generateUuidV7().slice(-4)}`,
        description: 'Inactivity fixture',
        status: params.status ?? 'ACTIVE',
        moderationStatus: 'CLEAN',
        urgency: isUrgencyType ? 'URGENT' : undefined,
        cityId: testCity.id,
        governorate: testCity.governorate,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
        effectiveScore: 0,
        ...(params.inactiveMinutes != null ? { lastEngagedAt: inactiveTimestamp(params.inactiveMinutes) } : {}),
      })
      .returning();
    return post;
  }

  async function seedProduct(params: {
    status?: Post['status'];
    creatorId?: string;
    inactiveMinutes?: number;
    title?: string;
    withMedia?: boolean;
  }): Promise<Post> {
    const post = await seedPost({
      postType: 'PRODUCT',
      status: params.status,
      creatorId: params.creatorId,
      inactiveMinutes: params.inactiveMinutes,
      title: params.title,
    });
    await dbHelper.db.insert(productPosts).values({
      postId: post.id,
      category: 'FOOD',
      condition: 'NEW',
      isFree: true,
      openToOffers: false,
    });
    if (params.withMedia) {
      await dbHelper.db.insert(postMedia).values({
        postId: post.id,
        publicUrl: `https://cdn.pupzy.net/posts/${post.id}/main.webp`,
        cloudflareStorageKey: `posts/${post.id}/main.webp`,
        displayOrder: 0,
      });
    }
    return post;
  }

  async function seedAdoption(params: {
    status?: Post['status'];
    creatorId?: string;
    inactiveMinutes?: number;
    title?: string;
    withMedia?: boolean;
  }): Promise<Post> {
    const post = await seedPost({
      postType: 'ADOPTION',
      status: params.status,
      creatorId: params.creatorId,
      inactiveMinutes: params.inactiveMinutes,
      title: params.title,
    });
    await dbHelper.db.insert(adoptionPosts).values({
      postId: post.id,
      petName: 'Luna',
      species: 'CAT',
      gender: 'FEMALE',
      vaccinated: true,
      neutered: true,
      priorPetExperienceRequired: false,
      personalityTags: [],
    });
    if (params.withMedia) {
      await dbHelper.db.insert(postMedia).values({
        postId: post.id,
        publicUrl: `https://cdn.pupzy.net/posts/${post.id}/main.webp`,
        cloudflareStorageKey: `posts/${post.id}/main.webp`,
        displayOrder: 0,
      });
    }
    return post;
  }

  function createContext(user: User): GqlContext {
    const userLoader = new DataLoader<string, User | null>(async (ids: readonly string[]) => {
      const rows = await dbHelper.db.select().from(users).where(eq(users.id, ids[0]));
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

  async function storedPost(postId: string): Promise<Post | undefined> {
    const [row] = await dbHelper.db.select().from(posts).where(eq(posts.id, postId));
    return row;
  }

  async function nudgeNotifications(recipientId = owner.id) {
    return dbHelper.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.recipientId, recipientId), eq(notifications.type, 'POST_INACTIVITY_NUDGE')));
  }

  async function feedIds(source: string, user: User): Promise<string[]> {
    const result = await runGql<Record<string, PostConnectionData>>(source, { cityId: testCity.id }, user);
    expect(result.errors).toBeUndefined();
    const field = source.includes('marketFeed')
      ? 'marketFeed'
      : source.includes('adoptFeed')
        ? 'adoptFeed'
        : 'homeFeed';
    return result.data![field].edges.map((edge) => edge.node.id);
  }

  async function renewPost(post: Post, user: User = owner) {
    return runGql<{ renewPost: PostNode }>(RENEW_POST, { postId: post.id }, user);
  }

  async function commentOnPost(post: Post, user: User = other): Promise<CommentNode> {
    const result = await runGql<{ createComment: CommentNode }>(
      CREATE_COMMENT,
      { input: { clientRequestId: generateUuidV7(), postId: post.id, text: 'Any update on this listing?' } },
      user,
    );
    expect(result.errors).toBeUndefined();
    return result.data!.createComment;
  }

  // ─── Expiry window ──────────────────────────────────────────────────────

  describe('PRODUCT inactivity window', () => {
    it('expires at 14 inactive days: leaves discovery but keeps direct detail, media, discussion and owner history', async () => {
      const post = await seedProduct({ inactiveMinutes: 14 * DAY_MINUTES + 60, withMedia: true });
      const comment = await commentOnPost(post);

      expect(await feedIds(MARKET_FEED, other)).toContain(post.id);
      expect(await feedIds(HOME_FEED, other)).toContain(post.id);

      const result = await processor.processPendingExpiry();
      expect(result.expired).toBe(1);

      const stored = await storedPost(post.id);
      expect(stored?.status).toBe('EXPIRED');
      expect(stored?.reminderSentAt).toBeNull();

      // Discovery excludes the expired listing; the other feed queries do too.
      expect(await feedIds(MARKET_FEED, other)).not.toContain(post.id);
      expect(await feedIds(HOME_FEED, other)).not.toContain(post.id);

      // Direct detail and discussion remain readable with the expired status.
      const detail = await runGql<{ post: PostNode }>(POST_DETAIL, { id: post.id }, other);
      expect(detail.errors).toBeUndefined();
      expect(detail.data?.post).toMatchObject({ id: post.id, status: 'EXPIRED' });
      expect(detail.data?.post.media).toHaveLength(1);

      const productDetail = await runGql(PRODUCT_DETAIL, { postId: post.id }, other);
      expect(productDetail.errors).toBeUndefined();

      const discussion = await runGql<{ comments: CommentConnectionData }>(COMMENTS, { postId: post.id }, other);
      expect(discussion.errors).toBeUndefined();
      expect(discussion.data?.comments.edges).toHaveLength(1);
      expect(comment.text).toBe('Any update on this listing?');

      // Owner history keeps the listing.
      const mine = await runGql<{ myPosts: PostConnectionData }>(MY_POSTS, { postType: 'PRODUCT' }, owner);
      expect(mine.errors).toBeUndefined();
      expect(mine.data?.myPosts.edges.map((edge) => edge.node.status)).toContain('EXPIRED');

      // Expiry is not removal: it does not change the owner's Post counters.
      const [ownerRow] = await dbHelper.db.select().from(users).where(eq(users.id, owner.id));
      expect(ownerRow.productPostCount).toBe(1);
    });

    it('does not expire a listing still inside the 14-day window', async () => {
      const post = await seedProduct({ inactiveMinutes: 14 * DAY_MINUTES - 60 });

      const result = await processor.processPendingExpiry();

      expect(result.expired).toBe(0);
      expect((await storedPost(post.id))?.status).toBe('ACTIVE');
      expect(await feedIds(MARKET_FEED, other)).toContain(post.id);
    });

    it('never expires RESCUE, LOST or MATING listings, however old', async () => {
      const rescue = await seedPost({ postType: 'RESCUE', inactiveMinutes: 400 * DAY_MINUTES });
      const lost = await seedPost({ postType: 'LOST', inactiveMinutes: 400 * DAY_MINUTES });
      const mating = await seedPost({ postType: 'MATING', inactiveMinutes: 400 * DAY_MINUTES });

      const result = await processor.processPendingExpiry();

      expect(result).toEqual({ expired: 0, reminded: 0 });
      for (const post of [rescue, lost, mating]) {
        expect((await storedPost(post.id))?.status).toBe('ACTIVE');
        expect((await storedPost(post.id))?.reminderSentAt).toBeNull();
      }
      expect(await nudgeNotifications()).toHaveLength(0);
    });
  });

  // ─── Adoption window ────────────────────────────────────────────────────

  describe('ADOPTION inactivity window', () => {
    it('expires at 30 inactive days: leaves adoption discovery but keeps direct detail, media, discussion and owner history', async () => {
      const post = await seedAdoption({ inactiveMinutes: 30 * DAY_MINUTES + 60, withMedia: true });
      await commentOnPost(post);

      expect(await feedIds(ADOPT_FEED, other)).toContain(post.id);
      expect(await feedIds(HOME_FEED, other)).toContain(post.id);

      const result = await processor.processPendingExpiry();
      expect(result).toEqual({ expired: 1, reminded: 0 });

      const stored = await storedPost(post.id);
      expect(stored?.status).toBe('EXPIRED');
      // Past the reminder window, so the expiry never sends a late nudge.
      expect(stored?.reminderSentAt).toBeNull();
      expect(await nudgeNotifications()).toHaveLength(0);

      // Discovery excludes the expired adoption listing.
      expect(await feedIds(ADOPT_FEED, other)).not.toContain(post.id);
      expect(await feedIds(HOME_FEED, other)).not.toContain(post.id);

      // Direct detail, adoption detail and discussion remain readable.
      const detail = await runGql<{ post: PostNode }>(POST_DETAIL, { id: post.id }, other);
      expect(detail.errors).toBeUndefined();
      expect(detail.data?.post).toMatchObject({ id: post.id, status: 'EXPIRED' });
      expect(detail.data?.post.media).toHaveLength(1);

      const adoptionDetail = await runGql<{ adoptionPostDetail: { postId: string; petName: string } }>(
        ADOPTION_DETAIL,
        { postId: post.id },
        other,
      );
      expect(adoptionDetail.errors).toBeUndefined();
      expect(adoptionDetail.data?.adoptionPostDetail).toMatchObject({ postId: post.id, petName: 'Luna' });

      const discussion = await runGql<{ comments: CommentConnectionData }>(COMMENTS, { postId: post.id }, other);
      expect(discussion.errors).toBeUndefined();
      expect(discussion.data?.comments.edges).toHaveLength(1);

      // Owner history keeps the listing and the owner's counters are unchanged.
      const mine = await runGql<{ myPosts: PostConnectionData }>(MY_POSTS, { postType: 'ADOPTION' }, owner);
      expect(mine.errors).toBeUndefined();
      expect(mine.data?.myPosts.edges.map((edge) => edge.node.status)).toContain('EXPIRED');

      const [ownerRow] = await dbHelper.db.select().from(users).where(eq(users.id, owner.id));
      expect(ownerRow.adoptionPostCount).toBe(1);
    });

    it('does not expire an adoption listing still inside the 30-day window', async () => {
      const post = await seedAdoption({ inactiveMinutes: 30 * DAY_MINUTES - 60 });

      const result = await processor.processPendingExpiry();

      expect(result.expired).toBe(0);
      expect((await storedPost(post.id))?.status).toBe('ACTIVE');
      expect(await feedIds(ADOPT_FEED, other)).toContain(post.id);
    });

    it('reminds the ADOPTION owner once at 27 inactive days with bilingual content', async () => {
      const post = await seedAdoption({ inactiveMinutes: 27 * DAY_MINUTES + 1 });

      const result = await processor.processPendingExpiry();
      expect(result.reminded).toBe(1);

      const rows = await nudgeNotifications();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ recipientId: owner.id, relatedPostId: post.id, isRead: false });
      expect(rows[0].body).toContain(post.title);
      expect(rows[0].titleArabic).toBeTruthy();
      expect(rows[0].bodyArabic).toBeTruthy();
      expect((await storedPost(post.id))?.status).toBe('ACTIVE');
      expect((await storedPost(post.id))?.reminderSentAt).not.toBeNull();

      // Repeated runs never duplicate the same cycle's reminder.
      const repeated = await processor.processPendingExpiry();
      expect(repeated.reminded).toBe(0);
      expect(await nudgeNotifications()).toHaveLength(1);
    });

    it('does not remind before the 27-day mark', async () => {
      await seedAdoption({ inactiveMinutes: 27 * DAY_MINUTES - 60 });

      const result = await processor.processPendingExpiry();

      expect(result).toEqual({ expired: 0, reminded: 0 });
      expect(await nudgeNotifications()).toHaveLength(0);
    });

    it('lets new activity reset the adoption inactivity window', async () => {
      const post = await seedAdoption({ inactiveMinutes: 29 * DAY_MINUTES });

      // Upvote is an ADOPTION activity signal, so the window restarts now.
      const upvote = await runGql(TOGGLE_UPVOTE, { postId: post.id }, other);
      expect(upvote.errors).toBeUndefined();

      const result = await processor.processPendingExpiry();

      expect(result).toEqual({ expired: 0, reminded: 0 });
      const stored = (await storedPost(post.id))!;
      expect(stored.status).toBe('ACTIVE');
      expect(Date.now() - stored.lastEngagedAt.getTime()).toBeLessThan(60_000);
    });
  });

  // ─── Reminder ───────────────────────────────────────────────────────────

  describe('owner inactivity reminder', () => {
    it('reminds the PRODUCT owner once at 11 inactive days with bilingual content', async () => {
      const post = await seedProduct({ inactiveMinutes: 11 * DAY_MINUTES + 1 });

      const result = await processor.processPendingExpiry();
      expect(result.reminded).toBe(1);

      const rows = await nudgeNotifications();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ recipientId: owner.id, relatedPostId: post.id, isRead: false });
      expect(rows[0].title).toBe('Is your post still active?');
      expect(rows[0].body).toContain(post.title);
      expect(rows[0].titleArabic).toBeTruthy();
      expect(rows[0].bodyArabic).toBeTruthy();

      const stored = await storedPost(post.id);
      expect(stored?.status).toBe('ACTIVE');
      expect(stored?.reminderSentAt).not.toBeNull();

      // Repeated runs never duplicate the same cycle's reminder.
      const repeated = await processor.processPendingExpiry();
      expect(repeated.reminded).toBe(0);
      expect(await nudgeNotifications()).toHaveLength(1);
    });

    it('does not remind before the 11-day mark', async () => {
      await seedProduct({ inactiveMinutes: 11 * DAY_MINUTES - 60 });

      const result = await processor.processPendingExpiry();

      expect(result.reminded).toBe(0);
      expect(await nudgeNotifications()).toHaveLength(0);
    });

    it('lets concurrent workers race one candidate without duplicating the reminder', async () => {
      const post = await seedProduct({ inactiveMinutes: 11 * DAY_MINUTES + 5 });
      const secondWorker = new PostExpiryProcessor(postsRepository, dbHelper.db);

      const [first, second] = await Promise.all([
        processor.processPendingExpiry(),
        secondWorker.processPendingExpiry(),
      ]);

      expect(first.reminded + second.reminded).toBe(1);
      expect(await nudgeNotifications()).toHaveLength(1);
      expect((await storedPost(post.id))?.reminderSentAt).not.toBeNull();
    });

    it('lets concurrent workers race one expiry candidate with exactly one committed expiry', async () => {
      const post = await seedProduct({ inactiveMinutes: 20 * DAY_MINUTES });
      const secondWorker = new PostExpiryProcessor(postsRepository, dbHelper.db);

      const [first, second] = await Promise.all([
        processor.processPendingExpiry(),
        secondWorker.processPendingExpiry(),
      ]);

      expect(first.expired + second.expired).toBe(1);
      expect((await storedPost(post.id))?.status).toBe('EXPIRED');
    });

    it('starts a new reminder cycle only after new activity', async () => {
      const post = await seedProduct({ inactiveMinutes: 11 * DAY_MINUTES + 5 });
      await processor.processPendingExpiry();
      expect(await nudgeNotifications()).toHaveLength(1);

      // New activity happened after the first reminder; that activity is now
      // itself 11 days old, so a new inactivity cycle is due.
      await dbHelper.db
        .update(posts)
        .set({
          lastEngagedAt: inactiveTimestamp(11 * DAY_MINUTES + 5),
          reminderSentAt: inactiveTimestamp(20 * DAY_MINUTES),
        })
        .where(eq(posts.id, post.id));
      const secondRun = await processor.processPendingExpiry();

      expect(secondRun.reminded).toBe(1);
      expect(await nudgeNotifications()).toHaveLength(2);
    });

    it('expires a stale Post instead of reminding it', async () => {
      const post = await seedProduct({ inactiveMinutes: 20 * DAY_MINUTES });

      const result = await processor.processPendingExpiry();

      expect(result).toEqual({ expired: 1, reminded: 0 });
      expect((await storedPost(post.id))?.status).toBe('EXPIRED');
      expect(await nudgeNotifications()).toHaveLength(0);
    });
  });

  // ─── Renewal ────────────────────────────────────────────────────────────

  describe('explicit owner renewal', () => {
    it('renews an expired PRODUCT listing back into discovery while retaining media and discussion', async () => {
      const post = await seedProduct({ inactiveMinutes: 15 * DAY_MINUTES, withMedia: true });
      await commentOnPost(post);
      expect((await processor.processPendingExpiry()).expired).toBe(1);
      expect((await storedPost(post.id))?.status).toBe('EXPIRED');
      const expiredAt = (await storedPost(post.id))!.lastEngagedAt;

      const result = await renewPost(post);
      expect(result.errors).toBeUndefined();
      expect(result.data?.renewPost).toMatchObject({ id: post.id, status: 'ACTIVE' });

      const stored = (await storedPost(post.id))!;
      expect(stored.status).toBe('ACTIVE');
      expect(stored.renewedAt).not.toBeNull();
      expect(stored.lastEngagedAt.getTime()).toBeGreaterThan(expiredAt.getTime());

      expect(await feedIds(MARKET_FEED, other)).toContain(post.id);
      expect(await dbHelper.db.select().from(postMedia).where(eq(postMedia.postId, post.id))).toHaveLength(1);
      const discussion = await runGql<{ comments: CommentConnectionData }>(COMMENTS, { postId: post.id }, other);
      expect(discussion.data?.comments.edges).toHaveLength(1);
    });

    it('resets the inactivity window of an ACTIVE listing without closing it', async () => {
      const post = await seedProduct({ inactiveMinutes: 10 * DAY_MINUTES });

      const result = await renewPost(post);
      expect(result.errors).toBeUndefined();

      const stored = (await storedPost(post.id))!;
      expect(stored.status).toBe('ACTIVE');
      expect(Date.now() - stored.lastEngagedAt.getTime()).toBeLessThan(60_000);
    });

    it('rejects renewal by anyone but the owner and denies missing or removed listings', async () => {
      const post = await seedProduct({ inactiveMinutes: 15 * DAY_MINUTES });
      await processor.processPendingExpiry();

      const foreign = await renewPost(post, other);
      expect(errorCode(foreign)).toBe('FORBIDDEN');
      expect((await storedPost(post.id))?.status).toBe('EXPIRED');

      const missing = await runGql(RENEW_POST, { postId: '0192ffff-0000-7000-8000-000000000000' }, owner);
      expect(errorCode(missing)).toBe('NOT_FOUND');

      const [removedPost] = await dbHelper.db
        .update(posts)
        .set({ status: 'REMOVED' })
        .where(eq(posts.id, post.id))
        .returning();
      expect(removedPost.status).toBe('REMOVED');
      const removed = await renewPost(removedPost);
      expect(errorCode(removed)).toBe('NOT_FOUND');
      expect((await storedPost(post.id))?.status).toBe('REMOVED');
    });

    it('rejects completed and non-renewable listings', async () => {
      const sold = await seedProduct({ status: 'SOLD', inactiveMinutes: 15 * DAY_MINUTES });
      const soldResult = await renewPost(sold);
      expect(errorCode(soldResult)).toBe('VALIDATION_ERROR');
      expect(soldResult.errors?.[0].message).toContain('cannot be renewed');
      expect((await storedPost(sold.id))?.status).toBe('SOLD');

      const adoption = await seedAdoption({ status: 'ADOPTED', inactiveMinutes: 40 * DAY_MINUTES });
      const adoptionResult = await renewPost(adoption);
      expect(errorCode(adoptionResult)).toBe('VALIDATION_ERROR');
      expect((await storedPost(adoption.id))?.status).toBe('ADOPTED');

      const rescue = await seedPost({ postType: 'RESCUE', inactiveMinutes: 90 * DAY_MINUTES });
      expect(errorCode(await renewPost(rescue))).toBe('VALIDATION_ERROR');

      const mating = await seedPost({ postType: 'MATING', inactiveMinutes: 90 * DAY_MINUTES });
      expect(errorCode(await renewPost(mating))).toBe('VALIDATION_ERROR');
    });

    it('enforces the seven-day cooldown and allows the next renewal after it lapses', async () => {
      const post = await seedProduct({ inactiveMinutes: 15 * DAY_MINUTES });
      await processor.processPendingExpiry();

      expect((await renewPost(post)).errors).toBeUndefined();

      const immediate = await renewPost(post);
      expect(errorCode(immediate)).toBe('RENEWAL_COOLDOWN');
      expect((await storedPost(post.id))?.status).toBe('ACTIVE');

      await dbHelper.db
        .update(posts)
        .set({ renewedAt: sql`now() - make_interval(days => 8::int)` })
        .where(eq(posts.id, post.id));

      const afterCooldown = await renewPost(post);
      expect(afterCooldown.errors).toBeUndefined();
      expect(afterCooldown.data?.renewPost.status).toBe('ACTIVE');
    });

    it('settles concurrent renewals with exactly one success', async () => {
      const post = await seedProduct({ inactiveMinutes: 15 * DAY_MINUTES });
      await processor.processPendingExpiry();

      const [first, second] = await Promise.all([renewPost(post), renewPost(post)]);
      const outcomes = [errorCode(first), errorCode(second)];

      expect(outcomes.filter((code) => code === undefined)).toHaveLength(1);
      expect(outcomes.filter((code) => code === 'RENEWAL_COOLDOWN')).toHaveLength(1);
      expect((await storedPost(post.id))?.status).toBe('ACTIVE');
      expect((await storedPost(post.id))?.renewedAt).not.toBeNull();
    });

    it('does not revive interactions terminated by expiry and retains approved contact', async () => {
      const post = await seedAdoption({ inactiveMinutes: 40 * DAY_MINUTES });
      const pendingRequest = await runGql<{ requestContact: { id: string } }>(
        REQUEST_CONTACT,
        { postId: post.id, message: 'Interested in adopting.' },
        requester,
      );
      expect(pendingRequest.errors).toBeUndefined();
      const approvedRequest = await runGql<{ requestContact: { id: string } }>(
        REQUEST_CONTACT,
        { postId: post.id, message: 'Also interested.' },
        other,
      );
      expect(approvedRequest.errors).toBeUndefined();
      const approval = await runGql(APPROVE_CONTACT, { requestId: approvedRequest.data!.requestContact.id }, owner);
      expect(approval.errors).toBeUndefined();
      const application = await runGql<{ submitAdoptionApplication: { id: string } }>(
        SUBMIT_APPLICATION,
        { input: { ...APPLICATION_INPUT, targetPostId: post.id } },
        other,
      );
      expect(application.errors).toBeUndefined();

      // Expiry terminates the still-pending interactions and preserves every row.
      const expired = await postsRepository.expireInactivePost(post.id, 'ADOPTION', 30);
      expect(expired?.status).toBe('EXPIRED');

      const [pendingRow] = await dbHelper.db
        .select()
        .from(contactRequests)
        .where(eq(contactRequests.id, pendingRequest.data!.requestContact.id));
      expect(pendingRow.status).toBe('REJECTED');
      expect(pendingRow.respondedAt).not.toBeNull();

      const [approvedRow] = await dbHelper.db
        .select()
        .from(contactRequests)
        .where(eq(contactRequests.id, approvedRequest.data!.requestContact.id));
      expect(approvedRow.status).toBe('APPROVED');
      expect(approvedRow.respondedAt).not.toBeNull();

      const [applicationRow] = await dbHelper.db
        .select()
        .from(adoptionApplications)
        .where(eq(adoptionApplications.id, application.data!.submitAdoptionApplication.id));
      expect(applicationRow.status).toBe('REJECTED');
      expect(applicationRow.respondedAt).not.toBeNull();

      expect(await dbHelper.db.select().from(contactRequests).where(eq(contactRequests.postId, post.id))).toHaveLength(
        2,
      );
      expect(
        await dbHelper.db.select().from(adoptionApplications).where(eq(adoptionApplications.targetPostId, post.id)),
      ).toHaveLength(1);
    });
  });

  // ─── Adoption renewal and cleanup ───────────────────────────────────────

  describe('ADOPTION renewal, application cleanup and races', () => {
    async function submitApplication(post: Post, user: User) {
      return runGql<{ submitAdoptionApplication: { id: string; status: string } }>(
        SUBMIT_APPLICATION,
        { input: { ...APPLICATION_INPUT, targetPostId: post.id } },
        user,
      );
    }

    async function applicationsOn(post: Post) {
      return dbHelper.db.select().from(adoptionApplications).where(eq(adoptionApplications.targetPostId, post.id));
    }

    it('renews an expired adoption listing back into discovery while retaining media and discussion', async () => {
      const post = await seedAdoption({ inactiveMinutes: 31 * DAY_MINUTES, withMedia: true });
      await commentOnPost(post);
      expect((await processor.processPendingExpiry()).expired).toBe(1);
      expect((await storedPost(post.id))?.status).toBe('EXPIRED');
      const expiredAt = (await storedPost(post.id))!.lastEngagedAt;

      const result = await renewPost(post);
      expect(result.errors).toBeUndefined();
      expect(result.data?.renewPost).toMatchObject({ id: post.id, status: 'ACTIVE' });

      const stored = (await storedPost(post.id))!;
      expect(stored.status).toBe('ACTIVE');
      expect(stored.renewedAt).not.toBeNull();
      expect(stored.lastEngagedAt.getTime()).toBeGreaterThan(expiredAt.getTime());

      expect(await feedIds(ADOPT_FEED, other)).toContain(post.id);
      expect(await dbHelper.db.select().from(postMedia).where(eq(postMedia.postId, post.id))).toHaveLength(1);
      const discussion = await runGql<{ comments: CommentConnectionData }>(COMMENTS, { postId: post.id }, other);
      expect(discussion.data?.comments.edges).toHaveLength(1);
    });

    it('does not let new engagement revive an expired adoption listing', async () => {
      const post = await seedAdoption({ inactiveMinutes: 31 * DAY_MINUTES });
      expect((await processor.processPendingExpiry()).expired).toBe(1);

      // Upvote is an activity signal, but only an explicit renewal reactivates.
      const upvote = await runGql(TOGGLE_UPVOTE, { postId: post.id }, other);
      expect(upvote.errors).toBeUndefined();

      expect((await storedPost(post.id))?.status).toBe('EXPIRED');
      expect(await feedIds(ADOPT_FEED, other)).not.toContain(post.id);
    });

    it('expires pending applications atomically, keeps them closed through renewal and preserves application uniqueness', async () => {
      const post = await seedAdoption({ inactiveMinutes: 31 * DAY_MINUTES });
      const application = await submitApplication(post, requester);
      expect(application.errors).toBeUndefined();
      expect(application.data?.submitAdoptionApplication.status).toBe('PENDING');

      // Expiry terminates the still-pending application in the same transaction.
      const result = await processor.processPendingExpiry();
      expect(result.expired).toBe(1);

      const [terminated] = await dbHelper.db
        .select()
        .from(adoptionApplications)
        .where(eq(adoptionApplications.id, application.data!.submitAdoptionApplication.id));
      expect(terminated.status).toBe('REJECTED');
      expect(terminated.respondedAt).not.toBeNull();

      // Renewal reactivates the listing but never revives the terminated application.
      expect((await renewPost(post)).errors).toBeUndefined();
      expect((await storedPost(post.id))?.status).toBe('ACTIVE');

      const [afterRenewal] = await dbHelper.db
        .select()
        .from(adoptionApplications)
        .where(eq(adoptionApplications.id, terminated.id));
      expect(afterRenewal.status).toBe('REJECTED');
      expect(afterRenewal.respondedAt?.getTime()).toBe(terminated.respondedAt?.getTime());

      // Existing uniqueness rules still reject the same applicant...
      const reapply = await submitApplication(post, requester);
      expect(errorCode(reapply)).toBe('CONFLICT');
      expect((await applicationsOn(post)).filter((row) => row.status === 'PENDING')).toHaveLength(0);

      // ...while a fresh applicant can still apply to the renewed listing.
      const fresh = await submitApplication(post, other);
      expect(fresh.errors).toBeUndefined();
      expect(fresh.data?.submitAdoptionApplication.status).toBe('PENDING');
      expect((await applicationsOn(post)).filter((row) => row.status === 'PENDING')).toHaveLength(1);
    });

    it('keeps approved adoption contact retrievable through expiry and renewal while denying unapproved and Blocked callers', async () => {
      const post = await seedAdoption({ inactiveMinutes: 31 * DAY_MINUTES });
      const application = await submitApplication(post, requester);
      expect(application.errors).toBeUndefined();
      const applicationId = application.data!.submitAdoptionApplication.id;

      const approval = await runGql<{ approveAdoptionApplication: { id: string; status: string } }>(
        APPROVE_APPLICATION,
        { applicationId },
        owner,
      );
      expect(approval.errors).toBeUndefined();
      expect(approval.data?.approveAdoptionApplication.status).toBe('APPROVED');

      const unapproved = await runGql(ADOPTION_WHATSAPP_LINK, { applicationId }, other);
      expect(errorCode(unapproved)).toBe('FORBIDDEN');

      expect((await processor.processPendingExpiry()).expired).toBe(1);
      const expiredLink = await runGql<{ getAdoptionWhatsAppLink: string }>(
        ADOPTION_WHATSAPP_LINK,
        { applicationId },
        requester,
      );
      expect(expiredLink.errors).toBeUndefined();
      expect(expiredLink.data?.getAdoptionWhatsAppLink).toContain('wa.me');

      expect((await renewPost(post)).errors).toBeUndefined();
      const renewedLink = await runGql<{ getAdoptionWhatsAppLink: string }>(
        ADOPTION_WHATSAPP_LINK,
        { applicationId },
        requester,
      );
      expect(renewedLink.errors).toBeUndefined();
      expect(renewedLink.data?.getAdoptionWhatsAppLink).toContain('wa.me');

      // The established Block restriction still applies after renewal.
      await dbHelper.db.insert(blocks).values({ blockerId: owner.id, blockedId: requester.id });
      const blockedLink = await runGql(ADOPTION_WHATSAPP_LINK, { applicationId }, requester);
      expect(errorCode(blockedLink)).toBe('NOT_FOUND');
    });

    it('never leaves a pending application on an expired adoption listing when an application races expiry', async () => {
      const post = await seedAdoption({ inactiveMinutes: 31 * DAY_MINUTES });

      const [expiryResult, application] = await Promise.all([
        processor.processPendingExpiry(),
        submitApplication(post, requester),
      ]);

      expect(expiryResult.expired).toBe(1);
      expect((await storedPost(post.id))?.status).toBe('EXPIRED');

      const rows = await applicationsOn(post);
      expect(rows.filter((row) => row.status === 'PENDING')).toHaveLength(0);
      if (application.errors) {
        // Expiry committed first, so the application was rejected as inactive.
        expect(errorCode(application)).toBe('VALIDATION_ERROR');
        expect(rows).toHaveLength(0);
      } else {
        // The application committed first and expiry terminated it atomically.
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('REJECTED');
        expect(rows[0].respondedAt).not.toBeNull();
      }
    });

    it('lets a renewal and a concurrent application settle in one serial order', async () => {
      const post = await seedAdoption({ inactiveMinutes: 31 * DAY_MINUTES });
      expect((await processor.processPendingExpiry()).expired).toBe(1);
      expect((await storedPost(post.id))?.status).toBe('EXPIRED');

      const [renewal, application] = await Promise.all([renewPost(post), submitApplication(post, requester)]);

      expect(renewal.errors).toBeUndefined();
      expect((await storedPost(post.id))?.status).toBe('ACTIVE');

      const pending = (await applicationsOn(post)).filter((row) => row.status === 'PENDING');
      if (application.errors) {
        expect(errorCode(application)).toBe('VALIDATION_ERROR');
        expect(pending).toHaveLength(0);
      } else {
        expect(pending).toHaveLength(1);
      }
    });

    it('never lets concurrent expiry defeat an adoption renewal', async () => {
      const post = await seedAdoption({ inactiveMinutes: 31 * DAY_MINUTES });

      const [renewal, expiryResult] = await Promise.all([renewPost(post), processor.processPendingExpiry()]);

      expect(renewal.errors).toBeUndefined();
      expect(expiryResult.expired).toBeLessThanOrEqual(1);
      const stored = (await storedPost(post.id))!;
      expect(stored.status).toBe('ACTIVE');
      expect(stored.renewedAt).not.toBeNull();
    });
  });

  // ─── Interactions and revival ───────────────────────────────────────────

  describe('expired listings reject new interactions', () => {
    it('rejects contact requests, applications and direct seller contact on expired listings', async () => {
      const product = await seedProduct({ status: 'EXPIRED', inactiveMinutes: 20 * DAY_MINUTES });
      const adoption = await seedAdoption({ status: 'EXPIRED', inactiveMinutes: 40 * DAY_MINUTES });

      const contact = await runGql(REQUEST_CONTACT, { postId: adoption.id, message: 'Still available?' }, requester);
      expect(errorCode(contact)).toBe('VALIDATION_ERROR');
      expect(firstError(contact)).toMatch(/inactive post/i);

      const application = await runGql(
        SUBMIT_APPLICATION,
        { input: { ...APPLICATION_INPUT, targetPostId: adoption.id } },
        other,
      );
      expect(errorCode(application)).toBe('VALIDATION_ERROR');
      expect(firstError(application)).toMatch(/inactive adoption listing/i);

      const sellerContact = await runGql(PRODUCT_SELLER_CONTACT, { postId: product.id }, other);
      expect(errorCode(sellerContact)).toBe('VALIDATION_ERROR');
      expect(firstError(sellerContact)).toMatch(/no longer active/i);
    });

    it('keeps a viewed and commented expired listing expired without resetting its inactivity window', async () => {
      const post = await seedProduct({ inactiveMinutes: 15 * DAY_MINUTES, withMedia: true });
      expect((await processor.processPendingExpiry()).expired).toBe(1);

      const before = (await storedPost(post.id))!;
      const comment = await commentOnPost(post);
      expect(comment.postId).toBe(post.id);

      const view = await runGql(RECORD_VIEW, { postId: post.id }, other);
      expect(view.errors).toBeUndefined();
      await viewFlushCron.handleFlush();

      const after = (await storedPost(post.id))!;
      expect(after.status).toBe('EXPIRED');
      expect(after.viewCount).toBe(0);
      expect(after.lastEngagedAt.getTime()).toBe(before.lastEngagedAt.getTime());

      // A repeated expiry run leaves the expired listing untouched.
      const repeated = await processor.processPendingExpiry();
      expect(repeated.expired).toBe(0);
      expect((await storedPost(post.id))?.status).toBe('EXPIRED');
    });

    it('never lets stale expiry work expire a renewed, re-engaged or completed listing', async () => {
      const renewed = await seedProduct({ inactiveMinutes: 15 * DAY_MINUTES });
      await renewPost(renewed);

      const staleResult = await postsRepository.expireInactivePost(renewed.id, 'PRODUCT', 14);
      expect(staleResult).toBeUndefined();
      expect((await storedPost(renewed.id))?.status).toBe('ACTIVE');

      const reengaged = await seedProduct({ inactiveMinutes: 15 * DAY_MINUTES });
      await dbHelper.db
        .update(posts)
        .set({ lastEngagedAt: sql`now()` })
        .where(eq(posts.id, reengaged.id));

      const reengagedResult = await postsRepository.expireInactivePost(reengaged.id, 'PRODUCT', 14);
      expect(reengagedResult).toBeUndefined();
      expect((await storedPost(reengaged.id))?.status).toBe('ACTIVE');

      const completed = await seedProduct({ inactiveMinutes: 15 * DAY_MINUTES });
      const closed = await runGql<StatusMutationData>(
        UPDATE_POST_STATUS,
        { postId: completed.id, status: 'SOLD' },
        owner,
      );
      expect(closed.errors).toBeUndefined();

      const completedResult = await postsRepository.expireInactivePost(completed.id, 'PRODUCT', 14);
      expect(completedResult).toBeUndefined();
      expect((await storedPost(completed.id))?.status).toBe('SOLD');
    });
  });

  // ─── Batch bound ────────────────────────────────────────────────────────

  describe('bounded batch processing', () => {
    it('processes at most one candidate batch per expiry query', async () => {
      const inactiveMinutes = 20 * DAY_MINUTES;
      for (let index = 0; index < POST_EXPIRY_CANDIDATE_BATCH_SIZE + 2; index += 1) {
        await seedProduct({ inactiveMinutes });
      }

      const result = await processor.processPendingExpiry();

      expect(result.expired).toBe(POST_EXPIRY_CANDIDATE_BATCH_SIZE);
      const remaining = await dbHelper.db
        .select()
        .from(posts)
        .where(and(eq(posts.status, 'ACTIVE'), eq(posts.postType, 'PRODUCT')));
      expect(remaining).toHaveLength(2);
    });
  });
});

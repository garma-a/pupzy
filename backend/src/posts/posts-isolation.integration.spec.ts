import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import DataLoader from 'dataloader';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import { blocks, cities, postSaves, posts, users, type City, type Post, type User } from '../database/schema';
import * as schema from '../database/schema';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';
import { PostsResolver } from './posts.resolver';
import { MatingRepository } from '../mating/mating.repository';
import { MatingService } from '../mating/mating.service';
import { MatingResolver } from '../mating/mating.resolver';
import { CitiesRepository } from '../cities/cities.repository';
import { UsersRepository } from '../users/users.repository';
import { CitiesService } from '../cities/cities.service';
import { UsersService } from '../users/users.service';
import { UploadService } from '../upload/upload.service';
import { ViewFlushCron } from './view-flush.cron';
import { NotificationsService } from '../notifications/notifications.service';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import type { GqlContext } from '../common/types/gql-context.type';

type PostType = 'RESCUE' | 'LOST' | 'ADOPTION' | 'PRODUCT' | 'MATING';

interface FeedPage {
  edges: Array<{ node: { id: string; creator?: { id: string } }; cursor: string }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  Plans?: PlanNode[];
}

const NONEXISTENT_POST_ID = '0192ffff-0000-7000-8000-000000000000';

const REPORT_POST_MUTATION = `mutation ReportPost($input: ReportPostInput!) {
  reportPost(input: $input)
}`;

const HOME_FEED = `query Home($cityId: ID, $first: Int, $after: String) {
  homeFeed(cityId: $cityId, first: $first, after: $after) {
    edges { node { id creator { id } } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const HELP_FEED = `query Help($cityId: ID, $first: Int, $after: String) {
  helpFeed(cityId: $cityId, first: $first, after: $after) {
    edges { node { id } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const ADOPT_FEED = `query Adopt($cityId: ID, $sort: AdoptFeedSort, $first: Int, $after: String) {
  adoptFeed(cityId: $cityId, sort: $sort, first: $first, after: $after) {
    edges { node { id } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const MARKET_FEED = `query Market($cityId: ID, $category: ProductCategory, $sort: MarketFeedSort, $first: Int, $after: String) {
  marketFeed(cityId: $cityId, category: $category, sort: $sort, first: $first, after: $after) {
    edges { node { id } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const MATING_FEED = `query Mating($cityId: ID, $first: Int, $after: String) {
  matingFeed(filter: { cityId: $cityId }, first: $first, after: $after) {
    edges { node { id } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const SAVED_POSTS = `query Saved($first: Int, $after: String) {
  mySavedPosts(first: $first, after: $after) {
    edges { node { id creator { id } } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const MY_POSTS = `query Mine($postType: PostType!, $first: Int, $after: String) {
  myPosts(postType: $postType, first: $first, after: $after) {
    edges { node { id } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const DIRECT_POST = `query DirectPost($id: ID!) { post(id: $id) { id postType } }`;

const RESCUE_DETAIL = `query RescueDetail($postId: ID!) { rescuePostDetail(postId: $postId) { postId conditionSummary } }`;
const LOST_DETAIL = `query LostDetail($postId: ID!) { lostPostDetail(postId: $postId) { postId reportType } }`;
const ADOPTION_DETAIL = `query AdoptionDetail($postId: ID!) { adoptionPostDetail(postId: $postId) { postId petName } }`;
const PRODUCT_DETAIL = `query ProductDetail($postId: ID!) { productPostDetail(postId: $postId) { postId category } }`;
const MATING_DETAIL = `query MatingDetail($postId: ID!) { matingPostDetail(postId: $postId) { petName breed } }`;

describe('Post account isolation across discovery and retrieval (Ticket 06)', () => {
  jest.setTimeout(180_000);

  let dbHelper: TestDatabaseHelper;
  let executableSchema: GraphQLSchema;
  let postsRepository: PostsRepository;
  let postsService: PostsService;
  let postsResolver: PostsResolver;
  let matingService: MatingService;
  let matingResolver: MatingResolver;
  let citiesService: CitiesService;
  let usersService: UsersService;
  let uploadService: UploadService;
  let viewFlushCron: ViewFlushCron;
  let notificationsService: NotificationsService;
  let mockCache: Cache;

  let testCity: City;
  let viewer: User;
  let author: User;
  let other: User;

  let postSequence = 0;

  function nextPostId(): string {
    postSequence += 1;
    return `0192f1ee-0000-7000-8000-${String(postSequence).padStart(12, '0')}`;
  }

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    const cacheStore = new Map<string, unknown>();
    mockCache = {
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
      get: jest.fn((key: string) => {
        switch (key) {
          case 'PHONE_ENCRYPTION_KEY':
            return '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
          default:
            return undefined;
        }
      }),
    } as unknown as ConfigService;

    const citiesRepo = new CitiesRepository(dbHelper.db);
    const usersRepo = new UsersRepository(dbHelper.db);
    postsRepository = new PostsRepository(dbHelper.db);
    const matingRepository = new MatingRepository(dbHelper.db);

    citiesService = new CitiesService(citiesRepo, mockCache);
    usersService = new UsersService(usersRepo, citiesService, mockConfig, mockCache);
    uploadService = new UploadService(mockConfig, mockCache, dbHelper.db);
    viewFlushCron = new ViewFlushCron(postsRepository, mockCache);
    notificationsService = {
      fireNotification: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService;

    postsService = new PostsService(
      postsRepository,
      citiesService,
      uploadService,
      viewFlushCron,
      usersService,
      notificationsService,
      mockCache,
    );
    matingService = new MatingService(matingRepository, citiesService, uploadService);

    postsResolver = new PostsResolver(postsService);
    matingResolver = new MatingResolver(matingService);

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
          rescuePostDetail: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.rescuePostDetail(args.postId, ctx),
          lostPostDetail: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.lostPostDetail(args.postId, ctx),
          adoptionPostDetail: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.adoptionPostDetail(args.postId, ctx),
          productPostDetail: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.productPostDetail(args.postId, ctx),
          helpFeed: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) =>
            postsResolver.helpFeed(args, ctx),
          adoptFeed: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) =>
            postsResolver.adoptFeed(args, ctx),
          marketFeed: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) =>
            postsResolver.marketFeed(args, ctx),
          homeFeed: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) =>
            postsResolver.homeFeed(args, ctx),
          mySavedPosts: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) =>
            postsResolver.mySavedPosts(args, ctx),
          myPosts: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) => postsResolver.myPosts(args, ctx),
          matingFeed: (
            _root: unknown,
            args: { filter?: Record<string, unknown> | null; first?: number; after?: string },
            ctx: GqlContext,
          ) => matingResolver.matingFeed(args.filter ?? undefined, args.first, args.after, ctx),
          matingPostDetail: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            matingResolver.matingPostDetail(args.postId, ctx),
        },
        Mutation: {
          reportPost: (_root: unknown, args: { input: unknown }, ctx: GqlContext) =>
            postsResolver.reportPost(args.input, ctx),
        },
        Post: {
          coordinates: (root: Post) => postsResolver.coordinates(root),
          city: (root: Post, _args: unknown, ctx: GqlContext) => postsResolver.city(root, ctx),
          creator: (root: Post, _args: unknown, ctx: GqlContext) => postsResolver.creator(root, ctx),
          media: (root: Post, _args: unknown, ctx: GqlContext) => postsResolver.media(root, ctx),
          isUpvotedByMe: (root: Post, _args: unknown, ctx: GqlContext) => postsResolver.isUpvotedByMe(root, ctx),
          isSavedByMe: (root: Post, _args: unknown, ctx: GqlContext) => postsResolver.isSavedByMe(root, ctx),
          commentCount: (root: Post) => postsResolver.commentCount(root),
        },
      },
    });
  });

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();

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

    viewer = await insertUser('viewer');
    author = await insertUser('author');
    other = await insertUser('other');
  });

  async function insertUser(label: string): Promise<User> {
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-${label}-${generateUuidV7()}`,
        email: `${label}-${generateUuidV7()}@pupzy.dev`,
        fullName: `Isolation ${label}`,
      })
      .returning();
    return user;
  }

  async function seedPost(params: {
    creatorId: string;
    postType: PostType;
    id?: string;
    createdAt?: Date;
    effectiveScore?: number;
    urgency?: 'CRITICAL' | 'URGENT' | 'MODERATE';
    marketCategory?: 'FOOD' | 'CARE' | 'ACCESSORIES';
    status?: Post['status'];
  }): Promise<Post> {
    const id = params.id ?? nextPostId();
    const isUrgencyType = params.postType === 'RESCUE' || params.postType === 'LOST';
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        id,
        creatorId: params.creatorId,
        postType: params.postType,
        title: `Isolation ${params.postType} ${id.slice(-4)}`,
        description: 'Isolation matrix fixture',
        status: params.status ?? 'ACTIVE',
        urgency: isUrgencyType ? (params.urgency ?? 'URGENT') : undefined,
        marketCategory: params.postType === 'PRODUCT' ? (params.marketCategory ?? 'FOOD') : undefined,
        cityId: testCity.id,
        governorate: testCity.governorate,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
        effectiveScore: params.effectiveScore ?? 0,
        ...(params.createdAt ? { createdAt: params.createdAt } : {}),
      })
      .returning();
    return post;
  }

  async function seedRescue(params: Parameters<typeof seedPost>[0]): Promise<Post> {
    const post = await seedPost({ ...params, postType: 'RESCUE' });
    await dbHelper.db.insert(schema.rescuePosts).values({
      postId: post.id,
      species: 'DOG',
      conditionSummary: 'Needs rescue',
      reporterRole: 'ON_SITE',
      isLifeThreatening: false,
      hasVisibleSeriousInjury: false,
      isInDangerousLocation: false,
      canAnimalMoveOrEscape: true,
    });
    return post;
  }

  async function seedLost(params: Parameters<typeof seedPost>[0]): Promise<Post> {
    const post = await seedPost({ ...params, postType: 'LOST' });
    await dbHelper.db.insert(schema.lostPosts).values({
      postId: post.id,
      reportType: 'LOST_PET',
      species: 'CAT',
      dateLastSeen: '2026-01-01',
    });
    return post;
  }

  async function seedAdoption(params: Parameters<typeof seedPost>[0]): Promise<Post> {
    const post = await seedPost({ ...params, postType: 'ADOPTION' });
    await dbHelper.db.insert(schema.adoptionPosts).values({
      postId: post.id,
      petName: 'Rex',
      species: 'DOG',
      gender: 'MALE',
    });
    return post;
  }

  async function seedProduct(params: Parameters<typeof seedPost>[0]): Promise<Post> {
    const post = await seedPost({ ...params, postType: 'PRODUCT' });
    await dbHelper.db.insert(schema.productPosts).values({
      postId: post.id,
      category: params.marketCategory ?? 'FOOD',
      condition: 'NEW',
      priceAmount: '100.00',
      isFree: false,
    });
    return post;
  }

  async function seedMating(params: Parameters<typeof seedPost>[0]): Promise<Post> {
    const post = await seedPost({ ...params, postType: 'MATING' });
    await dbHelper.db.insert(schema.matingPosts).values({
      postId: post.id,
      petName: 'Luna',
      species: 'CAT',
      breed: 'Siamese',
      gender: 'FEMALE',
      ageValue: 2,
      ageUnit: 'YEARS',
    });
    return post;
  }

  async function setBlock(blocker: User, blocked: User): Promise<void> {
    await dbHelper.db.delete(blocks);
    await dbHelper.db.insert(blocks).values({ blockerId: blocker.id, blockedId: blocked.id });
  }

  async function setNoBlocks(): Promise<void> {
    await dbHelper.db.delete(blocks);
  }

  async function savePost(user: User, post: Post, savedAt?: Date): Promise<void> {
    await dbHelper.db.insert(postSaves).values({
      postId: post.id,
      userId: user.id,
      ...(savedAt ? { createdAt: savedAt } : {}),
    });
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
        commentBoostedByMe: { load: jest.fn().mockResolvedValue(false) },
        pinnedCommentIdByPostId: { load: jest.fn().mockResolvedValue(null) },
        commentMediaByCommentId: { load: jest.fn().mockResolvedValue([]) },
      } as unknown as GqlContext['loaders'],
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

  async function runFeed(
    source: string,
    field: string,
    variables: Record<string, unknown>,
    user: User,
  ): Promise<FeedPage> {
    const res = await runGql<Record<string, FeedPage>>(source, variables, user);
    expect(res.errors).toBeUndefined();
    return res.data![field];
  }

  function ids(page: FeedPage): string[] {
    return page.edges.map((edge) => edge.node.id);
  }

  async function detailError(source: string, postId: string, user: User): Promise<string> {
    const res = await runGql(source, { postId }, user);
    expect(res.errors).toBeDefined();
    expect(res.errors).toHaveLength(1);
    return res.errors![0].message;
  }

  /** Replaces the requested Post id so errors can be compared regardless of id. */
  function neutralized(message: string, postId: string): string {
    return message.split(postId).join('<id>');
  }

  it('home feed omits isolated creators in either Block direction and keeps pages dense', async () => {
    const otherPost1 = await seedRescue({ creatorId: other.id });
    const otherPost2 = await seedLost({ creatorId: other.id });
    const otherPost3 = await seedAdoption({ creatorId: other.id });
    const authorPost1 = await seedRescue({ creatorId: author.id });
    const authorPost2 = await seedLost({ creatorId: author.id });
    const authorPost3 = await seedAdoption({ creatorId: author.id });
    const visibleIds = [otherPost3.id, otherPost2.id, otherPost1.id];

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const firstPage = await runFeed(HOME_FEED, 'homeFeed', { cityId: testCity.id, first: 2 }, viewer);
      expect(ids(firstPage)).toEqual(visibleIds.slice(0, 2));
      expect(firstPage.edges.every((edge) => edge.node.creator?.id === other.id)).toBe(true);
      expect(firstPage.pageInfo.hasNextPage).toBe(true);

      const secondPage = await runFeed(
        HOME_FEED,
        'homeFeed',
        { cityId: testCity.id, first: 2, after: firstPage.pageInfo.endCursor },
        viewer,
      );
      expect(ids(secondPage)).toEqual(visibleIds.slice(2));
      expect(secondPage.pageInfo.hasNextPage).toBe(false);
    }

    await setNoBlocks();
    const unfiltered = await runFeed(HOME_FEED, 'homeFeed', { cityId: testCity.id, first: 10 }, viewer);
    expect(ids(unfiltered)).toEqual([
      authorPost3.id,
      authorPost2.id,
      authorPost1.id,
      otherPost3.id,
      otherPost2.id,
      otherPost1.id,
    ]);
    expect(unfiltered.pageInfo.hasNextPage).toBe(false);
  });

  it('help feed omits isolated creators and continues cursors over the filtered set', async () => {
    const authorCritical = await seedRescue({
      creatorId: author.id,
      urgency: 'CRITICAL',
      createdAt: new Date('2026-01-04T00:00:00Z'),
    });
    const otherCritical = await seedLost({
      creatorId: other.id,
      urgency: 'CRITICAL',
      createdAt: new Date('2026-01-03T00:00:00Z'),
    });
    await seedRescue({ creatorId: author.id, urgency: 'URGENT', createdAt: new Date('2026-01-02T00:00:00Z') });
    const otherUrgent = await seedLost({
      creatorId: other.id,
      urgency: 'URGENT',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const firstPage = await runFeed(HELP_FEED, 'helpFeed', { cityId: testCity.id, first: 1 }, viewer);
      expect(ids(firstPage)).toEqual([otherCritical.id]);
      expect(firstPage.pageInfo.hasNextPage).toBe(true);

      const secondPage = await runFeed(
        HELP_FEED,
        'helpFeed',
        { cityId: testCity.id, first: 1, after: firstPage.edges[0].cursor },
        viewer,
      );
      expect(ids(secondPage)).toEqual([otherUrgent.id]);
      expect(secondPage.pageInfo.hasNextPage).toBe(false);
    }

    await setNoBlocks();
    const unfiltered = await runFeed(HELP_FEED, 'helpFeed', { cityId: testCity.id, first: 3 }, viewer);
    expect(ids(unfiltered)[0]).toBe(authorCritical.id);
  });

  it('adopt and market feeds omit isolated creators for HOT and NEWEST in either direction', async () => {
    const otherAdoption = await seedAdoption({ creatorId: other.id, effectiveScore: 1 });
    const authorAdoption = await seedAdoption({ creatorId: author.id, effectiveScore: 100 });
    const otherProduct = await seedProduct({ creatorId: other.id, marketCategory: 'FOOD', effectiveScore: 1 });
    const authorProduct = await seedProduct({ creatorId: author.id, marketCategory: 'FOOD', effectiveScore: 100 });

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const adoptHot = await runFeed(ADOPT_FEED, 'adoptFeed', { cityId: testCity.id, sort: 'HOT' }, viewer);
      expect(ids(adoptHot)).toEqual([otherAdoption.id]);
      const adoptNewest = await runFeed(ADOPT_FEED, 'adoptFeed', { cityId: testCity.id, sort: 'NEWEST' }, viewer);
      expect(ids(adoptNewest)).toEqual([otherAdoption.id]);

      const marketNewest = await runFeed(
        MARKET_FEED,
        'marketFeed',
        { cityId: testCity.id, category: 'FOOD', sort: 'NEWEST' },
        viewer,
      );
      expect(ids(marketNewest)).toEqual([otherProduct.id]);
      const marketHot = await runFeed(
        MARKET_FEED,
        'marketFeed',
        { cityId: testCity.id, category: 'FOOD', sort: 'HOT' },
        viewer,
      );
      expect(ids(marketHot)).toEqual([otherProduct.id]);
    }

    await setNoBlocks();
    const unfilteredAdopt = await runFeed(ADOPT_FEED, 'adoptFeed', { cityId: testCity.id, sort: 'HOT' }, viewer);
    expect(ids(unfilteredAdopt)).toEqual([authorAdoption.id, otherAdoption.id]);
    const unfilteredMarket = await runFeed(
      MARKET_FEED,
      'marketFeed',
      { cityId: testCity.id, category: 'FOOD', sort: 'NEWEST' },
      viewer,
    );
    expect(ids(unfilteredMarket)).toEqual([authorProduct.id, otherProduct.id]);
  });

  it('mating feed omits isolated creators in either direction', async () => {
    const otherMating = await seedMating({ creatorId: other.id });
    const authorMating = await seedMating({ creatorId: author.id });

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const page = await runFeed(MATING_FEED, 'matingFeed', { cityId: testCity.id, first: 10 }, viewer);
      expect(ids(page)).toEqual([otherMating.id]);
    }

    await setNoBlocks();
    const unfiltered = await runFeed(MATING_FEED, 'matingFeed', { cityId: testCity.id, first: 10 }, viewer);
    expect(ids(unfiltered)).toEqual([authorMating.id, otherMating.id]);
  });

  it('saved posts omit isolated posts without deleting the underlying Save relationship', async () => {
    const authorPost = await seedRescue({ creatorId: author.id });
    const otherPost = await seedRescue({ creatorId: other.id });
    await savePost(viewer, authorPost, new Date('2026-01-01T00:00:00Z'));
    await savePost(viewer, otherPost, new Date('2026-01-02T00:00:00Z'));

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const page = await runFeed(SAVED_POSTS, 'mySavedPosts', { first: 10 }, viewer);
      expect(ids(page)).toEqual([otherPost.id]);
    }

    const persisted = await dbHelper.db
      .select()
      .from(postSaves)
      .where(and(eq(postSaves.userId, viewer.id), eq(postSaves.postId, authorPost.id)));
    expect(persisted).toHaveLength(1);

    await setNoBlocks();
    const restored = await runFeed(SAVED_POSTS, 'mySavedPosts', { first: 10 }, viewer);
    expect(ids(restored)).toEqual([otherPost.id, authorPost.id]);

    await setBlock(author, viewer);
    const hiddenAgain = await runFeed(SAVED_POSTS, 'mySavedPosts', { first: 10 }, viewer);
    expect(ids(hiddenAgain)).toEqual([otherPost.id]);
  });

  it('direct base Post lookup treats isolated posts as inaccessible in either direction', async () => {
    const authorPost = await seedRescue({ creatorId: author.id });
    const otherPost = await seedRescue({ creatorId: other.id });

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const isolated = await runGql<{ post: { id: string } | null }>(DIRECT_POST, { id: authorPost.id }, viewer);
      expect(isolated.errors).toBeUndefined();
      expect(isolated.data!.post).toBeNull();

      const visible = await runGql<{ post: { id: string } | null }>(DIRECT_POST, { id: otherPost.id }, viewer);
      expect(visible.errors).toBeUndefined();
      expect(visible.data!.post?.id).toBe(otherPost.id);
    }

    const missing = await runGql<{ post: { id: string } | null }>(DIRECT_POST, { id: NONEXISTENT_POST_ID }, viewer);
    expect(missing.errors).toBeUndefined();
    expect(missing.data!.post).toBeNull();
  });

  it('type-specific detail queries cannot leak extension data after isolation', async () => {
    const rescuePost = await seedRescue({ creatorId: author.id });
    const lostPost = await seedLost({ creatorId: author.id });
    const adoptionPost = await seedAdoption({ creatorId: author.id });
    const productPost = await seedProduct({ creatorId: author.id });
    const matingPost = await seedMating({ creatorId: author.id });

    const detailCases: Array<[string, string]> = [
      [RESCUE_DETAIL, rescuePost.id],
      [LOST_DETAIL, lostPost.id],
      [ADOPTION_DETAIL, adoptionPost.id],
      [PRODUCT_DETAIL, productPost.id],
      [MATING_DETAIL, matingPost.id],
    ];

    await setNoBlocks();
    for (const [source, postId] of detailCases) {
      const res = await runGql<Record<string, unknown>>(source, { postId }, viewer);
      expect(res.errors).toBeUndefined();
      expect(res.data).not.toBeNull();
      expect(Object.values(res.data!)[0]).toBeTruthy();
    }

    const missingMessages = new Map<string, string>();
    for (const [source] of detailCases) {
      missingMessages.set(source, await detailError(source, NONEXISTENT_POST_ID, viewer));
    }

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      for (const [source, postId] of detailCases) {
        const message = await detailError(source, postId, viewer);
        expect(neutralized(message, postId)).toBe(neutralized(missingMessages.get(source)!, NONEXISTENT_POST_ID));
        expect(message).not.toMatch(/block/i);
      }
    }

    await setNoBlocks();
    for (const [source, postId] of detailCases) {
      const res = await runGql<Record<string, unknown>>(source, { postId }, viewer);
      expect(res.errors).toBeUndefined();
      expect(Object.values(res.data!)[0]).toBeTruthy();
    }
  });

  it('mating detail respects base Post lifecycle and isolation together', async () => {
    const removedMating = await seedMating({ creatorId: other.id, status: 'REMOVED' });
    const removedMessage = await detailError(MATING_DETAIL, removedMating.id, viewer);
    const missingMessage = await detailError(MATING_DETAIL, NONEXISTENT_POST_ID, viewer);
    expect(neutralized(removedMessage, removedMating.id)).toBe(neutralized(missingMessage, NONEXISTENT_POST_ID));
  });

  it('My Posts remains available to its creator regardless of who initiated the Block', async () => {
    const viewerPost = await seedRescue({ creatorId: viewer.id });
    const authorPost = await seedRescue({ creatorId: author.id });

    await setBlock(viewer, author);
    let mine = await runFeed(MY_POSTS, 'myPosts', { postType: 'RESCUE', first: 10 }, viewer);
    expect(ids(mine)).toEqual([viewerPost.id]);
    let theirs = await runFeed(MY_POSTS, 'myPosts', { postType: 'RESCUE', first: 10 }, author);
    expect(ids(theirs)).toEqual([authorPost.id]);

    await setBlock(author, viewer);
    mine = await runFeed(MY_POSTS, 'myPosts', { postType: 'RESCUE', first: 10 }, viewer);
    expect(ids(mine)).toEqual([viewerPost.id]);
    theirs = await runFeed(MY_POSTS, 'myPosts', { postType: 'RESCUE', first: 10 }, author);
    expect(ids(theirs)).toEqual([authorPost.id]);
  });

  it('reporting an isolated Post fails with the neutral not-found in either direction', async () => {
    const moderationAdmissions = async (): Promise<number> => {
      const result = await dbHelper.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM comment_quota_admissions WHERE user_id = $1 AND action = 'MODERATION_REPORT'`,
        [viewer.id],
      );
      return Number(result.rows[0].count);
    };

    const missing = await runGql<{ reportPost: boolean }>(
      REPORT_POST_MUTATION,
      { input: { postId: NONEXISTENT_POST_ID, reason: 'SPAM' } },
      viewer,
    );
    const missingMessage = missing.errors![0].message;

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      const isolated = await seedLost({ creatorId: author.id });
      const admissionsBefore = await moderationAdmissions();

      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const res = await runGql<{ reportPost: boolean }>(
        REPORT_POST_MUTATION,
        { input: { postId: isolated.id, reason: 'SPAM' } },
        viewer,
      );
      expect(res.data?.reportPost ?? null).toBeNull();
      expect(res.errors).toHaveLength(1);
      expect(neutralized(res.errors![0].message, isolated.id)).toBe(neutralized(missingMessage, NONEXISTENT_POST_ID));
      expect(res.errors![0].message).not.toMatch(/block/i);

      // The rejected report consumed no shared allowance slot.
      expect(await moderationAdmissions()).toBe(admissionsBefore);
    }

    await setNoBlocks();
    const restored = await seedLost({ creatorId: author.id });
    const res = await runGql<{ reportPost: boolean }>(
      REPORT_POST_MUTATION,
      { input: { postId: restored.id, reason: 'SCAM' } },
      viewer,
    );
    expect(res.errors).toBeUndefined();
    expect(res.data?.reportPost).toBe(true);
  });

  it('query-plan evidence: isolation executes in SQL before the limit with bounded indexed blocks access', async () => {
    const captured: Array<{ sql: string; params: unknown[] }> = [];
    const capturingDb: NodePgDatabase<typeof schema> = drizzle(dbHelper.pool, {
      schema,
      logger: {
        logQuery(query: string, params: unknown[]) {
          captured.push({ sql: query, params });
        },
      },
    });
    const planService = new PostsService(
      new PostsRepository(capturingDb),
      citiesService,
      uploadService,
      viewFlushCron,
      usersService,
      notificationsService,
      mockCache,
    );

    const fillerRows = Array.from({ length: 300 }, (_, index) => ({
      firebaseUserId: `plan-filler-${index}-${generateUuidV7()}`,
      email: `plan-filler-${index}-${generateUuidV7()}@pupzy.dev`,
      fullName: `Plan Filler ${index}`,
    }));
    const fillers = await dbHelper.db.insert(users).values(fillerRows).returning();

    await dbHelper.pool.query(`
      INSERT INTO blocks (blocker_id, blocked_id)
      SELECT a.id, b.id
      FROM users a
      CROSS JOIN users b
      WHERE a.firebase_user_id LIKE 'plan-filler-%'
        AND b.firebase_user_id LIKE 'plan-filler-%'
        AND a.id <> b.id
    `);
    await dbHelper.db
      .insert(blocks)
      .values([
        { blockerId: viewer.id, blockedId: author.id },
        { blockerId: author.id, blockedId: viewer.id },
        ...fillers.slice(0, 100).map((filler) => ({ blockerId: viewer.id, blockedId: filler.id })),
      ]);

    const createdAt = Date.now();
    const postValues = Array.from({ length: 600 }, (_, index) => ({
      id: nextPostId(),
      creatorId: index % 3 === 0 ? viewer.id : index % 3 === 1 ? author.id : fillers[index % fillers.length].id,
      postType: 'RESCUE' as const,
      title: `Plan post ${index}`,
      description: 'Plan fixture',
      urgency: 'URGENT' as const,
      cityId: testCity.id,
      governorate: testCity.governorate,
      coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      effectiveScore: 0,
      createdAt: new Date(createdAt - index * 1_000),
    }));
    const insertedPosts = await dbHelper.db.insert(posts).values(postValues).returning({ id: posts.id });

    await dbHelper.db.insert(postSaves).values(
      insertedPosts.slice(0, 120).map((post, index) => ({
        postId: post.id,
        userId: viewer.id,
        createdAt: new Date(createdAt - index * 1_000),
      })),
    );

    await dbHelper.pool.query('ANALYZE posts');
    await dbHelper.pool.query('ANALYZE blocks');
    await dbHelper.pool.query('ANALYZE post_saves');

    captured.length = 0;
    await planService.getHomeFeed({ governorate: testCity.governorate, first: 20 }, viewer.id);
    expect(captured).toHaveLength(1);
    const homeFeedSql = captured[0];

    captured.length = 0;
    await planService.getPostsSavedByCurrentUser(viewer.id, { first: 20 });
    expect(captured).toHaveLength(1);
    const savedPostsSql = captured[0];

    async function explain(entry: { sql: string; params: unknown[] }): Promise<PlanNode> {
      const result = await dbHelper.pool.query<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>({
        text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${entry.sql}`,
        values: entry.params,
      });
      return result.rows[0]['QUERY PLAN'][0].Plan;
    }

    function flatten(node: PlanNode): PlanNode[] {
      return [node, ...(node.Plans ?? []).flatMap((child) => flatten(child))];
    }

    const plans: Array<[string, PlanNode]> = [
      ['home feed', await explain(homeFeedSql)],
      ['saved posts', await explain(savedPostsSql)],
    ];

    for (const [label, plan] of plans) {
      const nodes = flatten(plan);
      const limit = nodes.find((node) => node['Node Type'] === 'Limit');
      if (!limit) throw new Error(`${label} plan is missing a Limit node`);

      const blocksScans = nodes.filter((node) => node['Relation Name'] === 'blocks');
      expect(blocksScans.length).toBeGreaterThan(0);
      expect(blocksScans.length).toBeLessThanOrEqual(2);
      for (const scan of blocksScans) {
        expect(String(scan['Node Type'])).toMatch(/Index|Bitmap/);
        // One bounded lookup per Block direction — not one pair check per row.
        expect(scan['Actual Loops']).toBeLessThanOrEqual(2);
      }

      // The isolation anti-join runs inside the same plan as the keyset scan:
      // the limit receives a full page of viewer-visible rows (limit + 1).
      expect(limit['Actual Rows']).toBe(21);
    }
  });
});

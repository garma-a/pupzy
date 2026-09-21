import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import DataLoader from 'dataloader';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import { blocks, cities, posts, users, type City, type Post, type User } from '../database/schema';
import * as schema from '../database/schema';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';
import { PostsResolver } from './posts.resolver';
import { CitiesRepository } from '../cities/cities.repository';
import { UsersRepository } from '../users/users.repository';
import { AccountDeletionRepository } from '../users/account-deletion.repository';
import { CitiesService } from '../cities/cities.service';
import { UsersService } from '../users/users.service';
import { UploadService } from '../upload/upload.service';
import { ViewFlushCron } from './view-flush.cron';
import { NotificationsService } from '../notifications/notifications.service';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { normalizeSearchText } from './search-query.util';
import type { GqlContext } from '../common/types/gql-context.type';

type PostType = 'RESCUE' | 'LOST' | 'ADOPTION' | 'PRODUCT' | 'MATING';
type Urgency = 'CRITICAL' | 'URGENT' | 'MODERATE';

interface FeedPage {
  edges: Array<{ node: { id: string }; cursor: string }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  Plans?: PlanNode[];
}

const HOME_FEED = `query HomeFeed(
  $cityId: ID
  $governorate: String
  $viewerLocation: ViewerLocationInput
  $radiusKm: Float
  $search: String
  $first: Int
  $after: String
) {
  homeFeed(
    cityId: $cityId
    governorate: $governorate
    viewerLocation: $viewerLocation
    radiusKm: $radiusKm
    search: $search
    first: $first
    after: $after
  ) {
    edges { node { id } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

const HELP_FEED = `query HelpFeed(
  $cityId: ID
  $governorate: String
  $viewerLocation: ViewerLocationInput
  $radiusKm: Float
  $search: String
  $first: Int
  $after: String
) {
  helpFeed(
    cityId: $cityId
    governorate: $governorate
    viewerLocation: $viewerLocation
    radiusKm: $radiusKm
    search: $search
    first: $first
    after: $after
  ) {
    edges { node { id } cursor }
    pageInfo { hasNextPage endCursor }
  }
}`;

describe('Server-side feed search (Ticket 15)', () => {
  jest.setTimeout(300_000);

  let dbHelper: TestDatabaseHelper;
  let executableSchema: GraphQLSchema;
  let postsRepository: PostsRepository;
  let postsService: PostsService;
  let postsResolver: PostsResolver;
  let citiesService: CitiesService;
  let usersService: UsersService;
  let uploadService: UploadService;
  let viewFlushCron: ViewFlushCron;
  let notificationsService: NotificationsService;
  let mockCache: Cache;

  let cairo: City;
  let giza: City;
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
    const accountDeletionRepo = new AccountDeletionRepository(dbHelper.db);
    postsRepository = new PostsRepository(dbHelper.db);

    citiesService = new CitiesService(citiesRepo, mockCache);
    usersService = new UsersService(usersRepo, citiesService, accountDeletionRepo, mockConfig, mockCache);
    uploadService = new UploadService(mockConfig, mockCache, dbHelper.db);
    viewFlushCron = new ViewFlushCron(postsRepository);
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
    postsResolver = new PostsResolver(postsService);

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
          helpFeed: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) =>
            postsResolver.helpFeed(args, ctx),
          homeFeed: (_root: unknown, args: Record<string, unknown>, ctx: GqlContext) =>
            postsResolver.homeFeed(args, ctx),
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

    const [cairoCity] = await dbHelper.db
      .insert(cities)
      .values({
        nameEnglish: 'Cairo',
        nameArabic: 'القاهرة',
        governorate: 'Cairo',
        status: 'OFFICIAL',
        centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    cairo = cairoCity;

    const [gizaCity] = await dbHelper.db
      .insert(cities)
      .values({
        nameEnglish: 'Giza',
        nameArabic: 'الجيزة',
        governorate: 'Giza',
        status: 'OFFICIAL',
        centerPoint: sql`ST_SetSRID(ST_MakePoint(31.1342, 30.0131), 4326)`,
      })
      .returning();
    giza = gizaCity;

    viewer = await insertUser('viewer');
    author = await insertUser('author');
    other = await insertUser('other');
  });

  async function insertUser(label: string): Promise<User> {
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-search-${label}-${generateUuidV7()}`,
        email: `${label}-${generateUuidV7()}@pupzy.dev`,
        fullName: `Search ${label}`,
      })
      .returning();
    return user;
  }

  async function seedPost(params: {
    creatorId: string;
    postType: PostType;
    title?: string;
    description?: string;
    areaName?: string | null;
    status?: Post['status'];
    urgency?: Urgency;
    marketCategory?: 'FOOD' | 'CARE' | 'ACCESSORIES';
    cityId?: string;
    createdAt?: Date;
    coordinates?: { latitude: number; longitude: number };
  }): Promise<Post> {
    const id = nextPostId();
    const isUrgencyType = params.postType === 'RESCUE' || params.postType === 'LOST';
    const city = params.cityId === giza.id ? giza : cairo;
    const coordinates =
      params.coordinates ??
      (city === giza ? { latitude: 30.0131, longitude: 31.1342 } : { latitude: 30.0444, longitude: 31.2357 });
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        id,
        creatorId: params.creatorId,
        postType: params.postType,
        title: params.title ?? `Search ${params.postType} ${id.slice(-4)}`,
        description: params.description ?? 'Search fixture description',
        status: params.status ?? 'ACTIVE',
        urgency: isUrgencyType ? (params.urgency ?? 'URGENT') : undefined,
        marketCategory: params.postType === 'PRODUCT' ? (params.marketCategory ?? 'FOOD') : undefined,
        cityId: city.id,
        governorate: city.governorate,
        areaName: params.areaName ?? null,
        coordinates: sql`ST_SetSRID(ST_MakePoint(${coordinates.longitude}, ${coordinates.latitude}), 4326)`,
        effectiveScore: 0,
        ...(params.createdAt ? { createdAt: params.createdAt } : {}),
      })
      .returning();
    return post;
  }

  async function setBlock(blocker: User, blocked: User): Promise<void> {
    await dbHelper.db.delete(blocks);
    await dbHelper.db.insert(blocks).values({ blockerId: blocker.id, blockedId: blocked.id });
  }

  function createContext(user?: User): GqlContext {
    const userLoader = new DataLoader<string, User | null>(async (ids: readonly string[]) => {
      const rows = await dbHelper.db.select().from(users);
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

  async function collectSearchPages(
    source: string,
    field: string,
    variables: Record<string, unknown>,
    user: User,
    pageSize: number,
  ): Promise<FeedPage[]> {
    const pages: FeedPage[] = [];
    let after: string | null = null;
    for (let i = 0; i < 20; i += 1) {
      const page = await runFeed(source, field, { ...variables, first: pageSize, after }, user);
      pages.push(page);
      if (!page.pageInfo.hasNextPage) return pages;
      after = page.pageInfo.endCursor;
    }
    throw new Error('Search pagination did not terminate');
  }

  it('home feed search finds matches beyond the first page with stable newest-first cursors', async () => {
    for (let i = 0; i < 5; i += 1) {
      await seedPost({ creatorId: other.id, postType: 'RESCUE', title: `Ordinary oldest ${i}` });
    }
    const matching: Post[] = [];
    for (let i = 0; i < 25; i += 1) {
      matching.push(
        await seedPost({
          creatorId: other.id,
          postType: i % 2 === 0 ? 'RESCUE' : 'LOST',
          title: `Searchable zebra ${i}`,
        }),
      );
    }
    const newestNonMatching: Post[] = [];
    for (let i = 0; i < 20; i += 1) {
      newestNonMatching.push(
        await seedPost({ creatorId: other.id, postType: 'RESCUE', title: `Ordinary newest ${i}` }),
      );
    }

    const expected = matching.map((post) => post.id).reverse();
    const pages = await collectSearchPages(HOME_FEED, 'homeFeed', { cityId: cairo.id, search: 'zebra' }, viewer, 10);

    expect(pages).toHaveLength(3);
    expect(pages.map((page) => page.pageInfo.hasNextPage)).toEqual([true, true, false]);
    const collected = pages.flatMap(ids);
    expect(collected).toEqual(expected);
    expect(new Set(collected).size).toBe(25);

    // The newest page of the unfiltered feed is entirely non-matching, so the
    // matches would never appear by filtering an already-loaded client page.
    const unfiltered = await runFeed(HOME_FEED, 'homeFeed', { cityId: cairo.id, first: 25 }, viewer);
    expect(ids(unfiltered).slice(0, 20)).toEqual(newestNonMatching.map((post) => post.id).reverse());
    const matchingIds = new Set(matching.map((post) => post.id));
    expect(ids(unfiltered).filter((id) => matchingIds.has(id))).toEqual(expected.slice(0, 5));
  });

  it('search matches English, Arabic, normalization variants, category, area and description text', async () => {
    const alefVariant = await seedPost({ creatorId: other.id, postType: 'RESCUE', title: 'أحمد يبحث عن كلبه' });
    const yehVariant = await seedPost({ creatorId: other.id, postType: 'LOST', title: 'قطة مفقودة في المعادى' });
    const cityVariant = await seedPost({ creatorId: other.id, postType: 'RESCUE', title: 'كلب صغير', cityId: giza.id });
    const tatweelStored = await seedPost({ creatorId: other.id, postType: 'RESCUE', title: 'كـــلب كبير' });
    const diacriticsStored = await seedPost({ creatorId: other.id, postType: 'RESCUE', title: 'كَلب أسود' });
    const englishCase = await seedPost({
      creatorId: other.id,
      postType: 'ADOPTION',
      title: 'A Free PUPPY needs a home',
    });
    const whitespace = await seedPost({ creatorId: other.id, postType: 'LOST', title: 'Lost    Dog   again' });
    const category = await seedPost({
      creatorId: other.id,
      postType: 'PRODUCT',
      title: 'Quality pet supplies',
      description: 'Everything your companion needs',
      marketCategory: 'FOOD',
    });
    const area = await seedPost({
      creatorId: other.id,
      postType: 'ADOPTION',
      title: 'Friendly cat',
      areaName: 'Maadi',
    });
    const description = await seedPost({
      creatorId: other.id,
      postType: 'RESCUE',
      title: 'حالة عاجلة',
      description: 'قطة على ضفاف النيل',
    });
    const literalPercent = await seedPost({
      creatorId: other.id,
      postType: 'PRODUCT',
      title: 'Adoption fee 100% waived',
      marketCategory: 'ACCESSORIES',
    });
    await seedPost({
      creatorId: other.id,
      postType: 'PRODUCT',
      title: 'Item 100x cheaper',
      marketCategory: 'ACCESSORIES',
    });

    const cases: Array<[string, Post, Record<string, unknown>]> = [
      ['احمد', alefVariant, { governorate: 'Cairo' }],
      ['المعادي', yehVariant, { governorate: 'Cairo' }],
      ['كلب كبير', tatweelStored, { governorate: 'Cairo' }],
      ['كــلب أسود', diacriticsStored, { governorate: 'Cairo' }],
      ['free puppy', englishCase, { governorate: 'Cairo' }],
      ['  lost    dog   ', whitespace, { governorate: 'Cairo' }],
      ['FoOd', category, { governorate: 'Cairo' }],
      ['maadi', area, { governorate: 'Cairo' }],
      ['النيل', description, { governorate: 'Cairo' }],
      // LIKE metacharacters match literally, so the other PRODUCT is excluded.
      ['100%', literalPercent, { governorate: 'Cairo' }],
      // City Arabic name with the teh-marbuta variant of Giza.
      ['الجيزه', cityVariant, { cityId: giza.id }],
    ];

    for (const [search, matched, location] of cases) {
      const page = await runFeed(HOME_FEED, 'homeFeed', { ...location, search, first: 10 }, viewer);
      expect({ search, ids: ids(page) }).toEqual({ search, ids: [matched.id] });
    }
  });

  it('help feed search keeps urgency ordering and continues cursors across matches beyond the first page', async () => {
    const matching: Post[] = [];
    const criticalDates = [
      '2026-01-01T00:00:00Z',
      '2026-01-02T00:00:00Z',
      '2026-01-03T00:00:00Z',
      '2026-01-04T00:00:00Z',
    ];
    for (const [index, createdAt] of criticalDates.entries()) {
      matching.push(
        await seedPost({
          creatorId: other.id,
          postType: index % 2 === 0 ? 'RESCUE' : 'LOST',
          title: `Zebra critical ${index}`,
          urgency: 'CRITICAL',
          createdAt: new Date(createdAt),
        }),
      );
    }
    for (let i = 0; i < 3; i += 1) {
      matching.push(
        await seedPost({
          creatorId: other.id,
          postType: 'RESCUE',
          title: `Zebra urgent ${i}`,
          urgency: 'URGENT',
          createdAt: new Date(`2026-01-0${i + 1}T00:00:00Z`),
        }),
      );
    }
    await seedPost({ creatorId: other.id, postType: 'RESCUE', title: 'Unrelated rescue', urgency: 'CRITICAL' });
    await seedPost({ creatorId: other.id, postType: 'LOST', title: 'Unrelated lost', urgency: 'URGENT' });
    await seedPost({ creatorId: other.id, postType: 'ADOPTION', title: 'Zebra adoption outside help feed' });

    const byUrgencyThenNewest = [...matching].sort(
      (a, b) =>
        a.urgency!.localeCompare(b.urgency!) ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );
    const expected = byUrgencyThenNewest.map((post) => post.id);

    const pages = await collectSearchPages(HELP_FEED, 'helpFeed', { cityId: cairo.id, search: 'zebra' }, viewer, 2);
    expect(pages.map((page) => page.pageInfo.hasNextPage)).toEqual([true, true, true, false]);
    const collected = pages.flatMap(ids);
    expect(collected).toEqual(expected);
    expect(new Set(collected).size).toBe(matching.length);

    const unfiltered = await runFeed(HELP_FEED, 'helpFeed', { cityId: cairo.id, first: 20 }, viewer);
    const matchingIds = new Set(expected);
    expect(ids(unfiltered).filter((id) => matchingIds.has(id))).toEqual(expected);
  });

  it('search composes with city, governorate and radius filters without changing them', async () => {
    const cairoMatch = await seedPost({ creatorId: other.id, postType: 'RESCUE', title: 'Zebra in Cairo' });
    const cairoMatchTwo = await seedPost({ creatorId: other.id, postType: 'LOST', title: 'Zebra near Cairo' });
    const gizaMatch = await seedPost({
      creatorId: other.id,
      postType: 'RESCUE',
      title: 'Zebra in Giza',
      cityId: giza.id,
    });
    const nearby = await seedPost({
      creatorId: other.id,
      postType: 'RESCUE',
      title: 'Zebra nearby',
      coordinates: { latitude: 30.05, longitude: 31.24 },
    });
    const farAway = await seedPost({
      creatorId: other.id,
      postType: 'LOST',
      title: 'Zebra far away',
      coordinates: { latitude: 28.5, longitude: 34.0 },
    });

    const byCity = await runFeed(
      HOME_FEED,
      'homeFeed',
      { cityId: giza.id, radiusKm: 5, search: 'zebra', first: 10 },
      viewer,
    );
    expect(ids(byCity)).toEqual([gizaMatch.id]);

    const byGovernorate = await runFeed(
      HOME_FEED,
      'homeFeed',
      { governorate: 'Cairo', search: 'zebra', first: 10 },
      viewer,
    );
    expect(new Set(ids(byGovernorate))).toEqual(new Set([nearby.id, farAway.id, cairoMatchTwo.id, cairoMatch.id]));

    const byRadius = await runFeed(
      HOME_FEED,
      'homeFeed',
      {
        cityId: cairo.id,
        search: 'zebra',
        viewerLocation: { latitude: 30.0444, longitude: 31.2357 },
        radiusKm: 5,
        first: 10,
      },
      viewer,
    );
    expect(new Set(ids(byRadius))).toEqual(new Set([cairoMatch.id, cairoMatchTwo.id, nearby.id]));
    expect(ids(byRadius)).not.toContain(farAway.id);
    expect(ids(byRadius)).not.toContain(gizaMatch.id);

    // The same composition works on help discovery.
    const helpByCity = await runFeed(
      HELP_FEED,
      'helpFeed',
      { cityId: giza.id, radiusKm: 5, search: 'zebra', first: 10 },
      viewer,
    );
    expect(ids(helpByCity)).toEqual([gizaMatch.id]);
  });

  it('search excludes isolated creators in either Block direction and non-ACTIVE Posts', async () => {
    const authorMatch = await seedPost({ creatorId: author.id, postType: 'RESCUE', title: 'Zebra by author' });
    const otherMatch = await seedPost({ creatorId: other.id, postType: 'RESCUE', title: 'Zebra by other' });
    await seedPost({ creatorId: other.id, postType: 'RESCUE', title: 'Zebra resolved', status: 'RESOLVED' });
    await seedPost({ creatorId: other.id, postType: 'RESCUE', title: 'Zebra removed', status: 'REMOVED' });
    await seedPost({ creatorId: other.id, postType: 'RESCUE', title: 'Zebra expired', status: 'EXPIRED' });
    await seedPost({ creatorId: other.id, postType: 'LOST', title: 'Zebra reunited', status: 'REUNITED' });

    for (const direction of ['viewer-blocks', 'author-blocks'] as const) {
      if (direction === 'viewer-blocks') {
        await setBlock(viewer, author);
      } else {
        await setBlock(author, viewer);
      }

      const home = await runFeed(HOME_FEED, 'homeFeed', { cityId: cairo.id, search: 'zebra', first: 20 }, viewer);
      expect(ids(home)).toEqual([otherMatch.id]);

      const help = await runFeed(HELP_FEED, 'helpFeed', { cityId: cairo.id, search: 'zebra', first: 20 }, viewer);
      expect(ids(help)).toEqual([otherMatch.id]);
    }

    await dbHelper.db.delete(blocks);
    const restored = await runFeed(HOME_FEED, 'homeFeed', { cityId: cairo.id, search: 'zebra', first: 20 }, viewer);
    expect(ids(restored)).toEqual([otherMatch.id, authorMatch.id]);
  });

  it('empty and normalized-empty search keeps the unfiltered feed while short and oversize search are rejected', async () => {
    await seedPost({ creatorId: other.id, postType: 'RESCUE', title: 'Zebra one' });
    await seedPost({ creatorId: other.id, postType: 'LOST', title: 'Zebra two' });
    await seedPost({ creatorId: other.id, postType: 'ADOPTION', title: 'Unrelated' });

    const baseline = ids(await runFeed(HOME_FEED, 'homeFeed', { cityId: cairo.id, first: 20 }, viewer));

    for (const search of [null, '', '   ', 'ًَ']) {
      const page = await runFeed(HOME_FEED, 'homeFeed', { cityId: cairo.id, search, first: 20 }, viewer);
      expect({ search, ids: ids(page) }).toEqual({ search, ids: baseline });
    }

    const helpBaseline = ids(await runFeed(HELP_FEED, 'helpFeed', { cityId: cairo.id, first: 20 }, viewer));
    const helpEmpty = await runFeed(HELP_FEED, 'helpFeed', { cityId: cairo.id, search: '  ', first: 20 }, viewer);
    expect(ids(helpEmpty)).toEqual(helpBaseline);

    for (const source of [HOME_FEED, HELP_FEED]) {
      const short = await runGql<Record<string, unknown>>(source, { cityId: cairo.id, search: 'x' }, viewer);
      expect(short.errors).toHaveLength(1);
      expect(short.errors![0].message).toContain('search must be at least 2 characters');

      const oversize = await runGql<Record<string, unknown>>(
        source,
        { cityId: cairo.id, search: 'a'.repeat(101) },
        viewer,
      );
      expect(oversize.errors).toHaveLength(1);
      expect(oversize.errors![0].message).toContain('search must be at most 100 characters');
    }
  });

  it('query and stored text share one normalization via the database function', async () => {
    const inputs = [
      '  Lost   DOG ',
      'أَحْمَد',
      'كـــلب',
      'المعادى',
      'القاهرة',
      'قاهره',
      'الجيزة',
      'ًَ',
      'GIZA',
      'Maadi',
      'مِنطَقَة',
      'Mixed عربي و English 123',
    ];

    for (const input of inputs) {
      const result = await dbHelper.pool.query<{ normalized: string }>(
        'SELECT pupzy_search_normalize($1) AS normalized',
        [input],
      );
      expect({ input, normalized: result.rows[0].normalized }).toEqual({
        input,
        normalized: normalizeSearchText(input),
      });
    }
  });

  it('query-plan evidence: search filters in SQL through the normalized trigram index with dense pages', async () => {
    const captured: Array<{ sql: string; params: unknown[] }> = [];
    const capturingDb: NodePgDatabase<typeof schema> = drizzle(dbHelper.pool, {
      schema,
      logger: {
        logQuery(query: string, params: unknown[]) {
          captured.push({ sql: query, params: [...params] });
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

    const postTypes: PostType[] = ['RESCUE', 'LOST', 'ADOPTION', 'PRODUCT', 'MATING'];
    const rows = Array.from({ length: 6_000 }, (_, index) => {
      const type = postTypes[index % postTypes.length];
      const isUrgencyType = type === 'RESCUE' || type === 'LOST';
      return {
        creatorId: other.id,
        postType: type,
        title: index % 97 === 0 ? `Plan fixture zzsearchtoken ${index}` : `Plan fixture ${index}`,
        description: 'Plan fixture description',
        status: index % 200 === 1 ? 'RESOLVED' : 'ACTIVE',
        urgency: isUrgencyType ? ('URGENT' as const) : undefined,
        marketCategory: type === 'PRODUCT' ? ('FOOD' as const) : undefined,
        cityId: cairo.id,
        governorate: cairo.governorate,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
        effectiveScore: 0,
      };
    });
    for (let i = 0; i < rows.length; i += 1_000) {
      await dbHelper.db.insert(posts).values(rows.slice(i, i + 1_000));
    }

    // VACUUM flushes the GIN pending list so the planner prices the trigram
    // index from its main structure rather than the recent inserts.
    await dbHelper.pool.query('VACUUM (ANALYZE) posts');
    await dbHelper.pool.query('VACUUM (ANALYZE) blocks');
    await dbHelper.pool.query('VACUUM (ANALYZE) cities');

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

    captured.length = 0;
    await planService.getHomeFeed({ governorate: cairo.governorate, first: 20, search: 'zzsearchtoken' }, viewer.id);
    expect(captured).toHaveLength(2);
    const homeSearchSql = captured[captured.length - 1];
    expect(homeSearchSql.sql).toContain('pupzy_search_normalize');
    expect(homeSearchSql.sql).toContain('LIKE');

    const homePlan = await explain(homeSearchSql);
    console.log('### Home Feed search plan');
    console.log(JSON.stringify(homePlan, null, 2));
    const homeNodes = flatten(homePlan);
    const homeLimit = homeNodes.find((node) => node['Node Type'] === 'Limit');
    expect(homeLimit?.['Actual Rows']).toBe(21);
    const searchIndexScan = homeNodes.find((node) => node['Index Name'] === 'idx_posts_search_document_trgm');
    expect(searchIndexScan).toBeDefined();
    expect(String(searchIndexScan!['Node Type'])).toMatch(/Index|Bitmap/);

    captured.length = 0;
    await planService.getHelpFeed({ governorate: cairo.governorate, first: 20, search: 'zzsearchtoken' }, viewer.id);
    expect(captured).toHaveLength(2);
    const helpSearchSql = captured[captured.length - 1];
    expect(helpSearchSql.sql).toContain('pupzy_search_normalize');

    const helpPlan = await explain(helpSearchSql);
    console.log('### Help Feed search plan');
    console.log(JSON.stringify(helpPlan, null, 2));
    const helpNodes = flatten(helpPlan);
    expect(helpNodes.find((node) => node['Node Type'] === 'Limit')).toBeDefined();
    expect(helpNodes.find((node) => node['Index Name'] === 'idx_posts_search_document_trgm')).toBeDefined();
  });
});

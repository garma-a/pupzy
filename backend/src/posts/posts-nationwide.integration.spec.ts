import { sql } from 'drizzle-orm';
import type { Cache } from 'cache-manager';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import { blocks, cities, posts, users, type City, type NewPost, type Post, type User } from '../database/schema';
import { CitiesService } from '../cities/cities.service';
import { UploadService } from '../upload/upload.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ViewFlushCron } from './view-flush.cron';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';
import { PostsResolver } from './posts.resolver';
import type { GqlContext } from '../common/types/gql-context.type';

type FeedMethod = 'helpFeed' | 'adoptFeed' | 'marketFeed' | 'homeFeed';
const feeds: Array<{ method: FeedMethod; postType: Post['postType']; sort: 'HOT' | 'NEWEST' }> = [
  { method: 'helpFeed', postType: 'RESCUE', sort: 'HOT' },
  { method: 'adoptFeed', postType: 'ADOPTION', sort: 'HOT' },
  { method: 'adoptFeed', postType: 'ADOPTION', sort: 'NEWEST' },
  { method: 'marketFeed', postType: 'PRODUCT', sort: 'HOT' },
  { method: 'marketFeed', postType: 'PRODUCT', sort: 'NEWEST' },
  { method: 'homeFeed', postType: 'RESCUE', sort: 'HOT' },
];

describe('Nationwide Post feeds (integration)', () => {
  const dbHelper = new TestDatabaseHelper();
  let resolver: PostsResolver;
  let cairo: City;
  let aswan: City;
  let viewer: User;
  let author: User;
  let blocked: User;
  let blockedBy: User;
  let sequence = 0;
  const timestamp = new Date('2026-10-01T12:00:00.000Z');

  beforeAll(async () => {
    await dbHelper.start();
    resolver = new PostsResolver(
      new PostsService(
        new PostsRepository(dbHelper.db),
        {} as CitiesService,
        {} as UploadService,
        {} as ViewFlushCron,
        {} as UsersService,
        {} as NotificationsService,
        {} as Cache,
      ),
    );
  }, 180_000);

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();
    sequence = 0;
    [cairo, aswan] = await dbHelper.db
      .insert(cities)
      .values([
        {
          nameEnglish: 'Cairo',
          nameArabic: 'القاهرة',
          governorate: 'Cairo',
          status: 'OFFICIAL',
          centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
        },
        {
          nameEnglish: 'Aswan',
          nameArabic: 'أسوان',
          governorate: 'Aswan',
          status: 'OFFICIAL',
          centerPoint: sql`ST_SetSRID(ST_MakePoint(32.8998, 24.0889), 4326)`,
        },
      ])
      .returning();
    [viewer, author, blocked, blockedBy] = await dbHelper.db
      .insert(users)
      .values(
        ['viewer', 'author', 'blocked', 'blocked-by'].map((name) => ({
          firebaseUserId: `nationwide-${name}`,
          email: `${name}@pupzy.dev`,
          fullName: name,
        })),
      )
      .returning();
    await dbHelper.db.insert(blocks).values([
      { blockerId: viewer.id, blockedId: blocked.id },
      { blockerId: blockedBy.id, blockedId: viewer.id },
    ]);
  });

  async function seed(postType: Post['postType'], city: City, overrides: Partial<NewPost> = {}) {
    sequence += 1;
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        id: `0192f1ee-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
        creatorId: author.id,
        postType,
        title: 'Nationwide zebra Post',
        description: 'Feed regression fixture',
        cityId: city.id,
        governorate: city.governorate,
        coordinates: city.id === cairo.id ? [31.2357, 30.0444] : [32.8998, 24.0889],
        urgency: postType === 'RESCUE' || postType === 'LOST' ? 'URGENT' : null,
        marketCategory: postType === 'PRODUCT' ? 'FOOD' : null,
        effectiveScore: 10,
        createdAt: timestamp,
        listedAt: timestamp,
        ...overrides,
      })
      .returning();
    return post;
  }

  describe.each(feeds)('$method $sort', ({ method, postType, sort }) => {
    function page(overrides: Record<string, unknown> = {}) {
      return resolver[method](
        {
          governorate: cairo.governorate,
          cityId: cairo.id,
          viewerLocation: { latitude: 30.0444, longitude: 31.2357 },
          radiusKm: null,
          sort,
          category: 'FOOD',
          search: 'zebra',
          first: 20,
          ...overrides,
        },
        { user: viewer } as GqlContext,
      );
    }

    it.each([null, undefined])('radius %s includes distant Posts and preserves all other filters', async (radiusKm) => {
      const near = await seed(postType, cairo);
      const far = await seed(postType, aswan);
      await seed(postType, aswan, { creatorId: blocked.id });
      await seed(postType, aswan, { creatorId: blockedBy.id });
      await seed(postType, aswan, { status: 'REMOVED' });
      await seed(postType, aswan, { title: 'Unmatched Post' });
      if (method !== 'homeFeed') await seed('MATING', aswan);
      if (method === 'marketFeed') await seed(postType, aswan, { marketCategory: 'CARE' });

      // Exercise GPS, City center and governorate-only inputs. Administrative
      // fields sent by installed Flutter clients must never scope these pages.
      for (const location of [{}, { viewerLocation: null }, { viewerLocation: null, cityId: null }]) {
        const result = await page({ radiusKm, ...location });
        expect(result.edges.map((edge) => edge.node.id)).toEqual([far.id, near.id]);
        expect(result.pageInfo.hasNextPage).toBe(false);
        const distance = result.edges[0].distanceKm;
        if (location.cityId === null) expect(distance).toBeNull();
        else expect(distance).toBeGreaterThan(600);
      }
    });

    it('numeric radius still filters by proximity and falls back to governorate/City', async () => {
      const near = await seed(postType, cairo);
      await seed(postType, aswan);
      for (const location of [
        {},
        { viewerLocation: null },
        { viewerLocation: null, cityId: null },
        { viewerLocation: null, cityId: '0192ffff-0000-7000-8000-000000000000' },
      ]) {
        const result = await page({ radiusKm: 50, ...location });
        // An unknown City cannot resolve a center and retains City equality.
        expect(result.edges.map((edge) => edge.node.id)).toEqual(
          location.cityId?.startsWith('0192ffff') ? [] : [near.id],
        );
      }
    });

    it('paginates nationwide over tied ranking keys without duplicates or gaps', async () => {
      const eligible = [
        await seed(postType, cairo),
        await seed(postType, aswan),
        await seed(method === 'helpFeed' ? 'LOST' : postType, cairo),
        await seed(method === 'homeFeed' ? 'MATING' : postType, aswan),
      ];
      // Interleave isolated and ineligible rows above the page boundary.
      await seed(postType, aswan, { creatorId: blocked.id });
      await seed(postType, aswan, { creatorId: blockedBy.id });
      await seed(postType, aswan, { status: 'REMOVED' });
      const first = await page({ first: 2 });
      expect(first.pageInfo.hasNextPage).toBe(true);
      const second = await page({ first: 2, after: first.pageInfo.endCursor });
      expect(second.pageInfo.hasNextPage).toBe(false);
      const ids = [...first.edges, ...second.edges].map((edge) => edge.node.id);
      expect(ids).toEqual(eligible.map((post) => post.id).reverse());
      expect(new Set(ids).size).toBe(4);
      const end = await page({ first: 2, after: second.pageInfo.endCursor });
      expect(end.edges).toEqual([]);
      expect(end.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
    });
  });
});

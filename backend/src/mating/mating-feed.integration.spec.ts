import { sql } from 'drizzle-orm';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  blocks,
  cities,
  matingPosts,
  posts,
  users,
  type City,
  type NewMatingPostRow,
  type NewPost,
  type User,
} from '../database/schema';
import type { GqlContext } from '../common/types/gql-context.type';
import type { FeedLocationInput } from '../posts/dto/feed-query.input';
import { CitiesService } from '../cities/cities.service';
import { UploadService } from '../upload/upload.service';
import { MatingRepository } from './mating.repository';
import { MatingService, type MatingFeedFilterInput } from './mating.service';
import { MatingResolver } from './mating.resolver';

describe('Mating feed distance (integration)', () => {
  const dbHelper = new TestDatabaseHelper();
  let resolver: MatingResolver;
  let cairo: City;
  let nearby: City;
  let aswan: City;
  let viewer: User;
  let author: User;
  let blocked: User;
  let blockedBy: User;
  let sequence = 0;
  const timestamp = new Date('2026-10-01T12:00:00.000Z');
  const cairoLocation = { latitude: 30.0444, longitude: 31.2357 };
  const aswanLocation = { latitude: 24.0889, longitude: 32.8998 };

  beforeAll(async () => {
    await dbHelper.start();
    resolver = new MatingResolver(
      new MatingService(new MatingRepository(dbHelper.db), {} as CitiesService, {} as UploadService),
    );
  }, 180_000);

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();
    sequence = 0;
    [cairo, nearby, aswan] = await dbHelper.db
      .insert(cities)
      .values([
        {
          nameEnglish: 'Cairo',
          nameArabic: 'القاهرة',
          governorate: 'Cairo',
          centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
        },
        {
          // Different City and governorate, about 2 km from the Cairo fixture.
          nameEnglish: 'Nearby Giza district',
          nameArabic: 'حي الجيزة القريب',
          governorate: 'Giza',
          centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2157, 30.0444), 4326)`,
        },
        {
          nameEnglish: 'Aswan',
          nameArabic: 'أسوان',
          governorate: 'Aswan',
          centerPoint: sql`ST_SetSRID(ST_MakePoint(32.8998, 24.0889), 4326)`,
        },
      ])
      .returning();
    [viewer, author, blocked, blockedBy] = await dbHelper.db
      .insert(users)
      .values(
        ['viewer', 'author', 'blocked', 'blocked-by'].map((name) => ({
          firebaseUserId: `mating-distance-${name}`,
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

  async function seed(city: City, overrides: Partial<NewPost> = {}, details: Partial<NewMatingPostRow> = {}) {
    sequence += 1;
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        id: `0192f1ee-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
        creatorId: author.id,
        postType: 'MATING',
        title: 'Zebra mating Post',
        description: 'Distance regression fixture',
        cityId: city.id,
        governorate: city.governorate,
        coordinates: city.centerPoint,
        createdAt: timestamp,
        ...overrides,
      })
      .returning();
    if (post.postType === 'MATING') {
      await dbHelper.db.insert(matingPosts).values({
        postId: post.id,
        petName: 'Max',
        species: 'DOG',
        gender: 'FEMALE',
        breed: 'Golden Retriever',
        ageValue: 2,
        ageUnit: 'YEARS',
        ...details,
      });
    }
    return post;
  }

  function page(
    options: FeedLocationInput & {
      filter?: MatingFeedFilterInput | null;
      first?: number;
      after?: string | null;
    } = {},
  ) {
    return resolver.matingFeed(
      options.filter === undefined ? { cityId: cairo.id } : (options.filter ?? undefined),
      options.first ?? 20,
      options.after ?? undefined,
      'zebra',
      { user: viewer } as GqlContext,
      options.viewerLocation,
      options.radiusKm,
    );
  }

  it.each([null, undefined])(
    'radius %s includes other Cities and governorates for installed clients',
    async (radiusKm) => {
      const local = await seed(cairo);
      const near = await seed(nearby);
      const far = await seed(aswan);
      await seed(aswan, { status: 'REMOVED' });
      await seed(aswan, { status: 'RESOLVED' });
      await seed(aswan, { postType: 'ADOPTION' });
      await seed(aswan, { title: 'Unmatched Post' });
      const result = await page({ radiusKm });
      expect(result.edges.map((edge) => edge.node.id)).toEqual([far.id, near.id, local.id]);
      expect(result.pageInfo.hasNextPage).toBe(false);
    },
  );

  it('numeric radius around a City includes a nearby different City and excludes distant Posts', async () => {
    const local = await seed(cairo);
    const near = await seed(nearby);
    await seed(aswan);
    const result = await page({ radiusKm: 5 });
    expect(result.edges.map((edge) => edge.node.id)).toEqual([near.id, local.id]);
  });

  it('viewerLocation takes precedence over City and also works without City', async () => {
    await seed(cairo);
    await seed(nearby);
    const far = await seed(aswan);
    for (const filter of [{ cityId: cairo.id }, null]) {
      const result = await page({ filter, viewerLocation: aswanLocation, radiusKm: 5 });
      expect(result.edges.map((edge) => edge.node.id)).toEqual([far.id]);
    }
  });

  it('uses the documented numeric-radius fallbacks when no centre resolves', async () => {
    const local = await seed(cairo);
    const far = await seed(aswan);
    const unknownCity = '0192ffff-0000-7000-8000-000000000000';
    expect((await page({ filter: { cityId: unknownCity }, radiusKm: 50 })).edges).toEqual([]);
    const result = await page({ filter: null, radiusKm: 50 });
    expect(result.edges.map((edge) => edge.node.id)).toEqual([far.id, local.id]);
  });

  const modes = ['nationwide', 'City radius', 'viewer radius', 'no location'] as const;
  function location(mode: (typeof modes)[number]) {
    if (mode === 'City radius') return { radiusKm: 5 };
    if (mode === 'viewer radius') return { radiusKm: 5, viewerLocation: aswanLocation };
    if (mode === 'no location') return { radiusKm: 5, filter: null };
    return { radiusKm: null };
  }

  it.each(modes)('keeps both Block directions isolated in %s mode', async (mode) => {
    const local = await seed(cairo);
    const far = await seed(aswan);
    for (const city of [cairo, nearby, aswan]) {
      await seed(city, { creatorId: blocked.id });
      await seed(city, { creatorId: blockedBy.id });
    }
    const result = await page(location(mode));
    const expected = mode === 'City radius' ? [local.id] : mode === 'viewer radius' ? [far.id] : [far.id, local.id];
    expect(result.edges.map((edge) => edge.node.id)).toEqual(expected);
  });

  it.each([null, 5])('composes species, gender, partial breed and search with radius %s', async (radiusKm) => {
    const near = await seed(nearby);
    const far = await seed(aswan);
    await seed(nearby, {}, { species: 'CAT' });
    await seed(nearby, {}, { gender: 'MALE' });
    await seed(nearby, {}, { breed: 'Mixed' });
    await seed(nearby, { title: 'Unmatched Post' });
    const result = await page({
      filter: { cityId: cairo.id, species: 'DOG', gender: 'FEMALE', breed: 'retrIEVer' },
      viewerLocation: cairoLocation,
      radiusKm,
    });
    expect(result.edges.map((edge) => edge.node.id)).toEqual(radiusKm === null ? [far.id, near.id] : [near.id]);
  });

  it('paginates two nationwide pages over tied timestamps without duplicates or gaps', async () => {
    const eligible = [await seed(cairo), await seed(aswan)];
    await seed(aswan, { creatorId: blocked.id });
    eligible.push(await seed(nearby));
    await seed(cairo, { creatorId: blockedBy.id });
    eligible.push(await seed(aswan));
    await seed(aswan, { status: 'REMOVED' });
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

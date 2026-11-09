import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from '../database/schema';
import { PostsRepository } from './posts.repository';

const methods = ['findHelpFeed', 'findAdoptFeed', 'findMarketFeed', 'findHomeFeed'] as const;

describe('Post feed location SQL', () => {
  const cityId = '01916327-0000-7000-8000-000000000001';
  const viewerId = '01916327-0000-7000-8000-000000000002';
  const center = 'SRID=4326;POINT(31.2357 30.0444)';
  let query: jest.Mock;
  let repository: PostsRepository;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] });
    repository = new PostsRepository(drizzle({ query } as unknown as Pool, { schema }));
  });

  describe.each(methods)('%s', (method) => {
    const parameters = {
      governorate: 'Cairo',
      cityId,
      viewerLocation: { latitude: 30.0444, longitude: 31.2357 },
      sort: 'HOT' as const,
      category: 'FOOD' as const,
      limit: 2,
      cursor: null,
      viewerId,
    };

    function feedSql(): string {
      const [config] = query.mock.calls.at(-1)! as [{ text: string }];
      return config.text;
    }

    function feedParams(): unknown[] {
      const [, params] = query.mock.calls.at(-1)! as [unknown, unknown[]];
      return params;
    }

    it.each([null, undefined])(
      'radius %s omits every location predicate but keeps distance and isolation',
      async (radiusKm) => {
        await repository[method]({ ...parameters, radiusKm });
        const statement = feedSql();
        const where = statement.split(' where ')[1];
        expect(statement).toContain('ST_Distance');
        expect(where).not.toContain('ST_DWithin');
        expect(where).not.toContain('"posts"."city_id"');
        expect(where).not.toContain('"posts"."governorate"');
        expect(where).toContain('"posts"."status" =');
        expect(where).toContain('"posts"."creator_id" NOT IN');
        expect(where).toContain('"blocks"."blocked_id"');
        expect(where).toContain('"blocks"."blocker_id"');
        if (method !== 'findHomeFeed') expect(where).toContain('"posts"."post_type"');
        if (method === 'findMarketFeed') expect(where).toContain('"posts"."market_category" =');
      },
    );

    it('keeps both radius predicates and the same ordering for numeric radii', async () => {
      await repository[method]({ ...parameters, radiusKm: null });
      const nationwideOrdering = feedSql().split(' order by ')[1].split(' limit ')[0];
      await repository[method]({ ...parameters, radiusKm: 50 });
      expect(feedSql().match(/ST_DWithin/g)).toHaveLength(2);
      expect(feedParams()).toContain(50_000);
      expect(feedSql().split(' order by ')[1].split(' limit ')[0]).toBe(nationwideOrdering);
    });

    it('resolves City distance nationwide without adding a City predicate', async () => {
      query.mockResolvedValueOnce({ rows: [[center]] });
      await repository[method]({ ...parameters, viewerLocation: null });
      expect(query).toHaveBeenCalledTimes(2);
      expect(feedSql()).toContain('ST_Distance');
      expect(feedParams()).toContain(center);
      expect(feedSql().split(' where ')[1]).not.toContain('"posts"."city_id"');
    });

    it('returns a null distance without a center and ignores governorate nationwide', async () => {
      await repository[method]({ ...parameters, viewerLocation: null, cityId: null, radiusKm: null });
      expect(feedSql()).toContain('NULL::double precision');
      expect(feedSql().split(' where ')[1]).not.toContain('"posts"."governorate"');
    });

    it('retains governorate and City fallback filtering for numeric radii', async () => {
      await repository[method]({ ...parameters, viewerLocation: null, cityId: null, radiusKm: 50 });
      expect(feedSql().split(' where ')[1]).toContain('"posts"."governorate" =');
      // No City center found: the historical fallback is exact City equality.
      await repository[method]({ ...parameters, viewerLocation: null, radiusKm: 50 });
      expect(feedSql().split(' where ')[1]).toContain('"posts"."city_id" =');
    });
  });
});

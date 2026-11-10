import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from '../database/schema';
import { MatingRepository } from './mating.repository';

describe('Mating feed location SQL', () => {
  const cityId = '01916327-0000-7000-8000-000000000001';
  const viewerId = '01916327-0000-7000-8000-000000000002';
  const center = 'SRID=4326;POINT(31.2357 30.0444)';
  let query: jest.Mock;
  let repository: MatingRepository;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] });
    repository = new MatingRepository(drizzle({ query } as unknown as Pool, { schema }));
  });

  const parameters = { filter: { cityId }, limit: 2, cursor: null, viewerId };

  function feedSql(): string {
    const [config] = query.mock.calls.at(-1)! as [{ text: string }];
    return config.text;
  }

  function feedParams(): unknown[] {
    const [, params] = query.mock.calls.at(-1)! as [unknown, unknown[]];
    return params;
  }

  it.each([null, undefined])('radius %s ignores City scoping and preserves isolation/status', async (radiusKm) => {
    await repository.findFeed({ ...parameters, radiusKm });
    const where = feedSql().split(' where ')[1];
    expect(where).not.toContain('"posts"."city_id"');
    expect(where).not.toContain('ST_DWithin');
    expect(where).toContain('"posts"."post_type" =');
    expect(where).toContain('"posts"."status" =');
    expect(where).toContain('"posts"."creator_id" NOT IN');
    expect(where).toContain('"blocks"."blocked_id"');
    expect(where).toContain('"blocks"."blocker_id"');
  });

  it('uses the City center for numeric radius without City equality', async () => {
    query.mockResolvedValueOnce({ rows: [[center]] });
    await repository.findFeed({ ...parameters, radiusKm: 50 });
    expect(query).toHaveBeenCalledTimes(2);
    expect(feedSql().match(/ST_DWithin/g)).toHaveLength(2);
    expect(feedSql().split(' where ')[1]).not.toContain('"posts"."city_id"');
    expect(feedParams()).toEqual(expect.arrayContaining([center, 50_000]));
  });

  it('prefers viewer coordinates to the City and keeps the ordering', async () => {
    await repository.findFeed(parameters);
    const ordering = feedSql().split(' order by ')[1].split(' limit ')[0];
    query.mockClear();
    await repository.findFeed({
      ...parameters,
      radiusKm: 5,
      viewerLocation: { latitude: 24.0889, longitude: 32.8998 },
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(feedParams()).toContain('SRID=4326;POINT(32.8998 24.0889)');
    expect(feedParams()).toContain(5_000);
    expect(feedSql().split(' order by ')[1].split(' limit ')[0]).toBe(ordering);
  });

  it('falls back to City equality when a numeric radius has no center', async () => {
    await repository.findFeed({ ...parameters, radiusKm: 50 });
    expect(feedSql()).not.toContain('ST_DWithin');
    expect(feedSql().split(' where ')[1]).toContain('"posts"."city_id" =');
    expect(feedParams()).toContain(cityId);
  });

  it('uses no location condition when a numeric radius has neither City nor viewer', async () => {
    await repository.findFeed({ ...parameters, filter: {}, radiusKm: 50 });
    expect(feedSql()).not.toContain('ST_DWithin');
    expect(feedSql().split(' where ')[1]).not.toContain('"posts"."city_id"');
  });
});

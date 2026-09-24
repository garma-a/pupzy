import { sql } from 'drizzle-orm';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import { cities, posts, users } from '../database/schema';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';

/**
 * Regression: migration 0001 left posts.coordinates as `geometry(point)` with no
 * SRID. The create mutations insert a [longitude, latitude] tuple, which lands
 * with SRID 0, so on any database built from migrations every radius-filtered
 * feed (helpFeed with a city, etc.) failed with "Operation on mixed SRID
 * geometries". Existing fixtures masked it by inserting ST_SetSRID(…, 4326)
 * directly; this test inserts exactly the way PostsService does.
 */
describe('posts.coordinates SRID (integration)', () => {
  const dbHelper = new TestDatabaseHelper();

  beforeAll(async () => {
    await dbHelper.start();
  }, 180_000);

  afterAll(async () => {
    await dbHelper.stop();
  });

  it('declares geometry(Point, 4326) after migrations', async () => {
    const { rows } = await dbHelper.pool.query<{ type: string }>(
      `SELECT format_type(a.atttypid, a.atttypmod) AS type
         FROM pg_attribute a
        WHERE a.attrelid = 'public.posts'::regclass AND a.attname = 'coordinates'`,
    );
    expect(rows[0].type).toBe('geometry(Point,4326)');
  });

  it('stores tuple-inserted points with SRID 4326 so radius filters work', async () => {
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
    const [user] = await dbHelper.db
      .insert(users)
      .values({ firebaseUserId: `fb-${generateUuidV7()}`, email: `${generateUuidV7()}@pupzy.dev`, fullName: 'SRID' })
      .returning();

    // Same shape PostsService.createRescuePost passes: a [lng, lat] tuple.
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId: user.id,
        postType: 'RESCUE',
        title: 'SRID regression',
        description: 'Inserted through the tuple path',
        urgency: 'URGENT',
        cityId: city.id,
        governorate: city.governorate,
        coordinates: [31.2351, 30.0431],
      })
      .returning();

    const { rows } = await dbHelper.pool.query<{ srid: number; near: boolean }>(
      `SELECT ST_SRID(coordinates) AS srid,
              ST_DWithin(coordinates, ST_GeomFromEWKT('SRID=4326;POINT(31.2357 30.0444)'), 0.2) AS near
         FROM posts WHERE id = $1`,
      [post.id],
    );
    expect(rows[0]).toEqual({ srid: 4326, near: true });
  });
});

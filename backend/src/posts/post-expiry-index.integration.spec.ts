import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { cities, posts, users } from '../database/schema';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { PostsRepository } from './posts.repository';
import { PostExpiryProcessor } from './post-expiry.processor';

/**
 * Query-plan evidence for the RESCUE/LOST stand-alone inactivity reminder.
 *
 * Migration 0009 created `idx_posts_last_engaged` with a predicate limited to
 * ADOPTION/PRODUCT, so the reminder candidate query for RESCUE and LOST could
 * not use it. Migration 0056 widens the predicate; this spec runs the real
 * processor query and asserts the planner picks the index.
 */

const DAY_MINUTES = 24 * 60;

/** Old enough to be a reminder candidate for the 60-day RESCUE/LOST window. */
const OVERDUE_MINUTES = 61 * DAY_MINUTES;

/** Rows per type: a small overdue slice inside a larger active population. */
const OVERDUE_ROWS = 500;
const RECENT_ROWS = 9_500;

interface CapturedQuery {
  sql: string;
  params: unknown[];
}

interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

describe('Inactivity reminder candidate index (standards fix)', () => {
  jest.setTimeout(240_000);

  let dbHelper: TestDatabaseHelper;
  let processor: PostExpiryProcessor;
  let captured: CapturedQuery[];
  let cityId: string;
  let ownerId: string;
  let postSequence = 0;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();
  });

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();
    captured = [];
    postSequence = 0;

    const capturingDb: NodePgDatabase<typeof schema> = drizzle(dbHelper.pool, {
      schema,
      logger: {
        logQuery(query: string, params: unknown[]) {
          captured.push({ sql: query, params: [...params] });
        },
      },
    });
    processor = new PostExpiryProcessor(new PostsRepository(capturingDb), capturingDb);

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
    cityId = city.id;

    const [owner] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `fb-plan-${generateUuidV7()}`,
        email: `plan-${generateUuidV7()}@pupzy.dev`,
        fullName: 'Plan Owner',
      })
      .returning();
    ownerId = owner.id;
  });

  async function seedPosts(postType: 'RESCUE' | 'LOST'): Promise<void> {
    const ages = [
      ...Array.from({ length: OVERDUE_ROWS }, (_, index) => OVERDUE_MINUTES + index),
      ...Array.from({ length: RECENT_ROWS }, (_, index) => index),
    ];
    const rows = ages.map((minutes) => {
      postSequence += 1;
      return {
        id: `0192f4c0-0002-7000-8000-${String(postSequence).padStart(12, '0')}`,
        creatorId: ownerId,
        postType,
        title: `Plan ${postType} ${postSequence}`,
        description: 'Plan fixture',
        status: 'ACTIVE' as const,
        moderationStatus: 'CLEAN' as const,
        urgency: 'URGENT' as const,
        cityId,
        governorate: 'Cairo',
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
        effectiveScore: 0,
        lastEngagedAt: sql`now() - make_interval(mins => ${minutes}::int)`,
      };
    });

    for (let index = 0; index < rows.length; index += 1_000) {
      await dbHelper.db.insert(posts).values(rows.slice(index, index + 1_000));
    }
    await dbHelper.pool.query('VACUUM (ANALYZE) posts');
  }

  /** The real reminder candidate query captured from the processor. */
  function reminderQuery(postType: 'RESCUE' | 'LOST'): CapturedQuery {
    const query = captured.find(
      (entry) =>
        entry.sql.includes('reminder_sent_at IS NULL OR reminder_sent_at < last_engaged_at') &&
        entry.params.includes(postType),
    );
    expect(query).toBeDefined();
    return query!;
  }

  async function explain(entry: CapturedQuery): Promise<PlanNode> {
    const result = await dbHelper.pool.query<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>({
      text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${entry.sql}`,
      values: entry.params,
    });
    return result.rows[0]['QUERY PLAN'][0].Plan;
  }

  function flatten(node: PlanNode): PlanNode[] {
    return [node, ...(node.Plans ?? []).flatMap((child) => flatten(child))];
  }

  async function expectIndexUsed(postType: 'RESCUE' | 'LOST'): Promise<void> {
    await processor.processPendingExpiry();

    const query = reminderQuery(postType);
    const plan = await explain(query);
    console.log(`### ${postType} reminder candidate plan`);
    console.log(JSON.stringify(plan, null, 2));
    const nodes = flatten(plan);
    expect(nodes.find((node) => node['Node Type'] === 'Limit')).toBeDefined();
    const scan = nodes.find((node) => node['Index Name'] === 'idx_posts_last_engaged');
    expect(scan).toBeDefined();
    expect(String(scan!['Node Type'])).toMatch(/Index|Bitmap/);
  }

  it('covers every reminder type in the partial index predicate', async () => {
    const { rows } = await dbHelper.pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_posts_last_engaged'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain("'RESCUE'");
    expect(rows[0].indexdef).toContain("'LOST'");
    expect(rows[0].indexdef).toContain("'ADOPTION'");
    expect(rows[0].indexdef).toContain("'PRODUCT'");
  });

  it('serves the RESCUE 60-day reminder candidate query from the index', async () => {
    await seedPosts('RESCUE');
    await expectIndexUsed('RESCUE');
  });

  it('serves the LOST 60-day reminder candidate query from the index', async () => {
    await seedPosts('LOST');
    await expectIndexUsed('LOST');
  });
});

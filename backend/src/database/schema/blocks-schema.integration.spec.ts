import { eq } from 'drizzle-orm';
import { generateUuidV7 } from '../../common/utils/generate-uuidv7';
import { TestDatabaseHelper } from '../../../test/test-database.helper';
import { blocks, users } from './index';

interface ExplainPlanNode {
  'Node Type': string;
  'Index Name'?: string;
  Plans?: ExplainPlanNode[];
}

function collectIndexNames(node: ExplainPlanNode, names: string[] = []): string[] {
  if (node['Index Name']) names.push(node['Index Name']);
  for (const child of node.Plans ?? []) collectIndexNames(child, names);
  return names;
}

describe('Blocks schema (integration)', () => {
  let dbHelper: TestDatabaseHelper;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();
  }, 120_000);

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();
  });

  async function insertAccount(label: string) {
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `firebase-block-${label}-${generateUuidV7()}`,
        email: `block-${label}-${generateUuidV7()}@example.com`,
        fullName: `Block Fixture ${label}`,
      })
      .returning();
    return user;
  }

  async function insertBlock(blockerId: string, blockedId: string) {
    const [block] = await dbHelper.db.insert(blocks).values({ blockerId, blockedId }).returning();
    return block;
  }

  it('persists a directional Block with blocker, blocked account, and creation time', async () => {
    const [blocker, blocked] = await Promise.all([insertAccount('blocker'), insertAccount('blocked')]);

    const block = await insertBlock(blocker.id, blocked.id);

    expect(block.blockerId).toBe(blocker.id);
    expect(block.blockedId).toBe(blocked.id);
    expect(block.createdAt).toBeInstanceOf(Date);
  });

  it('prohibits self-blocking at the database', async () => {
    const account = await insertAccount('self');

    await expect(insertBlock(account.id, account.id)).rejects.toMatchObject({
      cause: { code: '23514' },
    });
  });

  it('prohibits duplicate ordered blocker/blocked pairs while allowing the reverse relationship', async () => {
    const [a, b] = await Promise.all([insertAccount('a'), insertAccount('b')]);
    await insertBlock(a.id, b.id);

    await expect(insertBlock(a.id, b.id)).rejects.toMatchObject({
      cause: { code: '23505' },
    });

    const reverse = await insertBlock(b.id, a.id);
    expect(reverse.blockerId).toBe(b.id);
    expect(reverse.blockedId).toBe(a.id);

    const rows = await dbHelper.db.select().from(blocks);
    expect(rows).toHaveLength(2);
  });

  it('cascades every Block involving a deleted account without affecting unrelated accounts', async () => {
    const [a, b, c, d] = await Promise.all([
      insertAccount('a'),
      insertAccount('b'),
      insertAccount('c'),
      insertAccount('d'),
    ]);
    await insertBlock(a.id, b.id);
    await insertBlock(b.id, a.id);
    await insertBlock(c.id, d.id);

    await dbHelper.db.delete(users).where(eq(users.id, b.id));

    const afterDeletingBlockedAccount = await dbHelper.db.select().from(blocks);
    expect(afterDeletingBlockedAccount).toHaveLength(1);
    expect(afterDeletingBlockedAccount[0].blockerId).toBe(c.id);
    expect(afterDeletingBlockedAccount[0].blockedId).toBe(d.id);

    await dbHelper.db.delete(users).where(eq(users.id, c.id));

    expect(await dbHelper.db.select().from(blocks)).toHaveLength(0);
    const survivingAccounts = await dbHelper.db.select({ id: users.id }).from(users);
    expect(survivingAccounts.map((row) => row.id).sort()).toEqual([a.id, d.id].sort());
  });

  it('exposes indexes for duplicate prevention, both Block directions, and newest-first pagination', async () => {
    const result = await dbHelper.pool.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'blocks' ORDER BY indexname
    `);
    const indexNames = result.rows.map((row) => row.indexname);

    expect(indexNames).toEqual(
      expect.arrayContaining([
        'blocks_pkey',
        'unique_block_ordered_pair',
        'idx_blocks_blocked',
        'idx_blocks_blocker_created',
      ]),
    );
  });

  it('uses the directional indexes for pair lookups and newest-first pagination', async () => {
    const [viewer, ...others] = await Promise.all(
      Array.from({ length: 20 }, (_, index) => insertAccount(`plan-${index}`)),
    );
    for (const other of others) {
      await insertBlock(viewer.id, other.id);
    }
    await insertBlock(others[0].id, viewer.id);

    const client = await dbHelper.pool.connect();
    try {
      await client.query('ANALYZE blocks');
      await client.query('SET enable_seqscan = off');

      const explainIndexes = async (text: string, params: unknown[]): Promise<string[]> => {
        const result = await client.query<{ 'QUERY PLAN': Array<{ Plan: ExplainPlanNode }> }>(
          `EXPLAIN (FORMAT JSON) ${text}`,
          params,
        );
        return collectIndexNames(result.rows[0]['QUERY PLAN'][0].Plan);
      };

      const directed = await explainIndexes('SELECT id FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [
        viewer.id,
        others[0].id,
      ]);
      expect(directed.some((name) => name === 'unique_block_ordered_pair' || name === 'idx_blocks_blocked')).toBe(true);

      const mutual = await explainIndexes(
        `SELECT id FROM blocks
         WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)
         LIMIT 1`,
        [viewer.id, others[0].id],
      );
      expect(mutual.some((name) => name === 'unique_block_ordered_pair' || name === 'idx_blocks_blocked')).toBe(true);

      const reverse = await explainIndexes('SELECT id FROM blocks WHERE blocked_id = $1 LIMIT 1', [viewer.id]);
      expect(reverse).toContain('idx_blocks_blocked');

      const pagination = await explainIndexes(
        'SELECT id, created_at FROM blocks WHERE blocker_id = $1 ORDER BY created_at DESC, id DESC LIMIT 10',
        [viewer.id],
      );
      expect(pagination).toContain('idx_blocks_blocker_created');
    } finally {
      await client.query('RESET enable_seqscan');
      client.release();
    }
  });
});

import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import { blocks, users } from '../database/schema';
import { AccountIsolationPolicy, canonicalAccountPairKey } from './account-isolation.policy';

// Fixed, lexicographically ordered UUIDs so canonical pair ordering is deterministic.
const ACCOUNT_A = '0192f0aa-0000-7000-8000-00000000000a';
const ACCOUNT_B = '0192f0bb-0000-7000-8000-00000000000b';
const ACCOUNT_C = '0192f0cc-0000-7000-8000-00000000000c';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('AccountIsolationPolicy (integration)', () => {
  let dbHelper: TestDatabaseHelper;
  let policy: AccountIsolationPolicy;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();
    policy = new AccountIsolationPolicy(dbHelper.db);
  }, 120_000);

  afterAll(async () => {
    await dbHelper.stop();
  }, 120_000);

  beforeEach(async () => {
    await dbHelper.clean();
  });

  async function insertAccount(label: string, id?: string) {
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        ...(id ? { id } : {}),
        firebaseUserId: `firebase-isolation-${label}-${generateUuidV7()}`,
        email: `isolation-${label}-${generateUuidV7()}@example.com`,
        fullName: `Isolation Fixture ${label}`,
      })
      .returning();
    return user;
  }

  async function insertBlock(blockerId: string, blockedId: string) {
    const [block] = await dbHelper.db.insert(blocks).values({ blockerId, blockedId }).returning();
    return block;
  }

  async function waitForWaitingAdvisoryLock(timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await dbHelper.pool.query<{ waiting: number }>(
        `SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`,
      );
      if ((result.rows[0]?.waiting ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for a transaction to block on an advisory lock');
  }

  async function canAcquirePairLock(firstAccountId: string, secondAccountId: string): Promise<boolean> {
    const key = canonicalAccountPairKey(firstAccountId, secondAccountId);
    return dbHelper.db.transaction(async (tx) => {
      const result = await tx.execute<{ acquired: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(hashtext('account_pair'), hashtext(${key})) AS acquired`,
      );
      return result.rows[0]?.acquired ?? false;
    });
  }

  it('reports no isolation when neither direction has a Block', async () => {
    const [a, b] = await Promise.all([insertAccount('a'), insertAccount('b')]);

    expect(await policy.isIsolated(a.id, b.id)).toBe(false);
    expect(await policy.isIsolated(b.id, a.id)).toBe(false);
    expect(await policy.isIsolated(a.id, a.id)).toBe(false);
    expect(await policy.accessDecision(a.id, b.id)).toBe('ACCESSIBLE');
  });

  it('treats a Block in either direction as mutual isolation for that pair only', async () => {
    const [a, b, c, d] = await Promise.all([
      insertAccount('a'),
      insertAccount('b'),
      insertAccount('c'),
      insertAccount('d'),
    ]);

    await insertBlock(a.id, b.id);
    expect(await policy.isIsolated(a.id, b.id)).toBe(true);
    expect(await policy.isIsolated(b.id, a.id)).toBe(true);
    expect(await policy.isIsolated(c.id, d.id)).toBe(false);

    await insertBlock(d.id, c.id);
    expect(await policy.isIsolated(c.id, d.id)).toBe(true);
    expect(await policy.isIsolated(d.id, c.id)).toBe(true);
  });

  it('exposes neutral decisions that do not disclose the Block initiator', async () => {
    const [a, b, c, d] = await Promise.all([
      insertAccount('a'),
      insertAccount('b'),
      insertAccount('c'),
      insertAccount('d'),
    ]);

    await insertBlock(a.id, b.id);
    await insertBlock(d.id, c.id);

    const decisions = await Promise.all([
      policy.accessDecision(a.id, b.id),
      policy.accessDecision(b.id, a.id),
      policy.accessDecision(c.id, d.id),
      policy.accessDecision(d.id, c.id),
    ]);
    expect(decisions).toEqual(['UNAVAILABLE', 'UNAVAILABLE', 'UNAVAILABLE', 'UNAVAILABLE']);
  });

  it('participates in a caller transaction so writes recheck isolation before commit', async () => {
    const [a, b] = await Promise.all([insertAccount('a'), insertAccount('b')]);

    const state = await dbHelper.db.transaction(async (tx) => {
      const before = await policy.lockPairAndRecheck(tx, a.id, b.id);
      await tx.insert(blocks).values({ blockerId: a.id, blockedId: b.id });
      const after = await policy.isIsolated(a.id, b.id, tx);
      return { before, after };
    });

    expect(state).toEqual({ before: false, after: true });
    expect(await policy.isIsolated(a.id, b.id)).toBe(true);
  });

  it('serializes a concurrent Block ahead of an interaction recheck in the same transaction', async () => {
    const [a, b] = await Promise.all([insertAccount('a'), insertAccount('b')]);
    const blockerReady = deferred();
    const blockerMayCommit = deferred();

    const blockingTransaction = dbHelper.db.transaction(async (tx) => {
      await policy.lockPair(tx, a.id, b.id);
      await tx.insert(blocks).values({ blockerId: a.id, blockedId: b.id });
      blockerReady.resolve();
      await blockerMayCommit.promise;
    });

    await blockerReady.promise;

    const interactionResult = dbHelper.db.transaction((tx) => policy.lockPairAndRecheck(tx, b.id, a.id));
    await waitForWaitingAdvisoryLock();

    blockerMayCommit.resolve();
    await blockingTransaction;

    await expect(interactionResult).resolves.toBe(true);
  }, 10_000);

  it('acquires multiple pair locks in deterministic canonical order', async () => {
    const [a, b, c] = await Promise.all([
      insertAccount('a', ACCOUNT_A),
      insertAccount('b', ACCOUNT_B),
      insertAccount('c', ACCOUNT_C),
    ]);
    const holderReady = deferred();
    const holderMayCommit = deferred();

    const holderTransaction = dbHelper.db.transaction(async (tx) => {
      await policy.lockPair(tx, b.id, c.id);
      holderReady.resolve();
      await holderMayCommit.promise;
    });

    await holderReady.promise;

    const multiPairTransaction = dbHelper.db.transaction((tx) =>
      policy.lockPairsAndRecheck(tx, [
        [b.id, c.id],
        [a.id, b.id],
      ]),
    );
    await waitForWaitingAdvisoryLock();

    // Canonical order is A:B before B:C, so the blocked transaction already
    // holds A:B even though B:C was requested first.
    await expect(canAcquirePairLock(a.id, b.id)).resolves.toBe(false);

    holderMayCommit.resolve();
    await holderTransaction;
    await expect(multiPairTransaction).resolves.toBe(false);

    await expect(canAcquirePairLock(a.id, b.id)).resolves.toBe(true);
  }, 10_000);

  it('runs overlapping multi-pair operations with reversed input orders without deadlock', async () => {
    const [a, b, c, d] = await Promise.all([
      insertAccount('a'),
      insertAccount('b'),
      insertAccount('c'),
      insertAccount('d'),
    ]);

    const results = await Promise.all([
      dbHelper.db.transaction((tx) =>
        policy.lockPairsAndRecheck(tx, [
          [a.id, b.id],
          [c.id, d.id],
          [b.id, c.id],
        ]),
      ),
      dbHelper.db.transaction((tx) =>
        policy.lockPairsAndRecheck(tx, [
          [b.id, c.id],
          [c.id, d.id],
          [a.id, b.id],
        ]),
      ),
    ]);

    expect(results).toEqual([false, false]);
  }, 10_000);
});

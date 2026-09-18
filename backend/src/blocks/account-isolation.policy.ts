import { Inject, Injectable } from '@nestjs/common';
import { and, eq, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import { blocks } from '../database/schema';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

/** Drizzle executor: the pooled database handle or a caller-owned transaction. */
export type AccountIsolationExecutor = NodePgDatabase<typeof schema> | DbTransaction;

/**
 * Neutral, direction-free outcome. Callers map `UNAVAILABLE` onto the same
 * not-found behavior they already use for inaccessible content, so no response
 * reveals which account initiated a Block.
 */
export type AccountAccessDecision = 'ACCESSIBLE' | 'UNAVAILABLE';

/**
 * Canonical undirected serialization key derived from the lexicographically
 * sorted Pupzy Account IDs: `block:<smaller>:<larger>`.
 */
export function canonicalAccountPairKey(firstAccountId: string, secondAccountId: string): string {
  const first = firstAccountId.toLowerCase();
  const second = secondAccountId.toLowerCase();
  return first <= second ? `block:${first}:${second}` : `block:${second}:${first}`;
}

/** Canonical keys for many account pairs, deduplicated and sorted for deterministic locking. */
export function canonicalAccountPairKeys(pairs: ReadonlyArray<readonly [string, string]>): string[] {
  return [...new Set(pairs.map(([first, second]) => canonicalAccountPairKey(first, second)))].sort();
}

function sortAccountPair(firstAccountId: string, secondAccountId: string): [string, string] {
  const first = firstAccountId.toLowerCase();
  const second = secondAccountId.toLowerCase();
  return first <= second ? [first, second] : [second, first];
}

/**
 * Account isolation policy seam for directional Blocks.
 *
 * Answers whether an active Block isolates a pair of Pupzy Accounts, and
 * serializes Block-sensitive operations on the canonical undirected pair lock
 * (`pg_advisory_xact_lock(hashtext('account_pair'), hashtext(key))`).
 *
 * Every method accepts a caller-provided executor so reads can filter inside
 * existing queries and writes can recheck isolation inside the transaction that
 * commits. Usage:
 * - Reads: `isIsolated(viewerId, authorId)` / `accessDecision(...)`, then map an
 *   isolated result onto the caller's existing not-found path.
 * - Single-pair writes: `lockPairAndRecheck(tx, actorId, otherId)` before commit.
 * - Multi-pair writes (e.g. Replies): `lockPairsAndRecheck(tx, pairs)` acquires
 *   every lock in deterministic canonical-key order, then rechecks inside `tx`.
 */
@Injectable()
export class AccountIsolationPolicy {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: NodePgDatabase<typeof schema>) {}

  /**
   * True when an active Block exists between the two Pupzy Accounts in either
   * direction. Both argument orders return the same value.
   */
  async isIsolated(
    firstAccountId: string,
    secondAccountId: string,
    executor: AccountIsolationExecutor = this.db,
  ): Promise<boolean> {
    if (firstAccountId === secondAccountId) return false;
    const [smaller, larger] = sortAccountPair(firstAccountId, secondAccountId);
    const [row] = await executor
      .select({ blockerId: blocks.blockerId })
      .from(blocks)
      .where(
        or(
          and(eq(blocks.blockerId, smaller), eq(blocks.blockedId, larger)),
          and(eq(blocks.blockerId, larger), eq(blocks.blockedId, smaller)),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** Neutral accessible/unavailable decision for a pair, without Block direction. */
  async accessDecision(
    firstAccountId: string,
    secondAccountId: string,
    executor: AccountIsolationExecutor = this.db,
  ): Promise<AccountAccessDecision> {
    return (await this.isIsolated(firstAccountId, secondAccountId, executor)) ? 'UNAVAILABLE' : 'ACCESSIBLE';
  }

  /** Acquires the canonical pair lock for one account pair inside `tx`. */
  async lockPair(tx: DbTransaction, firstAccountId: string, secondAccountId: string): Promise<void> {
    await this.acquirePairLock(tx, canonicalAccountPairKey(firstAccountId, secondAccountId));
  }

  /**
   * Acquires the canonical pair locks for many account pairs inside `tx`,
   * deduplicated and ordered by canonical key so overlapping multi-pair
   * operations cannot deadlock.
   */
  async lockPairs(tx: DbTransaction, pairs: ReadonlyArray<readonly [string, string]>): Promise<void> {
    for (const key of canonicalAccountPairKeys(pairs)) {
      await this.acquirePairLock(tx, key);
    }
  }

  /** Locks one pair and rechecks isolation inside the same transaction. */
  async lockPairAndRecheck(tx: DbTransaction, firstAccountId: string, secondAccountId: string): Promise<boolean> {
    await this.lockPair(tx, firstAccountId, secondAccountId);
    return this.isIsolated(firstAccountId, secondAccountId, tx);
  }

  /**
   * Locks many pairs deterministically and rechecks every pair inside the same
   * transaction. Returns true when any pair is isolated.
   */
  async lockPairsAndRecheck(tx: DbTransaction, pairs: ReadonlyArray<readonly [string, string]>): Promise<boolean> {
    await this.lockPairs(tx, pairs);
    for (const [first, second] of pairs) {
      if (await this.isIsolated(first, second, tx)) return true;
    }
    return false;
  }

  private async acquirePairLock(tx: DbTransaction, key: string): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('account_pair'), hashtext(${key}))`);
  }
}

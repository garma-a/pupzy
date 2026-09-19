import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import { blocks, users } from '../database/schema';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

/** Drizzle executor: the pooled database handle or a caller-owned transaction. */
export type BlocksExecutor = NodePgDatabase<typeof schema> | DbTransaction;

/**
 * One Blocked Accounts page row: the Block itself plus the minimal display
 * identity of the blocked Pupzy Account.
 */
export interface BlockedUserRow {
  blockId: string;
  blockedAt: Date;
  /**
   * Full-precision PostgreSQL text form of `created_at`. The JS Date in
   * `blockedAt` only carries milliseconds, which would make the id tie-breaker
   * unreachable for Blocks created within the same millisecond and could skip
   * rows; cursors therefore round-trip this microsecond-accurate string.
   */
  cursorCreatedAt: string;
  userId: string;
  fullName: string | null;
  fullNameArabic: string | null;
  profilePictureUrl: string | null;
  isVerified: boolean;
}

/**
 * BlocksRepository — data access for the directional `blocks` table.
 *
 * Every read/write accepts a caller-owned executor so Block creation can insert
 * the row inside the same transaction that rejects pending direct interactions
 * and holds the canonical account-pair lock.
 */
@Injectable()
export class BlocksRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: NodePgDatabase<typeof schema>) {}

  /** Finds the Block owned by `blockerId` that targets `blockedId`, if any. */
  async findDirected(
    blockerId: string,
    blockedId: string,
    executor: BlocksExecutor = this.db,
  ): Promise<{ id: string } | undefined> {
    const [row] = await executor
      .select({ id: blocks.id })
      .from(blocks)
      .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
      .limit(1);
    return row;
  }

  /** True when the Pupzy Account row still exists. */
  async userExists(userId: string, executor: BlocksExecutor = this.db): Promise<boolean> {
    const [row] = await executor.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    return row !== undefined;
  }

  /**
   * Inserts the directional Block. Returns false when an existing row already
   * satisfied the ordered-pair uniqueness constraint, so callers can treat the
   * request as an idempotent retry instead of an error.
   */
  async insert(blockerId: string, blockedId: string, executor: BlocksExecutor = this.db): Promise<boolean> {
    const inserted = await executor
      .insert(blocks)
      .values({ blockerId, blockedId })
      .onConflictDoNothing()
      .returning({ id: blocks.id });
    return inserted.length > 0;
  }

  /**
   * Removes only the Block owned by `blockerId` that targets `blockedId`.
   * A Block owned by the other party is never touched. Returns true when a row
   * was removed; an absent relationship is a successful no-op.
   */
  async deleteDirected(blockerId: string, blockedId: string, executor: BlocksExecutor = this.db): Promise<boolean> {
    const deleted = await executor
      .delete(blocks)
      .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
      .returning({ id: blocks.id });
    return deleted.length > 0;
  }

  /**
   * Newest-first keyset page of Blocks owned by the viewer, joined to the
   * blocked account's display identity. Ordering uses `(created_at DESC,
   * id DESC)`, matching `idx_blocks_blocker_created`, and the cursor predicate
   * runs before `limit()` so pages stay dense.
   */
  async findBlockedUsers(parameters: {
    blockerId: string;
    limit: number;
    cursor: { createdAt: string; id: string } | null;
  }): Promise<{ rows: BlockedUserRow[]; hasNextPage: boolean }> {
    const { blockerId, limit, cursor } = parameters;

    const rows = await this.db
      .select({
        blockId: blocks.id,
        blockedAt: blocks.createdAt,
        cursorCreatedAt:
          sql<string>`to_char(${blocks.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
            'cursor_created_at',
          ),
        userId: users.id,
        fullName: users.fullName,
        fullNameArabic: users.fullNameArabic,
        profilePictureUrl: users.profilePictureUrl,
        isVerified: users.isVerified,
      })
      .from(blocks)
      .innerJoin(users, eq(users.id, blocks.blockedId))
      .where(
        and(
          eq(blocks.blockerId, blockerId),
          cursor
            ? sql`(${blocks.createdAt}, ${blocks.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(blocks.createdAt), desc(blocks.id))
      .limit(limit + 1);

    const hasNextPage = rows.length > limit;
    return { rows: hasNextPage ? rows.slice(0, limit) : rows, hasNextPage };
  }
}

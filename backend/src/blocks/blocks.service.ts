import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { BlocksRepository, type BlockedUserRow } from './blocks.repository';
import { AccountIsolationPolicy } from './account-isolation.policy';
import { ContactsService } from '../contacts/contacts.service';
import { AdoptionsService } from '../adoptions/adoptions.service';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import { NotFoundError, ValidationError } from '../common/errors/app.errors';
import { assertUuid } from '../common/utils/validate-uuid';
import { clampFirst } from '../common/utils/pagination.util';

/** Minimal display identity of a blocked Pupzy Account. */
export interface BlockedUserPayload {
  id: string;
  fullName: string | null;
  fullNameArabic: string | null;
  profilePictureUrl: string | null;
  isVerified: boolean;
}

export interface BlockedUserEdgePayload {
  node: BlockedUserPayload;
  blockedAt: Date;
  cursor: string;
}

export interface BlockedUserConnectionPayload {
  edges: BlockedUserEdgePayload[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

/**
 * BlocksService — public Block management.
 *
 * ## Ownership
 * A Block is directionally owned by its initiator. Only that account may
 * remove it, while either direction isolates the pair for user-facing reads
 * and writes through `AccountIsolationPolicy`.
 *
 * ## Completion guarantee
 * `blockUser` acquires the canonical undirected account-pair lock, inserts the
 * Block, and rejects every PENDING Contact Request and Adoption Application
 * between the pair in one transaction before returning. Any interaction that
 * commits later rechecks isolation under the same lock and fails neutrally.
 *
 * ## Privacy
 * Block and Unblock never create a Report, never notify the other party, and
 * never reveal Block direction. A second `blockUser` for the same direction is
 * an idempotent success that repeats no cleanup.
 */
@Injectable()
export class BlocksService {
  constructor(
    private readonly blocksRepository: BlocksRepository,
    private readonly isolationPolicy: AccountIsolationPolicy,
    private readonly contactsService: ContactsService,
    private readonly adoptionsService: AdoptionsService,
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Creates the caller-owned Block on `targetUserId` and rejects pending
   * direct interactions between the pair atomically. Returns true on success,
   * including an idempotent retry of an already-owned Block.
   */
  async blockUser(blockerId: string, targetUserId: string): Promise<boolean> {
    assertUuid(targetUserId, 'userId');
    if (targetUserId === blockerId) {
      throw new ValidationError('You cannot block your own Pupzy Account');
    }

    return this.db.transaction(async (tx) => {
      // Serialize the undirected pair so a Block cannot race an interaction.
      await this.isolationPolicy.lockPair(tx, blockerId, targetUserId);

      const existing = await this.blocksRepository.findDirected(blockerId, targetUserId, tx);
      if (existing) {
        // Already blocked by this caller: success without repeating cleanup.
        return true;
      }

      if (!(await this.blocksRepository.userExists(targetUserId, tx))) {
        throw new NotFoundError('User', targetUserId);
      }

      const inserted = await this.blocksRepository.insert(blockerId, targetUserId, tx);
      if (!inserted) {
        // A concurrent writer won the ordered-pair insert; it owns the cleanup.
        return true;
      }

      await this.contactsService.rejectPendingContactRequestsBetweenAccounts(tx, blockerId, targetUserId);
      await this.adoptionsService.rejectPendingAdoptionApplicationsBetweenAccounts(tx, blockerId, targetUserId);
      return true;
    });
  }

  /**
   * Removes only the Block owned by the caller. Returns true even when no
   * relationship exists, and never touches a Block owned by the other party.
   */
  async unblockUser(blockerId: string, targetUserId: string): Promise<boolean> {
    assertUuid(targetUserId, 'userId');
    if (targetUserId === blockerId) {
      throw new ValidationError('You cannot unblock your own Pupzy Account');
    }

    return this.db.transaction(async (tx) => {
      await this.isolationPolicy.lockPair(tx, blockerId, targetUserId);

      if (!(await this.blocksRepository.userExists(targetUserId, tx))) {
        throw new NotFoundError('User', targetUserId);
      }

      await this.blocksRepository.deleteDirected(blockerId, targetUserId, tx);
      return true;
    });
  }

  /**
   * Newest-first Blocked Accounts page for the authenticated viewer.
   * Ordered by Block creation time with the Block id as unique tie-breaker.
   */
  async getBlockedUsers(
    viewerId: string,
    first: number | null | undefined,
    after: string | null | undefined,
  ): Promise<BlockedUserConnectionPayload> {
    const limit = clampFirst(first);
    const cursor = this.decodeCursor(after);

    const result = await this.blocksRepository.findBlockedUsers({
      blockerId: viewerId,
      limit,
      cursor,
    });

    return this.mapToConnection(result);
  }

  // ─── Cursor helpers ──────────────────────────────────────────────────

  private decodeCursor(cursorBase64: string | null | undefined): { createdAt: string; id: string } | null {
    if (!cursorBase64) return null;
    try {
      const parsed = JSON.parse(Buffer.from(cursorBase64, 'base64url').toString('utf8')) as {
        createdAt: string;
        id: string;
      };
      const parsedDate = new Date(parsed.createdAt);
      if (Number.isNaN(parsedDate.getTime()) || typeof parsed.id !== 'string') {
        throw new ValidationError('Invalid cursor format');
      }
      return parsed;
    } catch {
      throw new ValidationError('Invalid cursor format');
    }
  }

  private encodeCursor(row: BlockedUserRow): string {
    return Buffer.from(
      JSON.stringify({
        createdAt: row.blockedAt.toISOString(),
        id: row.blockId,
      }),
      'utf8',
    ).toString('base64url');
  }

  private mapToConnection(result: { rows: BlockedUserRow[]; hasNextPage: boolean }): BlockedUserConnectionPayload {
    return {
      edges: result.rows.map((row) => ({
        node: {
          id: row.userId,
          fullName: row.fullName,
          fullNameArabic: row.fullNameArabic,
          profilePictureUrl: row.profilePictureUrl,
          isVerified: row.isVerified,
        },
        blockedAt: row.blockedAt,
        cursor: this.encodeCursor(row),
      })),
      pageInfo: {
        hasNextPage: result.hasNextPage,
        endCursor: result.rows.length > 0 ? this.encodeCursor(result.rows[result.rows.length - 1]) : null,
      },
    };
  }
}

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
    // Canonical UUID form: a case-variant self target must not slip past the
    // service check and hit the database self-Block constraint.
    const targetId = targetUserId.toLowerCase();
    if (targetId === blockerId.toLowerCase()) {
      throw new ValidationError('You cannot block your own Pupzy Account');
    }

    return this.db.transaction(async (tx) => {
      // Serialize the undirected pair so a Block cannot race an interaction.
      await this.isolationPolicy.lockPair(tx, blockerId, targetId);

      const existing = await this.blocksRepository.findDirected(blockerId, targetId, tx);
      if (existing) {
        // Already blocked by this caller: success without repeating cleanup.
        return true;
      }

      if (!(await this.blocksRepository.userExists(targetId, tx))) {
        throw new NotFoundError('User', targetId);
      }

      const inserted = await this.blocksRepository.insert(blockerId, targetId, tx);
      if (!inserted) {
        // A concurrent writer won the ordered-pair insert; it owns the cleanup.
        return true;
      }

      await this.contactsService.rejectPendingContactRequestsBetweenAccounts(tx, blockerId, targetId);
      await this.adoptionsService.rejectPendingAdoptionApplicationsBetweenAccounts(tx, blockerId, targetId);
      return true;
    });
  }

  /**
   * Removes only the Block owned by the caller. Returns true even when no
   * relationship exists, and never touches a Block owned by the other party.
   */
  async unblockUser(blockerId: string, targetUserId: string): Promise<boolean> {
    assertUuid(targetUserId, 'userId');
    // Canonical UUID form so self-target rejection is case-insensitive.
    const targetId = targetUserId.toLowerCase();
    if (targetId === blockerId.toLowerCase()) {
      throw new ValidationError('You cannot unblock your own Pupzy Account');
    }

    return this.db.transaction(async (tx) => {
      await this.isolationPolicy.lockPair(tx, blockerId, targetId);

      if (!(await this.blocksRepository.userExists(targetId, tx))) {
        throw new NotFoundError('User', targetId);
      }

      await this.blocksRepository.deleteDirected(blockerId, targetId, tx);
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
      if (typeof parsed.createdAt !== 'string' || !this.isValidCursorTimestamp(parsed.createdAt)) {
        throw new ValidationError('Invalid cursor format');
      }
      if (typeof parsed.id !== 'string') {
        throw new ValidationError('Invalid cursor format');
      }
      // The cursor id reaches a uuid comparison in SQL, so a crafted non-UUID
      // id must fail validation instead of surfacing a database error.
      assertUuid(parsed.id, 'cursor id');
      return parsed;
    } catch {
      throw new ValidationError('Invalid cursor format');
    }
  }

  /**
   * Rejects timestamp text the `::timestamptz` cast would choke on.
   *
   * `new Date` normalizes values PostgreSQL refuses (February 30, year 0000,
   * offsets beyond ±15:59), so validation must confirm the exact instant
   * described by the canonical `to_char` text survives a calendar round-trip.
   * Only the encoder's ISO-8601 UTC shape is accepted.
   */
  private isValidCursorTimestamp(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/.exec(value);
    if (!match) return false;
    const [year, month, day, hours, minutes, seconds] = match.slice(1, 7).map(Number);
    const milliseconds = Number((match[7] ?? '').padEnd(3, '0').slice(0, 3));
    if (year < 1) return false;
    const instant = new Date(0);
    instant.setUTCFullYear(year, month - 1, day);
    instant.setUTCHours(hours, minutes, seconds, milliseconds);
    return (
      instant.getUTCFullYear() === year &&
      instant.getUTCMonth() === month - 1 &&
      instant.getUTCDate() === day &&
      instant.getUTCHours() === hours &&
      instant.getUTCMinutes() === minutes &&
      instant.getUTCSeconds() === seconds &&
      instant.getUTCMilliseconds() === milliseconds
    );
  }

  private encodeCursor(row: BlockedUserRow): string {
    return Buffer.from(
      JSON.stringify({
        // Microsecond precision from PostgreSQL; `blockedAt` only has
        // milliseconds and would break the id tie-breaker within one tick.
        createdAt: row.cursorCreatedAt,
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

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { BlocksService } from './blocks.service';
import { BlocksRepository } from './blocks.repository';
import { AccountIsolationPolicy } from './account-isolation.policy';
import { ContactsService } from '../contacts/contacts.service';
import { AdoptionsService } from '../adoptions/adoptions.service';
import { NotFoundError, ValidationError } from '../common/errors/app.errors';
import type * as schema from '../database/schema';

describe('BlocksService', () => {
  let service: BlocksService;
  let mockBlocksRepo: jest.Mocked<Partial<BlocksRepository>>;
  let mockIsolationPolicy: { lockPair: jest.Mock };
  let mockContactsService: { rejectPendingContactRequestsBetweenAccounts: jest.Mock };
  let mockAdoptionsService: { rejectPendingAdoptionApplicationsBetweenAccounts: jest.Mock };
  let mockDb: { transaction: jest.Mock };

  const validBlockerId = '01916327-0000-7000-8000-000000000001';
  const validTargetId = '01916327-0000-7000-8000-000000000002';
  const validBlockId = '01916327-0000-7000-8000-000000000003';
  const letteredBlockerId = '01916327-0000-7000-8000-0000000000ab';
  const letteredTargetId = '01916327-0000-7000-8000-0000000000cd';

  beforeEach(() => {
    mockBlocksRepo = {
      findDirected: jest.fn().mockResolvedValue(undefined),
      userExists: jest.fn().mockResolvedValue(true),
      insert: jest.fn().mockResolvedValue(true),
      deleteDirected: jest.fn().mockResolvedValue(true),
      findBlockedUsers: jest.fn().mockResolvedValue({ rows: [], hasNextPage: false }),
    };
    mockIsolationPolicy = { lockPair: jest.fn().mockResolvedValue(undefined) };
    mockContactsService = {
      rejectPendingContactRequestsBetweenAccounts: jest.fn().mockResolvedValue(1),
    };
    mockAdoptionsService = {
      rejectPendingAdoptionApplicationsBetweenAccounts: jest.fn().mockResolvedValue(1),
    };
    mockDb = {
      transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) => callback({ tx: true })),
    };

    service = new BlocksService(
      mockBlocksRepo as BlocksRepository,
      mockIsolationPolicy as unknown as AccountIsolationPolicy,
      mockContactsService as unknown as ContactsService,
      mockAdoptionsService as unknown as AdoptionsService,
      mockDb as unknown as NodePgDatabase<typeof schema>,
    );
  });

  describe('blockUser', () => {
    it('locks the pair, inserts the Block, and rejects pending interactions in one transaction', async () => {
      await expect(service.blockUser(validBlockerId, validTargetId)).resolves.toBe(true);

      expect(mockIsolationPolicy.lockPair).toHaveBeenCalledWith({ tx: true }, validBlockerId, validTargetId);
      expect(mockBlocksRepo.insert).toHaveBeenCalledWith(validBlockerId, validTargetId, { tx: true });
      expect(mockContactsService.rejectPendingContactRequestsBetweenAccounts).toHaveBeenCalledWith(
        { tx: true },
        validBlockerId,
        validTargetId,
      );
      expect(mockAdoptionsService.rejectPendingAdoptionApplicationsBetweenAccounts).toHaveBeenCalledWith(
        { tx: true },
        validBlockerId,
        validTargetId,
      );
    });

    it('returns success for an already-owned Block without repeating cleanup', async () => {
      mockBlocksRepo.findDirected = jest.fn().mockResolvedValue({ id: validBlockId });

      await expect(service.blockUser(validBlockerId, validTargetId)).resolves.toBe(true);

      expect(mockBlocksRepo.insert).not.toHaveBeenCalled();
      expect(mockContactsService.rejectPendingContactRequestsBetweenAccounts).not.toHaveBeenCalled();
      expect(mockAdoptionsService.rejectPendingAdoptionApplicationsBetweenAccounts).not.toHaveBeenCalled();
    });

    it('returns success without cleanup when the ordered pair insert loses a race', async () => {
      mockBlocksRepo.insert = jest.fn().mockResolvedValue(false);

      await expect(service.blockUser(validBlockerId, validTargetId)).resolves.toBe(true);

      expect(mockContactsService.rejectPendingContactRequestsBetweenAccounts).not.toHaveBeenCalled();
      expect(mockAdoptionsService.rejectPendingAdoptionApplicationsBetweenAccounts).not.toHaveBeenCalled();
    });

    it('rejects self-blocking, malformed targets, and nonexistent accounts', async () => {
      await expect(service.blockUser(validBlockerId, validBlockerId)).rejects.toBeInstanceOf(ValidationError);
      await expect(service.blockUser(letteredBlockerId, letteredBlockerId.toUpperCase())).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(service.blockUser(validBlockerId, 'not-a-uuid')).rejects.toBeInstanceOf(ValidationError);
      expect(mockDb.transaction).not.toHaveBeenCalled();

      mockBlocksRepo.userExists = jest.fn().mockResolvedValue(false);
      await expect(service.blockUser(validBlockerId, validTargetId)).rejects.toBeInstanceOf(NotFoundError);
      expect(mockBlocksRepo.insert).not.toHaveBeenCalled();
    });

    it('normalizes a case-variant target to the canonical UUID', async () => {
      await expect(service.blockUser(validBlockerId, letteredTargetId.toUpperCase())).resolves.toBe(true);

      expect(mockBlocksRepo.findDirected).toHaveBeenCalledWith(validBlockerId, letteredTargetId, { tx: true });
      expect(mockBlocksRepo.insert).toHaveBeenCalledWith(validBlockerId, letteredTargetId, { tx: true });
      expect(mockContactsService.rejectPendingContactRequestsBetweenAccounts).toHaveBeenCalledWith(
        { tx: true },
        validBlockerId,
        letteredTargetId,
      );
    });
  });

  describe('unblockUser', () => {
    it('removes only the Block owned by the caller', async () => {
      await expect(service.unblockUser(validBlockerId, validTargetId)).resolves.toBe(true);

      expect(mockIsolationPolicy.lockPair).toHaveBeenCalledWith({ tx: true }, validBlockerId, validTargetId);
      expect(mockBlocksRepo.deleteDirected).toHaveBeenCalledWith(validBlockerId, validTargetId, { tx: true });
    });

    it('returns success when no relationship exists', async () => {
      mockBlocksRepo.deleteDirected = jest.fn().mockResolvedValue(false);
      await expect(service.unblockUser(validBlockerId, validTargetId)).resolves.toBe(true);
    });

    it('rejects self-unblock, malformed targets, and nonexistent accounts', async () => {
      await expect(service.unblockUser(validBlockerId, validBlockerId)).rejects.toBeInstanceOf(ValidationError);
      await expect(service.unblockUser(letteredBlockerId, letteredBlockerId.toUpperCase())).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(service.unblockUser(validBlockerId, 'not-a-uuid')).rejects.toBeInstanceOf(ValidationError);

      mockBlocksRepo.userExists = jest.fn().mockResolvedValue(false);
      await expect(service.unblockUser(validBlockerId, validTargetId)).rejects.toBeInstanceOf(NotFoundError);
      expect(mockBlocksRepo.deleteDirected).not.toHaveBeenCalled();
    });

    it('normalizes a case-variant target to the canonical UUID', async () => {
      await expect(service.unblockUser(validBlockerId, letteredTargetId.toUpperCase())).resolves.toBe(true);

      expect(mockBlocksRepo.deleteDirected).toHaveBeenCalledWith(validBlockerId, letteredTargetId, { tx: true });
    });
  });

  describe('getBlockedUsers', () => {
    const blockedAt = new Date('2026-02-01T10:00:00.000Z');
    const cursorCreatedAt = '2026-02-01T10:00:00.000123Z';

    function blockedRow() {
      return {
        blockId: validBlockId,
        blockedAt,
        cursorCreatedAt,
        userId: validTargetId,
        fullName: 'Blocked User',
        fullNameArabic: null,
        profilePictureUrl: null,
        isVerified: false,
      };
    }

    it('maps rows to a minimal-identity connection with an opaque cursor', async () => {
      mockBlocksRepo.findBlockedUsers = jest.fn().mockResolvedValue({ rows: [blockedRow()], hasNextPage: true });

      const connection = await service.getBlockedUsers(validBlockerId, 2, undefined);

      expect(mockBlocksRepo.findBlockedUsers).toHaveBeenCalledWith({
        blockerId: validBlockerId,
        limit: 2,
        cursor: null,
      });
      expect(connection.edges).toHaveLength(1);
      expect(connection.edges[0].node).toEqual({
        id: validTargetId,
        fullName: 'Blocked User',
        fullNameArabic: null,
        profilePictureUrl: null,
        isVerified: false,
      });
      expect(Object.keys(connection.edges[0].node)).not.toContain('phoneNumber');
      expect(
        JSON.parse(Buffer.from(connection.edges[0].cursor, 'base64url').toString('utf8')) as Record<string, unknown>,
      ).toEqual({ createdAt: cursorCreatedAt, id: validBlockId });
      expect(connection.pageInfo).toEqual({ hasNextPage: true, endCursor: connection.edges[0].cursor });
    });

    it('clamps first and decodes a valid cursor', async () => {
      for (const validCreatedAt of [cursorCreatedAt, '2024-02-29T23:59:59.999999Z', '2026-02-01T10:00:00Z']) {
        const cursor = Buffer.from(JSON.stringify({ createdAt: validCreatedAt, id: validBlockId }), 'utf8').toString(
          'base64url',
        );

        await service.getBlockedUsers(validBlockerId, undefined, cursor);
        expect(mockBlocksRepo.findBlockedUsers).toHaveBeenLastCalledWith(
          expect.objectContaining({ limit: 20, cursor: { createdAt: validCreatedAt, id: validBlockId } }),
        );
      }

      await service.getBlockedUsers(validBlockerId, 500, undefined);
      expect(mockBlocksRepo.findBlockedUsers).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50 }));
    });

    it('rejects an invalid cursor and reports an empty page', async () => {
      await expect(service.getBlockedUsers(validBlockerId, 10, 'not-a-cursor')).rejects.toBeInstanceOf(ValidationError);

      const malformedCursors = [
        { createdAt: 123, id: validBlockId },
        { createdAt: 'not-a-date', id: validBlockId },
        { createdAt: null, id: validBlockId },
        { id: validBlockId },
        // `new Date` accepts these, but the `::timestamptz` cast does not.
        { createdAt: '0000-01-01T00:00:00Z', id: validBlockId },
        { createdAt: '2026-02-30T00:00:00Z', id: validBlockId },
        { createdAt: '2026-03-01T09:00:00.000+23:59', id: validBlockId },
      ].map((body) => Buffer.from(JSON.stringify(body), 'utf8').toString('base64url'));
      for (const malformed of malformedCursors) {
        await expect(service.getBlockedUsers(validBlockerId, 10, malformed)).rejects.toBeInstanceOf(ValidationError);
      }
      expect(mockBlocksRepo.findBlockedUsers).not.toHaveBeenCalled();

      const connection = await service.getBlockedUsers(validBlockerId, 10, undefined);
      expect(connection.edges).toHaveLength(0);
      expect(connection.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
    });

    it('rejects a well-formed cursor whose id is not a UUID before querying', async () => {
      const cursor = Buffer.from(
        JSON.stringify({ createdAt: blockedAt.toISOString(), id: 'not-a-uuid' }),
        'utf8',
      ).toString('base64url');

      await expect(service.getBlockedUsers(validBlockerId, 10, cursor)).rejects.toBeInstanceOf(ValidationError);
      expect(mockBlocksRepo.findBlockedUsers).not.toHaveBeenCalled();
    });
  });
});

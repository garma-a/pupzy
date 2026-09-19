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
      await expect(service.blockUser(validBlockerId, 'not-a-uuid')).rejects.toBeInstanceOf(ValidationError);
      expect(mockDb.transaction).not.toHaveBeenCalled();

      mockBlocksRepo.userExists = jest.fn().mockResolvedValue(false);
      await expect(service.blockUser(validBlockerId, validTargetId)).rejects.toBeInstanceOf(NotFoundError);
      expect(mockBlocksRepo.insert).not.toHaveBeenCalled();
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
      await expect(service.unblockUser(validBlockerId, 'not-a-uuid')).rejects.toBeInstanceOf(ValidationError);

      mockBlocksRepo.userExists = jest.fn().mockResolvedValue(false);
      await expect(service.unblockUser(validBlockerId, validTargetId)).rejects.toBeInstanceOf(NotFoundError);
      expect(mockBlocksRepo.deleteDirected).not.toHaveBeenCalled();
    });
  });

  describe('getBlockedUsers', () => {
    const blockedAt = new Date('2026-02-01T10:00:00.000Z');

    function blockedRow() {
      return {
        blockId: validBlockId,
        blockedAt,
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
      ).toEqual({ createdAt: blockedAt.toISOString(), id: validBlockId });
      expect(connection.pageInfo).toEqual({ hasNextPage: true, endCursor: connection.edges[0].cursor });
    });

    it('clamps first and decodes a valid cursor', async () => {
      const cursor = Buffer.from(
        JSON.stringify({ createdAt: blockedAt.toISOString(), id: validBlockId }),
        'utf8',
      ).toString('base64url');

      await service.getBlockedUsers(validBlockerId, undefined, cursor);
      expect(mockBlocksRepo.findBlockedUsers).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20, cursor: { createdAt: blockedAt.toISOString(), id: validBlockId } }),
      );

      await service.getBlockedUsers(validBlockerId, 500, undefined);
      expect(mockBlocksRepo.findBlockedUsers).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50 }));
    });

    it('rejects an invalid cursor and reports an empty page', async () => {
      await expect(service.getBlockedUsers(validBlockerId, 10, 'not-a-cursor')).rejects.toBeInstanceOf(ValidationError);

      const connection = await service.getBlockedUsers(validBlockerId, 10, undefined);
      expect(connection.edges).toHaveLength(0);
      expect(connection.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
    });
  });
});

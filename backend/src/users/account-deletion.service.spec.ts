import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { getAuth } from 'firebase-admin/auth';
import { AccountDeletionService } from './account-deletion.service';
import { AccountDeletionRepository } from './account-deletion.repository';
import { UsersRepository } from './users.repository';
import { UploadService } from '../upload/upload.service';
import { DATABASE_TOKEN } from '../database/database.provider';
import { FIREBASE_ADMIN_TOKEN } from '../auth/firebase.module';
import { ForbiddenError, NotFoundError } from '../common/errors/app.errors';
import type { User, AccountDeletion } from '../database/schema';

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;
  let mockAccountDeletionRepo: {
    findByFirebaseUserId: jest.Mock;
    findByUserId: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let mockUsersRepo: {
    findById: jest.Mock;
    delete: jest.Mock;
  };
  let mockUploadService: {
    deleteObjects: jest.Mock;
    deletePrefix: jest.Mock;
    getLastUploadGraceUntil: jest.Mock;
  };
  let mockCacheManager: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let mockDb: {
    insert: jest.Mock;
    select: jest.Mock;
    delete: jest.Mock;
    update: jest.Mock;
    execute: jest.Mock;
    transaction: jest.Mock;
  };
  let mockDeleteUser: jest.Mock;
  let mockConfigService: { get: jest.Mock };

  const sampleUser: User = {
    id: '01916327-0000-7000-8000-000000000001',
    firebaseUserId: 'fb-user-123',
    email: 'test@example.com',
    fullName: 'Test User',
    fullNameArabic: 'مستخدم تجريبي',
    profilePictureUrl: null,
    isVerified: false,
    phoneNumber: '+201012345678',
    homeCityId: null,
    lastKnownLocation: null,
    postCount: 0,
    rescuePostCount: 0,
    lostPostCount: 0,
    adoptionPostCount: 0,
    productPostCount: 0,
    languagePreference: 'ar',
    notificationsEnabled: true,
    isBanned: false,
    bannedAt: null,
    banReason: null,
    bannedByAdminId: null,
    lastSeenAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockDeleteUser = jest.fn().mockResolvedValue(undefined);
    (getAuth as jest.Mock).mockReturnValue({
      deleteUser: mockDeleteUser,
    });

    const inMemoryRecords = new Map<string, AccountDeletion>();
    mockAccountDeletionRepo = {
      findByFirebaseUserId: jest.fn().mockImplementation((uid: string) => {
        for (const r of inMemoryRecords.values()) {
          if (r.firebaseUserId === uid) return Promise.resolve(r);
        }
        return Promise.resolve(undefined);
      }),
      findByUserId: jest.fn().mockImplementation((uid: string) => {
        for (const r of inMemoryRecords.values()) {
          if (r.userId === uid) return Promise.resolve(r);
        }
        return Promise.resolve(undefined);
      }),
      findById: jest.fn().mockImplementation((id: string) => Promise.resolve(inMemoryRecords.get(id))),
      create: jest.fn().mockImplementation((data: { id: string } & Partial<AccountDeletion>) => {
        const r = { ...data, createdAt: new Date(), updatedAt: new Date() } as AccountDeletion;
        inMemoryRecords.set(data.id, r);
        return Promise.resolve(r);
      }),
      update: jest.fn().mockImplementation((id: string, data: Partial<AccountDeletion>) => {
        const existing = inMemoryRecords.get(id) || ({ id } as AccountDeletion);
        const updated = { ...existing, ...data, updatedAt: new Date() };
        inMemoryRecords.set(id, updated);
        return Promise.resolve(updated);
      }),
    };

    mockUsersRepo = {
      findById: jest.fn().mockResolvedValue(sampleUser),
      delete: jest.fn().mockResolvedValue(true),
    };

    mockUploadService = {
      deleteObjects: jest.fn().mockResolvedValue(undefined),
      deletePrefix: jest.fn().mockResolvedValue(0),
      getLastUploadGraceUntil: jest.fn().mockResolvedValue(null),
    };

    mockCacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn().mockResolvedValue(undefined),
    };

    const createChain = () => {
      const p = Promise.resolve([]) as unknown as Record<string, unknown>;
      p.from = jest.fn().mockReturnValue(p);
      p.where = jest.fn().mockReturnValue(p);
      p.set = jest.fn().mockReturnValue(p);
      p.values = jest.fn().mockReturnValue(p);
      p.orderBy = jest.fn().mockReturnValue(p);
      p.limit = jest.fn().mockReturnValue(p);
      p.returning = jest.fn().mockReturnValue(p);
      p.for = jest.fn().mockReturnValue(p);
      return p;
    };

    mockDb = {
      insert: jest.fn().mockImplementation(() => {
        const record = {
          id: 'del-1',
          userId: 'user-1',
          firebaseUserId: 'fb-user-1',
          email: 'test@example.com',
          status: 'PENDING',
          step: 'ACCEPTED',
          progressTokenHash: 'hash',
          stagedUploadGraceUntil: null,
          acceptedAt: new Date(),
          purgeAt: new Date(),
        };
        const p = Promise.resolve([record]) as unknown as Record<string, unknown>;
        p.values = jest.fn().mockImplementation((val) => {
          Object.assign(record, val);
          return p;
        });
        p.returning = jest.fn().mockReturnValue(p);
        return p;
      }),
      select: jest.fn().mockImplementation(createChain),
      delete: jest.fn().mockImplementation(createChain),
      update: jest.fn().mockImplementation(createChain),
      execute: jest.fn().mockResolvedValue({}),
      transaction: jest.fn().mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(mockDb)),
    };

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'ACCOUNT_DELETION_ENABLED') return true;
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountDeletionService,
        { provide: AccountDeletionRepository, useValue: mockAccountDeletionRepo },
        { provide: UsersRepository, useValue: mockUsersRepo },
        { provide: UploadService, useValue: mockUploadService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: FIREBASE_ADMIN_TOKEN, useValue: {} },
        { provide: DATABASE_TOKEN, useValue: mockDb },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
      ],
    }).compile();

    service = module.get<AccountDeletionService>(AccountDeletionService);
  });

  describe('initiateDeletion - authentication and boundaries', () => {
    it('throws ForbiddenError when authTime is undefined', async () => {
      await expect(service.initiateDeletion(sampleUser, undefined)).rejects.toThrow(
        new ForbiddenError('RECENT_AUTHENTICATION_REQUIRED'),
      );
    });

    it('throws ForbiddenError when authTime is in the future (>30s)', async () => {
      const futureAuthTime = Math.floor(Date.now() / 1000) + 120;
      await expect(service.initiateDeletion(sampleUser, futureAuthTime)).rejects.toThrow(
        new ForbiddenError('INVALID_AUTHENTICATION_TIME'),
      );
    });

    it('throws ForbiddenError when authTime is stale (>5 minutes ago)', async () => {
      const staleAuthTime = Math.floor(Date.now() / 1000) - 301;
      await expect(service.initiateDeletion(sampleUser, staleAuthTime)).rejects.toThrow(
        new ForbiddenError('RECENT_AUTHENTICATION_REQUIRED'),
      );
    });

    it('accepts deletion when authTime is within 5 minutes (e.g. 2 minutes ago)', async () => {
      const recentAuthTime = Math.floor(Date.now() / 1000) - 120;
      const result = await service.initiateDeletion(sampleUser, recentAuthTime);

      expect(result.status).toBe('COMPLETED');
      expect(result.deletionId).toBeDefined();
      expect(result.progressToken).toBeDefined();
      expect(mockAccountDeletionRepo.create).toHaveBeenCalled();
      expect(mockCacheManager.del).toHaveBeenCalledWith(`user_resolve:${sampleUser.firebaseUserId}`);
      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDeleteUser).toHaveBeenCalledWith(sampleUser.firebaseUserId);
    });

    it('throws ForbiddenError when ACCOUNT_DELETION_ENABLED is false', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'ACCOUNT_DELETION_ENABLED') return false;
        return undefined;
      });

      const recentAuthTime = Math.floor(Date.now() / 1000) - 10;
      await expect(service.initiateDeletion(sampleUser, recentAuthTime)).rejects.toThrow(
        new ForbiddenError('ACCOUNT_DELETION_DISABLED'),
      );
    });

    it('preserves client-supplied progressToken', async () => {
      const recentAuthTime = Math.floor(Date.now() / 1000) - 10;
      const clientToken = 'custom-progress-token-12345678';
      const result = await service.initiateDeletion(sampleUser, recentAuthTime, clientToken);

      expect(result.status).toBe('COMPLETED');
      expect(result.progressToken).toBe(clientToken);
    });

    it('defers completion when staged upload grace window is active', async () => {
      const recentAuthTime = Math.floor(Date.now() / 1000) - 10;
      const futureGrace = new Date(Date.now() + 300_000); // 5 minutes in future
      mockUploadService.getLastUploadGraceUntil.mockResolvedValue(futureGrace);

      const result = await service.initiateDeletion(sampleUser, recentAuthTime);

      expect(result.status).toBe('PENDING');
      expect(result.completedAt).toBeNull();
      expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it('is idempotent: returns existing record if already PENDING or COMPLETED', async () => {
      const recentAuthTime = Math.floor(Date.now() / 1000) - 10;
      const existingRecord: AccountDeletion = {
        id: 'del-123',
        userId: sampleUser.id,
        firebaseUserId: sampleUser.firebaseUserId,
        email: sampleUser.email,
        status: 'PENDING',
        step: 'ACCEPTED',
        progressTokenHash: 'hash',
        mediaCleanupScope: null,
        storageCleanupAttempts: 0,
        firebaseCleanupAttempts: 0,
        lastError: null,
        nextRetryAt: null,
        stagedUploadGraceUntil: null,
        acceptedAt: new Date(),
        completedAt: null,
        purgeAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockAccountDeletionRepo.findByFirebaseUserId.mockResolvedValue(existingRecord);

      const result = await service.initiateDeletion(sampleUser, recentAuthTime);

      expect(result.deletionId).toBe('del-123');
      expect(result.status).toBe('PENDING');
      expect(mockAccountDeletionRepo.create).not.toHaveBeenCalled();
    });

    it('is idempotent inside transaction: reuses existing record atomically if concurrent request created it', async () => {
      const recentAuthTime = Math.floor(Date.now() / 1000) - 10;
      const existingRecord: AccountDeletion = {
        id: 'del-concurrent-1',
        userId: sampleUser.id,
        firebaseUserId: sampleUser.firebaseUserId,
        email: sampleUser.email,
        status: 'PENDING',
        step: 'ACCEPTED',
        progressTokenHash: 'hash',
        mediaCleanupScope: null,
        storageCleanupAttempts: 0,
        firebaseCleanupAttempts: 0,
        lastError: null,
        nextRetryAt: null,
        stagedUploadGraceUntil: null,
        acceptedAt: new Date(),
        completedAt: null,
        purgeAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Outside the transaction, repo finds nothing (race window)
      mockAccountDeletionRepo.findByFirebaseUserId.mockResolvedValue(undefined);

      // Inside transaction, select on accountDeletions finds existingRecord
      let selectCalls = 0;
      mockDb.select = jest.fn().mockImplementation(() => {
        selectCalls++;
        const p = Promise.resolve(selectCalls === 1 ? [{ id: sampleUser.id }] : [existingRecord]) as unknown as Record<
          string,
          unknown
        >;
        p.from = jest.fn().mockReturnValue(p);
        p.where = jest.fn().mockReturnValue(p);
        p.orderBy = jest.fn().mockReturnValue(p);
        p.limit = jest.fn().mockReturnValue(p);
        p.for = jest.fn().mockReturnValue(p);
        return p;
      });

      const result = await service.initiateDeletion(sampleUser, recentAuthTime);

      expect(result.deletionId).toBe('del-concurrent-1');
      expect(result.status).toBe('PENDING');
      expect(mockAccountDeletionRepo.create).not.toHaveBeenCalled();
      expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it('handles Firebase user-not-found gracefully during cleanup', async () => {
      const recentAuthTime = Math.floor(Date.now() / 1000) - 10;
      mockDeleteUser.mockRejectedValue({ code: 'auth/user-not-found' });

      const result = await service.initiateDeletion(sampleUser, recentAuthTime);

      expect(result.status).toBe('COMPLETED');
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('records lastError and sets PENDING status on unexpected cleanup error', async () => {
      const recentAuthTime = Math.floor(Date.now() / 1000) - 10;
      mockDeleteUser.mockRejectedValue(new Error('Firebase service unavailable'));

      const result = await service.initiateDeletion(sampleUser, recentAuthTime);

      expect(result.status).toBe('PENDING');
      expect(mockAccountDeletionRepo.update).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          lastError: 'Firebase service unavailable',
          nextRetryAt: expect.any(Date) as unknown,
        }),
      );
    });

    it('executes storage cleanup serialized under transaction advisory lock', async () => {
      const recentAuthTime = Math.floor(Date.now() / 1000) - 10;
      const result = await service.initiateDeletion(sampleUser, recentAuthTime);

      expect(result.status).toBe('COMPLETED');
      expect(mockUploadService.deletePrefix).toHaveBeenCalledWith(`staging/${sampleUser.id}/`);
      expect(mockDb.execute).toHaveBeenCalled();
    });
  });

  describe('getProgress', () => {
    it('returns progress for matching deletionId and valid progressToken', async () => {
      const token = 'my-secret-token-123';
      const hash = crypto.createHash('sha256').update(token).digest('hex');

      const record: AccountDeletion = {
        id: 'del-456',
        userId: sampleUser.id,
        firebaseUserId: sampleUser.firebaseUserId,
        email: sampleUser.email,
        status: 'COMPLETED',
        step: 'COMPLETED',
        progressTokenHash: hash,
        mediaCleanupScope: null,
        storageCleanupAttempts: 0,
        firebaseCleanupAttempts: 0,
        lastError: null,
        nextRetryAt: null,
        stagedUploadGraceUntil: null,
        acceptedAt: new Date(),
        completedAt: new Date(),
        purgeAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockAccountDeletionRepo.findById.mockResolvedValue(record);

      const progress = await service.getProgress('del-456', token);

      expect(progress.status).toBe('COMPLETED');
      expect(progress.deletionId).toBe('del-456');
    });

    it('throws NotFoundError for invalid progress token', async () => {
      const record: AccountDeletion = {
        id: 'del-456',
        userId: sampleUser.id,
        firebaseUserId: sampleUser.firebaseUserId,
        email: sampleUser.email,
        status: 'PENDING',
        step: 'ACCEPTED',
        progressTokenHash: 'correct-hash',
        mediaCleanupScope: null,
        storageCleanupAttempts: 0,
        firebaseCleanupAttempts: 0,
        lastError: null,
        nextRetryAt: null,
        stagedUploadGraceUntil: null,
        acceptedAt: new Date(),
        completedAt: null,
        purgeAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockAccountDeletionRepo.findById.mockResolvedValue(record);

      await expect(service.getProgress('del-456', 'wrong-token')).rejects.toThrow(NotFoundError);
    });
  });

  describe('isDeletedOrPending', () => {
    it('returns true when record is PENDING', async () => {
      mockAccountDeletionRepo.findByFirebaseUserId.mockResolvedValue({
        status: 'PENDING',
      });

      expect(await service.isDeletedOrPending('fb-1')).toBe(true);
    });

    it('returns true when record is COMPLETED', async () => {
      mockAccountDeletionRepo.findByFirebaseUserId.mockResolvedValue({
        status: 'COMPLETED',
      });

      expect(await service.isDeletedOrPending('fb-1')).toBe(true);
    });

    it('returns false when no record exists', async () => {
      mockAccountDeletionRepo.findByFirebaseUserId.mockResolvedValue(undefined);

      expect(await service.isDeletedOrPending('fb-fresh')).toBe(false);
    });
  });
});

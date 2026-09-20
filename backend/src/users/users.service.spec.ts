import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';

import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { UsersRepository } from './users.repository';
import { AccountDeletionRepository } from './account-deletion.repository';
import { CitiesService } from '../cities/cities.service';
import type { AccountDeletion, User } from '../database/schema';

describe('UsersService', () => {
  let service: UsersService;
  let testingModule: TestingModule;
  let mockUsersRepo: {
    findByFirebaseUserId: jest.Mock;
    findByEmail: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let mockCitiesService: { findById: jest.Mock; findNearest: jest.Mock };
  let mockCacheManager: { del: jest.Mock };

  beforeEach(async () => {
    mockUsersRepo = {
      findByFirebaseUserId: jest.fn(),
      findByEmail: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    mockCitiesService = { findById: jest.fn(), findNearest: jest.fn() };
    mockCacheManager = { del: jest.fn().mockResolvedValue(undefined) };

    testingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: mockUsersRepo },
        { provide: CitiesService, useValue: mockCitiesService },
        {
          provide: AccountDeletionRepository,
          useValue: {
            findByFirebaseUserId: jest.fn().mockResolvedValue(undefined),
            findByUserId: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=') },
        },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
      ],
    }).compile();

    service = testingModule.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOrCreate', () => {
    it('throws ForbiddenError(ACCOUNT_DELETED) when deletion is PENDING or COMPLETED', async () => {
      const deletionRepo = testingModule.get<AccountDeletionRepository>(AccountDeletionRepository);
      jest.spyOn(deletionRepo, 'findByFirebaseUserId').mockResolvedValue({
        status: 'PENDING',
      } as unknown as AccountDeletion);

      await expect(
        service.findOrCreate({ firebaseUserId: 'fb-deleted-user', email: 'test@example.com' }),
      ).rejects.toThrow('ACCOUNT_DELETED');
    });

    it('creates fresh user when no deletion record exists', async () => {
      const mockCreated = {
        id: 'new-user-id',
        firebaseUserId: 'fb-fresh-user',
        email: 'fresh@example.com',
        phoneNumber: null,
      } as unknown as User;
      mockUsersRepo.findByFirebaseUserId.mockResolvedValue(undefined);
      mockUsersRepo.findByEmail.mockResolvedValue(undefined);
      mockUsersRepo.create.mockResolvedValue(mockCreated);

      const res = await service.findOrCreate({ firebaseUserId: 'fb-fresh-user', email: 'fresh@example.com' });
      expect(res.id).toBe('new-user-id');
      expect(mockUsersRepo.create).toHaveBeenCalled();
    });
  });

  describe('findActiveById', () => {
    it('returns undefined if an account deletion is PENDING or COMPLETED', async () => {
      const deletionRepo = testingModule.get<AccountDeletionRepository>(AccountDeletionRepository);
      jest.spyOn(deletionRepo, 'findByUserId').mockResolvedValue({
        status: 'PENDING',
      } as unknown as AccountDeletion);

      const res = await service.findActiveById('deleting-user-id');
      expect(res).toBeUndefined();
    });

    it('returns decrypted active user if no deletion record is active', async () => {
      const mockUser = {
        id: 'active-user-id',
        firebaseUserId: 'fb-active',
        phoneNumber: null,
        isBanned: false,
      } as unknown as User;
      const usersRepo = testingModule.get<UsersRepository>(UsersRepository);
      usersRepo.findActiveById = jest.fn().mockResolvedValue(mockUser);

      const res = await service.findActiveById('active-user-id');
      expect(res).toEqual(mockUser);
    });
  });

  describe('language synchronization', () => {
    const userId = '01916327-0000-7000-8000-000000000001';
    const cityId = '01916327-0000-7000-8000-000000000002';
    const updatedUser = {
      id: userId,
      firebaseUserId: 'fb-language-user',
      phoneNumber: null,
      homeCityId: cityId,
      languagePreference: 'ar',
    } as unknown as User;

    beforeEach(() => {
      mockUsersRepo.update.mockResolvedValue(updatedUser);
      mockCitiesService.findById.mockResolvedValue({ id: cityId });
    });

    it('persists an explicit onboarding language without changing other inputs', async () => {
      await service.completeProfile(userId, {
        fullName: 'Ahmed Ali',
        phoneNumber: '+201012345678',
        cityId,
        languagePreference: 'ar',
      });

      expect(mockUsersRepo.update).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({ languagePreference: 'ar', homeCityId: cityId }),
      );
    });

    it('leaves the preference unsynchronized when onboarding omits it', async () => {
      await service.completeProfile(userId, {
        fullName: 'Ahmed Ali',
        phoneNumber: '+201012345678',
        cityId,
      });

      const updateCalls = mockUsersRepo.update.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
      expect(updateCalls[0][1]).not.toHaveProperty('languagePreference');
    });

    it('updates only the language preference — no unrelated field is required', async () => {
      const result = await service.updateLanguagePreference(userId, 'ar');

      expect(mockUsersRepo.update).toHaveBeenCalledWith(userId, { languagePreference: 'ar' });
      expect(result).toBe(updatedUser);
      expect(mockCacheManager.del).toHaveBeenCalledWith('user_resolve:fb-language-user');
    });

    it('accepts switching back to English', async () => {
      mockUsersRepo.update.mockResolvedValue({ ...updatedUser, languagePreference: 'en' });

      await service.updateLanguagePreference(userId, 'en');

      expect(mockUsersRepo.update).toHaveBeenCalledWith(userId, { languagePreference: 'en' });
    });
  });
});

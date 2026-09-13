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
  };

  beforeEach(async () => {
    mockUsersRepo = {
      findByFirebaseUserId: jest.fn(),
      findByEmail: jest.fn(),
      create: jest.fn(),
    };

    testingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: mockUsersRepo },
        { provide: CitiesService, useValue: {} },
        {
          provide: AccountDeletionRepository,
          useValue: { findByFirebaseUserId: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: CACHE_MANAGER, useValue: {} },
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
});

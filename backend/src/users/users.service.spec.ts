import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';

import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { UsersRepository } from './users.repository';
import { AccountDeletionRepository } from './account-deletion.repository';
import { CitiesService } from '../cities/cities.service';

describe('UsersService', () => {
  let service: UsersService;
  let testingModule: TestingModule;

  beforeEach(async () => {
    testingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: {} },
        { provide: CitiesService, useValue: {} },
        { provide: AccountDeletionRepository, useValue: { findByFirebaseUserId: jest.fn().mockResolvedValue(undefined) } },
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
      } as any);

      await expect(
        service.findOrCreate({ firebaseUserId: 'fb-deleted-user', email: 'test@example.com' }),
      ).rejects.toThrow('ACCOUNT_DELETED');
    });

    it('creates fresh user when no deletion record exists', async () => {
      const usersRepo = testingModule.get<UsersRepository>(UsersRepository);
      const mockCreated = {
        id: 'new-user-id',
        firebaseUserId: 'fb-fresh-user',
        email: 'fresh@example.com',
        phoneNumber: null,
      };
      (usersRepo as any).findByFirebaseUserId = jest.fn().mockResolvedValue(undefined);
      (usersRepo as any).findByEmail = jest.fn().mockResolvedValue(undefined);
      (usersRepo as any).create = jest.fn().mockResolvedValue(mockCreated);

      const res = await service.findOrCreate({ firebaseUserId: 'fb-fresh-user', email: 'fresh@example.com' });
      expect(res.id).toBe('new-user-id');
      expect((usersRepo as any).create).toHaveBeenCalled();
    });
  });
});

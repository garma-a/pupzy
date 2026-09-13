import type { ExecutionContext } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { getAuth } from 'firebase-admin/auth';
import { ForbiddenError } from '../common/errors/app.errors';
import type { User } from '../database/schema';
import { UsersService } from '../users/users.service';
import { AccountDeletionRepository } from '../users/account-deletion.repository';
import { FirebaseAuthGuard } from './firebase.guard';

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));

describe('FirebaseAuthGuard', () => {
  let guard: FirebaseAuthGuard;

  const mockFirebaseApp = {};
  const mockUsersService = {
    findOrCreate: jest.fn(),
  } satisfies Partial<UsersService>;
  const mockAccountDeletionRepo = {
    findByFirebaseUserId: jest.fn().mockResolvedValue(undefined),
  };
  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (getAuth as jest.Mock).mockReturnValue({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'firebase-1',
        firebase: {},
        email_verified: true,
      }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FirebaseAuthGuard,
        Reflector,
        { provide: 'FIREBASE_ADMIN', useValue: mockFirebaseApp },
        { provide: UsersService, useValue: mockUsersService },
        { provide: AccountDeletionRepository, useValue: mockAccountDeletionRepo },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
      ],
    }).compile();

    guard = module.get<FirebaseAuthGuard>(FirebaseAuthGuard);
  });


  function httpContext(request: { headers: Record<string, string>; user?: unknown }): ExecutionContext {
    return {
      getType: () => 'http',
      getHandler: () => function handler() {},
      getClass: () => class TestController {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('is defined', () => {
    expect(guard).toBeDefined();
  });

  it('throws ForbiddenError when the resolved user is banned', async () => {
    const bannedUser = { id: 'user-1', isBanned: true } as User;
    mockCacheManager.get.mockResolvedValue({
      user: bannedUser,
      expiresAt: Date.now() + 30_000,
    });
    const request = { headers: { authorization: 'Bearer valid-token' } };

    await expect(guard.canActivate(httpContext(request))).rejects.toThrow(
      new ForbiddenError('Your account has been suspended.'),
    );
    expect(request).not.toHaveProperty('user');
  });

  it('allows an unbanned user and attaches it to the request', async () => {
    const user = { id: 'user-1', isBanned: false } as User;
    mockCacheManager.get.mockResolvedValue({
      user,
      expiresAt: Date.now() + 30_000,
    });
    const request: { headers: Record<string, string>; user?: unknown } = {
      headers: { authorization: 'Bearer valid-token' },
    };

    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
    expect(request.user).toBe(user);
  });

  it('throws ForbiddenError(ACCOUNT_DELETED) when user deletion is PENDING or COMPLETED', async () => {
    mockAccountDeletionRepo.findByFirebaseUserId.mockResolvedValue({
      id: 'del-1',
      userId: 'user-1',
      firebaseUserId: 'firebase-1',
      email: 'deleted@example.com',
      status: 'PENDING',
    });
    const request = { headers: { authorization: 'Bearer valid-token' } };

    await expect(guard.canActivate(httpContext(request))).rejects.toThrow(
      new ForbiddenError('ACCOUNT_DELETED'),
    );
    expect(mockCacheManager.del).toHaveBeenCalledWith('user_resolve:firebase-1');
  });

  it('allows deleteMyAccount handler through when already deleted to support idempotency', async () => {
    mockAccountDeletionRepo.findByFirebaseUserId.mockResolvedValue({
      id: 'del-1',
      userId: 'user-1',
      firebaseUserId: 'firebase-1',
      email: 'deleted@example.com',
      status: 'COMPLETED',
    });
    const request: { headers: Record<string, string>; user?: unknown; authTime?: number } = {
      headers: { authorization: 'Bearer valid-token' },
    };
    const deleteMyAccountContext: ExecutionContext = {
      getType: () => 'http',
      getHandler: () => function deleteMyAccount() {},
      getClass: () => class UsersResolver {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(deleteMyAccountContext)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'user-1',
      firebaseUserId: 'firebase-1',
      email: 'deleted@example.com',
    });
  });
});

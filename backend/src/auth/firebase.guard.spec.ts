import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { FirebaseAuthGuard } from './firebase.guard';
import { UsersService } from '../users/users.service';

/**
 * Unit tests for FirebaseAuthGuard.
 *
 * TODO: expand these stubs with proper mocks:
 *   - Mock Firebase Admin SDK (mock `getAuth().verifyIdToken()`)
 *   - Mock UsersService (mock `findOrCreate()`)
 *   - Test: @Public() routes pass without a token
 *   - Test: Missing Authorization header → UnauthorizedException
 *   - Test: Malformed Bearer token → UnauthorizedException
 *   - Test: Valid token → user attached to context
 *   - Test: Token cache hit → Firebase not called again
 *   - Test: User cache hit → DB not called again
 */
describe('FirebaseAuthGuard', () => {
  let guard: FirebaseAuthGuard;

  const mockFirebaseApp = {
    // Firebase Admin App shape — only needs what the guard accesses
  };

  const mockUsersService = {
    findOrCreate: jest.fn(),
  } satisfies Partial<UsersService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FirebaseAuthGuard,
        Reflector,
        { provide: 'FIREBASE_ADMIN', useValue: mockFirebaseApp },
        { provide: UsersService, useValue: mockUsersService },
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<FirebaseAuthGuard>(FirebaseAuthGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });
});

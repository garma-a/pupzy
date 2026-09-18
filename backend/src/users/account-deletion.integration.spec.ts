import { sql, eq, inArray } from 'drizzle-orm';
import { join } from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
const request = require('supertest');
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { TestDatabaseHelper } from '../../test/test-database.helper';

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/staging-presigned-url'),
}));

import {
  users,
  posts,
  postMedia,
  postUpvotes,
  postSaves,
  postReports,
  notifications,
  contactRequests,
  adoptionApplications,
  rescuePosts,
  lostPosts,
  adoptionPosts,
  productPosts,
  matingPosts,
  moderationActions,
  cities,
  accountDeletions,
  mediaFinalizations,
  stagedUploads,
  type AccountDeletion,
  type User,
} from '../database/schema';
import { AccountDeletionService } from './account-deletion.service';
import { AccountDeletionRepository } from './account-deletion.repository';
import { AccountDeletionCron } from './account-deletion.cron';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { UsersResolver } from './users.resolver';
import { UploadService } from '../upload/upload.service';
import {
  MediaFinalizationRepository,
  MEDIA_FINALIZATION_LEASE_MS,
  MEDIA_FINALIZATION_ORPHAN_TTL_MS,
} from '../upload/media-finalization.repository';
import { CitiesService } from '../cities/cities.service';
import { PostsRepository } from '../posts/posts.repository';
import { ContactsRepository } from '../contacts/contacts.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { ContactsResolver } from '../contacts/contacts.resolver';
import { AdoptionsResolver } from '../adoptions/adoptions.resolver';
import { ContactsService } from '../contacts/contacts.service';
import { AdoptionsService } from '../adoptions/adoptions.service';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { ForbiddenError, NotFoundError } from '../common/errors/app.errors';
import { GqlExceptionFilter } from '../common/filters/gql-exception.filter';
import { FirebaseAuthGuard } from '../auth/firebase.guard';
import { FIREBASE_ADMIN_TOKEN } from '../auth/firebase.module';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type { App } from 'firebase-admin/app';
import type { GqlContext } from '../common/types/gql-context.type';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../database/schema';

interface DeleteMyAccountGqlData {
  status: string;
  deletionId: string;
  progressToken: string | null;
  message: string;
}

interface AccountDeletionProgressGqlData {
  status: string;
  deletionId: string;
  message: string;
}

interface GqlResponseBody {
  data?: {
    deleteMyAccount?: DeleteMyAccountGqlData;
    accountDeletionProgress?: AccountDeletionProgressGqlData;
    me?: { id: string; email: string };
    [key: string]: unknown;
  };
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

async function executeGql(
  targetApp: INestApplication,
  query: string,
  variables?: Record<string, unknown>,
  token?: string,
): Promise<{ status: number; body: GqlResponseBody }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const req = request(targetApp.getHttpServer()).post('/graphql');
  if (token) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    req.set('Authorization', `Bearer ${token}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const res = (await req.send({ query, variables })) as { status: number; body: GqlResponseBody };
  return res;
}

describe('Account Deletion Feature Integration', () => {
  let dbHelper: TestDatabaseHelper;
  let accountDeletionRepo: AccountDeletionRepository;
  let usersRepo: UsersRepository;
  let mediaFinalizationRepo: MediaFinalizationRepository;
  let usersService: UsersService;
  let accountDeletionService: AccountDeletionService;
  let accountDeletionCron: AccountDeletionCron;
  let mockUploadService: {
    deleteObjects: jest.Mock;
    deletePrefix: jest.Mock;
    getLastUploadGraceUntil: jest.Mock;
  };
  let mockCacheManager: jest.Mocked<Cache>;
  let mockFirebaseApp: App;
  let mockDeleteUser: jest.Mock;
  let mockVerifyIdToken: jest.Mock;
  let mockConfig: { get: jest.Mock };
  let app: INestApplication | undefined;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();
  }, 120_000);

  afterAll(async () => {
    await dbHelper.stop();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  beforeEach(async () => {
    await dbHelper.clean();
    jest.clearAllMocks();

    accountDeletionRepo = new AccountDeletionRepository(dbHelper.db);
    usersRepo = new UsersRepository(dbHelper.db);
    mediaFinalizationRepo = new MediaFinalizationRepository(dbHelper.db);

    mockUploadService = {
      deleteObjects: jest.fn().mockResolvedValue(undefined),
      deletePrefix: jest.fn().mockResolvedValue(1),
      getLastUploadGraceUntil: jest.fn().mockResolvedValue(null),
    };

    const cacheStore = new Map<string, unknown>();
    mockCacheManager = {
      get: jest.fn().mockImplementation((key: string) => Promise.resolve(cacheStore.get(key))),
      set: jest.fn().mockImplementation((key: string, val: unknown) => {
        cacheStore.set(key, val);
        return Promise.resolve();
      }),
      del: jest.fn().mockImplementation((key: string) => {
        cacheStore.delete(key);
        return Promise.resolve();
      }),
    } as unknown as jest.Mocked<Cache>;

    mockDeleteUser = jest.fn().mockResolvedValue(undefined);
    mockVerifyIdToken = jest.fn();
    mockFirebaseApp = {} as unknown as App;
    // Mock getAuth implementation
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
    const authModule = require('firebase-admin/auth');

    jest.spyOn(authModule, 'getAuth').mockReturnValue({
      deleteUser: mockDeleteUser,
      verifyIdToken: mockVerifyIdToken,
    });

    mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'ACCOUNT_DELETION_ENABLED') return true;
        if (key === 'PHONE_ENCRYPTION_KEY') return 'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=';
        if (key === 'R2_BUCKET_NAME') return 'pupzy-bucket';
        if (key === 'R2_PUBLIC_URL') return 'https://cdn.pupzy.com';
        if (key === 'R2_ACCOUNT_ID') return 'test-account';
        if (key === 'R2_ACCESS_KEY_ID') return 'test-key';
        if (key === 'R2_SECRET_ACCESS_KEY') return 'test-secret';
        return undefined;
      }),
    };

    const mockCitiesService = {} as unknown as CitiesService;
    usersService = new UsersService(
      usersRepo,
      mockCitiesService,
      accountDeletionRepo,
      mockConfig as unknown as ConfigService,
      mockCacheManager,
    );

    accountDeletionService = new AccountDeletionService(
      accountDeletionRepo,
      usersRepo,
      mockUploadService as unknown as UploadService,
      mockConfig as unknown as ConfigService,
      mockFirebaseApp,
      dbHelper.db,
      mockCacheManager,
      mediaFinalizationRepo,
    );

    accountDeletionCron = new AccountDeletionCron(accountDeletionRepo, accountDeletionService);
  });

  async function initTestApp(): Promise<INestApplication> {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          typePaths: [join(process.cwd(), 'src/**/*.graphql')],
          context: ({ req }: { req: unknown }) => ({ req }),
        }),
      ],
      providers: [
        UsersResolver,
        { provide: UsersService, useValue: usersService },
        { provide: AccountDeletionService, useValue: accountDeletionService },
        { provide: AccountDeletionRepository, useValue: accountDeletionRepo },
        { provide: FIREBASE_ADMIN_TOKEN, useValue: mockFirebaseApp },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: APP_GUARD, useClass: FirebaseAuthGuard },
        { provide: APP_FILTER, useClass: GqlExceptionFilter },
      ],
    }).compile();

    const nestApp = moduleRef.createNestApplication();
    await nestApp.init();
    return nestApp;
  }

  async function seedCity(name = 'Cairo'): Promise<string> {
    const [city] = await dbHelper.db
      .insert(cities)
      .values({
        nameEnglish: name,
        nameArabic: 'القاهرة',
        governorate: name,
        status: 'OFFICIAL',
        centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    return city.id;
  }

  async function seedPostMediaTicket(userId: string): Promise<{
    mediaId: string;
    postId: string;
    stagingKey: string;
  }> {
    const mediaId = generateUuidV7();
    const postId = generateUuidV7();
    const stagingKey = `staging/${userId}/${mediaId}.webp`;
    await dbHelper.db.insert(stagedUploads).values({
      id: mediaId,
      userId,
      purpose: 'POST_MEDIA',
      stagingKey,
      declaredContentType: 'image/webp',
      declaredFileSizeBytes: 1024,
      status: 'ISSUED',
      expiresAt: new Date(Date.now() + 900_000),
    });
    return { mediaId, postId, stagingKey };
  }

  // ─── TICKET 01: Empty Account Deletion Journey ──────────────────────────────

  describe('Ticket 01: Delete account with no community data', () => {
    it('successfully accepts, blocks access, deletes database row and Firebase user for empty account', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-empty-1',
          email: 'empty@example.com',
          fullName: 'Empty User',
          homeCityId: cityId,
        })
        .returning();

      // Auth time is recent (10 seconds ago)
      const authTime = Math.floor(Date.now() / 1000) - 10;

      const payload = await accountDeletionService.initiateDeletion(user, authTime);

      expect(payload.status).toBe('COMPLETED');
      expect(payload.deletionId).toBeDefined();
      expect(payload.progressToken).toBeDefined();
      expect(payload.completedAt).toBeDefined();

      // Database user row must be deleted
      const foundUser = await usersRepo.findById(user.id);
      expect(foundUser).toBeUndefined();

      // Firebase user deletion must be called
      expect(mockDeleteUser).toHaveBeenCalledWith('fb-empty-1');

      // account_deletions row must be COMPLETED
      const deletionRecord = await accountDeletionRepo.findById(payload.deletionId);
      expect(deletionRecord).toBeDefined();
      expect(deletionRecord?.status).toBe('COMPLETED');
      expect(deletionRecord?.step).toBe('COMPLETED');

      // Cache for user must be invalidated
      expect(mockCacheManager.del).toHaveBeenCalledWith('user_resolve:fb-empty-1');

      // Access must be blocked immediately via isDeletedOrPending
      const isBlocked = await accountDeletionService.isDeletedOrPending('fb-empty-1');
      expect(isBlocked).toBe(true);

      // Old token recreation attempt must be rejected
      await expect(
        usersService.findOrCreate({ firebaseUserId: 'fb-empty-1', email: 'empty@example.com' }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('enforces recent authentication within 5 minutes', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-auth-test',
          email: 'auth@example.com',
          fullName: 'Auth User',
          homeCityId: cityId,
        })
        .returning();

      const currentEpochSeconds = Math.floor(Date.now() / 1000);

      // 1. Missing authTime
      await expect(accountDeletionService.initiateDeletion(user, undefined)).rejects.toThrow(
        new ForbiddenError('RECENT_AUTHENTICATION_REQUIRED'),
      );

      // 2. Stale authTime (301 seconds ago)
      await expect(accountDeletionService.initiateDeletion(user, currentEpochSeconds - 301)).rejects.toThrow(
        new ForbiddenError('RECENT_AUTHENTICATION_REQUIRED'),
      );

      // 3. Future authTime (>30s tolerance)
      await expect(accountDeletionService.initiateDeletion(user, currentEpochSeconds + 120)).rejects.toThrow(
        new ForbiddenError('INVALID_AUTHENTICATION_TIME'),
      );

      // 4. Valid authTime (290 seconds ago = 4m 50s) succeeds
      const result = await accountDeletionService.initiateDeletion(user, currentEpochSeconds - 290);
      expect(result.status).toBe('COMPLETED');
    });

    it('is idempotent: safe against duplicate submissions and lost responses', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-idempotent-1',
          email: 'idemp@example.com',
          fullName: 'Idempotent User',
          homeCityId: cityId,
        })
        .returning();

      const authTime = Math.floor(Date.now() / 1000) - 20;
      const clientToken = 'client-provided-token-12345678';

      // First call
      const first = await accountDeletionService.initiateDeletion(user, authTime, clientToken);
      expect(first.status).toBe('COMPLETED');
      expect(first.progressToken).toBe(clientToken);

      // Second duplicate call with same client token
      const second = await accountDeletionService.initiateDeletion(user, authTime, clientToken);
      expect(second.status).toBe('COMPLETED');
      expect(second.deletionId).toBe(first.deletionId);
      expect(second.progressToken).toBe(clientToken);

      // Third duplicate call without token returns null progressToken safely
      const third = await accountDeletionService.initiateDeletion(user, authTime);
      expect(third.status).toBe('COMPLETED');
      expect(third.deletionId).toBe(first.deletionId);
    });

    it('allows unauthenticated progress querying using deletionId and progressToken without granting account access', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-progress-1',
          email: 'progress@example.com',
          fullName: 'Progress User',
          homeCityId: cityId,
        })
        .returning();

      const authTime = Math.floor(Date.now() / 1000) - 10;
      const clientToken = 'secret-progress-token-99887766';

      const initial = await accountDeletionService.initiateDeletion(user, authTime, clientToken);

      // Valid token query returns progress
      const progress = await accountDeletionService.getProgress(initial.deletionId, clientToken);
      expect(progress.status).toBe('COMPLETED');
      expect(progress.deletionId).toBe(initial.deletionId);

      // Invalid token query throws NotFoundError
      await expect(accountDeletionService.getProgress(initial.deletionId, 'wrong-token')).rejects.toThrow(
        NotFoundError,
      );
    });

    it('enforces that deliberate fresh registration after completion starts fresh without old content', async () => {
      const cityId = await seedCity();
      const [oldUser] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-old-uid',
          email: 'returning@example.com',
          fullName: 'Returning User',
          homeCityId: cityId,
        })
        .returning();

      const authTime = Math.floor(Date.now() / 1000) - 10;
      await accountDeletionService.initiateDeletion(oldUser, authTime);

      // Confirm old identity is deleted
      const oldCheck = await usersRepo.findById(oldUser.id);
      expect(oldCheck).toBeUndefined();

      // Fresh registration arrives with a new Firebase UID for the same email
      const freshUser = await usersService.findOrCreate({
        firebaseUserId: 'fb-new-fresh-uid',
        email: 'returning@example.com',
      });

      expect(freshUser).toBeDefined();
      expect(freshUser.id).not.toBe(oldUser.id);
      expect(freshUser.firebaseUserId).toBe('fb-new-fresh-uid');
      expect(freshUser.postCount).toBe(0);

      // Old UID remains blocked
      expect(await accountDeletionService.isDeletedOrPending('fb-old-uid')).toBe(true);
      // New UID is not blocked
      expect(await accountDeletionService.isDeletedOrPending('fb-new-fresh-uid')).toBe(false);
    });
  });

  // ─── TICKET 02: Populated Account Deletion Journey ──────────────────────────

  describe('Ticket 02: Delete Posts, interactions, and personal information', () => {
    it('permanently deletes all 5 post types (including unresolved rescue/lost), reconciles interactions, and redacts surviving notifications/moderation', async () => {
      const cityId = await seedCity();

      // Deleting user
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-populated-1',
          email: 'populated@example.com',
          fullName: 'Ahmed Farouk',
          fullNameArabic: 'أحمد فاروق',
          phoneNumber: '+201011112222',
          homeCityId: cityId,
        })
        .returning();

      // Other surviving user
      const [otherUser] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-other-1',
          email: 'other@example.com',
          fullName: 'Mona Salem',
          homeCityId: cityId,
        })
        .returning();

      // 1. Seed user's 5 posts: RESCUE, LOST, ADOPTION, PRODUCT, MATING
      const [rescuePost] = await dbHelper.db
        .insert(posts)
        .values({
          creatorId: user.id,
          postType: 'RESCUE',
          cityId,
          title: 'Injured cat in Dokki',
          description: 'Needs urgent care',
          urgency: 'CRITICAL',
          coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
          status: 'ACTIVE',
        })
        .returning();
      await dbHelper.db.insert(rescuePosts).values({
        postId: rescuePost.id,
        species: 'CAT',
        conditionSummary: 'Cat with leg injury',
        reporterRole: 'REPORTING',
        isLifeThreatening: true,
        hasVisibleSeriousInjury: true,
        isInDangerousLocation: false,
        canAnimalMoveOrEscape: false,
      });
      await dbHelper.db.insert(postMedia).values({
        postId: rescuePost.id,
        cloudflareStorageKey: `posts/${rescuePost.id}/img1.webp`,
        publicUrl: `https://pub.example.com/posts/${rescuePost.id}/img1.webp`,
        fileContentType: 'image/webp',
        displayOrder: 0,
      });

      const [lostPost] = await dbHelper.db
        .insert(posts)
        .values({
          creatorId: user.id,
          postType: 'LOST',
          cityId,
          title: 'Lost Golden Retriever',
          description: 'Reward offered',
          urgency: 'MODERATE',
          coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
          status: 'ACTIVE',
        })
        .returning();
      await dbHelper.db.insert(lostPosts).values({
        postId: lostPost.id,
        reportType: 'LOST_PET',
        species: 'DOG',
        petName: 'Rex',
        dateLastSeen: '2026-03-01',
      });

      const [adoptionPost] = await dbHelper.db
        .insert(posts)
        .values({
          creatorId: user.id,
          postType: 'ADOPTION',
          cityId,
          title: 'Puppy for adoption',
          description: 'Friendly and vaccinated',
          coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
          status: 'ACTIVE',
        })
        .returning();
      await dbHelper.db.insert(adoptionPosts).values({
        postId: adoptionPost.id,
        petName: 'Milo',
        species: 'DOG',
        gender: 'MALE',
        vaccinated: true,
        neutered: false,
        personalityTags: ['PLAYFUL'],
        priorPetExperienceRequired: false,
      });

      const [productPost] = await dbHelper.db
        .insert(posts)
        .values({
          creatorId: user.id,
          postType: 'PRODUCT',
          cityId,
          marketCategory: 'ACCESSORIES',
          title: 'Pet Carrier Bag',
          description: 'New condition',
          coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
          status: 'ACTIVE',
        })
        .returning();
      await dbHelper.db.insert(productPosts).values({
        postId: productPost.id,
        category: 'ACCESSORIES',
        condition: 'NEW',
        priceAmount: '350.00',
        priceCurrency: 'EGP',
        isFree: false,
      });

      const [matingPost] = await dbHelper.db
        .insert(posts)
        .values({
          creatorId: user.id,
          postType: 'MATING',
          cityId,
          title: 'Purebred Husky for mating',
          description: 'Pedigree husky',
          coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
          status: 'ACTIVE',
        })
        .returning();
      await dbHelper.db.insert(matingPosts).values({
        postId: matingPost.id,
        petName: 'Ghost',
        species: 'DOG',
        breed: 'Siberian Husky',
        gender: 'MALE',
        ageValue: 2,
        ageUnit: 'YEARS',
        isPurebred: true,
      });

      // 2. Seed other user's surviving post with upvote, save, and report from deleting user
      const [survivingPost] = await dbHelper.db
        .insert(posts)
        .values({
          creatorId: otherUser.id,
          postType: 'ADOPTION',
          cityId,
          title: 'Persian Kitten',
          description: 'Looking for a home',
          coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
          upvoteCount: 5,
          saveCount: 3,
          effectiveScore: 10.5,
          status: 'ACTIVE',
        })
        .returning();
      await dbHelper.db.insert(adoptionPosts).values({
        postId: survivingPost.id,
        petName: 'Luna',
        species: 'CAT',
        gender: 'FEMALE',
        vaccinated: true,
      });

      await dbHelper.db.insert(postUpvotes).values({
        postId: survivingPost.id,
        userId: user.id,
      });
      await dbHelper.db.insert(postSaves).values({
        postId: survivingPost.id,
        userId: user.id,
      });
      await dbHelper.db.insert(postReports).values({
        postId: survivingPost.id,
        reporterId: user.id,
        reason: 'DUPLICATE',
      });

      // 3. Seed contact requests and adoption applications
      await dbHelper.db.insert(contactRequests).values({
        postId: survivingPost.id,
        requesterId: user.id,
        message: 'Can I visit the kitten?',
      });
      await dbHelper.db.insert(contactRequests).values({
        postId: rescuePost.id,
        requesterId: otherUser.id,
        message: 'I can foster the cat!',
      });
      await dbHelper.db.insert(adoptionApplications).values({
        targetPostId: adoptionPost.id,
        applicantId: otherUser.id,
        livingSituation: 'APARTMENT',
        hasOutdoorAccess: false,
        hasOtherPetsAtHome: false,
        hasChildrenAtHome: false,
        whyAdopt: 'Loving home ready for a puppy',
      });

      // 4. Seed notifications
      // A) Surviving notification received by otherUser mentioning deleting user's name
      const [survivingNotif] = await dbHelper.db
        .insert(notifications)
        .values({
          recipientId: otherUser.id,
          type: 'NEW_UPVOTE',
          title: 'Ahmed Farouk upvoted your post',
          body: 'Ahmed Farouk (+201011112222, populated@example.com) loved your Persian Kitten!',
        })
        .returning();

      // B) Notification for deleting user (must be removed)
      await dbHelper.db.insert(notifications).values({
        recipientId: user.id,
        type: 'SYSTEM_ANNOUNCEMENT',
        title: 'Welcome',
        body: 'Welcome to Pupzy',
      });

      // 5. Seed moderation action targeting user and user's post
      const [userModAction] = await dbHelper.db
        .insert(moderationActions)
        .values({
          actionType: 'USER_BANNED',
          targetType: 'USER',
          targetId: user.id,
          reason: 'Reported by Ahmed Farouk for spam',
          metadata: { ip: '192.168.1.1', email: 'populated@example.com' },
        })
        .returning();

      const [postModAction] = await dbHelper.db
        .insert(moderationActions)
        .values({
          actionType: 'POST_FLAGGED',
          targetType: 'POST',
          targetId: rescuePost.id,
          reason: 'Needs review for Ahmed Farouk',
          metadata: { flaggedBy: 'admin' },
        })
        .returning();

      // Unrelated moderation action (must be preserved intact)
      const [unrelatedModAction] = await dbHelper.db
        .insert(moderationActions)
        .values({
          actionType: 'POST_APPROVED',
          targetType: 'POST',
          targetId: survivingPost.id,
          reason: 'Legitimate adoption listing',
        })
        .returning();

      // 6. Execute account deletion
      const authTime = Math.floor(Date.now() / 1000) - 10;
      const result = await accountDeletionService.initiateDeletion(user, authTime);

      expect(result.status).toBe('COMPLETED');

      // 7. Verify all 5 user posts are permanently removed
      const remainingPosts = await dbHelper.db
        .select()
        .from(posts)
        .where(inArray(posts.id, [rescuePost.id, lostPost.id, adoptionPost.id, productPost.id, matingPost.id]));
      expect(remainingPosts).toHaveLength(0);

      // Verify extension rows are gone
      const remainingRescue = await dbHelper.db.select().from(rescuePosts).where(eq(rescuePosts.postId, rescuePost.id));
      expect(remainingRescue).toHaveLength(0);

      // 8. Verify other user's surviving post engagement is reconciled
      const [updatedSurviving] = await dbHelper.db.select().from(posts).where(eq(posts.id, survivingPost.id));
      expect(updatedSurviving.upvoteCount).toBe(4); // 5 - 1
      expect(updatedSurviving.saveCount).toBe(2); // 3 - 1
      expect(updatedSurviving.reportCount).toBe(0); // 0 + trigger insert - trigger delete
      expect(updatedSurviving.effectiveScore).toBeLessThan(10.5);

      // 9. Verify surviving notifications are redacted
      const [redactedNotif] = await dbHelper.db
        .select()
        .from(notifications)
        .where(eq(notifications.id, survivingNotif.id));
      expect(redactedNotif.title).not.toContain('Ahmed Farouk');
      expect(redactedNotif.title).toContain('Someone');
      expect(redactedNotif.body).not.toContain('Ahmed Farouk');
      expect(redactedNotif.body).not.toContain('+201011112222');
      expect(redactedNotif.body).not.toContain('populated@example.com');
      expect(redactedNotif.body).toContain('[deleted]');

      // 10. Verify moderation actions are redacted
      const [redactedUserMod] = await dbHelper.db
        .select()
        .from(moderationActions)
        .where(eq(moderationActions.id, userModAction.id));
      expect(redactedUserMod.reason).toBe('Redacted (account deleted)');
      expect(redactedUserMod.metadata).toBeNull();

      const [redactedPostMod] = await dbHelper.db
        .select()
        .from(moderationActions)
        .where(eq(moderationActions.id, postModAction.id));
      expect(redactedPostMod.reason).toBe('Redacted (account deleted)');
      expect(redactedPostMod.metadata).toBeNull();

      // Unrelated moderation action is completely preserved
      const [preservedMod] = await dbHelper.db
        .select()
        .from(moderationActions)
        .where(eq(moderationActions.id, unrelatedModAction.id));
      expect(preservedMod.reason).toBe('Legitimate adoption listing');

      // 11. Verify storage cleanup called for captured media keys
      expect(mockUploadService.deleteObjects).toHaveBeenCalledWith([`posts/${rescuePost.id}/img1.webp`]);
      expect(mockUploadService.deletePrefix).toHaveBeenCalledWith(`staging/${user.id}/`);
    });

    it('decrements every surviving Post Report count exactly once through the trigger and never below zero', async () => {
      const cityId = await seedCity();
      const [reporter] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-reporter-1',
          email: 'reporter@example.com',
          fullName: 'Reporting User',
        })
        .returning();
      const [otherUser] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-survivor-1',
          email: 'survivor@example.com',
          fullName: 'Surviving User',
        })
        .returning();
      const [thirdUser] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-survivor-2',
          email: 'survivor2@example.com',
          fullName: 'Other Reporting User',
        })
        .returning();

      const [postWithTwoOtherReports] = await dbHelper.db
        .insert(posts)
        .values({
          creatorId: otherUser.id,
          postType: 'RESCUE',
          cityId,
          title: 'Rescue with reports from two reporters',
          description: 'Needs review',
          urgency: 'URGENT',
          coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
          status: 'ACTIVE',
        })
        .returning();
      const [postWithOnlyReporterReport] = await dbHelper.db
        .insert(posts)
        .values({
          creatorId: otherUser.id,
          postType: 'RESCUE',
          cityId,
          title: 'Rescue reported only by deleting reporter',
          description: 'Needs review',
          urgency: 'URGENT',
          coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
          status: 'ACTIVE',
        })
        .returning();
      const [driftedPost] = await dbHelper.db
        .insert(posts)
        .values({
          creatorId: otherUser.id,
          postType: 'RESCUE',
          cityId,
          title: 'Rescue with drifted report counter',
          description: 'Needs review',
          urgency: 'URGENT',
          coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
          status: 'ACTIVE',
        })
        .returning();

      await dbHelper.db.insert(postReports).values([
        { postId: postWithTwoOtherReports.id, reporterId: otherUser.id, reason: 'SPAM' },
        { postId: postWithTwoOtherReports.id, reporterId: thirdUser.id, reason: 'SCAM' },
        { postId: postWithTwoOtherReports.id, reporterId: reporter.id, reason: 'DUPLICATE' },
        { postId: postWithOnlyReporterReport.id, reporterId: reporter.id, reason: 'SPAM' },
        { postId: driftedPost.id, reporterId: reporter.id, reason: 'SPAM' },
      ]);

      await dbHelper.db.update(posts).set({ reportCount: 0 }).where(eq(posts.id, driftedPost.id));

      const authTime = Math.floor(Date.now() / 1000) - 10;
      const result = await accountDeletionService.initiateDeletion(reporter, authTime);
      expect(result.status).toBe('COMPLETED');

      const survivingPosts = await dbHelper.db
        .select()
        .from(posts)
        .where(inArray(posts.id, [postWithTwoOtherReports.id, postWithOnlyReporterReport.id, driftedPost.id]));
      const countByPostId = new Map(survivingPosts.map((post) => [post.id, post.reportCount]));

      expect(countByPostId.get(postWithTwoOtherReports.id)).toBe(2);
      expect(countByPostId.get(postWithOnlyReporterReport.id)).toBe(0);
      expect(countByPostId.get(driftedPost.id)).toBe(0);

      const remainingReports = await dbHelper.db
        .select()
        .from(postReports)
        .where(eq(postReports.reporterId, reporter.id));
      expect(remainingReports).toHaveLength(0);

      const survivingReports = await dbHelper.db
        .select()
        .from(postReports)
        .where(inArray(postReports.postId, [postWithTwoOtherReports.id]));
      expect(survivingReports).toHaveLength(2);
    });

    it('immediately hides user posts and marks user banned at acceptance before cleanup completes', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-hide-test-1',
          email: 'hide@example.com',
          fullName: 'Hide User',
          homeCityId: cityId,
        })
        .returning();

      const [post] = await dbHelper.db
        .insert(posts)
        .values({
          creatorId: user.id,
          cityId,
          postType: 'ADOPTION',
          title: 'Puppy for Adoption',
          description: 'Cute puppy',
          coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
          status: 'ACTIVE',
        })
        .returning();

      // Simulate cleanup failure after acceptance so posts remain in database for inspection
      jest
        .spyOn(accountDeletionService as unknown as { cleanupDatabaseData: () => Promise<void> }, 'cleanupDatabaseData')
        .mockRejectedValueOnce(new Error('Transient DB glitch'));

      const authTime = Math.floor(Date.now() / 1000) - 10;
      const initial = await accountDeletionService.initiateDeletion(user, authTime);
      expect(initial.status).toBe('PENDING');

      // Post must be immediately set to REMOVED status
      const [removedPost] = await dbHelper.db.select().from(posts).where(eq(posts.id, post.id));
      expect(removedPost.status).toBe('REMOVED');

      // User must be banned with banReason ACCOUNT_DELETED
      const [bannedUser] = await dbHelper.db.select().from(users).where(eq(users.id, user.id));
      expect(bannedUser.isBanned).toBe(true);
      expect(bannedUser.banReason).toBe('ACCOUNT_DELETED');
    });
  });

  // ─── TICKET 03: Photo Deletion & Upload Grace Window ────────────────────────

  describe('Ticket 03: Finish deletion of uploaded photos and in-flight signed URLs', () => {
    it('defers completion when a presigned upload URL is still within its 10-minute validity window, then completes on cron retry', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-media-grace-1',
          email: 'grace@example.com',
          fullName: 'Media User',
          homeCityId: cityId,
        })
        .returning();

      // Simulate a presigned URL issued 2 minutes ago (grace expires in 8 minutes)
      const futureGrace = new Date(Date.now() + 480_000);
      mockUploadService.getLastUploadGraceUntil.mockResolvedValue(futureGrace);

      const authTime = Math.floor(Date.now() / 1000) - 10;
      const initial = await accountDeletionService.initiateDeletion(user, authTime);

      // Must be accepted durably, but remain in PENDING status
      expect(initial.status).toBe('PENDING');
      expect(initial.completedAt).toBeNull();

      // Database user row was cleaned
      expect(await usersRepo.findById(user.id)).toBeUndefined();
      // But Firebase user deletion is deferred until storage sweep completes
      expect(mockDeleteUser).not.toHaveBeenCalled();

      // Querying progress shows in progress
      const progress = await accountDeletionService.getProgress(initial.deletionId, initial.progressToken!);
      expect(progress.status).toBe('PENDING');

      // Now simulate time passing: grace window expires
      const record = await accountDeletionRepo.findById(initial.deletionId);
      expect(record).toBeDefined();
      await accountDeletionRepo.update(record!.id, {
        stagedUploadGraceUntil: new Date(Date.now() - 1000), // now expired
        nextRetryAt: new Date(Date.now() - 1000),
      });

      // Cron triggers and processes pending deletion
      await accountDeletionCron.processPendingDeletions();

      // Now storage sweep finishes and deletion completes
      const updated = await accountDeletionRepo.findById(initial.deletionId);
      expect(updated?.status).toBe('COMPLETED');
      expect(updated?.step).toBe('COMPLETED');
      expect(mockUploadService.deletePrefix).toHaveBeenCalledWith(`staging/${user.id}/`);
      expect(mockDeleteUser).toHaveBeenCalledWith('fb-media-grace-1');

      // Progress now reports completed
      const finalProgress = await accountDeletionService.getProgress(initial.deletionId, initial.progressToken!);
      expect(finalProgress.status).toBe('COMPLETED');
    });

    it('resumes from failure when storage or Firebase errors transiently', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-fail-retry-1',
          email: 'fail@example.com',
          fullName: 'Retry User',
          homeCityId: cityId,
        })
        .returning();

      // Storage deletePrefix fails first time
      mockUploadService.deletePrefix.mockRejectedValueOnce(new Error('Cloudflare R2 503 Service Unavailable'));

      const authTime = Math.floor(Date.now() / 1000) - 10;
      const initial = await accountDeletionService.initiateDeletion(user, authTime);

      expect(initial.status).toBe('PENDING');

      const record = await accountDeletionRepo.findById(initial.deletionId);
      expect(record?.status).toBe('PENDING');
      expect(record?.lastError).toContain('Cloudflare R2 503');

      // Reset nextRetryAt to now so cron picks it up
      await accountDeletionRepo.update(record!.id, {
        nextRetryAt: new Date(Date.now() - 1000),
      });

      // Cron runs, storage now succeeds
      mockUploadService.deletePrefix.mockResolvedValue(2);
      await accountDeletionCron.processPendingDeletions();

      const finalRecord = await accountDeletionRepo.findById(initial.deletionId);
      expect(finalRecord?.status).toBe('COMPLETED');
      expect(mockDeleteUser).toHaveBeenCalledWith('fb-fail-retry-1');
    });

    it('preserves media targets in mediaCleanupScope upon storage failure and does not mark COMPLETED', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-storage-fail-1',
          email: 'storagefail@example.com',
          fullName: 'Storage Fail User',
          homeCityId: cityId,
        })
        .returning();

      const [post] = await dbHelper.db
        .insert(posts)
        .values({
          creatorId: user.id,
          cityId,
          postType: 'PRODUCT',
          title: 'Pet Collar',
          description: 'Durable collar',
          coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
          status: 'ACTIVE',
        })
        .returning();

      await dbHelper.db.insert(postMedia).values({
        postId: post.id,
        mediaType: 'IMAGE',
        cloudflareStorageKey: `posts/${post.id}/photo.jpg`,
        publicUrl: `https://cdn.example.com/posts/${post.id}/photo.jpg`,
        sortOrder: 0,
      });

      // Storage deleteObjects fails (e.g. bulk error or individual failure)
      mockUploadService.deleteObjects.mockRejectedValueOnce(
        new Error('R2 bulk delete returned 1 object errors. Failed keys: posts/' + post.id + '/photo.jpg'),
      );

      const authTime = Math.floor(Date.now() / 1000) - 10;
      const payload = await accountDeletionService.initiateDeletion(user, authTime);
      expect(payload.status).toBe('PENDING');

      const record = await accountDeletionRepo.findById(payload.deletionId);
      expect(record?.status).toBe('PENDING');
      expect(record?.step).toBe('DATA_CLEANED');
      // Media keys must be preserved for retry!
      const scope = record?.mediaCleanupScope as { mediaKeys?: string[] } | null;
      expect(scope?.mediaKeys).toContain(`posts/${post.id}/photo.jpg`);

      // Reset nextRetryAt to past so cron picks it up
      await accountDeletionRepo.update(payload.deletionId, {
        nextRetryAt: new Date(Date.now() - 1000),
      });

      // Now retry with working storage: targets are deleted and record completes
      mockUploadService.deleteObjects.mockResolvedValueOnce(undefined);
      mockUploadService.deletePrefix.mockResolvedValueOnce(0);
      await accountDeletionCron.processPendingDeletions();

      const completedRecord = await accountDeletionRepo.findById(payload.deletionId);
      expect(completedRecord?.status).toBe('COMPLETED');
      expect(mockUploadService.deleteObjects).toHaveBeenCalledWith([`posts/${post.id}/photo.jpg`]);
    });

    it('crash recovery preserves mediaCleanupScope targets even when posts are already deleted', async () => {
      const userId = generateUuidV7();
      const deletionId = generateUuidV7();
      const preservedKeys = [`posts/crash-p1/img1.jpg`, `posts/crash-p1/img2.jpg`];

      // Simulate a crashed state where step is DATA_CLEANED, posts are already gone, but mediaKeys exist in DB
      await dbHelper.db
        .insert(accountDeletions)
        .values({
          id: deletionId,
          userId,
          firebaseUserId: 'fb-crashed-user',
          email: 'crash@example.com',
          status: 'PENDING',
          step: 'DATA_CLEANED',
          progressTokenHash: 'crashhash',
          mediaCleanupScope: {
            mediaKeys: preservedKeys,
            stagedPrefix: `staging/${userId}/`,
          },
          nextRetryAt: new Date(Date.now() - 1000),
        })
        .returning();

      await accountDeletionCron.processPendingDeletions();

      // Verified: deleteObjects was called with the preserved keys!
      expect(mockUploadService.deleteObjects).toHaveBeenCalledWith(preservedKeys);
      const finished = await accountDeletionRepo.findById(deletionId);
      expect(finished?.status).toBe('COMPLETED');
    });

    it('10+ failures keep access blocked and keep retrying in cron with backoff', async () => {
      const userId = generateUuidV7();
      const deletionId = generateUuidV7();

      await dbHelper.db
        .insert(accountDeletions)
        .values({
          id: deletionId,
          userId,
          firebaseUserId: 'fb-failed-10-user',
          email: 'failed10@example.com',
          status: 'FAILED',
          step: 'DATA_CLEANED',
          progressTokenHash: 'failedhash',
          storageCleanupAttempts: 10,
          nextRetryAt: new Date(Date.now() - 1000), // Due for retry
        })
        .returning();

      // 1. Access is blocked: findOrCreate throws ForbiddenError ACCOUNT_DELETED
      await expect(
        usersService.findOrCreate({ firebaseUserId: 'fb-failed-10-user', email: 'failed10@example.com' }),
      ).rejects.toThrow(ForbiddenError);

      // 2. isDeletedOrPending returns true
      expect(await accountDeletionService.isDeletedOrPending('fb-failed-10-user')).toBe(true);

      // 3. findPendingForRetry still selects this FAILED record so retry never stops!
      const retryList = await accountDeletionRepo.findPendingForRetry();
      expect(retryList.some((r) => r.id === deletionId)).toBe(true);

      // 4. Cron processes it and completes when storage recovers
      mockUploadService.deletePrefix.mockResolvedValue(0);
      await accountDeletionCron.processPendingDeletions();

      const recovered = await accountDeletionRepo.findById(deletionId);
      expect(recovered?.status).toBe('COMPLETED');
    });

    it('persists uploadGraceUntil in PostgreSQL so protection survives process restarts and cache misses', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-grace-db-1',
          email: 'gracedb@example.com',
          fullName: 'Grace DB User',
          homeCityId: cityId,
        })
        .returning();

      // Real UploadService with test database helper DB
      const uploadServiceWithDb = new UploadService(
        mockConfig as unknown as ConfigService,
        mockCacheManager,
        dbHelper.db,
        mediaFinalizationRepo,
      );

      // Generate a presigned upload URL
      const upload = await uploadServiceWithDb.generatePresignedUrl(user.id, 'image/jpeg', 1024);
      expect(upload.expiresAt).toBeDefined();

      // Verify column upload_grace_until was written to PostgreSQL
      const [dbUser] = await dbHelper.db.select().from(users).where(eq(users.id, user.id));
      expect(dbUser.uploadGraceUntil).toBeDefined();
      expect(dbUser.uploadGraceUntil?.getTime()).toBeCloseTo(upload.expiresAt.getTime(), -3);

      // Simulate process restart: cache is completely cleared
      mockCacheManager.get.mockResolvedValue(null);

      // getLastUploadGraceUntil falls back to PostgreSQL and returns the timestamp!
      const fallbackGrace = await uploadServiceWithDb.getLastUploadGraceUntil(user.id);
      expect(fallbackGrace).toBeDefined();
      expect(fallbackGrace?.getTime()).toBeCloseTo(upload.expiresAt.getTime(), -3);
    });
  });

  // ─── TICKET 04: Apple-Linked & Private Relay Accounts ───────────────────────

  describe('Ticket 04: Complete deletion for Apple-linked accounts', () => {
    it('successfully deletes Apple-linked account with private relay email without asking for real email', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-apple-privaterelay-1',
          email: 'abc123xyz@privaterelay.appleid.com',
          fullName: 'Apple Relay User',
          homeCityId: cityId,
        })
        .returning();

      const authTime = Math.floor(Date.now() / 1000) - 30;
      const payload = await accountDeletionService.initiateDeletion(user, authTime);

      expect(payload.status).toBe('COMPLETED');
      expect(await usersRepo.findById(user.id)).toBeUndefined();
      expect(mockDeleteUser).toHaveBeenCalledWith('fb-apple-privaterelay-1');

      const record = await accountDeletionRepo.findById(payload.deletionId);
      expect(record?.email).toBe('abc123xyz@privaterelay.appleid.com');
      expect(record?.status).toBe('COMPLETED');
    });
  });

  // ─── TICKET 05: Release Verification & Purge Metadata ───────────────────────

  describe('Ticket 05: Verify purge and lifecycle bounds', () => {
    it('purges expired deletion audit records older than 30 days', async () => {
      // Seed an expired deletion record
      const [record] = await dbHelper.db
        .insert(accountDeletions)
        .values({
          userId: generateUuidV7(),
          firebaseUserId: 'fb-purge-old',
          email: 'old@example.com',
          status: 'COMPLETED',
          step: 'COMPLETED',
          progressTokenHash: 'dummyhash',
          purgeAt: new Date(Date.now() - 10_000), // Expired
        })
        .returning();

      // Seed a non-expired deletion record
      const [activeRecord] = await dbHelper.db
        .insert(accountDeletions)
        .values({
          userId: generateUuidV7(),
          firebaseUserId: 'fb-purge-active',
          email: 'active@example.com',
          status: 'COMPLETED',
          step: 'COMPLETED',
          progressTokenHash: 'dummyhash2',
          purgeAt: new Date(Date.now() + 86_400_000), // 1 day in future
        })
        .returning();

      await accountDeletionCron.purgeExpiredRecords();

      // Expired record is purged
      const checkExpired = await accountDeletionRepo.findById(record.id);
      expect(checkExpired).toBeUndefined();

      // Active record remains
      const checkActive = await accountDeletionRepo.findById(activeRecord.id);
      expect(checkActive).toBeDefined();
    });

    it('retention purge only purges COMPLETED records, never PENDING or FAILED', async () => {
      // Seed an expired PENDING record
      const [pendingRecord] = await dbHelper.db
        .insert(accountDeletions)
        .values({
          userId: generateUuidV7(),
          firebaseUserId: 'fb-purge-pending',
          email: 'pending@example.com',
          status: 'PENDING',
          step: 'DATA_CLEANED',
          progressTokenHash: 'hash1',
          purgeAt: new Date(Date.now() - 10_000), // Expired
        })
        .returning();

      // Seed an expired FAILED record
      const [failedRecord] = await dbHelper.db
        .insert(accountDeletions)
        .values({
          userId: generateUuidV7(),
          firebaseUserId: 'fb-purge-failed',
          email: 'failed@example.com',
          status: 'FAILED',
          step: 'DATA_CLEANED',
          progressTokenHash: 'hash2',
          purgeAt: new Date(Date.now() - 10_000), // Expired
        })
        .returning();

      // Seed an expired COMPLETED record
      const [completedRecord] = await dbHelper.db
        .insert(accountDeletions)
        .values({
          userId: generateUuidV7(),
          firebaseUserId: 'fb-purge-completed',
          email: 'completed@example.com',
          status: 'COMPLETED',
          step: 'COMPLETED',
          progressTokenHash: 'hash3',
          purgeAt: new Date(Date.now() - 10_000), // Expired
        })
        .returning();

      await accountDeletionCron.purgeExpiredRecords();

      // ONLY completed record is purged
      expect(await accountDeletionRepo.findById(completedRecord.id)).toBeUndefined();
      // PENDING and FAILED records MUST NOT be purged
      expect(await accountDeletionRepo.findById(pendingRecord.id)).toBeDefined();
      expect(await accountDeletionRepo.findById(failedRecord.id)).toBeDefined();
    });
  });

  // ─── TICKET 05 / SPEC 7: GraphQL API Execution Seam ─────────────────────────

  describe('Ticket 05 / Spec 7: GraphQL API Execution Seam', () => {
    it('executes deleteMyAccount mutation via GraphQL over HTTP through FirebaseAuthGuard and GqlExceptionFilter', async () => {
      app = await initTestApp();
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-gql-user-1',
          email: 'gql@example.com',
          fullName: 'GraphQL User',
          homeCityId: cityId,
        })
        .returning();

      const authTime = Math.floor(Date.now() / 1000) - 20;
      mockVerifyIdToken.mockResolvedValue({
        uid: user.firebaseUserId,
        auth_time: authTime,
        firebase: { sign_in_provider: 'google.com' },
      });

      const response = await executeGql(
        app,
        `
          mutation DeleteMyAccount($input: DeleteMyAccountInput!) {
            deleteMyAccount(input: $input) {
              status
              deletionId
              progressToken
              message
            }
          }
        `,
        {
          input: {
            confirm: true,
            progressToken: 'custom-client-token-12345',
          },
        },
        'valid-firebase-token',
      );

      expect(response.status).toBe(200);
      expect(response.body.errors).toBeUndefined();
      expect(response.body.data?.deleteMyAccount).toBeDefined();
      expect(response.body.data?.deleteMyAccount?.status).toBe('COMPLETED');
      expect(response.body.data?.deleteMyAccount?.progressToken).toBe('custom-client-token-12345');
      expect(mockDeleteUser).toHaveBeenCalledWith(user.firebaseUserId);
    });

    it('queries public accountDeletionProgress query via GraphQL over HTTP without auth header', async () => {
      app = await initTestApp();
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-gql-progress-1',
          email: 'gqlprog@example.com',
          fullName: 'Progress User',
          homeCityId: cityId,
        })
        .returning();

      const authTime = Math.floor(Date.now() / 1000) - 20;
      const progressToken = 'custom-progress-token-67890';
      const initial = await accountDeletionService.initiateDeletion(user, authTime, progressToken);

      const response = await executeGql(
        app,
        `
          query CheckProgress($deletionId: ID!, $progressToken: String!) {
            accountDeletionProgress(deletionId: $deletionId, progressToken: $progressToken) {
              status
              deletionId
              message
            }
          }
        `,
        {
          deletionId: initial.deletionId,
          progressToken,
        },
      );

      expect(response.status).toBe(200);
      expect(response.body.errors).toBeUndefined();
      expect(response.body.data?.accountDeletionProgress?.status).toBe('COMPLETED');
      expect(response.body.data?.accountDeletionProgress?.deletionId).toBe(initial.deletionId);
    });

    it('rejects authenticated requests with ACCOUNT_DELETED via FirebaseAuthGuard when account is deleted or pending', async () => {
      app = await initTestApp();
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-gql-deleted-1',
          email: 'deleted@example.com',
          fullName: 'Deleted User',
          homeCityId: cityId,
        })
        .returning();

      const authTime = Math.floor(Date.now() / 1000) - 20;
      await accountDeletionService.initiateDeletion(user, authTime);

      mockVerifyIdToken.mockResolvedValue({
        uid: user.firebaseUserId,
        auth_time: authTime,
        firebase: { sign_in_provider: 'google.com' },
      });

      const response = await executeGql(
        app,
        `
          query GetMe {
            me {
              id
              email
            }
          }
        `,
        undefined,
        'valid-firebase-token',
      );

      expect(response.status).toBe(200);
      expect(response.body.errors).toBeDefined();
      expect(response.body.errors?.[0]?.message).toBe('ACCOUNT_DELETED');
      expect(response.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });
  });

  describe('Concurrency, Upload Grace Serialization, and Relationship Protection', () => {
    it('blocks presigned upload issuance when account deletion is pending or accepted', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-upload-serialize-1',
          email: 'upload-serialize@example.com',
          fullName: 'Upload Serialize User',
          homeCityId: cityId,
        })
        .returning();

      const uploadServiceWithDatabase = new UploadService(
        mockConfig as unknown as ConfigService,
        mockCacheManager,
        dbHelper.db,
        mediaFinalizationRepo,
      );

      // Verify issuance works before deletion
      const presigned = await uploadServiceWithDatabase.generatePresignedUrl(user.id, 'image/jpeg', 1024);
      expect(presigned.uploadUrl).toBeDefined();

      // Now initiate deletion
      const currentEpochSeconds = Math.floor(Date.now() / 1000) - 20;
      await accountDeletionService.initiateDeletion(user, currentEpochSeconds);

      // Upload issuance must now fail closed with ForbiddenError('ACCOUNT_DELETED')
      await expect(uploadServiceWithDatabase.generatePresignedUrl(user.id, 'image/jpeg', 1024)).rejects.toThrow(
        'ACCOUNT_DELETED',
      );
    });

    it('fails closed when database transaction encounters an error during upload issuance', async () => {
      const mockDatabaseWithError = {
        transaction: jest.fn().mockRejectedValue(new Error('Connection terminated')),
      } as unknown as NodePgDatabase<typeof schema>;
      const uploadServiceWithFailingDatabase = new UploadService(
        mockConfig as unknown as ConfigService,
        mockCacheManager,
        mockDatabaseWithError,
      );

      await expect(
        uploadServiceWithFailingDatabase.generatePresignedUrl('some-user-id', 'image/jpeg', 1024),
      ).rejects.toThrow('Connection terminated');
    });

    it('blocks in-flight post creation with ForbiddenError when user is banned/deleting', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-post-serialize-1',
          email: 'post-serialize@example.com',
          fullName: 'Post Serialize User',
          homeCityId: cityId,
        })
        .returning();

      const postsRepository = new PostsRepository(dbHelper.db);

      // Initiate deletion, which marks user as banned with reason ACCOUNT_DELETED
      const currentEpochSeconds = Math.floor(Date.now() / 1000) - 20;
      await accountDeletionService.initiateDeletion(user, currentEpochSeconds);

      // Attempt to create post in-flight
      await expect(
        postsRepository.createRescuePost(
          {
            creatorId: user.id,
            postType: 'RESCUE',
            title: 'Late Rescue Post',
            description: 'This post should not be created',
            status: 'ACTIVE',
            cityId,
            urgency: 'URGENT',
          },
          {
            rescueAnimalType: 'DOG',
            healthCondition: 'CRITICAL',
          },
          [],
        ),
      ).rejects.toThrow('ACCOUNT_DELETED');
    });

    it('cleans up staging object and aborts finalization when creator is banned/deleting', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-finalize-serialize-1',
          email: 'finalize-serialize@example.com',
          fullName: 'Finalize Serialize User',
          homeCityId: cityId,
          isBanned: true,
          banReason: 'ACCOUNT_DELETED',
        })
        .returning();

      const uploadServiceWithDatabase = new UploadService(
        mockConfig as unknown as ConfigService,
        mockCacheManager,
        dbHelper.db,
        mediaFinalizationRepo,
      );
      const ticket = await seedPostMediaTicket(user.id);

      // Mock cache returning owner
      (mockCacheManager.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'media_owner:media-uuid-1') return Promise.resolve(user.id);
        if (key === 'media_ct:media-uuid-1') return Promise.resolve('image/jpeg');
        return Promise.resolve(null);
      });

      // Mock s3Client send
      const mockS3Send = jest.fn().mockResolvedValue({});
      (uploadServiceWithDatabase as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockS3Send;

      await expect(uploadServiceWithDatabase.finalizeMedia(ticket.mediaId, user.id, ticket.postId)).rejects.toThrow(
        'ACCOUNT_DELETED',
      );

      // Verify staging object was deleted
      expect(mockS3Send).toHaveBeenCalled();
      const sendCalls = mockS3Send.mock.calls as Array<[{ input?: { Key?: string } }]>;
      const lastCall = sendCalls[sendCalls.length - 1];
      expect(lastCall?.[0]?.input?.Key).toContain('staging/');
    });

    it('prevents profile exposure through contact requests and adoption applications when user is deleting', async () => {
      const cityId = await seedCity();
      const [requesterUser] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-rel-requester-1',
          email: 'requester@example.com',
          fullName: 'Requester Person',
          homeCityId: cityId,
        })
        .returning();

      const [postOwnerUser] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-rel-owner-1',
          email: 'owner@example.com',
          fullName: 'Owner Person',
          homeCityId: cityId,
        })
        .returning();

      const [samplePost] = await dbHelper.db
        .insert(posts)
        .values({
          creatorId: postOwnerUser.id,
          postType: 'ADOPTION',
          title: 'Post with Contact Request',
          description: 'Description',
          cityId,
          coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
        })
        .returning();

      const [contactRequestRecord] = await dbHelper.db
        .insert(contactRequests)
        .values({
          postId: samplePost.id,
          requesterId: requesterUser.id,
          message: 'Can I help?',
          status: 'PENDING',
        })
        .returning();

      const [adoptionApplicationRecord] = await dbHelper.db
        .insert(adoptionApplications)
        .values({
          targetPostId: samplePost.id,
          applicantId: requesterUser.id,
          status: 'PENDING',
          livingSituation: 'APARTMENT',
          hasOutdoorAccess: true,
          hasOtherPetsAtHome: false,
          hasChildrenAtHome: false,
          whyAdopt: 'Loving home ready for a puppy',
        })
        .returning();

      // Before deletion, DataLoader resolves requester
      const initialLoader = usersService.createUserByIdLoader();
      const initialLoadedUser = await initialLoader.load(requesterUser.id);
      expect(initialLoadedUser?.id).toBe(requesterUser.id);

      // Now requester initiates deletion
      const currentEpochSeconds = Math.floor(Date.now() / 1000) - 20;
      await accountDeletionService.initiateDeletion(requesterUser, currentEpochSeconds);

      // DataLoader must not return the deleting/banned user
      const freshLoader = usersService.createUserByIdLoader();
      const resolvedAfterDeletion = await freshLoader.load(requesterUser.id);
      expect(resolvedAfterDeletion).toBeNull();

      // ContactsResolver and AdoptionsResolver must return null for requester/applicant
      const contactsResolver = new ContactsResolver({} as unknown as ContactsService);
      const adoptionsResolver = new AdoptionsResolver({} as unknown as AdoptionsService);

      const mockContext = {
        loaders: {
          userById: freshLoader,
        },
      } as unknown as GqlContext;

      const requesterProfile = await contactsResolver.requester(contactRequestRecord, mockContext);
      expect(requesterProfile).toBeNull();

      const applicantProfile = await adoptionsResolver.applicant(adoptionApplicationRecord, mockContext);
      expect(applicantProfile).toBeNull();
    });

    it('concurrent cleanup retains captured media keys and does not overwrite with an empty list', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-concurrent-cleanup-1',
          email: 'concurrent-cleanup@example.com',
          fullName: 'Concurrent Cleanup User',
          homeCityId: cityId,
        })
        .returning();

      const [userPost] = await dbHelper.db
        .insert(posts)
        .values({
          creatorId: user.id,
          postType: 'ADOPTION',
          title: 'Post With Media',
          description: 'Description',
          cityId,
          coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
        })
        .returning();

      await dbHelper.db.insert(postMedia).values({
        postId: userPost.id,
        cloudflareStorageKey: `posts/${userPost.id}/photo.jpg`,
        publicUrl: `https://cdn.pupzy.com/posts/${userPost.id}/photo.jpg`,
        displayOrder: 0,
      });

      // Mock storage deleteObjects to fail initially to simulate deferred/retrying cleanup
      mockUploadService.deleteObjects.mockRejectedValueOnce(new Error('Transient storage failure'));

      const currentEpochSeconds = Math.floor(Date.now() / 1000) - 20;
      const initial = await accountDeletionService.initiateDeletion(user, currentEpochSeconds);

      // Deletion record should be in PENDING with captured media keys
      const pendingRecord = await accountDeletionRepo.findById(initial.deletionId);
      expect(pendingRecord?.step).toBe('DATA_CLEANED');
      expect((pendingRecord?.mediaCleanupScope as { mediaKeys: string[] })?.mediaKeys).toEqual([
        `posts/${userPost.id}/photo.jpg`,
      ]);

      // Simulate a concurrent cleanup attempt when posts are already deleted
      // The second execution must retain existing mediaKeys from mediaCleanupScope
      await (
        accountDeletionService as unknown as {
          cleanupDatabaseData: (record: AccountDeletion, userHint?: User) => Promise<void>;
        }
      ).cleanupDatabaseData(pendingRecord!);

      const verifiedRecord = await accountDeletionRepo.findById(initial.deletionId);
      expect((verifiedRecord?.mediaCleanupScope as { mediaKeys: string[] })?.mediaKeys).toEqual([
        `posts/${userPost.id}/photo.jpg`,
      ]);
    });

    it('enforces one job per identity and reuses it atomically across concurrent requests', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-concurrent-atomic-1',
          email: 'concurrent-atomic@example.com',
          fullName: 'Concurrent Atomic User',
          homeCityId: cityId,
        })
        .returning();

      const currentEpochSeconds = Math.floor(Date.now() / 1000) - 20;

      // Run two concurrent deletion requests for the same identity
      const [res1, res2] = await Promise.all([
        accountDeletionService.initiateDeletion(user, currentEpochSeconds),
        accountDeletionService.initiateDeletion(user, currentEpochSeconds),
      ]);

      // Both requests must yield the exact same deletionId
      expect(res1.deletionId).toBeDefined();
      expect(res2.deletionId).toBeDefined();
      expect(res1.deletionId).toBe(res2.deletionId);

      // Exactly one deletion row must exist in PostgreSQL
      const deletionRows = await dbHelper.db
        .select()
        .from(accountDeletions)
        .where(eq(accountDeletions.firebaseUserId, user.firebaseUserId));

      expect(deletionRows).toHaveLength(1);
      expect(deletionRows[0].id).toBe(res1.deletionId);
    });

    it('binds persisted upload grace deadline and presigned URL signature to the same timestamp', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-grace-window-1',
          email: 'grace-window@example.com',
          fullName: 'Grace Window User',
          homeCityId: cityId,
        })
        .returning();

      const uploadServiceWithDb = new UploadService(
        mockConfig as unknown as ConfigService,
        mockCacheManager,
        dbHelper.db,
        mediaFinalizationRepo,
      );

      const result = await uploadServiceWithDb.generatePresignedUrl(user.id, 'image/webp', 2048);

      const [updatedUser] = await dbHelper.db
        .select({ uploadGraceUntil: users.uploadGraceUntil })
        .from(users)
        .where(eq(users.id, user.id));

      expect(updatedUser.uploadGraceUntil).toBeDefined();
      expect(result.expiresAt).toEqual(updatedUser.uploadGraceUntil);

      const remainingMs = updatedUser.uploadGraceUntil!.getTime() - Date.now();
      expect(remainingMs).toBeGreaterThan(590_000);
      expect(remainingMs).toBeLessThanOrEqual(600_000);
    });

    it('serializes media finalization with account deletion and rejects after deletion acceptance', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-finalize-serialized-1',
          email: 'finalize-serialized@example.com',
          fullName: 'Finalize Serialized User',
          homeCityId: cityId,
        })
        .returning();

      const uploadServiceWithDb = new UploadService(
        mockConfig as unknown as ConfigService,
        mockCacheManager,
        dbHelper.db,
        mediaFinalizationRepo,
      );

      const ticket = await seedPostMediaTicket(user.id);
      const currentEpochSeconds = Math.floor(Date.now() / 1000) - 20;
      await accountDeletionService.initiateDeletion(user, currentEpochSeconds);

      // Attempt to finalize media for the deleted user
      const mockS3Send = jest.fn().mockResolvedValue({});
      (uploadServiceWithDb as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockS3Send;

      await expect(uploadServiceWithDb.finalizeMedia(ticket.mediaId, user.id, ticket.postId)).rejects.toThrow(
        'ACCOUNT_DELETED',
      );

      // Permanent media copy command must never be dispatched
      const sendCalls = mockS3Send.mock.calls as Array<[{ input?: { CopySource?: string; Key?: string } }]>;
      const copyCall = sendCalls.find((call) => call[0]?.input?.CopySource !== undefined);
      expect(copyCall).toBeUndefined();
    });

    it('does not hold database connections open during stalled storage operations', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-stalled-finalize-1',
          email: 'stalled-finalize@example.com',
          fullName: 'Stalled Finalize User',
          homeCityId: cityId,
        })
        .returning();

      const uploadServiceWithDb = new UploadService(
        mockConfig as unknown as ConfigService,
        mockCacheManager,
        dbHelper.db,
        mediaFinalizationRepo,
      );

      // Simulate a storage provider that accepts the connection and never responds
      // until the test explicitly releases every pending operation.
      let releaseStalledStorage!: () => void;
      const stalledStorageGate = new Promise<void>((resolve) => {
        releaseStalledStorage = resolve;
      });
      const stalledSend = jest.fn().mockImplementation(() => stalledStorageGate.then(() => ({})));
      (uploadServiceWithDb as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = stalledSend;
      (mockCacheManager.get as jest.Mock).mockResolvedValue('image/webp');

      const stalledTickets = await Promise.all(Array.from({ length: 12 }, () => seedPostMediaTicket(user.id)));
      const stalledFinalizations = stalledTickets.map((ticket) =>
        uploadServiceWithDb.finalizeMedia(ticket.mediaId, user.id, ticket.postId),
      );

      // Wait until a full pool's worth of finalizations reached the storage boundary.
      // Under the previous implementation each of them held an open transaction,
      // which is exactly what this regression test must not allow.
      const waitUntilStalledCount = async (minimum: number, timeoutMs: number): Promise<void> => {
        const deadline = Date.now() + timeoutMs;
        while (stalledSend.mock.calls.length < minimum && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      };

      let poolRemainedAvailable = false;
      let poolProbeTimeout: NodeJS.Timeout | undefined;
      try {
        await waitUntilStalledCount(10, 10_000);
        expect(stalledSend.mock.calls.length).toBeGreaterThanOrEqual(10);

        // Unrelated API work must still acquire a database connection: no finalization
        // may hold a transaction open while waiting on storage.
        const unrelatedQuery = Promise.race([
          dbHelper.db.execute(sql`SELECT 1`),
          new Promise((_, reject) => {
            poolProbeTimeout = setTimeout(
              () => reject(new Error('connection pool exhausted by stalled storage operations')),
              2000,
            );
          }),
        ]);
        try {
          await expect(unrelatedQuery).resolves.toBeDefined();
        } finally {
          if (poolProbeTimeout) clearTimeout(poolProbeTimeout);
        }
        poolRemainedAvailable = true;
      } finally {
        releaseStalledStorage();
        await Promise.allSettled(stalledFinalizations);
      }

      expect(poolRemainedAvailable).toBe(true);
    });

    it('defers deletion while a durable finalization obligation is in flight, then completes after it resolves', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-inflight-grace-1',
          email: 'inflight-grace@example.com',
          fullName: 'In-Flight Grace User',
          homeCityId: cityId,
        })
        .returning();

      const uploadServiceWithDb = new UploadService(
        mockConfig as unknown as ConfigService,
        mockCacheManager,
        dbHelper.db,
        mediaFinalizationRepo,
      );

      let releaseStorage!: () => void;
      const storageGate = new Promise<void>((resolve) => {
        releaseStorage = resolve;
      });
      let sendCount = 0;
      const mockS3Send = jest.fn().mockImplementation(() => {
        sendCount++;
        if (sendCount === 1) {
          return storageGate.then(() => ({}));
        }
        return Promise.resolve({});
      });
      (uploadServiceWithDb as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockS3Send;
      (mockCacheManager.get as jest.Mock).mockResolvedValue('image/webp');

      const ticket = await seedPostMediaTicket(user.id);
      const inFlightFinalization = uploadServiceWithDb
        .finalizeMedia(ticket.mediaId, user.id, ticket.postId)
        .catch(() => undefined);

      // Wait for the durable obligation to be recorded before accepting deletion.
      const waitForObligations = async (): Promise<Array<{ status: string; finalKey: string }>> => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const rows = await dbHelper.db
            .select({ status: mediaFinalizations.status, finalKey: mediaFinalizations.finalKey })
            .from(mediaFinalizations)
            .where(eq(mediaFinalizations.userId, user.id));
          if (rows.length > 0) return rows;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return [];
      };
      const obligations = await waitForObligations();
      expect(obligations).toHaveLength(1);
      expect(obligations[0].status).toBe('IN_FLIGHT');
      expect(obligations[0].finalKey).toBe(`posts/${ticket.postId}/${ticket.mediaId}.webp`);

      const currentEpochSeconds = Math.floor(Date.now() / 1000) - 20;
      const result = await accountDeletionService.initiateDeletion(user, currentEpochSeconds);

      // Cleanup is accepted, but storage must wait for the in-flight obligation.
      expect(result.status).toBe('PENDING');
      expect(mockUploadService.deleteObjects).not.toHaveBeenCalled();
      expect(mockUploadService.deletePrefix).not.toHaveBeenCalled();
      const [deferredRecord] = await dbHelper.db
        .select()
        .from(accountDeletions)
        .where(eq(accountDeletions.userId, user.id));
      expect(deferredRecord.nextRetryAt).toBeDefined();
      expect(deferredRecord.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());

      releaseStorage();
      await inFlightFinalization;

      // The finalization must compensate by removing the permanent object it
      // recreated after acceptance banned the creator, then clear its obligation.
      const sendCalls = mockS3Send.mock.calls as Array<[{ input?: { Key?: string } }]>;
      const lastCall = sendCalls[sendCalls.length - 1];
      expect(lastCall?.[0]?.input?.Key).toBe(`posts/${ticket.postId}/${ticket.mediaId}.webp`);
      const remainingObligations = await dbHelper.db
        .select()
        .from(mediaFinalizations)
        .where(eq(mediaFinalizations.userId, user.id));
      expect(remainingObligations).toHaveLength(0);

      // Only now may the retry sweep storage and report completion.
      await accountDeletionService.executeCleanup(deferredRecord);
      const [completedRecord] = await dbHelper.db
        .select()
        .from(accountDeletions)
        .where(eq(accountDeletions.userId, user.id));
      expect(completedRecord.status).toBe('COMPLETED');
      expect(mockUploadService.deletePrefix).toHaveBeenCalledWith(`staging/${user.id}/`);
    });

    it('resolves stale in-flight obligations from a crashed finalizer before sweeping storage', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-stale-obligation-1',
          email: 'stale-obligation@example.com',
          fullName: 'Stale Obligation User',
          homeCityId: cityId,
        })
        .returning();

      const finalKey = 'posts/post-stale-1/media-stale-1.webp';
      const stagingKey = `staging/${user.id}/media-stale-1.webp`;
      const obligation = await mediaFinalizationRepo.create({
        userId: user.id,
        mediaId: 'media-stale-1',
        stagingKey,
        finalKey,
        status: 'IN_FLIGHT',
      });
      await dbHelper.db
        .update(mediaFinalizations)
        .set({ updatedAt: new Date(Date.now() - MEDIA_FINALIZATION_LEASE_MS - 1000) })
        .where(eq(mediaFinalizations.id, obligation.id));

      const currentEpochSeconds = Math.floor(Date.now() / 1000) - 20;
      const result = await accountDeletionService.initiateDeletion(user, currentEpochSeconds);

      expect(result.status).toBe('COMPLETED');
      expect(mockUploadService.deleteObjects).toHaveBeenCalledWith([finalKey]);
      expect(mockUploadService.deleteObjects).toHaveBeenCalledWith([stagingKey]);
      expect(mockUploadService.deletePrefix).toHaveBeenCalledWith(`staging/${user.id}/`);
      const remaining = await dbHelper.db
        .select()
        .from(mediaFinalizations)
        .where(eq(mediaFinalizations.userId, user.id));
      expect(remaining).toHaveLength(0);
    });

    it('keeps a failed compensation obligation retryable and blocks completion until it resolves', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-failed-compensation-1',
          email: 'failed-compensation@example.com',
          fullName: 'Failed Compensation User',
          homeCityId: cityId,
        })
        .returning();

      const finalKey = 'posts/post-comp-1/media-comp-1.webp';
      const obligation = await mediaFinalizationRepo.create({
        userId: user.id,
        mediaId: 'media-comp-1',
        stagingKey: `staging/${user.id}/media-comp-1.webp`,
        finalKey,
        status: 'IN_FLIGHT',
      });
      await mediaFinalizationRepo.markCompensationRequired(obligation.id, 'copy completed during blocked account');

      mockUploadService.deleteObjects.mockRejectedValueOnce(new Error('R2 unavailable'));

      const currentEpochSeconds = Math.floor(Date.now() / 1000) - 20;
      const firstAttempt = await accountDeletionService.initiateDeletion(user, currentEpochSeconds);

      expect(firstAttempt.status).toBe('PENDING');
      expect(mockUploadService.deletePrefix).not.toHaveBeenCalled();
      const [stillPending] = await dbHelper.db
        .select()
        .from(accountDeletions)
        .where(eq(accountDeletions.userId, user.id));
      expect(stillPending.status).toBe('PENDING');
      const [retainedObligation] = await dbHelper.db
        .select()
        .from(mediaFinalizations)
        .where(eq(mediaFinalizations.id, obligation.id));
      expect(retainedObligation).toBeDefined();
      expect(retainedObligation.status).toBe('COMPENSATION_REQUIRED');

      // Retry now that storage recovers: the obligation clears before completion.
      await accountDeletionService.executeCleanup(stillPending);
      const [completed] = await dbHelper.db.select().from(accountDeletions).where(eq(accountDeletions.userId, user.id));
      expect(completed.status).toBe('COMPLETED');
      const remaining = await dbHelper.db
        .select()
        .from(mediaFinalizations)
        .where(eq(mediaFinalizations.id, obligation.id));
      expect(remaining).toHaveLength(0);
    });

    it('reconciles abandoned obligations that no deletion request will resolve', async () => {
      const cityId = await seedCity();
      const [user] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-orphan-obligation-1',
          email: 'orphan-obligation@example.com',
          fullName: 'Orphan Obligation User',
          homeCityId: cityId,
        })
        .returning();

      const compensationFinalKey = 'posts/post-orphan-1/media-orphan-comp.webp';
      const compensation = await mediaFinalizationRepo.create({
        userId: user.id,
        mediaId: 'media-orphan-comp',
        stagingKey: `staging/${user.id}/media-orphan-comp.webp`,
        finalKey: compensationFinalKey,
        status: 'IN_FLIGHT',
      });
      await mediaFinalizationRepo.markCompensationRequired(compensation.id, 'compensation failed during outage');

      const inFlight = await mediaFinalizationRepo.create({
        userId: user.id,
        mediaId: 'media-orphan-flight',
        stagingKey: `staging/${user.id}/media-orphan-flight.webp`,
        finalKey: 'posts/post-orphan-1/media-orphan-flight.webp',
        status: 'IN_FLIGHT',
      });

      const staleAt = new Date(Date.now() - MEDIA_FINALIZATION_ORPHAN_TTL_MS - 1000);
      await dbHelper.db
        .update(mediaFinalizations)
        .set({ updatedAt: staleAt })
        .where(inArray(mediaFinalizations.id, [compensation.id, inFlight.id]));

      await accountDeletionService.reconcileAbandonedMediaFinalizations();

      expect(mockUploadService.deleteObjects).toHaveBeenCalledWith([compensationFinalKey]);
      const remaining = await dbHelper.db
        .select()
        .from(mediaFinalizations)
        .where(inArray(mediaFinalizations.id, [compensation.id, inFlight.id]));
      expect(remaining).toHaveLength(0);
    });

    it('blocks approved-contact lookup immediately from exposing a deleting owner phone even if cleanup failed', async () => {
      const cityId = await seedCity();
      const [owner] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-approved-owner-1',
          email: 'approved-owner@example.com',
          fullName: 'Approved Owner',
          phoneNumber: 'encrypted-phone-val',
          homeCityId: cityId,
        })
        .returning();

      const [requester] = await dbHelper.db
        .insert(users)
        .values({
          firebaseUserId: 'fb-approved-requester-1',
          email: 'approved-requester@example.com',
          fullName: 'Approved Requester',
          phoneNumber: 'encrypted-phone-req',
          homeCityId: cityId,
        })
        .returning();

      const [samplePost] = await dbHelper.db
        .insert(posts)
        .values({
          creatorId: owner.id,
          postType: 'RESCUE',
          title: 'Rescue Post For Contact',
          description: 'Help needed',
          status: 'ACTIVE',
          cityId,
          urgency: 'URGENT',
          coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
        })
        .returning();

      const [contactRequestRecord] = await dbHelper.db
        .insert(contactRequests)
        .values({
          postId: samplePost.id,
          requesterId: requester.id,
          message: 'I can foster this dog',
          status: 'APPROVED',
        })
        .returning();

      // Owner initiates deletion, but DB cleanup fails/defers so records remain in DB
      jest
        .spyOn(accountDeletionService as unknown as { cleanupDatabaseData: () => Promise<void> }, 'cleanupDatabaseData')
        .mockRejectedValueOnce(new Error('Transient DB glitch'));

      const currentEpochSeconds = Math.floor(Date.now() / 1000) - 20;
      await accountDeletionService.initiateDeletion(owner, currentEpochSeconds);

      // Verify the post is in REMOVED status and owner is banned
      const [removedPost] = await dbHelper.db.select().from(posts).where(eq(posts.id, samplePost.id));
      expect(removedPost?.status).toBe('REMOVED');

      const [bannedOwner] = await dbHelper.db.select().from(users).where(eq(users.id, owner.id));
      expect(bannedOwner?.isBanned).toBe(true);

      // Calling getWhatsAppLink must throw NotFoundError and NEVER return the phone link
      const contactsService = new ContactsService(
        new ContactsRepository(dbHelper.db),
        new PostsRepository(dbHelper.db),
        usersService,
        { fireNotification: jest.fn() } as unknown as NotificationsService,
        dbHelper.db,
        new AccountIsolationPolicy(dbHelper.db),
      );

      await expect(contactsService.getWhatsAppLink(requester.id, contactRequestRecord.id)).rejects.toThrow(
        NotFoundError,
      );
    });
  });
});

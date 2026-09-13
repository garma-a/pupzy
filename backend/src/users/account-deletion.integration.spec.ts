import { sql, eq, inArray } from 'drizzle-orm';
import * as crypto from 'crypto';
import { TestDatabaseHelper } from '../../test/test-database.helper';

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));

import {
  users,
  posts,
  postMedia,
  postUpvotes,
  postSaves,
  postReports,
  notifications,
  savedSearches,
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
} from '../database/schema';
import { AccountDeletionService } from './account-deletion.service';
import { AccountDeletionRepository } from './account-deletion.repository';
import { AccountDeletionCron } from './account-deletion.cron';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { UploadService } from '../upload/upload.service';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { ForbiddenError, NotFoundError, ValidationError } from '../common/errors/app.errors';
import type { Cache } from 'cache-manager';
import type { App } from 'firebase-admin/app';

describe('Account Deletion Feature Integration', () => {
  let dbHelper: TestDatabaseHelper;
  let accountDeletionRepo: AccountDeletionRepository;
  let usersRepo: UsersRepository;
  let usersService: UsersService;
  let accountDeletionService: AccountDeletionService;
  let accountDeletionCron: AccountDeletionCron;
  let mockUploadService: jest.Mocked<UploadService>;
  let mockCacheManager: jest.Mocked<Cache>;
  let mockFirebaseApp: App;
  let mockDeleteUser: jest.Mock;
  let mockConfig: { get: jest.Mock };

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();
  }, 120_000);

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();
    jest.clearAllMocks();

    accountDeletionRepo = new AccountDeletionRepository(dbHelper.db);
    usersRepo = new UsersRepository(dbHelper.db);

    mockUploadService = {
      deleteObjects: jest.fn().mockResolvedValue(undefined),
      deletePrefix: jest.fn().mockResolvedValue(1),
      getLastUploadGraceUntil: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<UploadService>;

    const cacheStore = new Map<string, unknown>();
    mockCacheManager = {
      get: jest.fn().mockImplementation((key) => Promise.resolve(cacheStore.get(key))),
      set: jest.fn().mockImplementation((key, val) => {
        cacheStore.set(key, val);
        return Promise.resolve();
      }),
      del: jest.fn().mockImplementation((key) => {
        cacheStore.delete(key);
        return Promise.resolve();
      }),
    } as unknown as jest.Mocked<Cache>;

    mockDeleteUser = jest.fn().mockResolvedValue(undefined);
    mockFirebaseApp = {} as unknown as App;
    // Mock getAuth implementation
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const authModule = require('firebase-admin/auth');
    jest.spyOn(authModule, 'getAuth').mockReturnValue({
      deleteUser: mockDeleteUser,
    });

    mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'ACCOUNT_DELETION_ENABLED') return true;
        if (key === 'PHONE_ENCRYPTION_KEY') return 'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=';
        return undefined;
      }),
    };

    const mockCitiesService = {} as any;
    usersService = new UsersService(
      usersRepo,
      mockCitiesService,
      accountDeletionRepo,
      mockConfig as any,
      mockCacheManager,
    );

    accountDeletionService = new AccountDeletionService(
      accountDeletionRepo,
      usersRepo,
      mockUploadService,
      mockConfig as any,
      mockFirebaseApp,
      dbHelper.db,
      mockCacheManager,
    );

    accountDeletionCron = new AccountDeletionCron(accountDeletionRepo, accountDeletionService);
  });

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

      const nowSec = Math.floor(Date.now() / 1000);

      // 1. Missing authTime
      await expect(accountDeletionService.initiateDeletion(user, undefined)).rejects.toThrow(
        new ForbiddenError('RECENT_AUTHENTICATION_REQUIRED'),
      );

      // 2. Stale authTime (301 seconds ago)
      await expect(accountDeletionService.initiateDeletion(user, nowSec - 301)).rejects.toThrow(
        new ForbiddenError('RECENT_AUTHENTICATION_REQUIRED'),
      );

      // 3. Future authTime (>30s tolerance)
      await expect(accountDeletionService.initiateDeletion(user, nowSec + 120)).rejects.toThrow(
        new ForbiddenError('INVALID_AUTHENTICATION_TIME'),
      );

      // 4. Valid authTime (290 seconds ago = 4m 50s) succeeds
      const result = await accountDeletionService.initiateDeletion(user, nowSec - 290);
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
          reportCount: 1,
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
        .where(
          inArray(posts.id, [
            rescuePost.id,
            lostPost.id,
            adoptionPost.id,
            productPost.id,
            matingPost.id,
          ]),
        );
      expect(remainingPosts).toHaveLength(0);

      // Verify extension rows are gone
      const remainingRescue = await dbHelper.db.select().from(rescuePosts).where(eq(rescuePosts.postId, rescuePost.id));
      expect(remainingRescue).toHaveLength(0);

      // 8. Verify other user's surviving post engagement is reconciled
      const [updatedSurviving] = await dbHelper.db.select().from(posts).where(eq(posts.id, survivingPost.id));
      expect(updatedSurviving.upvoteCount).toBe(4); // 5 - 1
      expect(updatedSurviving.saveCount).toBe(2); // 3 - 1
      expect(updatedSurviving.reportCount).toBe(0); // 1 - 1
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
  });
});

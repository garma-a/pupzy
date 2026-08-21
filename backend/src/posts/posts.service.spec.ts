import { PostsService } from './posts.service';
import { PostsRepository } from './posts.repository';
import { CitiesService } from '../cities/cities.service';
import { UploadService } from '../upload/upload.service';
import { ViewFlushCron } from './view-flush.cron';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Cache } from 'cache-manager';
import type { Post } from '../database/schema';

describe('PostsService', () => {
  let service: PostsService;
  let mockPostsRepo: jest.Mocked<Partial<PostsRepository>>;
  let mockCitiesService: jest.Mocked<Partial<CitiesService>>;
  let mockUploadService: jest.Mocked<Partial<UploadService>>;
  let mockViewFlushCron: jest.Mocked<Partial<ViewFlushCron>>;
  let mockUsersService: jest.Mocked<Partial<UsersService>>;
  let mockNotificationsService: jest.Mocked<Partial<NotificationsService>>;
  let mockCacheManager: jest.Mocked<Partial<Cache>>;

  const mockCity = {
    id: 'a0000000-0000-0000-0000-000000000001',
    nameEnglish: 'Cairo',
    nameArabic: 'القاهرة',
    governorate: 'Cairo',
    centerPoint: [31.2357, 30.0444] as [number, number],
    radiusKm: 30,
  };

  beforeEach(() => {
    mockPostsRepo = {
      createRescuePost: jest.fn(),
      createLostPost: jest.fn(),
      createAdoptionPost: jest.fn(),
      createProductPost: jest.fn(),
      findPostsSavedByCurrentUser: jest.fn(),
      findPostsCreatedByCurrentUser: jest.fn(),
      findHelpFeed: jest.fn(),
      findById: jest.fn(),
    };

    mockCitiesService = {
      findById: jest.fn().mockResolvedValue(mockCity),
      findNearest: jest.fn().mockResolvedValue(mockCity),
    };

    mockUploadService = {
      getExpectedMediaUrls: jest.fn().mockResolvedValue({ publicUrl: '', fileContentType: '' }),
      finalizeMedia: jest.fn().mockResolvedValue(undefined),
    };

    mockViewFlushCron = {
      bufferView: jest.fn(),
    };

    mockUsersService = {
      invalidateUserCacheById: jest.fn().mockResolvedValue(undefined),
    };

    mockNotificationsService = {
      fireNotification: jest.fn().mockResolvedValue(undefined),
    };

    mockCacheManager = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };

    service = new PostsService(
      mockPostsRepo as PostsRepository,
      mockCitiesService as CitiesService,
      mockUploadService as UploadService,
      mockViewFlushCron as ViewFlushCron,
      mockUsersService as UsersService,
      mockNotificationsService as NotificationsService,
      mockCacheManager as Cache,
    );
  });

  describe('createRescuePost', () => {
    it('computes urgency CRITICAL when isLifeThreatening is true and creates post', async () => {
      const mockCreatedPost = {
        id: 'post-1',
        creatorId: 'user-1',
        postType: 'RESCUE',
        urgency: 'CRITICAL',
        status: 'ACTIVE',
      } as unknown as Post;
      mockPostsRepo.createRescuePost = jest.fn().mockResolvedValue(mockCreatedPost);

      const result = await service.createRescuePost('user-1', {
        title: 'Emergency: Kitten hit by car',
        description: 'Needs urgent surgery and vet care right now.',
        coordinates: { latitude: 30.0444, longitude: 31.2357 },
        species: 'CAT',
        conditionSummary: 'Severe bleeding and unconscious',
        reporterRole: 'ON_SITE',
        isLifeThreatening: true,
        hasVisibleSeriousInjury: true,
        isInDangerousLocation: true,
        canAnimalMoveOrEscape: false,
      });

      expect(result).toBe(mockCreatedPost);
      expect(mockPostsRepo.createRescuePost).toHaveBeenCalledWith(
        expect.objectContaining({
          urgency: 'CRITICAL',
          postType: 'RESCUE',
        }),
        expect.objectContaining({
          isLifeThreatening: true,
          hasVisibleSeriousInjury: true,
        }),
        expect.any(Array),
      );
    });
  });

  describe('createLostPost', () => {
    it('computes urgency for LOST_PET from medical/hazard signals', async () => {
      const mockCreatedPost = {
        id: 'post-2',
        creatorId: 'user-1',
        postType: 'LOST',
        urgency: 'CRITICAL',
        status: 'ACTIVE',
      } as unknown as Post;
      mockPostsRepo.createLostPost = jest.fn().mockResolvedValue(mockCreatedPost);

      const result = await service.createLostPost('user-1', {
        title: 'Lost diabetic dog',
        description: 'Needs daily insulin injections urgently.',
        coordinates: { latitude: 30.0444, longitude: 31.2357 },
        reportType: 'LOST_PET',
        species: 'DOG',
        petName: 'Rocky',
        dateLastSeen: '2026-08-01',
        hasMedicalNeeds: true,
        isElderlyOrVeryYoung: false,
        lastSeenNearHazard: true,
      });

      expect(result).toBe(mockCreatedPost);
      expect(mockPostsRepo.createLostPost).toHaveBeenCalledWith(
        expect.objectContaining({
          urgency: 'CRITICAL',
          postType: 'LOST',
        }),
        expect.objectContaining({
          hasMedicalNeeds: true,
          lastSeenNearHazard: true,
        }),
        expect.any(Array),
      );
    });

    it('computes urgency for FOUND_STRAY from condition and safety signals', async () => {
      const mockCreatedPost = {
        id: 'post-3',
        creatorId: 'user-1',
        postType: 'LOST',
        urgency: 'URGENT',
        status: 'ACTIVE',
      } as unknown as Post;
      mockPostsRepo.createLostPost = jest.fn().mockResolvedValue(mockCreatedPost);

      const result = await service.createLostPost('user-1', {
        title: 'Found stray dog wandering',
        description: 'Healthy dog wandering near the park.',
        coordinates: { latitude: 30.0444, longitude: 31.2357 },
        reportType: 'FOUND_STRAY',
        species: 'DOG',
        currentCondition: 'HEALTHY',
        isCurrentlySafeWithReporter: false,
        dateFound: '2026-08-02',
      });

      expect(result).toBe(mockCreatedPost);
      expect(mockPostsRepo.createLostPost).toHaveBeenCalledWith(
        expect.objectContaining({
          urgency: 'URGENT', // HEALTHY (0) + not safe (3) = 3 -> URGENT
          postType: 'LOST',
        }),
        expect.objectContaining({
          currentCondition: 'HEALTHY',
          isCurrentlySafeWithReporter: false,
        }),
        expect.any(Array),
      );
    });
  });

  describe('getPostsSavedByCurrentUser', () => {
    it('calls repository with capped limit and mapped connection', async () => {
      const savedDate = new Date('2026-08-10T15:00:00Z');
      const mockPost = {
        id: 'post-save-1',
        createdAt: new Date('2026-08-01T12:00:00Z'),
        title: 'Saved Post',
      } as unknown as Post;
      mockPostsRepo.findPostsSavedByCurrentUser = jest.fn().mockResolvedValue({
        rows: [{ post: mockPost, distanceKm: null, savedAt: savedDate }],
        hasNextPage: false,
      });

      const result = await service.getPostsSavedByCurrentUser('user-1', { first: 20 });
      expect(mockPostsRepo.findPostsSavedByCurrentUser).toHaveBeenCalledWith({
        userId: 'user-1',
        limit: 20,
        cursor: null,
      });
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].node).toBe(mockPost);
      expect(result.pageInfo.hasNextPage).toBe(false);

      // Verify cursor uses savedAt (save timestamp), NOT post.createdAt
      const cursor = JSON.parse(Buffer.from(result.edges[0].cursor, 'base64url').toString('utf8')) as {
        savedAt: string;
        postId: string;
      };
      expect(cursor.savedAt).toBe(savedDate.toISOString());
      expect(cursor.postId).toBe('post-save-1');
    });
  });

  describe('getPostsCreatedByCurrentUser', () => {
    it('calls repository with postType filter and mapped connection', async () => {
      const mockPost = {
        id: 'post-create-1',
        createdAt: new Date('2026-08-01T12:00:00Z'),
        title: 'My Rescue Post',
        postType: 'RESCUE',
      } as unknown as Post;
      mockPostsRepo.findPostsCreatedByCurrentUser = jest.fn().mockResolvedValue({
        rows: [{ post: mockPost, distanceKm: null }],
        hasNextPage: false,
      });

      const result = await service.getPostsCreatedByCurrentUser('user-1', {
        postType: 'RESCUE',
        first: 10,
      });
      expect(mockPostsRepo.findPostsCreatedByCurrentUser).toHaveBeenCalledWith({
        creatorId: 'user-1',
        postType: 'RESCUE',
        limit: 10,
        cursor: null,
      });
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].node).toBe(mockPost);
    });
  });
});

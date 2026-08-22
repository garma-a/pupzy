import { PostsService } from './posts.service';
import { PostsRepository } from './posts.repository';
import { CitiesService } from '../cities/cities.service';
import { UploadService } from '../upload/upload.service';
import { ViewFlushCron } from './view-flush.cron';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Cache } from 'cache-manager';
import { ValidationError, NotFoundError, ForbiddenError } from '../common/errors/app.errors';
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
    id: '01916327-0000-7000-8000-000000000001',
    nameEnglish: 'Cairo',
    nameArabic: 'القاهرة',
    governorate: 'Cairo',
    centerPoint: [31.2357, 30.0444] as [number, number],
  };

  const validPostId = '01916327-0000-7000-8000-000000000002';
  const validUserId = '01916327-0000-7000-8000-000000000003';
  const otherUserId = '01916327-0000-7000-8000-000000000004';

  beforeEach(() => {
    mockPostsRepo = {
      createRescuePost: jest.fn(),
      createLostPost: jest.fn(),
      createAdoptionPost: jest.fn(),
      createProductPost: jest.fn(),
      findPostsSavedByCurrentUser: jest.fn(),
      findPostsCreatedByCurrentUser: jest.fn(),
      findHelpFeed: jest.fn(),
      findAdoptFeed: jest.fn(),
      findMarketFeed: jest.fn(),
      findHomeFeed: jest.fn(),
      findById: jest.fn(),
      findRescueDetail: jest.fn(),
      findLostDetail: jest.fn(),
      findAdoptionDetail: jest.fn(),
      findProductDetail: jest.fn(),
      updateStatus: jest.fn(),
      softDelete: jest.fn(),
      toggleUpvote: jest.fn(),
      toggleSave: jest.fn(),
    };

    mockCitiesService = {
      findById: jest.fn().mockResolvedValue(mockCity),
      findNearest: jest.fn().mockResolvedValue(mockCity),
    };

    mockUploadService = {
      getExpectedMediaUrls: jest
        .fn()
        .mockResolvedValue({ publicUrl: 'https://cdn.example.com/1.jpg', fileContentType: 'image/jpeg' }),
      finalizeMedia: jest.fn().mockResolvedValue(undefined),
    };

    mockViewFlushCron = {
      bufferView: jest.fn(),
    };

    mockUsersService = {
      findById: jest.fn().mockResolvedValue({ id: validUserId, fullName: 'Test User', phoneNumber: '+201000000000' }),
      invalidateUserCacheById: jest.fn().mockResolvedValue(undefined),
    };

    mockNotificationsService = {
      fireNotification: jest.fn(),
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
    it('computes urgency CRITICAL and creates rescue post with explicit cityId and mediaIds', async () => {
      const mockCreatedPost = {
        id: validPostId,
        creatorId: validUserId,
        postType: 'RESCUE',
        urgency: 'CRITICAL',
        status: 'ACTIVE',
      } as unknown as Post;
      mockPostsRepo.createRescuePost = jest.fn().mockResolvedValue(mockCreatedPost);

      const result = await service.createRescuePost(validUserId, {
        title: 'Emergency: Kitten hit by car',
        description: 'Needs urgent surgery and vet care right now.',
        cityId: mockCity.id,
        coordinates: { latitude: 30.0444, longitude: 31.2357 },
        species: 'CAT',
        conditionSummary: 'Severe bleeding and unconscious',
        reporterRole: 'ON_SITE',
        isLifeThreatening: true,
        hasVisibleSeriousInjury: true,
        isInDangerousLocation: true,
        canAnimalMoveOrEscape: false,
        mediaIds: ['01916327-0000-7000-8000-000000000005'],
      });

      expect(result).toBe(mockCreatedPost);
      expect(mockCitiesService.findById).toHaveBeenCalledWith(mockCity.id);
      expect(mockUploadService.getExpectedMediaUrls).toHaveBeenCalled();
      expect(mockPostsRepo.createRescuePost).toHaveBeenCalled();
    });

    it('throws ValidationError when cityId is unknown', async () => {
      mockCitiesService.findById = jest.fn().mockResolvedValue(undefined);

      await expect(
        service.createRescuePost(validUserId, {
          title: 'Emergency: Kitten hit by car',
          description: 'Needs urgent surgery.',
          cityId: '01916327-0000-7000-8000-000000000999',
          coordinates: { latitude: 30.0444, longitude: 31.2357 },
          species: 'CAT',
          conditionSummary: 'Severe bleeding',
          reporterRole: 'ON_SITE',
          isLifeThreatening: true,
          hasVisibleSeriousInjury: true,
          isInDangerousLocation: true,
          canAnimalMoveOrEscape: false,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws NotFoundError when auto-resolving GPS coordinates finds no nearby city', async () => {
      mockCitiesService.findNearest = jest.fn().mockResolvedValue(undefined);

      await expect(
        service.createRescuePost(validUserId, {
          title: 'Emergency: Kitten hit by car',
          description: 'Needs urgent surgery.',
          coordinates: { latitude: 0, longitude: 0 },
          species: 'CAT',
          conditionSummary: 'Severe bleeding',
          reporterRole: 'ON_SITE',
          isLifeThreatening: true,
          hasVisibleSeriousInjury: true,
          isInDangerousLocation: true,
          canAnimalMoveOrEscape: false,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('flags post for moderation if title or description matches blocklist', async () => {
      const mockCreatedPost = { id: validPostId } as unknown as Post;
      mockPostsRepo.createRescuePost = jest.fn().mockResolvedValue(mockCreatedPost);

      await service.createRescuePost(validUserId, {
        title: 'iPhone 15 for sale with kitten',
        description: 'Clean animal.',
        coordinates: { latitude: 30.0444, longitude: 31.2357 },
        species: 'CAT',
        conditionSummary: 'Good condition',
        reporterRole: 'ON_SITE',
        isLifeThreatening: false,
        hasVisibleSeriousInjury: false,
        isInDangerousLocation: false,
        canAnimalMoveOrEscape: true,
      });

      expect(mockPostsRepo.createRescuePost).toHaveBeenCalledWith(
        expect.objectContaining({ moderationStatus: 'FLAGGED' }),
        expect.any(Object),
        expect.any(Array),
      );
    });

    it('throws ValidationError if mediaIds exceeds 4', async () => {
      await expect(
        service.createRescuePost(validUserId, {
          title: 'Emergency kitten',
          description: 'Needs urgent surgery.',
          coordinates: { latitude: 30.0444, longitude: 31.2357 },
          species: 'CAT',
          conditionSummary: 'Bleeding',
          reporterRole: 'ON_SITE',
          isLifeThreatening: true,
          hasVisibleSeriousInjury: true,
          isInDangerousLocation: true,
          canAnimalMoveOrEscape: false,
          mediaIds: [
            '01916327-0000-7000-8000-000000000001',
            '01916327-0000-7000-8000-000000000002',
            '01916327-0000-7000-8000-000000000003',
            '01916327-0000-7000-8000-000000000004',
            '01916327-0000-7000-8000-000000000005',
          ],
        }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('createLostPost', () => {
    it('computes urgency for LOST_PET from medical/hazard signals', async () => {
      const mockCreatedPost = { id: validPostId, postType: 'LOST', urgency: 'CRITICAL' } as unknown as Post;
      mockPostsRepo.createLostPost = jest.fn().mockResolvedValue(mockCreatedPost);

      const result = await service.createLostPost(validUserId, {
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
        expect.objectContaining({ urgency: 'CRITICAL', postType: 'LOST' }),
        expect.objectContaining({ reportType: 'LOST_PET', petName: 'Rocky' }),
        expect.any(Array),
      );
    });

    it('computes urgency for FOUND_STRAY from condition and safety signals', async () => {
      const mockCreatedPost = { id: validPostId, postType: 'LOST', urgency: 'URGENT' } as unknown as Post;
      mockPostsRepo.createLostPost = jest.fn().mockResolvedValue(mockCreatedPost);

      const result = await service.createLostPost(validUserId, {
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
        expect.objectContaining({ urgency: 'URGENT', postType: 'LOST' }),
        expect.objectContaining({ reportType: 'FOUND_STRAY', currentCondition: 'HEALTHY' }),
        expect.any(Array),
      );
    });
  });

  describe('createAdoptionPost', () => {
    it('creates an adoption post with undefined urgency', async () => {
      const mockCreatedPost = { id: validPostId, postType: 'ADOPTION', status: 'ACTIVE' } as unknown as Post;
      mockPostsRepo.createAdoptionPost = jest.fn().mockResolvedValue(mockCreatedPost);

      const result = await service.createAdoptionPost(validUserId, {
        title: 'Golden Retriever for adoption',
        description: 'Very friendly and well-trained puppy looking for a loving home.',
        coordinates: { latitude: 30.0444, longitude: 31.2357 },
        petName: 'Max',
        species: 'DOG',
        gender: 'MALE',
        vaccinated: true,
        neutered: true,
        personalityTags: ['GOOD_WITH_KIDS', 'HOUSE_TRAINED'],
        priorPetExperienceRequired: false,
      });

      expect(result).toBe(mockCreatedPost);
      expect(mockPostsRepo.createAdoptionPost).toHaveBeenCalledWith(
        expect.objectContaining({ postType: 'ADOPTION', urgency: undefined }),
        expect.objectContaining({ petName: 'Max', vaccinated: true }),
        expect.any(Array),
      );
    });
  });

  describe('createProductPost', () => {
    it('creates a paid product post with priceAmount', async () => {
      const mockCreatedPost = { id: validPostId, postType: 'PRODUCT', status: 'ACTIVE' } as unknown as Post;
      mockPostsRepo.createProductPost = jest.fn().mockResolvedValue(mockCreatedPost);

      const result = await service.createProductPost(validUserId, {
        title: 'Dog Crate Large',
        description: 'Barely used heavy duty metal dog crate.',
        coordinates: { latitude: 30.0444, longitude: 31.2357 },
        category: 'CARE',
        condition: 'LIKE_NEW',
        isFree: false,
        priceAmount: 500,
        priceCurrency: 'EGP',
        openToOffers: false,
      });

      expect(result).toBe(mockCreatedPost);
      expect(mockPostsRepo.createProductPost).toHaveBeenCalledWith(
        expect.objectContaining({ postType: 'PRODUCT', marketCategory: 'CARE', urgency: undefined }),
        expect.objectContaining({ isFree: false, priceAmount: '500' }),
        expect.any(Array),
      );
    });

    it('creates a free product post without priceAmount', async () => {
      const mockCreatedPost = { id: validPostId, postType: 'PRODUCT', status: 'ACTIVE' } as unknown as Post;
      mockPostsRepo.createProductPost = jest.fn().mockResolvedValue(mockCreatedPost);

      const result = await service.createProductPost(validUserId, {
        title: 'Free Cat Food Samples',
        description: 'Giving away extra cat food cans.',
        coordinates: { latitude: 30.0444, longitude: 31.2357 },
        category: 'FOOD',
        condition: 'NEW',
        isFree: true,
        priceCurrency: 'EGP',
        openToOffers: false,
      });

      expect(result).toBe(mockCreatedPost);
      expect(mockPostsRepo.createProductPost).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ isFree: true, priceAmount: undefined }),
        expect.any(Array),
      );
    });
  });

  describe('getPost & Details', () => {
    it('returns post if active', async () => {
      const mockPost = { id: validPostId, status: 'ACTIVE' } as unknown as Post;
      mockPostsRepo.findById = jest.fn().mockResolvedValue(mockPost);

      const result = await service.getPost(validPostId);
      expect(result).toBe(mockPost);
    });

    it('returns null if post not found or REMOVED', async () => {
      mockPostsRepo.findById = jest.fn().mockResolvedValue(null);
      expect(await service.getPost(validPostId)).toBeNull();

      mockPostsRepo.findById = jest.fn().mockResolvedValue({ id: validPostId, status: 'REMOVED' });
      expect(await service.getPost(validPostId)).toBeNull();
    });

    it('fetches rescue, lost, adoption, and product details or throws NotFoundError', async () => {
      mockPostsRepo.findRescueDetail = jest.fn().mockResolvedValue({ postId: validPostId });
      expect(await service.getRescueDetail(validPostId)).toEqual({ postId: validPostId });

      mockPostsRepo.findRescueDetail = jest.fn().mockResolvedValue(null);
      await expect(service.getRescueDetail(validPostId)).rejects.toThrow(NotFoundError);

      mockPostsRepo.findLostDetail = jest.fn().mockResolvedValue({ postId: validPostId });
      expect(await service.getLostDetail(validPostId)).toEqual({ postId: validPostId });

      mockPostsRepo.findLostDetail = jest.fn().mockResolvedValue(null);
      await expect(service.getLostDetail(validPostId)).rejects.toThrow(NotFoundError);

      mockPostsRepo.findAdoptionDetail = jest.fn().mockResolvedValue({ postId: validPostId });
      expect(await service.getAdoptionDetail(validPostId)).toEqual({ postId: validPostId });

      mockPostsRepo.findAdoptionDetail = jest.fn().mockResolvedValue(null);
      await expect(service.getAdoptionDetail(validPostId)).rejects.toThrow(NotFoundError);

      mockPostsRepo.findProductDetail = jest.fn().mockResolvedValue({ postId: validPostId });
      expect(await service.getProductDetail(validPostId)).toEqual({ postId: validPostId });

      mockPostsRepo.findProductDetail = jest.fn().mockResolvedValue(null);
      await expect(service.getProductDetail(validPostId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('deletePost', () => {
    it('soft-deletes post when caller is owner', async () => {
      const mockPost = { id: validPostId, creatorId: validUserId, status: 'ACTIVE' } as unknown as Post;
      mockPostsRepo.findById = jest.fn().mockResolvedValue(mockPost);
      mockPostsRepo.softDelete = jest.fn().mockResolvedValue({ ...mockPost, status: 'REMOVED' });

      await service.deletePost(validPostId, validUserId);
      expect(mockPostsRepo.softDelete).toHaveBeenCalledWith(validPostId);
      expect(mockUsersService.invalidateUserCacheById).toHaveBeenCalledWith(validUserId);
    });

    it('throws NotFoundError if post does not exist or is already REMOVED', async () => {
      mockPostsRepo.findById = jest.fn().mockResolvedValue(null);
      await expect(service.deletePost(validPostId, validUserId)).rejects.toThrow(NotFoundError);

      mockPostsRepo.findById = jest.fn().mockResolvedValue({ id: validPostId, status: 'REMOVED' });
      await expect(service.deletePost(validPostId, validUserId)).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError if caller is not the creator', async () => {
      const mockPost = { id: validPostId, creatorId: otherUserId, status: 'ACTIVE' } as unknown as Post;
      mockPostsRepo.findById = jest.fn().mockResolvedValue(mockPost);

      await expect(service.deletePost(validPostId, validUserId)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('updatePostStatus', () => {
    it('updates post status for valid transitions', async () => {
      const mockPost = {
        id: validPostId,
        creatorId: validUserId,
        postType: 'RESCUE',
        status: 'ACTIVE',
      } as unknown as Post;
      mockPostsRepo.findById = jest.fn().mockResolvedValue(mockPost);
      mockPostsRepo.updateStatus = jest.fn().mockResolvedValue({ ...mockPost, status: 'RESOLVED' });

      const result = await service.updatePostStatus(validPostId, validUserId, 'RESOLVED');
      expect(result.status).toBe('RESOLVED');
      expect(mockPostsRepo.updateStatus).toHaveBeenCalledWith(validPostId, 'RESOLVED');
    });

    it('throws ForbiddenError if caller is not owner', async () => {
      mockPostsRepo.findById = jest
        .fn()
        .mockResolvedValue({ id: validPostId, creatorId: otherUserId, status: 'ACTIVE' });
      await expect(service.updatePostStatus(validPostId, validUserId, 'RESOLVED')).rejects.toThrow(ForbiddenError);
    });

    it('throws ValidationError if post is already not ACTIVE', async () => {
      mockPostsRepo.findById = jest
        .fn()
        .mockResolvedValue({ id: validPostId, creatorId: validUserId, status: 'RESOLVED', postType: 'RESCUE' });
      await expect(service.updatePostStatus(validPostId, validUserId, 'RESOLVED')).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError on invalid transition for post type', async () => {
      mockPostsRepo.findById = jest
        .fn()
        .mockResolvedValue({ id: validPostId, creatorId: validUserId, status: 'ACTIVE', postType: 'RESCUE' });
      await expect(service.updatePostStatus(validPostId, validUserId, 'SOLD')).rejects.toThrow(ValidationError);
    });
  });

  describe('toggleUpvote', () => {
    it('toggles upvote and fires notification when added by non-owner', async () => {
      const mockPost = {
        id: validPostId,
        creatorId: otherUserId,
        postType: 'ADOPTION',
        status: 'ACTIVE',
        title: 'Puppy',
      } as unknown as Post;
      mockPostsRepo.findById = jest.fn().mockResolvedValue(mockPost);
      mockPostsRepo.toggleUpvote = jest.fn().mockResolvedValue({ added: true, updatedPost: mockPost });

      const result = await service.toggleUpvote(validPostId, validUserId);
      expect(result).toBe(mockPost);
      expect(mockNotificationsService.fireNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: otherUserId,
          type: 'NEW_UPVOTE',
        }),
        validUserId,
      );
    });

    it('throws ForbiddenError when upvoting own post', async () => {
      const mockPost = {
        id: validPostId,
        creatorId: validUserId,
        postType: 'ADOPTION',
        status: 'ACTIVE',
      } as unknown as Post;
      mockPostsRepo.findById = jest.fn().mockResolvedValue(mockPost);

      await expect(service.toggleUpvote(validPostId, validUserId)).rejects.toThrow(ForbiddenError);
    });

    it('throws ValidationError when upvoting a PRODUCT post', async () => {
      const mockPost = {
        id: validPostId,
        creatorId: otherUserId,
        postType: 'PRODUCT',
        status: 'ACTIVE',
      } as unknown as Post;
      mockPostsRepo.findById = jest.fn().mockResolvedValue(mockPost);

      await expect(service.toggleUpvote(validPostId, validUserId)).rejects.toThrow(ValidationError);
    });
  });

  describe('toggleSave', () => {
    it('toggles save and fires notification when saved by another user', async () => {
      const mockPost = {
        id: validPostId,
        creatorId: otherUserId,
        postType: 'PRODUCT',
        status: 'ACTIVE',
        title: 'Crate',
      } as unknown as Post;
      mockPostsRepo.findById = jest.fn().mockResolvedValue(mockPost);
      mockPostsRepo.toggleSave = jest.fn().mockResolvedValue({ added: true, updatedPost: mockPost });

      const result = await service.toggleSave(validPostId, validUserId);
      expect(result).toBe(mockPost);
      expect(mockNotificationsService.fireNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: otherUserId,
          type: 'POST_SAVED',
        }),
        validUserId,
      );
    });

    it('does not fire notification when saving own post', async () => {
      const mockPost = {
        id: validPostId,
        creatorId: validUserId,
        postType: 'ADOPTION',
        status: 'ACTIVE',
        title: 'Puppy',
      } as unknown as Post;
      mockPostsRepo.findById = jest.fn().mockResolvedValue(mockPost);
      mockPostsRepo.toggleSave = jest.fn().mockResolvedValue({ added: true, updatedPost: mockPost });

      await service.toggleSave(validPostId, validUserId);
      expect(mockNotificationsService.fireNotification).not.toHaveBeenCalled();
    });
  });

  describe('Feed queries', () => {
    it('getHelpFeed parses cursor and calls repository', async () => {
      const mockPost = { id: validPostId, urgency: 'CRITICAL', createdAt: new Date() } as unknown as Post;
      mockPostsRepo.findHelpFeed = jest.fn().mockResolvedValue({
        rows: [{ post: mockPost, distanceKm: 2.5 }],
        hasNextPage: false,
      });

      const result = await service.getHelpFeed({ governorate: 'Cairo' });
      expect(mockPostsRepo.findHelpFeed).toHaveBeenCalled();
      expect(result.edges).toHaveLength(1);
    });

    it('getAdoptFeed supports HOT and NEWEST sort', async () => {
      const mockPost = { id: validPostId, effectiveScore: 10, createdAt: new Date() } as unknown as Post;
      mockPostsRepo.findAdoptFeed = jest.fn().mockResolvedValue({
        rows: [{ post: mockPost, distanceKm: 1.2 }],
        hasNextPage: false,
      });

      const hotResult = await service.getAdoptFeed({ sort: 'HOT' });
      expect(hotResult.edges).toHaveLength(1);

      const newestResult = await service.getAdoptFeed({ sort: 'NEWEST' });
      expect(newestResult.edges).toHaveLength(1);
    });

    it('getMarketFeed supports category and sort', async () => {
      const mockPost = { id: validPostId, effectiveScore: 5, createdAt: new Date() } as unknown as Post;
      mockPostsRepo.findMarketFeed = jest.fn().mockResolvedValue({
        rows: [{ post: mockPost, distanceKm: null }],
        hasNextPage: false,
      });

      const result = await service.getMarketFeed({ category: 'FOOD', sort: 'HOT' });
      expect(result.edges).toHaveLength(1);
    });

    it('getHomeFeed returns newest posts', async () => {
      const mockPost = { id: validPostId, createdAt: new Date() } as unknown as Post;
      mockPostsRepo.findHomeFeed = jest.fn().mockResolvedValue({
        rows: [{ post: mockPost, distanceKm: null }],
        hasNextPage: false,
      });

      const result = await service.getHomeFeed({});
      expect(result.edges).toHaveLength(1);
    });

    it('getHomeFeed includes MATING posts in results without errors', async () => {
      const matingPost = {
        id: validPostId,
        postType: 'MATING',
        status: 'ACTIVE',
        createdAt: new Date(),
      } as unknown as Post;
      mockPostsRepo.findHomeFeed = jest.fn().mockResolvedValue({
        rows: [{ post: matingPost, distanceKm: null }],
        hasNextPage: false,
      });

      const result = await service.getHomeFeed({});
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].node.postType).toBe('MATING');
    });

    it('getPostsSavedByCurrentUser encodes savedAt from join', async () => {
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

      const result = await service.getPostsSavedByCurrentUser(validUserId, { first: 20 });
      expect(result.edges).toHaveLength(1);
      const cursor = JSON.parse(Buffer.from(result.edges[0].cursor, 'base64url').toString('utf8')) as {
        savedAt: string;
        postId: string;
      };
      expect(cursor.savedAt).toBe(savedDate.toISOString());
    });

    it('getPostsCreatedByCurrentUser filters by postType', async () => {
      const mockPost = { id: validPostId, postType: 'RESCUE' } as unknown as Post;
      mockPostsRepo.findPostsCreatedByCurrentUser = jest.fn().mockResolvedValue({
        rows: [{ post: mockPost, distanceKm: null }],
        hasNextPage: false,
      });

      const result = await service.getPostsCreatedByCurrentUser(validUserId, { postType: 'RESCUE' });
      expect(result.edges).toHaveLength(1);
    });
  });

  describe('recordView', () => {
    it('buffers view if not seen in the last hour', async () => {
      mockCacheManager.get = jest.fn().mockResolvedValue(null);

      const result = await service.recordView(validPostId, validUserId);
      expect(result).toBe(true);
      expect(mockCacheManager.set).toHaveBeenCalled();
      expect(mockViewFlushCron.bufferView).toHaveBeenCalledWith(validPostId);
    });

    it('does not buffer view if already viewed recently', async () => {
      mockCacheManager.get = jest.fn().mockResolvedValue(true);

      const result = await service.recordView(validPostId, validUserId);
      expect(result).toBe(true);
      expect(mockViewFlushCron.bufferView).not.toHaveBeenCalled();
    });
  });
});

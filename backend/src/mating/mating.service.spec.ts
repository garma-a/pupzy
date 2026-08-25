import { MatingService } from './mating.service';
import { MatingRepository } from './mating.repository';
import { CitiesService } from '../cities/cities.service';
import { UploadService } from '../upload/upload.service';
import { ValidationError, NotFoundError } from '../common/errors/app.errors';
import type { Post, City } from '../database/schema';

describe('MatingService', () => {
  let service: MatingService;
  let mockMatingRepo: jest.Mocked<Partial<MatingRepository>>;
  let mockCitiesService: jest.Mocked<Partial<CitiesService>>;
  let mockUploadService: jest.Mocked<Partial<UploadService>>;

  const validUserId = '01916327-0000-7000-8000-000000000001';
  const validCityId = '01916327-0000-7000-8000-000000000002';
  const validMediaId = '01916327-0000-7000-8000-000000000003';
  const validPostId = '01916327-0000-7000-8000-000000000004';

  const mockCity = {
    id: validCityId,
    nameEnglish: 'Cairo',
    nameArabic: 'القاهرة',
    governorate: 'Cairo',
    centerPoint: [31.2357, 30.0444] as [number, number],
  } as unknown as City;

  const mockPost = {
    id: validPostId,
    creatorId: validUserId,
    postType: 'MATING',
    title: 'Golden Retriever • Male for mating',
    description: 'Max — mating partner search',
    status: 'ACTIVE',
    moderationStatus: 'PENDING_AUTO_REVIEW',
    urgency: null,
    cityId: validCityId,
    governorate: 'Cairo',
    areaName: null,
    coordinates: [31.2357, 30.0444] as [number, number],
    marketCategory: null,
    effectiveScore: 0,
    viewCount: 0,
    upvoteCount: 0,
    saveCount: 0,
    reportCount: 0,
    lastEngagedAt: new Date('2026-08-20T10:00:00Z'),
    lastAutoNudgedAt: null,
    lastAdminAutoReviewAt: null,
    createdAt: new Date('2026-08-20T10:00:00Z'),
    updatedAt: new Date('2026-08-20T10:00:00Z'),
  } as unknown as Post;

  beforeEach(() => {
    mockMatingRepo = {
      createMatingPost: jest.fn().mockResolvedValue(mockPost),
      findDetailsByPostId: jest.fn().mockResolvedValue({
        postId: validPostId,
        petName: 'Max',
        species: 'DOG',
        breed: 'Golden Retriever',
        gender: 'MALE',
        ageValue: 2,
        ageUnit: 'YEARS',
        isPurebred: true,
        hasPedigreeCertificate: true,
        vaccinated: true,
        dewormed: true,
        termsSummary: 'First pick of the litter',
        matingConditions: 'Must be fully vaccinated',
      }),
      findFeed: jest.fn().mockResolvedValue({
        rows: [mockPost],
        hasNextPage: false,
      }),
    };

    mockCitiesService = {
      findById: jest.fn().mockResolvedValue(mockCity),
    };

    mockUploadService = {
      getExpectedMediaUrls: jest.fn().mockResolvedValue({
        id: validMediaId,
        cloudflareStorageKey: 'posts/key.webp',
        publicUrl: 'https://cdn.pupzy.xyz/posts/key.webp',
        thumbnailUrl: 'https://cdn.pupzy.xyz/posts/key_thumb.webp',
        blurHash: 'LEHV6n004n-O0000000000',
        width: 1080,
        height: 1080,
        fileSizeBytes: 200000,
        displayOrder: 0,
        createdAt: new Date(),
      }),
      finalizeMedia: jest.fn().mockResolvedValue({
        mediaId: validMediaId,
        publicUrl: 'https://cdn.pupzy.xyz/posts/key.webp',
        thumbnailUrl: 'https://cdn.pupzy.xyz/posts/key_thumb.webp',
        blurHash: 'LEHV6n004n-O0000000000',
        width: 1080,
        height: 1080,
        fileSizeBytes: 200000,
      }),
    };

    service = new MatingService(
      mockMatingRepo as MatingRepository,
      mockCitiesService as CitiesService,
      mockUploadService as UploadService,
    );
  });

  describe('createMatingPost', () => {
    const validRawInput = {
      petName: 'Max',
      species: 'DOG',
      breed: 'Golden Retriever',
      gender: 'MALE',
      ageValue: 2,
      ageUnit: 'YEARS',
      isPurebred: true,
      hasPedigreeCertificate: true,
      vaccinated: true,
      dewormed: true,
      termsSummary: 'First pick of the litter',
      matingConditions: 'Must be fully vaccinated',
      cityId: validCityId,
      mediaIds: [validMediaId],
    };

    it('creates MATING post with city centroid coordinates and finalizes media', async () => {
      const result = await service.createMatingPost(validUserId, validRawInput);

      expect(result).toBe(mockPost);
      expect(mockCitiesService.findById).toHaveBeenCalledWith(validCityId);
      expect(mockUploadService.getExpectedMediaUrls).toHaveBeenCalledWith(validMediaId, expect.any(String));
      expect(mockMatingRepo.createMatingPost).toHaveBeenCalledWith(
        expect.objectContaining({
          postType: 'MATING',
          coordinates: mockCity.centerPoint,
          cityId: validCityId,
          governorate: 'Cairo',
          urgency: undefined,
        }),
        expect.objectContaining({
          petName: 'Max',
          breed: 'Golden Retriever',
          gender: 'MALE',
        }),
        expect.any(Array),
      );
      expect(mockUploadService.finalizeMedia).toHaveBeenCalledWith(validMediaId, validUserId, expect.any(String));
    });

    it('throws ValidationError if cityId is not found', async () => {
      mockCitiesService.findById = jest.fn().mockResolvedValue(undefined);
      await expect(service.createMatingPost(validUserId, validRawInput)).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError if gender is UNKNOWN', async () => {
      await expect(service.createMatingPost(validUserId, { ...validRawInput, gender: 'UNKNOWN' })).rejects.toThrow(
        ValidationError,
      );
    });

    it('throws ValidationError if mediaIds is empty', async () => {
      await expect(service.createMatingPost(validUserId, { ...validRawInput, mediaIds: [] })).rejects.toThrow(
        ValidationError,
      );
    });

    it('throws ValidationError if mediaIds has more than 4 items', async () => {
      const fiveMediaIds = [
        '01916327-0000-7000-8000-000000000001',
        '01916327-0000-7000-8000-000000000002',
        '01916327-0000-7000-8000-000000000003',
        '01916327-0000-7000-8000-000000000004',
        '01916327-0000-7000-8000-000000000005',
      ];
      await expect(service.createMatingPost(validUserId, { ...validRawInput, mediaIds: fiveMediaIds })).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe('matingFeed', () => {
    it('returns paginated connection with cursor encoding', async () => {
      const feed = await service.matingFeed({ species: 'DOG', gender: 'FEMALE' }, 10, null);
      expect(feed.edges).toHaveLength(1);
      expect(feed.edges[0].node.id).toBe(validPostId);
      expect(mockMatingRepo.findFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { species: 'DOG', gender: 'FEMALE' },
          limit: 10,
        }),
      );
    });

    it('throws ValidationError on malformed cursor', async () => {
      const badCursor = Buffer.from('bad json').toString('base64url');
      await expect(service.matingFeed(null, 10, badCursor)).rejects.toThrow(ValidationError);
    });
  });

  describe('getMatingPostDetail', () => {
    it('returns mating details when found', async () => {
      const details = await service.getMatingPostDetail(validPostId);
      expect(details.petName).toBe('Max');
      expect(details.breed).toBe('Golden Retriever');
      expect(details.gender).toBe('MALE');
    });

    it('throws NotFoundError when post detail is not found', async () => {
      mockMatingRepo.findDetailsByPostId = jest.fn().mockResolvedValue(undefined);
      await expect(service.getMatingPostDetail(validPostId)).rejects.toThrow(NotFoundError);
    });
  });
});

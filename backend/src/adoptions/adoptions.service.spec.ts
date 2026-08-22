import { AdoptionsService } from './adoptions.service';
import { AdoptionsRepository } from './adoptions.repository';
import { PostsRepository } from '../posts/posts.repository';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../common/errors/app.errors';
import type { AdoptionApplication, Post } from '../database/schema';

describe('AdoptionsService', () => {
  let service: AdoptionsService;
  let mockAdoptionsRepo: jest.Mocked<Partial<AdoptionsRepository>>;
  let mockPostsRepo: jest.Mocked<Partial<PostsRepository>>;
  let mockUsersService: jest.Mocked<Partial<UsersService>>;
  let mockNotificationsService: jest.Mocked<Partial<NotificationsService>>;

  const validPostId = '01916327-0000-7000-8000-000000000001';
  const validOwnerId = '01916327-0000-7000-8000-000000000002';
  const validApplicantId = '01916327-0000-7000-8000-000000000003';
  const validApplicationId = '01916327-0000-7000-8000-000000000004';

  const mockPost = {
    id: validPostId,
    creatorId: validOwnerId,
    postType: 'ADOPTION',
    status: 'ACTIVE',
    title: 'Golden Puppy',
  } as unknown as Post;

  beforeEach(() => {
    mockAdoptionsRepo = {
      create: jest.fn().mockResolvedValue({
        id: validApplicationId,
        status: 'PENDING',
        targetPostId: validPostId,
        applicantId: validApplicantId,
      }),
      findById: jest.fn().mockResolvedValue({
        id: validApplicationId,
        status: 'PENDING',
        targetPostId: validPostId,
        applicantId: validApplicantId,
        createdAt: new Date(),
      }),
      findExisting: jest.fn().mockResolvedValue(null),
      updateStatus: jest.fn().mockResolvedValue({
        id: validApplicationId,
        status: 'APPROVED',
        targetPostId: validPostId,
        applicantId: validApplicantId,
        createdAt: new Date(),
      }),
      findByPost: jest.fn().mockResolvedValue({
        rows: [{ id: validApplicationId, createdAt: new Date() } as AdoptionApplication],
        hasNextPage: false,
      }),
      findByApplicant: jest.fn().mockResolvedValue({
        rows: [{ id: validApplicationId, createdAt: new Date() } as AdoptionApplication],
        hasNextPage: false,
      }),
    };

    mockPostsRepo = {
      findById: jest.fn().mockResolvedValue(mockPost),
    };

    mockUsersService = {
      findById: jest.fn().mockResolvedValue({ id: validOwnerId, fullName: 'Owner User', phoneNumber: '+201012345678' }),
    };

    mockNotificationsService = {
      fireNotification: jest.fn(),
    };

    service = new AdoptionsService(
      mockAdoptionsRepo as AdoptionsRepository,
      mockPostsRepo as PostsRepository,
      mockUsersService as UsersService,
      mockNotificationsService as NotificationsService,
    );
  });

  describe('submitApplication', () => {
    const input = {
      targetPostId: validPostId,
      livingSituation: 'APARTMENT' as const,
      hasOutdoorAccess: false,
      hasOtherPetsAtHome: false,
      hasChildrenAtHome: false,
      hoursAtHomePerDay: 4,
      previousPetExperience: 'Grew up with dogs',
      whyAdopt: 'I love animals and have space for a pet.',
      consentHomeVisit: true,
      canProvideVetReference: true,
    };

    it('creates application and fires notification to post owner', async () => {
      const result = await service.submitApplication(validApplicantId, input);
      expect(result.id).toBe(validApplicationId);
      expect(mockAdoptionsRepo.create).toHaveBeenCalled();
      expect(mockNotificationsService.fireNotification).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: validOwnerId, type: 'ADOPTION_APPLICATION_RECEIVED' }),
        validApplicantId,
      );
    });

    it('throws NotFoundError if target post does not exist or is REMOVED', async () => {
      mockPostsRepo.findById = jest.fn().mockResolvedValue(null);
      await expect(service.submitApplication(validApplicantId, input)).rejects.toThrow(NotFoundError);
    });

    it('throws ValidationError if target post is not ADOPTION type', async () => {
      mockPostsRepo.findById = jest.fn().mockResolvedValue({ ...mockPost, postType: 'RESCUE' });
      await expect(service.submitApplication(validApplicantId, input)).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError if target post is not ACTIVE', async () => {
      mockPostsRepo.findById = jest.fn().mockResolvedValue({ ...mockPost, status: 'ADOPTED' });
      await expect(service.submitApplication(validApplicantId, input)).rejects.toThrow(ValidationError);
    });

    it('throws ForbiddenError if applicant is the post creator', async () => {
      await expect(service.submitApplication(validOwnerId, input)).rejects.toThrow(ForbiddenError);
    });

    it('throws ConflictError if duplicate application exists', async () => {
      mockAdoptionsRepo.findExisting = jest.fn().mockResolvedValue({ id: validApplicationId });
      await expect(service.submitApplication(validApplicantId, input)).rejects.toThrow(ConflictError);
    });
  });

  describe('approveApplication', () => {
    it('approves application, builds wa.me link, and fires notification', async () => {
      const result = await service.approveApplication(validOwnerId, validApplicationId);
      expect(result.status).toBe('APPROVED');
      expect(result.whatsappLink).toBe('https://wa.me/201012345678');
      expect(mockNotificationsService.fireNotification).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: validApplicantId, type: 'ADOPTION_APPLICATION_APPROVED' }),
        validOwnerId,
      );
    });

    it('throws ForbiddenError if caller is not the post owner', async () => {
      await expect(
        service.approveApplication('01916327-0000-7000-8000-000000000999', validApplicationId),
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ValidationError if application is not PENDING', async () => {
      mockAdoptionsRepo.findById = jest.fn().mockResolvedValue({
        id: validApplicationId,
        status: 'APPROVED',
        targetPostId: validPostId,
      });
      await expect(service.approveApplication(validOwnerId, validApplicationId)).rejects.toThrow(ValidationError);
    });
  });

  describe('rejectApplication', () => {
    it('rejects application and fires notification to applicant', async () => {
      mockAdoptionsRepo.updateStatus = jest.fn().mockResolvedValue({
        id: validApplicationId,
        status: 'REJECTED',
        targetPostId: validPostId,
        applicantId: validApplicantId,
      });

      const result = await service.rejectApplication(validOwnerId, validApplicationId);
      expect(result.status).toBe('REJECTED');
      expect(mockNotificationsService.fireNotification).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: validApplicantId, type: 'ADOPTION_APPLICATION_REJECTED' }),
        validOwnerId,
      );
    });
  });

  describe('getMyApplications & getPostApplications', () => {
    it('getMyApplications returns paginated connection', async () => {
      const result = await service.getMyApplications(validApplicantId, 10, null);
      expect(result.edges).toHaveLength(1);
    });

    it('getPostApplications returns paginated connection for post owner', async () => {
      const result = await service.getPostApplications(validOwnerId, validPostId, 'PENDING', 10, null);
      expect(result.edges).toHaveLength(1);
    });

    it('getPostApplications throws ForbiddenError for non-owner', async () => {
      await expect(service.getPostApplications(validApplicantId, validPostId, 'PENDING', 10, null)).rejects.toThrow(
        ForbiddenError,
      );
    });
  });
});

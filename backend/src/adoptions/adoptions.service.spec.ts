import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AdoptionsService } from './adoptions.service';
import { AdoptionsRepository } from './adoptions.repository';
import { PostsRepository } from '../posts/posts.repository';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../common/errors/app.errors';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import type * as schema from '../database/schema';
import type { AdoptionApplication, Post } from '../database/schema';

describe('AdoptionsService', () => {
  let service: AdoptionsService;
  let mockAdoptionsRepo: jest.Mocked<Partial<AdoptionsRepository>>;
  let mockPostsRepo: jest.Mocked<Partial<PostsRepository>>;
  let mockUsersService: jest.Mocked<Partial<UsersService>>;
  let mockNotificationsService: jest.Mocked<Partial<NotificationsService>>;
  let mockIsolationPolicy: { lockPairAndRecheck: jest.Mock; lockPair: jest.Mock };
  let mockDb: { transaction: jest.Mock };

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
      lockPostForInteraction: jest.fn().mockResolvedValue(mockPost),
    };

    mockUsersService = {
      findById: jest.fn().mockResolvedValue({ id: validOwnerId, fullName: 'Owner User', phoneNumber: '+201012345678' }),
      findActiveById: jest
        .fn()
        .mockResolvedValue({ id: validOwnerId, fullName: 'Owner User', phoneNumber: '+201012345678', isBanned: false }),
    };

    mockNotificationsService = {
      fireNotification: jest.fn(),
    };

    mockIsolationPolicy = {
      lockPairAndRecheck: jest.fn().mockResolvedValue(false),
      lockPair: jest.fn().mockResolvedValue(undefined),
    };

    mockDb = {
      transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) => callback({})),
    };

    service = new AdoptionsService(
      mockAdoptionsRepo as AdoptionsRepository,
      mockPostsRepo as PostsRepository,
      mockUsersService as UsersService,
      mockNotificationsService as NotificationsService,
      mockDb as unknown as NodePgDatabase<typeof schema>,
      mockIsolationPolicy as unknown as AccountIsolationPolicy,
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

    it('rejects an application when the Post closes before the transaction commits', async () => {
      mockPostsRepo.lockPostForInteraction = jest.fn().mockResolvedValue({ ...mockPost, status: 'ADOPTED' });
      await expect(service.submitApplication(validApplicantId, input)).rejects.toThrow(ValidationError);
      expect(mockAdoptionsRepo.create).not.toHaveBeenCalled();
    });

    it('treats a Post removed before the transaction commits as not found', async () => {
      mockPostsRepo.lockPostForInteraction = jest.fn().mockResolvedValue({ ...mockPost, status: 'REMOVED' });
      await expect(service.submitApplication(validApplicantId, input)).rejects.toThrow(NotFoundError);
      expect(mockAdoptionsRepo.create).not.toHaveBeenCalled();
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

    it('approve throws NotFoundError if post is REMOVED', async () => {
      mockPostsRepo.findById = jest.fn().mockResolvedValue({ ...mockPost, status: 'REMOVED' });
      await expect(service.approveApplication(validOwnerId, validApplicationId)).rejects.toThrow(NotFoundError);
    });

    it('approve throws ValidationError if post is not ACTIVE', async () => {
      mockPostsRepo.findById = jest.fn().mockResolvedValue({ ...mockPost, status: 'ADOPTED' });
      await expect(service.approveApplication(validOwnerId, validApplicationId)).rejects.toThrow(ValidationError);
    });

    it('approve throws ConflictError when application was concurrently transitioned (lost race)', async () => {
      mockAdoptionsRepo.updateStatus = jest.fn().mockResolvedValue(undefined);
      mockAdoptionsRepo.findById = jest
        .fn()
        .mockResolvedValueOnce({
          id: validApplicationId,
          status: 'PENDING',
          targetPostId: validPostId,
          applicantId: validApplicantId,
        })
        .mockResolvedValueOnce({
          id: validApplicationId,
          status: 'REJECTED',
          targetPostId: validPostId,
          applicantId: validApplicantId,
        });

      await expect(service.approveApplication(validOwnerId, validApplicationId)).rejects.toThrow(ConflictError);
      expect(mockNotificationsService.fireNotification).not.toHaveBeenCalled();
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

    it('reject throws NotFoundError if post is REMOVED', async () => {
      mockPostsRepo.findById = jest.fn().mockResolvedValue({ ...mockPost, status: 'REMOVED' });
      await expect(service.rejectApplication(validOwnerId, validApplicationId)).rejects.toThrow(NotFoundError);
    });

    it('reject throws ConflictError when application was concurrently transitioned (lost race)', async () => {
      mockAdoptionsRepo.updateStatus = jest.fn().mockResolvedValue(undefined);
      mockAdoptionsRepo.findById = jest
        .fn()
        .mockResolvedValueOnce({
          id: validApplicationId,
          status: 'PENDING',
          targetPostId: validPostId,
          applicantId: validApplicantId,
        })
        .mockResolvedValueOnce({
          id: validApplicationId,
          status: 'APPROVED',
          targetPostId: validPostId,
          applicantId: validApplicantId,
        });

      await expect(service.rejectApplication(validOwnerId, validApplicationId)).rejects.toThrow(ConflictError);
      expect(mockNotificationsService.fireNotification).not.toHaveBeenCalled();
    });
  });

  describe('getAdoptionWhatsAppLink', () => {
    const approvedApplication = {
      id: validApplicationId,
      status: 'APPROVED',
      targetPostId: validPostId,
      applicantId: validApplicantId,
    };

    it('returns the owner wa.me link to the approved applicant', async () => {
      mockAdoptionsRepo.findById = jest.fn().mockResolvedValue(approvedApplication);

      await expect(service.getAdoptionWhatsAppLink(validApplicantId, validApplicationId)).resolves.toBe(
        'https://wa.me/201012345678',
      );
      expect(mockIsolationPolicy.lockPairAndRecheck).toHaveBeenCalledWith(
        expect.anything(),
        validApplicantId,
        validOwnerId,
      );
    });

    it('throws NotFoundError for an unknown application', async () => {
      mockAdoptionsRepo.findById = jest.fn().mockResolvedValue(undefined);

      await expect(service.getAdoptionWhatsAppLink(validApplicantId, validApplicationId)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('throws ForbiddenError for the owner and unrelated callers', async () => {
      mockAdoptionsRepo.findById = jest.fn().mockResolvedValue(approvedApplication);

      await expect(service.getAdoptionWhatsAppLink(validOwnerId, validApplicationId)).rejects.toThrow(ForbiddenError);
      await expect(
        service.getAdoptionWhatsAppLink('01916327-0000-7000-8000-000000000999', validApplicationId),
      ).rejects.toThrow(ForbiddenError);
      expect(mockUsersService.findActiveById).not.toHaveBeenCalled();
    });

    it.each(['PENDING', 'REJECTED'])('throws ValidationError while the application is %s', async (status) => {
      mockAdoptionsRepo.findById = jest.fn().mockResolvedValue({ ...approvedApplication, status });

      await expect(service.getAdoptionWhatsAppLink(validApplicantId, validApplicationId)).rejects.toThrow(
        ValidationError,
      );
      expect(mockUsersService.findActiveById).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the target post is missing or REMOVED', async () => {
      mockAdoptionsRepo.findById = jest.fn().mockResolvedValue(approvedApplication);

      mockPostsRepo.findById = jest.fn().mockResolvedValue(null);
      await expect(service.getAdoptionWhatsAppLink(validApplicantId, validApplicationId)).rejects.toThrow(
        NotFoundError,
      );

      mockPostsRepo.findById = jest.fn().mockResolvedValue({ ...mockPost, status: 'REMOVED' });
      await expect(service.getAdoptionWhatsAppLink(validApplicantId, validApplicationId)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('fails neutrally as an unknown application when the pair is isolated', async () => {
      mockAdoptionsRepo.findById = jest.fn().mockResolvedValue(approvedApplication);
      mockIsolationPolicy.lockPairAndRecheck.mockResolvedValue(true);

      await expect(service.getAdoptionWhatsAppLink(validApplicantId, validApplicationId)).rejects.toThrow(
        `AdoptionApplication with id "${validApplicationId}" was not found`,
      );
      expect(mockUsersService.findActiveById).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the owner account is unavailable or has no phone', async () => {
      mockAdoptionsRepo.findById = jest.fn().mockResolvedValue(approvedApplication);

      mockUsersService.findActiveById = jest.fn().mockResolvedValue(undefined);
      await expect(service.getAdoptionWhatsAppLink(validApplicantId, validApplicationId)).rejects.toThrow(
        'Owner contact information is not available',
      );

      mockUsersService.findActiveById = jest.fn().mockResolvedValue({
        id: validOwnerId,
        fullName: 'Owner User',
        phoneNumber: null,
        isBanned: false,
      });
      await expect(service.getAdoptionWhatsAppLink(validApplicantId, validApplicationId)).rejects.toThrow(
        'Owner contact information is not available',
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

    it.each([-5, 0])('treats first=%i as limit 1', async (bad) => {
      mockAdoptionsRepo.findByApplicant = jest.fn().mockResolvedValue({ rows: [], hasNextPage: false });
      await service.getMyApplications(validApplicantId, bad, null);
      expect(mockAdoptionsRepo.findByApplicant).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
    });

    it('getPostApplications throws ValidationError on invalid status', async () => {
      await expect(service.getPostApplications(validOwnerId, validPostId, 'INVALID_STATUS', 10, null)).rejects.toThrow(
        ValidationError,
      );
    });

    it('getPostApplications throws ValidationError on invalid postId uuid', async () => {
      await expect(service.getPostApplications(validOwnerId, 'bad-uuid', 'PENDING', 10, null)).rejects.toThrow(
        ValidationError,
      );
    });

    it('throws ValidationError on malformed cursor JSON', async () => {
      const badCursor = Buffer.from('invalid json').toString('base64url');
      await expect(service.getMyApplications(validApplicantId, 10, badCursor)).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError on invalid date in cursor', async () => {
      const badCursor = Buffer.from(JSON.stringify({ createdAt: 'garbage-date', id: '123' })).toString('base64url');
      await expect(service.getMyApplications(validApplicantId, 10, badCursor)).rejects.toThrow(ValidationError);
    });

    it('filters both sent and received lists by the authenticated viewer', async () => {
      await service.getMyApplications(validApplicantId, 10, null);
      expect(mockAdoptionsRepo.findByApplicant).toHaveBeenCalledWith(
        expect.objectContaining({ applicantId: validApplicantId, viewerId: validApplicantId }),
      );

      await service.getPostApplications(validOwnerId, validPostId, null, 10, null);
      expect(mockAdoptionsRepo.findByPost).toHaveBeenCalledWith(
        expect.objectContaining({ targetPostId: validPostId, viewerId: validOwnerId }),
      );
    });
  });

  describe('account isolation', () => {
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

    it('submitApplication fails neutrally and creates nothing when the pair is isolated', async () => {
      mockIsolationPolicy.lockPairAndRecheck.mockResolvedValue(true);

      await expect(service.submitApplication(validApplicantId, input)).rejects.toThrow(NotFoundError);
      expect(mockAdoptionsRepo.create).not.toHaveBeenCalled();
      expect(mockNotificationsService.fireNotification).not.toHaveBeenCalled();
    });

    it('approveApplication rechecks isolation inside the transition and never discloses contact', async () => {
      mockIsolationPolicy.lockPairAndRecheck.mockResolvedValue(true);

      await expect(service.approveApplication(validOwnerId, validApplicationId)).rejects.toThrow(NotFoundError);
      expect(mockAdoptionsRepo.updateStatus).not.toHaveBeenCalled();
      expect(mockNotificationsService.fireNotification).not.toHaveBeenCalled();
    });

    it('rejectPendingAdoptionApplicationsBetweenAccounts locks the canonical pair and rejects rows', async () => {
      mockAdoptionsRepo.rejectPendingBetweenAccounts = jest.fn().mockResolvedValue(1);

      const count = await service.rejectPendingAdoptionApplicationsBetweenAccounts(
        {} as never,
        validApplicantId,
        validOwnerId,
      );

      expect(count).toBe(1);
      expect(mockIsolationPolicy.lockPair).toHaveBeenCalledWith(expect.anything(), validApplicantId, validOwnerId);
    });
  });
});

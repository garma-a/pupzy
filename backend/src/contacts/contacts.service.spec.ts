import { ContactsService } from './contacts.service';
import { ContactsRepository } from './contacts.repository';
import { PostsRepository } from '../posts/posts.repository';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../common/errors/app.errors';
import type { ContactRequest, Post } from '../database/schema';

describe('ContactsService', () => {
  let service: ContactsService;
  let mockContactsRepo: jest.Mocked<Partial<ContactsRepository>>;
  let mockPostsRepo: jest.Mocked<Partial<PostsRepository>>;
  let mockUsersService: jest.Mocked<Partial<UsersService>>;
  let mockNotificationsService: jest.Mocked<Partial<NotificationsService>>;

  const validPostId = '01916327-0000-7000-8000-000000000001';
  const validOwnerId = '01916327-0000-7000-8000-000000000002';
  const validRequesterId = '01916327-0000-7000-8000-000000000003';
  const validRequestId = '01916327-0000-7000-8000-000000000004';

  const mockPost = {
    id: validPostId,
    creatorId: validOwnerId,
    postType: 'RESCUE',
    status: 'ACTIVE',
    title: 'Injured Dog',
  } as unknown as Post;

  beforeEach(() => {
    mockContactsRepo = {
      create: jest.fn().mockResolvedValue({
        id: validRequestId,
        status: 'PENDING',
        postId: validPostId,
        requesterId: validRequesterId,
      }),
      findById: jest.fn().mockResolvedValue({
        id: validRequestId,
        status: 'PENDING',
        postId: validPostId,
        requesterId: validRequesterId,
        createdAt: new Date(),
      }),
      findExisting: jest.fn().mockResolvedValue(null),
      updateStatus: jest.fn().mockResolvedValue({
        id: validRequestId,
        status: 'APPROVED',
        postId: validPostId,
        requesterId: validRequesterId,
        createdAt: new Date(),
      }),
      findByPost: jest.fn().mockResolvedValue({
        rows: [{ id: validRequestId, createdAt: new Date() } as ContactRequest],
        hasNextPage: false,
      }),
      findByRequester: jest.fn().mockResolvedValue({
        rows: [{ id: validRequestId, createdAt: new Date() } as ContactRequest],
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

    service = new ContactsService(
      mockContactsRepo as ContactsRepository,
      mockPostsRepo as PostsRepository,
      mockUsersService as UsersService,
      mockNotificationsService as NotificationsService,
    );
  });

  describe('requestContact', () => {
    it('creates contact request and fires notification to post owner', async () => {
      const result = await service.requestContact(validRequesterId, validPostId, 'Can I help?');
      expect(result.id).toBe(validRequestId);
      expect(mockContactsRepo.create).toHaveBeenCalled();
      expect(mockNotificationsService.fireNotification).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: validOwnerId, type: 'CONTACT_REQUEST_RECEIVED' }),
        validRequesterId,
      );
    });

    it('creates contact request for MATING posts', async () => {
      mockPostsRepo.findById = jest.fn().mockResolvedValue({ ...mockPost, postType: 'MATING' });
      const result = await service.requestContact(validRequesterId, validPostId, 'Interested in mating');
      expect(result.id).toBe(validRequestId);
      expect(mockContactsRepo.create).toHaveBeenCalled();
    });

    it('throws NotFoundError if post does not exist or is REMOVED', async () => {
      mockPostsRepo.findById = jest.fn().mockResolvedValue(null);
      await expect(service.requestContact(validRequesterId, validPostId, 'Hi')).rejects.toThrow(NotFoundError);
    });

    it('throws ValidationError for PRODUCT posts', async () => {
      mockPostsRepo.findById = jest.fn().mockResolvedValue({ ...mockPost, postType: 'PRODUCT' });
      await expect(service.requestContact(validRequesterId, validPostId, 'Hi')).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for inactive posts', async () => {
      mockPostsRepo.findById = jest.fn().mockResolvedValue({ ...mockPost, status: 'RESOLVED' });
      await expect(service.requestContact(validRequesterId, validPostId, 'Hi')).rejects.toThrow(ValidationError);
    });

    it('throws ForbiddenError if requester is the post owner', async () => {
      await expect(service.requestContact(validOwnerId, validPostId, 'Hi')).rejects.toThrow(ForbiddenError);
    });

    it('throws ConflictError if duplicate request already exists', async () => {
      mockContactsRepo.findExisting = jest.fn().mockResolvedValue({ id: validRequestId });
      await expect(service.requestContact(validRequesterId, validPostId, 'Hi')).rejects.toThrow(ConflictError);
    });
  });

  describe('approveContactRequest', () => {
    it('approves request, decrypts owner phone, and returns wa.me link', async () => {
      const result = await service.approveContactRequest(validOwnerId, validRequestId);
      expect(result.status).toBe('APPROVED');
      expect(result.whatsappLink).toBe('https://wa.me/201012345678');
      expect(mockNotificationsService.fireNotification).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: validRequesterId, type: 'CONTACT_REQUEST_APPROVED' }),
        validOwnerId,
      );
    });

    it('throws ForbiddenError if caller is not the post owner', async () => {
      await expect(
        service.approveContactRequest('01916327-0000-7000-8000-000000000999', validRequestId),
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ValidationError if request is not PENDING', async () => {
      mockContactsRepo.findById = jest
        .fn()
        .mockResolvedValue({ id: validRequestId, status: 'APPROVED', postId: validPostId });
      await expect(service.approveContactRequest(validOwnerId, validRequestId)).rejects.toThrow(ValidationError);
    });

    it('approve throws NotFoundError if post is REMOVED', async () => {
      mockPostsRepo.findById = jest.fn().mockResolvedValue({ ...mockPost, status: 'REMOVED' });
      await expect(service.approveContactRequest(validOwnerId, validRequestId)).rejects.toThrow(NotFoundError);
    });

    it('approve throws ValidationError if post is not ACTIVE', async () => {
      mockPostsRepo.findById = jest.fn().mockResolvedValue({ ...mockPost, status: 'RESOLVED' });
      await expect(service.approveContactRequest(validOwnerId, validRequestId)).rejects.toThrow(ValidationError);
    });

    it('approve throws ConflictError when the row was concurrently transitioned (lost race)', async () => {
      const pendingReq = {
        id: validRequestId,
        postId: validPostId,
        requesterId: validRequesterId,
        status: 'PENDING',
      } as unknown as ContactRequest;
      const ownedPost = {
        id: validPostId,
        creatorId: validOwnerId,
        title: 'Cat',
        status: 'ACTIVE',
        postType: 'ADOPTION',
      } as unknown as Post;
      mockContactsRepo.findById = jest
        .fn()
        .mockResolvedValueOnce(pendingReq)
        .mockResolvedValueOnce({ ...pendingReq, status: 'REJECTED' });
      mockPostsRepo.findById = jest.fn().mockResolvedValue(ownedPost);
      mockContactsRepo.updateStatus = jest.fn().mockResolvedValue(undefined);

      await expect(service.approveContactRequest(validOwnerId, validRequestId)).rejects.toThrow(ConflictError);
      expect(mockNotificationsService.fireNotification).not.toHaveBeenCalled();
    });
  });

  describe('rejectContactRequest', () => {
    it('rejects request and notifies requester', async () => {
      mockContactsRepo.updateStatus = jest
        .fn()
        .mockResolvedValue({ id: validRequestId, status: 'REJECTED', postId: validPostId });

      const result = await service.rejectContactRequest(validOwnerId, validRequestId);
      expect(result.status).toBe('REJECTED');
      expect(mockNotificationsService.fireNotification).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: validRequesterId, type: 'CONTACT_REQUEST_REJECTED' }),
        validOwnerId,
      );
    });

    it('reject throws NotFoundError if post is REMOVED', async () => {
      mockPostsRepo.findById = jest.fn().mockResolvedValue({ ...mockPost, status: 'REMOVED' });
      await expect(service.rejectContactRequest(validOwnerId, validRequestId)).rejects.toThrow(NotFoundError);
    });

    it('reject throws ConflictError when the row was concurrently transitioned (lost race)', async () => {
      const pendingReq = {
        id: validRequestId,
        postId: validPostId,
        requesterId: validRequesterId,
        status: 'PENDING',
      } as unknown as ContactRequest;
      const ownedPost = {
        id: validPostId,
        creatorId: validOwnerId,
        title: 'Cat',
        status: 'ACTIVE',
        postType: 'ADOPTION',
      } as unknown as Post;
      mockContactsRepo.findById = jest
        .fn()
        .mockResolvedValueOnce(pendingReq)
        .mockResolvedValueOnce({ ...pendingReq, status: 'APPROVED' });
      mockPostsRepo.findById = jest.fn().mockResolvedValue(ownedPost);
      mockContactsRepo.updateStatus = jest.fn().mockResolvedValue(undefined);

      await expect(service.rejectContactRequest(validOwnerId, validRequestId)).rejects.toThrow(ConflictError);
      expect(mockNotificationsService.fireNotification).not.toHaveBeenCalled();
    });
  });

  describe('getWhatsAppLink', () => {
    it('returns owner whatsapp link for approved request', async () => {
      mockContactsRepo.findById = jest.fn().mockResolvedValue({
        id: validRequestId,
        status: 'APPROVED',
        postId: validPostId,
        requesterId: validRequesterId,
      });

      const link = await service.getWhatsAppLink(validRequesterId, validRequestId);
      expect(link).toBe('https://wa.me/201012345678');
    });

    it('throws ForbiddenError if caller is not the requester', async () => {
      mockContactsRepo.findById = jest.fn().mockResolvedValue({
        id: validRequestId,
        status: 'APPROVED',
        postId: validPostId,
        requesterId: validRequesterId,
      });

      await expect(service.getWhatsAppLink('01916327-0000-7000-8000-000000000999', validRequestId)).rejects.toThrow(
        ForbiddenError,
      );
    });

    it('throws ValidationError if request is not approved yet', async () => {
      mockContactsRepo.findById = jest.fn().mockResolvedValue({
        id: validRequestId,
        status: 'PENDING',
        postId: validPostId,
        requesterId: validRequesterId,
      });

      await expect(service.getWhatsAppLink(validRequesterId, validRequestId)).rejects.toThrow(ValidationError);
    });
  });

  describe('getProductSellerContact', () => {
    it('returns seller whatsapp link directly for active product post', async () => {
      mockPostsRepo.findById = jest.fn().mockResolvedValue({
        id: validPostId,
        creatorId: validOwnerId,
        postType: 'PRODUCT',
        status: 'ACTIVE',
      });

      const link = await service.getProductSellerContact(validRequesterId, validPostId);
      expect(link).toBe('https://wa.me/201012345678');
    });

    it('throws ForbiddenError when requesting contact on own product listing', async () => {
      mockPostsRepo.findById = jest.fn().mockResolvedValue({
        id: validPostId,
        creatorId: validOwnerId,
        postType: 'PRODUCT',
        status: 'ACTIVE',
      });

      await expect(service.getProductSellerContact(validOwnerId, validPostId)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getMyContactRequests & getPostContactRequests', () => {
    it('getMyContactRequests returns paginated connection', async () => {
      const result = await service.getMyContactRequests(validRequesterId, validPostId, 'PENDING', 10, null);
      expect(result.edges).toHaveLength(1);
    });

    it('getPostContactRequests returns paginated connection for post owner', async () => {
      const result = await service.getPostContactRequests(validOwnerId, validPostId, 'PENDING', 10, null);
      expect(result.edges).toHaveLength(1);
    });

    it('getPostContactRequests throws ForbiddenError for non-owner', async () => {
      await expect(service.getPostContactRequests(validRequesterId, validPostId, 'PENDING', 10, null)).rejects.toThrow(
        ForbiddenError,
      );
    });

    it.each([-5, 0])('treats first=%i as limit 1 (no 500, no infinite empty loop)', async (bad) => {
      mockContactsRepo.findByRequester = jest.fn().mockResolvedValue({ rows: [], hasNextPage: false });
      await service.getMyContactRequests('user-1', null, null, bad, null);
      expect(mockContactsRepo.findByRequester).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
    });

    it('getMyContactRequests throws ValidationError on invalid postId uuid', async () => {
      await expect(service.getMyContactRequests(validRequesterId, 'bad-uuid', 'PENDING', 10, null)).rejects.toThrow(
        ValidationError,
      );
    });

    it('getMyContactRequests throws ValidationError on invalid status', async () => {
      await expect(service.getMyContactRequests(validRequesterId, null, 'INVALID_STATUS', 10, null)).rejects.toThrow(
        ValidationError,
      );
    });

    it('getPostContactRequests throws ValidationError on invalid status', async () => {
      await expect(
        service.getPostContactRequests(validOwnerId, validPostId, 'INVALID_STATUS', 10, null),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError on malformed cursor JSON', async () => {
      const badCursor = Buffer.from('invalid json').toString('base64url');
      await expect(service.getMyContactRequests(validRequesterId, null, null, 10, badCursor)).rejects.toThrow(
        ValidationError,
      );
    });

    it('throws ValidationError on invalid date in cursor', async () => {
      const badCursor = Buffer.from(JSON.stringify({ createdAt: 'garbage-date', id: '123' })).toString('base64url');
      await expect(service.getMyContactRequests(validRequesterId, null, null, 10, badCursor)).rejects.toThrow(
        ValidationError,
      );
    });
  });
});

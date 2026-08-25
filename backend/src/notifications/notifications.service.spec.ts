import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';
import { NotFoundError, ValidationError } from '../common/errors/app.errors';
import type { Notification } from '../database/schema';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockRepo: jest.Mocked<Partial<NotificationsRepository>>;

  const validUserId = '01916327-0000-7000-8000-000000000001';
  const validNotificationId = '01916327-0000-7000-8000-000000000002';

  beforeEach(() => {
    mockRepo = {
      create: jest.fn().mockResolvedValue({ id: validNotificationId }),
      findByRecipient: jest.fn().mockResolvedValue({ rows: [], hasNextPage: false }),
      countUnread: jest.fn().mockResolvedValue(3),
      markRead: jest.fn().mockResolvedValue({ id: validNotificationId, isRead: true }),
      markAllRead: jest.fn().mockResolvedValue(5),
    };
    service = new NotificationsService(mockRepo as NotificationsRepository);
  });

  describe('fireNotification', () => {
    it('creates notification for recipient', () => {
      service.fireNotification(
        {
          recipientId: validUserId,
          type: 'NEW_UPVOTE',
          title: 'New upvote',
          body: 'Someone upvoted your post',
        },
        '01916327-0000-7000-8000-000000000009',
      );

      expect(mockRepo.create).toHaveBeenCalled();
    });

    it('suppresses notification if recipient is the actor (self-notification)', () => {
      service.fireNotification(
        {
          recipientId: validUserId,
          type: 'NEW_UPVOTE',
          title: 'New upvote',
          body: 'Someone upvoted your post',
        },
        validUserId, // Same as recipientId
      );

      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('catches and logs errors without throwing to caller', () => {
      mockRepo.create = jest.fn().mockRejectedValue(new Error('DB failure'));

      expect(() => {
        service.fireNotification({
          recipientId: validUserId,
          type: 'NEW_UPVOTE',
          title: 'New upvote',
          body: 'Someone upvoted your post',
        });
      }).not.toThrow();
    });
  });

  describe('getMyNotifications', () => {
    it('returns paginated notifications and unread count', async () => {
      const mockNotification = {
        id: validNotificationId,
        createdAt: new Date(),
        recipientId: validUserId,
      } as Notification;

      mockRepo.findByRecipient = jest.fn().mockResolvedValue({
        rows: [mockNotification],
        hasNextPage: false,
      });

      const result = await service.getMyNotifications(validUserId, 10, null);
      expect(result.edges).toHaveLength(1);
      expect(result.unreadCount).toBe(3);
    });

    it('throws ValidationError for malformed cursor', async () => {
      await expect(service.getMyNotifications(validUserId, 10, 'invalid-base64-!@#')).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for a cursor with an invalid date', async () => {
      const badCursor = Buffer.from(JSON.stringify({ createdAt: 'not-a-real-date', id: 'abc' })).toString('base64url');
      await expect(service.getMyNotifications(validUserId, 10, badCursor)).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for a cursor with a non-string id', async () => {
      const badCursor = Buffer.from(JSON.stringify({ createdAt: new Date().toISOString(), id: 12345 })).toString(
        'base64url',
      );
      await expect(service.getMyNotifications(validUserId, 10, badCursor)).rejects.toThrow(ValidationError);
    });
  });

  describe('getUnreadCount', () => {
    it('returns count from repository', async () => {
      const count = await service.getUnreadCount(validUserId);
      expect(count).toBe(3);
      expect(mockRepo.countUnread).toHaveBeenCalledWith(validUserId);
    });
  });

  describe('markRead', () => {
    it('marks notification as read', async () => {
      const result = await service.markRead(validNotificationId, validUserId);
      expect(result.isRead).toBe(true);
      expect(mockRepo.markRead).toHaveBeenCalledWith(validNotificationId, validUserId);
    });

    it('throws NotFoundError if notification does not exist', async () => {
      mockRepo.markRead = jest.fn().mockResolvedValue(null);
      await expect(service.markRead(validNotificationId, validUserId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('markAllRead', () => {
    it('calls repository markAllRead', async () => {
      const count = await service.markAllRead(validUserId);
      expect(count).toBe(5);
      expect(mockRepo.markAllRead).toHaveBeenCalledWith(validUserId);
    });
  });
});

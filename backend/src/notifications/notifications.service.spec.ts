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
      createIfNotIsolated: jest.fn().mockResolvedValue({ id: validNotificationId }),
      findByRecipient: jest.fn().mockResolvedValue({ rows: [], hasNextPage: false }),
      countUnread: jest.fn().mockResolvedValue(3),
      markRead: jest.fn().mockResolvedValue({ id: validNotificationId, isRead: true }),
      markAllRead: jest.fn().mockResolvedValue(5),
    };
    service = new NotificationsService(mockRepo as NotificationsRepository);
  });

  describe('fireNotification', () => {
    it('creates notification for recipient', () => {
      const actorId = '01916327-0000-7000-8000-000000000009';
      service.fireNotification(
        {
          recipientId: validUserId,
          type: 'NEW_UPVOTE',
          title: 'New upvote',
          body: 'Someone upvoted your post',
        },
        actorId,
      );

      expect(mockRepo.createIfNotIsolated).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: validUserId, type: 'NEW_UPVOTE' }),
        actorId,
        { enqueuePush: false },
      );
    });

    it('creates discussion notifications with relatedPostId and relatedCommentId (Ticket 10)', () => {
      const commentId = '01916327-0000-7000-8000-000000000030';
      const postId = '01916327-0000-7000-8000-000000000010';
      const otherUser = '01916327-0000-7000-8000-000000000009';

      service.fireNotification(
        {
          recipientId: validUserId,
          type: 'NEW_COMMENT',
          title: 'New comment',
          body: 'Someone commented on your post',
          relatedPostId: postId,
          relatedCommentId: commentId,
        },
        otherUser,
      );

      expect(mockRepo.createIfNotIsolated).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'NEW_COMMENT',
          relatedPostId: postId,
          relatedCommentId: commentId,
        }),
        otherUser,
        { enqueuePush: false },
      );

      service.fireNotification(
        {
          recipientId: validUserId,
          type: 'NEW_REPLY',
          title: 'New reply',
          body: 'Someone replied to your comment',
          relatedPostId: postId,
          relatedCommentId: commentId,
        },
        otherUser,
      );

      expect(mockRepo.createIfNotIsolated).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'NEW_REPLY',
          relatedPostId: postId,
          relatedCommentId: commentId,
        }),
        otherUser,
        { enqueuePush: false },
      );

      service.fireNotification(
        {
          recipientId: validUserId,
          type: 'COMMENT_BOOSTED',
          title: 'Comment boosted',
          body: 'Someone boosted your comment',
          relatedPostId: postId,
          relatedCommentId: commentId,
        },
        otherUser,
      );

      expect(mockRepo.createIfNotIsolated).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'COMMENT_BOOSTED',
          relatedPostId: postId,
          relatedCommentId: commentId,
        }),
        otherUser,
        { enqueuePush: false },
      );

      service.fireNotification(
        {
          recipientId: validUserId,
          type: 'COMMENT_PINNED',
          title: 'Comment pinned',
          body: 'Your comment was pinned',
          relatedPostId: postId,
          relatedCommentId: commentId,
        },
        otherUser,
      );

      expect(mockRepo.createIfNotIsolated).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'COMMENT_PINNED',
          relatedPostId: postId,
          relatedCommentId: commentId,
        }),
        otherUser,
        { enqueuePush: false },
      );
    });

    it('enqueues durable push intent only for push-enabled notification types (Ticket 11)', () => {
      const actorId = '01916327-0000-7000-8000-000000000009';

      service.fireNotification(
        {
          recipientId: validUserId,
          type: 'ADOPTION_APPLICATION_APPROVED',
          title: 'Adoption application approved!',
          body: 'Your adoption application was approved.',
        },
        actorId,
      );

      expect(mockRepo.createIfNotIsolated).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ADOPTION_APPLICATION_APPROVED' }),
        actorId,
        { enqueuePush: true },
      );
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

      expect(mockRepo.createIfNotIsolated).not.toHaveBeenCalled();
    });

    it('catches and logs errors without throwing to caller', () => {
      mockRepo.createIfNotIsolated = jest.fn().mockRejectedValue(new Error('DB failure'));

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

  describe('language rendering', () => {
    const bilingualRow = {
      id: validNotificationId,
      recipientId: validUserId,
      type: 'NEW_COMMENT',
      title: 'New comment',
      body: 'Ahmed commented on your post "Missing cat"',
      titleArabic: 'تعليق جديد',
      bodyArabic: 'علّق Ahmed على منشورك "Missing cat"',
      relatedPostId: '01916327-0000-7000-8000-000000000010',
      relatedCommentId: null,
      isRead: false,
      createdAt: new Date(),
    } as Notification;

    it('renders inbox nodes in the explicitly synchronized language', async () => {
      mockRepo.findByRecipient = jest.fn().mockResolvedValue({ rows: [bilingualRow], hasNextPage: false });

      const result = await service.getMyNotifications(validUserId, 10, null, 'ar');

      expect(result.edges[0].node.title).toBe('تعليق جديد');
      expect(result.edges[0].node.body).toBe('علّق Ahmed على منشورك "Missing cat"');
      expect(result.edges[0].node.relatedPostId).toBe(bilingualRow.relatedPostId);
    });

    it('keeps legacy English rows for an Arabic recipient', async () => {
      const legacyRow = {
        ...bilingualRow,
        titleArabic: null,
        bodyArabic: null,
      } as Notification;
      mockRepo.findByRecipient = jest.fn().mockResolvedValue({ rows: [legacyRow], hasNextPage: false });

      const result = await service.getMyNotifications(validUserId, 10, null, 'ar');

      expect(result.edges[0].node.title).toBe('New comment');
    });

    it('renders English for an unsynchronized recipient', async () => {
      mockRepo.findByRecipient = jest.fn().mockResolvedValue({ rows: [bilingualRow], hasNextPage: false });

      const result = await service.getMyNotifications(validUserId, 10, null, null);

      expect(result.edges[0].node.title).toBe('New comment');
    });

    it('renders the marked-read notification in the synchronized language', async () => {
      mockRepo.markRead = jest.fn().mockResolvedValue(bilingualRow);

      const result = await service.markRead(validNotificationId, validUserId, 'ar');

      expect(result.title).toBe('تعليق جديد');
      expect(result.isRead).toBe(false);
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

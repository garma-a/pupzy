import { Injectable, Logger } from '@nestjs/common';
import { NotificationsRepository } from './notifications.repository';
import { NotFoundError, ValidationError } from '../common/errors/app.errors';
import { assertUuid } from '../common/utils/validate-uuid';
import type { Notification, NewNotification } from '../database/schema';

/**
 * NotificationsService — business logic layer for notifications.
 *
 * ## Key design: fireNotification() is fire-and-forget
 * Other services call fireNotification() without `await`.
 * Notification failures are logged but never propagate to the caller.
 * This ensures notification insert latency doesn't affect the main operation.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly notificationsRepository: NotificationsRepository) {}

  /**
   * Fire-and-forget notification creation.
   * Called by PostsService, ContactsService, AdoptionsService.
   * Never throws — notification failure must not block the main operation.
   *
   * ## Self-notification guard
   * Silently skips if recipientId equals the actor (don't notify yourself).
   */
  fireNotification(data: NewNotification, actorId?: string): void {
    // Don't notify yourself
    if (actorId && data.recipientId === actorId) return;

    this.notificationsRepository.create(data).catch((err) => {
      this.logger.error(
        `Failed to create notification type=${data.type} for recipient=${data.recipientId}`,
        err instanceof Error ? err.stack : String(err),
      );
    });
  }

  /**
   * Returns paginated notifications for the current user, newest first.
   * Also includes the total unread count for the badge indicator.
   */
  async getMyNotifications(userId: string, first: number | null | undefined, afterCursor: string | null | undefined) {
    const limit = Math.min(first ?? 20, 50);
    const cursor = this.decodeCursor(afterCursor);

    const [result, unreadCount] = await Promise.all([
      this.notificationsRepository.findByRecipient({
        recipientId: userId,
        limit,
        cursor,
      }),
      this.notificationsRepository.countUnread(userId),
    ]);

    return {
      edges: result.rows.map((notification) => ({
        node: notification,
        cursor: this.encodeCursor(notification),
      })),
      pageInfo: {
        hasNextPage: result.hasNextPage,
        endCursor: result.rows.length > 0 ? this.encodeCursor(result.rows[result.rows.length - 1]) : null,
      },
      unreadCount,
    };
  }

  /**
   * Returns the unread notification count for the current user.
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationsRepository.countUnread(userId);
  }

  /**
   * Marks a single notification as read.
   * @throws {NotFoundError} if the notification doesn't exist or doesn't belong to the user.
   */
  async markRead(notificationId: string, userId: string): Promise<Notification> {
    assertUuid(notificationId, 'notificationId');

    const updated = await this.notificationsRepository.markRead(notificationId, userId);
    if (!updated) {
      throw new NotFoundError('Notification', notificationId);
    }
    return updated;
  }

  /**
   * Marks all notifications for the current user as read.
   */
  async markAllRead(userId: string): Promise<number> {
    return this.notificationsRepository.markAllRead(userId);
  }

  // ─── Cursor helpers ─────────────────────────────────────────────────────

  private decodeCursor(cursorBase64: string | null | undefined): { createdAt: string; id: string } | null {
    if (!cursorBase64) return null;
    try {
      return JSON.parse(Buffer.from(cursorBase64, 'base64url').toString('utf8')) as { createdAt: string; id: string };
    } catch {
      throw new ValidationError('Invalid cursor format');
    }
  }

  private encodeCursor(notification: Notification): string {
    return Buffer.from(
      JSON.stringify({
        createdAt: notification.createdAt.toISOString(),
        id: notification.id,
      }),
      'utf8',
    ).toString('base64url');
  }
}

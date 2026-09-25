import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationsRepository } from './notifications.repository';
import { localizeNotification } from './notification-templates';
import { isPushDeliveryEnabled } from './push-delivery.constants';
import { PushDeliveryProcessor } from './push-delivery.processor';
import { NotFoundError, ValidationError } from '../common/errors/app.errors';
import { assertUuid } from '../common/utils/validate-uuid';
import { clampFirst } from '../common/utils/pagination.util';
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

  constructor(
    private readonly notificationsRepository: NotificationsRepository,
    @Optional()
    @Inject(PushDeliveryProcessor)
    private readonly pushDeliveryProcessor?: PushDeliveryProcessor,
  ) {}

  /**
   * Fire-and-forget notification creation.
   * Called by PostsService, ContactsService, AdoptionsService.
   * Never throws — notification failure must not block the main operation.
   *
   * ## Self-notification guard
   * Silently skips if recipientId equals the actor (don't notify yourself).
   *
   * ## Account isolation guard
   * Persistence rechecks mutual isolation between actor and recipient under
   * the canonical account-pair lock, so an active Block — including one that
   * commits concurrently — suppresses the notification before it is stored.
   *
   * ## Durable push intent
   * Push-enabled types persist their delivery intents in the same transaction
   * as the notification; the push worker sends only after that commit and
   * rechecks preference, account state and isolation again. The worker is
   * nudged as soon as the row commits, so the push arrives within seconds.
   */
  fireNotification(data: NewNotification, actorId?: string): void {
    // Don't notify yourself
    if (actorId && data.recipientId === actorId) return;

    const enqueuePush = isPushDeliveryEnabled(data.type);
    this.notificationsRepository
      .createIfNotIsolated(data, actorId, { enqueuePush })
      .then(() => {
        if (enqueuePush) this.pushDeliveryProcessor?.requestImmediateRun();
      })
      .catch((err) => {
        this.logger.error(
          `Failed to create notification type=${data.type} for recipient=${data.recipientId}`,
          err instanceof Error ? err.stack : String(err),
        );
      });
  }

  /**
   * Returns paginated notifications for the current user, newest first.
   * Also includes the total unread count for the badge indicator.
   *
   * Each node is rendered in the recipient's explicitly synchronized language.
   * Legacy rows without Arabic content keep their stored English text.
   */
  async getMyNotifications(
    userId: string,
    first: number | null | undefined,
    afterCursor: string | null | undefined,
    languagePreference?: string | null,
  ) {
    const limit = clampFirst(first);
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
        node: localizeNotification(notification, languagePreference),
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
   * Renders the returned node in the recipient's synchronized language.
   * @throws {NotFoundError} if the notification doesn't exist or doesn't belong to the user.
   */
  async markRead(notificationId: string, userId: string, languagePreference?: string | null): Promise<Notification> {
    assertUuid(notificationId, 'notificationId');

    const updated = await this.notificationsRepository.markRead(notificationId, userId);
    if (!updated) {
      throw new NotFoundError('Notification', notificationId);
    }
    return localizeNotification(updated, languagePreference);
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
      const parsed = JSON.parse(Buffer.from(cursorBase64, 'base64url').toString('utf8')) as {
        createdAt: string;
        id: string;
      };
      const parsedDate = new Date(parsed.createdAt);
      if (Number.isNaN(parsedDate.getTime()) || typeof parsed.id !== 'string') {
        throw new ValidationError('Invalid cursor format');
      }
      return parsed;
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

import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, and, or, lt, desc, count } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import { notifications, type Notification, type NewNotification } from '../database/schema';

/**
 * NotificationsRepository — data access layer for the notifications table.
 *
 * ## Cursor pagination
 * Uses keyset pagination on (created_at DESC, id DESC) for deterministic
 * ordering. Same limit+1 trick as PostsRepository for hasNextPage detection.
 *
 * ## Index usage
 * - idx_notifications_recipient_time: covers the myNotifications query
 */
@Injectable()
export class NotificationsRepository {
  private readonly logger = new Logger(NotificationsRepository.name);

  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  /**
   * Inserts a new notification row.
   * Called by NotificationsService.fireNotification() — fire-and-forget.
   */
  async create(data: NewNotification): Promise<Notification> {
    const [notification] = await this.db.insert(notifications).values(data).returning();
    return notification;
  }

  /**
   * Fetches paginated notifications for a recipient, newest first.
   * Uses keyset pagination on (created_at, id) for consistency.
   */
  async findByRecipient(parameters: {
    recipientId: string;
    limit: number;
    cursor: { createdAt: string; id: string } | null;
  }): Promise<{ rows: Notification[]; hasNextPage: boolean }> {
    const { recipientId, limit, cursor } = parameters;

    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          cursor
            ? or(
                lt(notifications.createdAt, new Date(cursor.createdAt)),
                and(eq(notifications.createdAt, new Date(cursor.createdAt)), lt(notifications.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit + 1);

    const hasNextPage = rows.length > limit;
    return { rows: hasNextPage ? rows.slice(0, limit) : rows, hasNextPage };
  }

  /**
   * Counts unread notifications for a user.
   * Uses the partial index on is_read = false for fast counts.
   */
  async countUnread(recipientId: string): Promise<number> {
    const [row] = await this.db
      .select({ unreadCount: count() })
      .from(notifications)
      .where(and(eq(notifications.recipientId, recipientId), eq(notifications.isRead, false)));
    return row?.unreadCount ?? 0;
  }

  /**
   * Marks a single notification as read.
   * Verifies recipient ownership — only your own notifications can be marked.
   */
  async markRead(notificationId: string, recipientId: string): Promise<Notification | undefined> {
    const [updated] = await this.db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, notificationId), eq(notifications.recipientId, recipientId)))
      .returning();
    return updated;
  }

  /**
   * Marks all notifications for a user as read.
   * Returns the number of rows updated.
   */
  async markAllRead(recipientId: string): Promise<number> {
    const updatedRows = await this.db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.recipientId, recipientId), eq(notifications.isRead, false)))
      .returning({ id: notifications.id });
    return updatedRows.length;
  }
}

import { Injectable, Inject, Logger } from '@nestjs/common';
import { sql, eq, and } from 'drizzle-orm';
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
  async findByRecipient(params: {
    recipientId: string;
    limit: number;
    cursor: { createdAt: string; id: string } | null;
  }): Promise<{ rows: Notification[]; hasNextPage: boolean }> {
    const { recipientId, limit, cursor } = params;
    const fetchLimit = limit + 1;

    const conditions = [sql`recipient_id = ${recipientId}`];

    if (cursor) {
      conditions.push(sql`(
        created_at < ${cursor.createdAt}::timestamptz
        OR (created_at = ${cursor.createdAt}::timestamptz AND id < ${cursor.id}::uuid)
      )`);
    }

    const whereClause = sql.join(conditions, sql` AND `);

    const result = await this.db.execute(sql`
      SELECT * FROM notifications
      WHERE ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ${fetchLimit}
    `);

    const rawRows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
    const hasNextPage = rawRows.length > limit;
    const trimmed = hasNextPage ? rawRows.slice(0, limit) : rawRows;

    return {
      rows: trimmed.map((raw) => this.mapRawToNotification(raw)),
      hasNextPage,
    };
  }

  /**
   * Counts unread notifications for a user.
   * Uses partial index on is_read = false for fast counts.
   */
  async countUnread(recipientId: string): Promise<number> {
    const result = await this.db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM notifications
      WHERE recipient_id = ${recipientId} AND is_read = false
    `);
    const rows = (result as unknown as { rows: { count: number }[] }).rows;
    return rows[0]?.count ?? 0;
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
    const result = await this.db.execute(sql`
      UPDATE notifications
      SET is_read = true
      WHERE recipient_id = ${recipientId} AND is_read = false
    `);
    return (result as unknown as { rowCount: number }).rowCount ?? 0;
  }

  /**
   * Maps a raw PostgreSQL row (snake_case) to a Notification object (camelCase).
   */
  private mapRawToNotification(raw: Record<string, unknown>): Notification {
    return {
      id: raw.id as string,
      recipientId: raw.recipient_id as string,
      type: raw.type as Notification['type'],
      title: raw.title as string,
      body: raw.body as string,
      relatedPostId: (raw.related_post_id as string) ?? null,
      relatedContactRequestId: (raw.related_contact_request_id as string) ?? null,
      relatedApplicationId: (raw.related_application_id as string) ?? null,
      isRead: raw.is_read as boolean,
      createdAt: new Date(raw.created_at as string),
    };
  }
}

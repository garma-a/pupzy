import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import type { Notification } from '../database/schema';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

/** Drizzle executor: the pooled database handle or a caller-owned transaction. */
export type PushDeliveryExecutor = NodePgDatabase<typeof schema> | DbTransaction;

/**
 * PushDeliveryRepository — durable push intent outbox.
 *
 * `enqueueForNotification` is called inside the notification insert
 * transaction, so a notification and its push intents commit or roll back
 * together. The unique `(notification_id, device_id)` key makes repeated
 * enqueue harmless.
 */
@Injectable()
export class PushDeliveryRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: NodePgDatabase<typeof schema>) {}

  /**
   * Creates one intent per device currently registered to the recipient.
   *
   * The optional actor is stored for the send-time Block recheck. When the
   * recipient has no registered device, no intent is written and the
   * notification remains inbox-only.
   */
  async enqueueForNotification(
    notification: Pick<Notification, 'id' | 'recipientId'>,
    actorId: string | null | undefined,
    executor: PushDeliveryExecutor = this.db,
  ): Promise<number> {
    const result = await executor.execute(sql`
      INSERT INTO push_deliveries (notification_id, recipient_id, actor_id, device_id)
      SELECT ${notification.id}::uuid, ${notification.recipientId}::uuid, ${actorId ?? null}::uuid, d.id
      FROM device_registrations d
      WHERE d.user_id = ${notification.recipientId}::uuid
      ON CONFLICT (notification_id, device_id) DO NOTHING
    `);
    return result.rowCount ?? 0;
  }
}

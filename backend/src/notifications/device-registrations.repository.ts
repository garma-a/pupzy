import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import { deviceRegistrations, pushDeliveries, type DevicePlatform, type DeviceRegistration } from '../database/schema';

/**
 * DeviceRegistrationsRepository — ownership-qualified access to push tokens.
 *
 * Registration is a single transaction: when a different account takes over an
 * existing token, the previous owner's queued push intents for that device are
 * cancelled before ownership moves, so sign-out gaps and token reassignment
 * cannot keep delivering the former account's notifications.
 */
@Injectable()
export class DeviceRegistrationsRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: NodePgDatabase<typeof schema>) {}

  /**
   * Idempotently registers a token for its owner and rotates ownership when a
   * different account registers the same token.
   */
  async register(userId: string, token: string, platform: DevicePlatform): Promise<DeviceRegistration> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(deviceRegistrations)
        .where(eq(deviceRegistrations.token, token))
        .for('update');

      if (existing && existing.userId !== userId) {
        await tx
          .delete(pushDeliveries)
          .where(and(eq(pushDeliveries.deviceId, existing.id), eq(pushDeliveries.recipientId, existing.userId)));
      }

      const [registration] = await tx
        .insert(deviceRegistrations)
        .values({ userId, token, platform })
        .onConflictDoUpdate({
          target: deviceRegistrations.token,
          set: { userId, platform, updatedAt: new Date() },
        })
        .returning();
      return registration;
    });
  }

  /**
   * Removes only the caller's own registration. Returns false when the token is
   * unknown or owned by another account, and never touches another account's
   * row. Deleting the registration cascades any queued push intents.
   */
  async unregister(userId: string, token: string): Promise<boolean> {
    const deleted = await this.db
      .delete(deviceRegistrations)
      .where(and(eq(deviceRegistrations.userId, userId), eq(deviceRegistrations.token, token)))
      .returning({ id: deviceRegistrations.id });
    return deleted.length > 0;
  }
}

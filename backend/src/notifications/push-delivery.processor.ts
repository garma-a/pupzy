import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import { deviceRegistrations, notifications, pushDeliveries, users, type PushDelivery } from '../database/schema';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { withDbRetry } from '../common/utils/db-retry.util';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import { buildPushMessage } from './push-payload';
import { isDeadPushTokenError, PUSH_PROVIDER, type PushDeliveryMessage, type PushProvider } from './push.provider';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

/** Upper bound on intents handled by one worker invocation. */
export const PUSH_DELIVERY_BATCH_SIZE = 50;

/** Bounded provider attempts before an intent becomes terminal FAILED. */
export const MAX_PUSH_DELIVERY_ATTEMPTS = 5;

const PUSH_DELIVERY_LEASE_MS = 60_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;
const MAX_LAST_ERROR_LENGTH = 500;
const EXPIRED_LEASE_FAILURE_MESSAGE = 'Push delivery lease expired after the maximum number of attempts';

/** A claimed intent whose send-time rechecks all passed. */
interface ResolvedPushDelivery {
  id: string;
  deviceId: string;
  leaseToken: string;
  message: PushDeliveryMessage;
}

/**
 * PushDeliveryProcessor — durable, bounded provider delivery for the push
 * intent outbox.
 *
 * ## Ordering
 * Intents are written in the same transaction as their notification, so the
 * worker can only ever see notifications that committed. Sends happen outside
 * database transactions: the durable intent already owns the work.
 *
 * ## Send-time rechecks
 * Before every provider call the worker re-reads the intent, device and
 * recipient under a lease-guarded transaction and terminally suppresses the
 * intent when the recipient disabled pushes, is banned/deleted, the token was
 * unregistered or reassigned, or an active Block now isolates the source actor
 * from the recipient. The in-app notification is never removed by suppression.
 *
 * ## Bounds and failures
 * One invocation handles at most `PUSH_DELIVERY_BATCH_SIZE` intents and each
 * intent is tried at most `MAX_PUSH_DELIVERY_ATTEMPTS` times with exponential
 * backoff. Permanently invalid tokens delete the device registration, which
 * cascades its pending intents. Provider acceptance is not exactly-once: a
 * crash between acceptance and the DELIVERED write may repeat one send.
 */
@Injectable()
export class PushDeliveryProcessor implements OnApplicationBootstrap {
  private readonly logger = new Logger(PushDeliveryProcessor.name);
  private readonly isolationPolicy: AccountIsolationPolicy;
  private isProcessing = false;

  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
    @Inject(PUSH_PROVIDER)
    private readonly provider: PushProvider,
    @Optional()
    @Inject(AccountIsolationPolicy)
    isolationPolicy?: AccountIsolationPolicy,
  ) {
    this.isolationPolicy = isolationPolicy ?? new AccountIsolationPolicy(this.db);
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.processPendingDeliveries();
    } catch (error) {
      this.logger.error('Unable to resume durable push delivery at startup', error);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processScheduledDeliveries(): Promise<void> {
    try {
      await this.processPendingDeliveries();
    } catch (error) {
      this.logger.error('Unable to deliver pending push notifications', error);
    }
  }

  /**
   * Claims and drains one bounded batch. Public for restart, retry and
   * multi-worker fault-injection tests; database leases protect competing API
   * processes.
   */
  async processPendingDeliveries(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    try {
      let delivered = 0;
      for (let index = 0; index < PUSH_DELIVERY_BATCH_SIZE; index++) {
        const delivery = await this.claimNextDelivery();
        if (!delivery) break;

        let resolved: ResolvedPushDelivery | null;
        try {
          resolved = await this.resolveClaimedDelivery(delivery);
        } catch (error) {
          await this.requeueOrFail(delivery, delivery.id, delivery.leaseToken!, this.describeError(error));
          this.logger.error(`Unable to resolve push delivery ${delivery.id}`, error);
          continue;
        }
        if (!resolved) continue;

        try {
          await this.provider.send(resolved.message);
          await this.markDelivered(resolved.id, resolved.leaseToken);
          delivered++;
        } catch (error) {
          await this.handleSendFailure(delivery, resolved, error);
        }
      }
      return delivered;
    } finally {
      this.isProcessing = false;
    }
  }

  private async claimNextDelivery(): Promise<PushDelivery | undefined> {
    return this.db.transaction(async (tx) => {
      // An interrupted intent whose attempts are already exhausted is terminal:
      // reclaiming it after lease expiry would send beyond the attempt bound.
      await tx.execute(sql`
        UPDATE push_deliveries
        SET status = 'FAILED',
            last_error = ${EXPIRED_LEASE_FAILURE_MESSAGE},
            lease_token = NULL,
            lease_expires_at = NULL,
            updated_at = now()
        WHERE status = 'PROCESSING'
          AND (lease_expires_at IS NULL OR lease_expires_at < now())
          AND attempts >= ${MAX_PUSH_DELIVERY_ATTEMPTS}
      `);

      const candidateResult = await tx.execute<{ id: string }>(sql`
        SELECT id
        FROM push_deliveries
        WHERE (
          status = 'PENDING'
          AND next_attempt_at <= now()
          AND attempts < ${MAX_PUSH_DELIVERY_ATTEMPTS}
        ) OR (
          status = 'PROCESSING'
          AND (lease_expires_at IS NULL OR lease_expires_at < now())
          AND attempts < ${MAX_PUSH_DELIVERY_ATTEMPTS}
        )
        ORDER BY next_attempt_at ASC, created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const candidateId = candidateResult.rows[0]?.id;
      if (!candidateId) return undefined;

      const leaseToken = generateUuidV7();
      const now = new Date();
      const [claimed] = await tx
        .update(pushDeliveries)
        .set({
          status: 'PROCESSING',
          attempts: sql`${pushDeliveries.attempts} + 1`,
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + PUSH_DELIVERY_LEASE_MS),
          updatedAt: now,
        })
        .where(eq(pushDeliveries.id, candidateId))
        .returning();
      return claimed;
    });
  }

  /**
   * Re-reads the claimed intent and performs every send-time recheck inside one
   * lease-guarded transaction. Returns null when the intent was lost to another
   * worker or terminally suppressed.
   */
  private async resolveClaimedDelivery(delivery: PushDelivery): Promise<ResolvedPushDelivery | null> {
    return withDbRetry(() =>
      this.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(pushDeliveries)
          .where(eq(pushDeliveries.id, delivery.id))
          .for('update');
        if (
          !current ||
          current.status !== 'PROCESSING' ||
          current.leaseToken !== delivery.leaseToken ||
          !delivery.leaseToken
        ) {
          return null;
        }

        const [recipient] = await tx.select().from(users).where(eq(users.id, current.recipientId)).limit(1);
        if (!recipient || recipient.isBanned || !recipient.notificationsEnabled) {
          await this.markSuppressed(tx, current.id, delivery.leaseToken);
          return null;
        }

        const [device] = await tx
          .select()
          .from(deviceRegistrations)
          .where(eq(deviceRegistrations.id, current.deviceId))
          .for('update')
          .limit(1);
        if (!device || device.userId !== current.recipientId) {
          await this.markSuppressed(tx, current.id, delivery.leaseToken);
          return null;
        }

        // A Block committed after the notification was queued terminates the
        // push while the inbox row survives. The pair lock orders this check
        // with a concurrently committing Block.
        if (
          current.actorId &&
          (await this.isolationPolicy.lockPairAndRecheck(tx, current.actorId, current.recipientId))
        ) {
          await this.markSuppressed(tx, current.id, delivery.leaseToken);
          return null;
        }

        const [notification] = await tx
          .select()
          .from(notifications)
          .where(eq(notifications.id, current.notificationId))
          .limit(1);
        if (!notification) {
          await this.markSuppressed(tx, current.id, delivery.leaseToken);
          return null;
        }

        return {
          id: current.id,
          deviceId: device.id,
          leaseToken: delivery.leaseToken,
          message: buildPushMessage({
            notification,
            languagePreference: recipient.languagePreference,
            token: device.token,
          }),
        };
      }),
    );
  }

  /** Marks a claimed intent as terminally suppressed. Lease-guarded. */
  private async markSuppressed(tx: DbTransaction, deliveryId: string, leaseToken: string): Promise<void> {
    await tx
      .update(pushDeliveries)
      .set({
        status: 'SUPPRESSED',
        lastError: null,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        sql`${pushDeliveries.id} = ${deliveryId} AND ${pushDeliveries.status} = 'PROCESSING' AND ${pushDeliveries.leaseToken} = ${leaseToken}`,
      );
  }

  private async markDelivered(deliveryId: string, leaseToken: string): Promise<void> {
    await this.db
      .update(pushDeliveries)
      .set({
        status: 'DELIVERED',
        deliveredAt: new Date(),
        lastError: null,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        sql`${pushDeliveries.id} = ${deliveryId} AND ${pushDeliveries.status} = 'PROCESSING' AND ${pushDeliveries.leaseToken} = ${leaseToken}`,
      );
  }

  /**
   * Applies the failure policy for one provider rejection: dead tokens delete
   * the device registration, everything else backs off until the attempt bound
   * is exhausted.
   */
  private async handleSendFailure(
    claimed: PushDelivery,
    resolved: ResolvedPushDelivery,
    error: unknown,
  ): Promise<void> {
    const message = this.describeError(error);

    if (isDeadPushTokenError(error)) {
      this.logger.warn(`Removing dead push token for device ${resolved.deviceId}: ${message}`);
      await this.db.delete(deviceRegistrations).where(eq(deviceRegistrations.id, resolved.deviceId));
      return;
    }

    await this.requeueOrFail(claimed, resolved.id, resolved.leaseToken, message);
  }

  /**
   * Bounded retry policy shared by provider failures and internal delivery
   * errors. The lease-guarded condition makes both outcomes safe to repeat and
   * prevents a stale worker from overwriting a newer owner.
   */
  private async requeueOrFail(
    claimed: PushDelivery,
    deliveryId: string,
    leaseToken: string,
    message: string,
  ): Promise<void> {
    if (claimed.attempts >= MAX_PUSH_DELIVERY_ATTEMPTS) {
      this.logger.error(
        `Push delivery ${deliveryId} failed permanently after ${claimed.attempts} attempts: ${message}`,
      );
      await this.db
        .update(pushDeliveries)
        .set({
          status: 'FAILED',
          lastError: message.slice(0, MAX_LAST_ERROR_LENGTH),
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          sql`${pushDeliveries.id} = ${deliveryId} AND ${pushDeliveries.status} = 'PROCESSING' AND ${pushDeliveries.leaseToken} = ${leaseToken}`,
        );
      return;
    }

    const retryDelayMs = Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** Math.min(claimed.attempts, 8));
    this.logger.warn(`Requeueing push delivery ${deliveryId} in ${retryDelayMs}ms: ${message}`);
    await this.db
      .update(pushDeliveries)
      .set({
        status: 'PENDING',
        lastError: `Push send failed; retry scheduled: ${message}`.slice(0, MAX_LAST_ERROR_LENGTH),
        nextAttemptAt: new Date(Date.now() + retryDelayMs),
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        sql`${pushDeliveries.id} = ${deliveryId} AND ${pushDeliveries.status} = 'PROCESSING' AND ${pushDeliveries.leaseToken} = ${leaseToken}`,
      );
  }

  /** Provider failures never echo the token; keep messages bounded for storage. */
  private describeError(error: unknown): string {
    if (error instanceof Error) {
      const code = (error as { code?: unknown }).code;
      return typeof code === 'string' ? `${code}: ${error.message}` : error.message;
    }
    return String(error);
  }
}

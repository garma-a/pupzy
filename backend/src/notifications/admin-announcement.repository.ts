import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import { announcements, type Announcement } from '../database/schema';
import { positionalSql } from '../common/utils/positional-sql.util';
import { ELIGIBLE_AUDIENCE_PREDICATE, MAX_ANNOUNCEMENT_ATTEMPTS, audienceValues } from './admin-announcement.contract';
import { isPushDeliveryEnabled } from './push-delivery.constants';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

/** What one fan-out batch did. */
export interface AnnouncementBatchOutcome {
  /** Eligible accounts read by this batch (at most the batch size). */
  scanned: number;
  /** In-app notifications created (conflicts with an existing one are not counted). */
  notified: number;
  /** Push delivery intents created. */
  intents: number;
  /** Highest `users.id` read; the next batch starts after it. */
  lastUserId: string | null;
  /** True when the batch reached the end of the audience. */
  completed: boolean;
}

/**
 * AdminAnnouncementRepository — the set-oriented SQL behind the Announcement
 * fan-out.
 *
 * One batch is a single statement: it reads the next page of eligible accounts
 * (by `users.id`, after the announcement's cursor), inserts their notifications
 * and inserts the push delivery intents of the opted-in recipients with a
 * device. Everything runs in the caller's transaction, which also advances the
 * cursor, so a notification and its intents commit or roll back together.
 *
 * The eligibility predicate is the one the admin service uses for the
 * confirmation count (`ELIGIBLE_AUDIENCE_PREDICATE`).
 */
@Injectable()
export class AdminAnnouncementRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: NodePgDatabase<typeof schema>) {}

  /**
   * Locks the oldest due unfinished announcement for the length of the caller's
   * transaction. `SKIP LOCKED` means a second worker (another API instance)
   * takes the next one instead of waiting or repeating a batch.
   */
  async claimNext(tx: DbTransaction): Promise<Announcement | null> {
    const result = await tx.execute<Record<string, unknown>>(sql`
      SELECT id FROM announcements
      WHERE status IN ('PENDING', 'SENDING') AND next_attempt_at <= now()
      ORDER BY created_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const id = result.rows[0]?.id as string | undefined;
    if (!id) return null;
    const [row] = await tx.select().from(announcements).where(eq(announcements.id, id)).limit(1);
    return row ?? null;
  }

  /**
   * Fans out the next page of the announcement's audience.
   *
   * `ON CONFLICT` on `(announcement_id, recipient_id)` is the idempotency
   * guard: re-walking a range creates no second notification, and because its
   * intents are inserted only for notifications this statement created, no
   * second intent either.
   */
  async fanOutBatch(
    tx: DbTransaction,
    announcement: Announcement,
    batchSize: number,
  ): Promise<AnnouncementBatchOutcome> {
    const audience = audienceValues({
      cutoff: announcement.audienceCutoffAt,
      audience: announcement.audience,
      cityId: announcement.audienceCityId,
    });
    const text = `
      WITH batch AS (
        SELECT u.id, u.notifications_enabled
        FROM users u
        WHERE ${ELIGIBLE_AUDIENCE_PREDICATE}
          AND ($4::uuid IS NULL OR u.id > $4::uuid)
        ORDER BY u.id
        LIMIT $5
      ), inserted AS (
        INSERT INTO notifications (recipient_id, type, title, body, title_arabic, body_arabic, announcement_id)
        SELECT b.id, 'ADMIN_ANNOUNCEMENT'::notification_type, $6::text, $7::text, $8::text, $9::text, $10::uuid
        FROM batch b
        ON CONFLICT (announcement_id, recipient_id) WHERE announcement_id IS NOT NULL DO NOTHING
        RETURNING id, recipient_id
      ), intents AS (
        INSERT INTO push_deliveries (notification_id, recipient_id, actor_id, device_id)
        SELECT i.id, i.recipient_id, NULL, d.id
        FROM inserted i
        JOIN batch b ON b.id = i.recipient_id
        JOIN device_registrations d ON d.user_id = i.recipient_id
        WHERE $11::boolean AND b.notifications_enabled
        ON CONFLICT (notification_id, device_id) DO NOTHING
        RETURNING id
      )
      SELECT (SELECT count(*)::int FROM batch) AS scanned,
             (SELECT count(*)::int FROM inserted) AS notified,
             (SELECT count(*)::int FROM intents) AS intents,
             (SELECT id FROM batch ORDER BY id DESC LIMIT 1) AS last_user_id`;
    const values = [
      ...audience, // $1 cutoff, $2 audience, $3 City
      announcement.cursorUserId, // $4
      batchSize, // $5
      announcement.titleEn, // $6
      announcement.bodyEn, // $7
      announcement.titleAr, // $8
      announcement.bodyAr, // $9
      announcement.id, // $10
      isPushDeliveryEnabled('ADMIN_ANNOUNCEMENT'), // $11
    ];
    const result = await tx.execute<{
      scanned: number;
      notified: number;
      intents: number;
      last_user_id: string | null;
    }>(positionalSql(text, values));
    const row = result.rows[0];
    return {
      scanned: row.scanned,
      notified: row.notified,
      intents: row.intents,
      lastUserId: row.last_user_id,
      completed: row.scanned < batchSize,
    };
  }

  /**
   * Advances the cursor and counters in the batch's own transaction. A short
   * batch (fewer accounts than the batch size) is the end of the audience, so
   * the same transaction marks the announcement SENT.
   */
  async recordProgress(
    tx: DbTransaction,
    announcement: Announcement,
    outcome: AnnouncementBatchOutcome,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE announcements
      SET status = ${outcome.completed ? 'SENT' : 'SENDING'}::announcement_status,
          cursor_user_id = COALESCE(${outcome.lastUserId}::uuid, cursor_user_id),
          in_app_count = in_app_count + ${outcome.notified},
          push_intent_count = push_intent_count + ${outcome.intents},
          attempts = 0,
          last_error = NULL,
          started_at = COALESCE(started_at, now()),
          completed_at = ${outcome.completed ? sql`now()` : sql`NULL`},
          updated_at = now()
      WHERE id = ${announcement.id}::uuid
    `);
  }

  /**
   * Records a failed batch after its transaction rolled back. Backs off
   * exponentially (capped at five minutes) and, after
   * `MAX_ANNOUNCEMENT_ATTEMPTS` consecutive failures, ends the announcement as
   * FAILED with the reason. What earlier batches delivered stays delivered.
   */
  async recordFailure(announcementId: string, error: unknown): Promise<void> {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await this.db.execute(sql`
      UPDATE announcements
      SET attempts = attempts + 1,
          last_error = ${message},
          next_attempt_at = now() + make_interval(secs => LEAST(300, power(2, attempts))),
          status = CASE WHEN attempts + 1 >= ${MAX_ANNOUNCEMENT_ATTEMPTS} THEN 'FAILED' ELSE status END,
          failure_reason = CASE WHEN attempts + 1 >= ${MAX_ANNOUNCEMENT_ATTEMPTS} THEN ${message} ELSE failure_reason END,
          completed_at = CASE WHEN attempts + 1 >= ${MAX_ANNOUNCEMENT_ATTEMPTS} THEN now() ELSE completed_at END,
          updated_at = now()
      WHERE id = ${announcementId}::uuid AND status IN ('PENDING', 'SENDING')
    `);
  }
}

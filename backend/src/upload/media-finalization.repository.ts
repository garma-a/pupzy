import { Inject, Injectable } from '@nestjs/common';
import { eq, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import { mediaFinalizations, type MediaFinalization, type NewMediaFinalization } from '../database/schema';

/**
 * How long an `IN_FLIGHT` obligation stays trusted without a heartbeat.
 *
 * The R2 client bounds every request (15s) and retries (3 attempts), and a
 * finalization performs at most three sequential operations, so a live
 * finalization heartbeats well within this window. Only a process that can no
 * longer be copying — crash, forced shutdown, multi-minute pause — lets an
 * obligation go stale, at which point account deletion may clean its objects.
 */
export const MEDIA_FINALIZATION_LEASE_MS = 5 * 60_000;

/**
 * How long an obligation may exist before the maintenance cron treats it as an
 * abandoned orphan. Stale `IN_FLIGHT` rows are dropped after this window (the
 * surviving post still owns its object and account deletion captures the key
 * from `post_media`); stale `COMPENSATION_REQUIRED` rows are retried until the
 * object is gone.
 */
export const MEDIA_FINALIZATION_ORPHAN_TTL_MS = 24 * 60 * 60_000;

/**
 * `MediaFinalizationRepository` — durable access to media-finalization obligations.
 * See `media-finalizations.schema.ts` for the lifecycle rationale.
 */
@Injectable()
export class MediaFinalizationRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: NodePgDatabase<Record<string, unknown>>) {}

  async create(data: NewMediaFinalization, tx?: NodePgDatabase<Record<string, unknown>>): Promise<MediaFinalization> {
    const executor = tx ?? this.db;
    const [record] = await executor.insert(mediaFinalizations).values(data).returning();
    return record;
  }

  async findById(id: string): Promise<MediaFinalization | undefined> {
    const [record] = await this.db.select().from(mediaFinalizations).where(eq(mediaFinalizations.id, id)).limit(1);
    return record;
  }

  async findByUserId(userId: string): Promise<MediaFinalization[]> {
    return this.db.select().from(mediaFinalizations).where(eq(mediaFinalizations.userId, userId));
  }

  /**
   * Renews the lease so a live finalization is never mistaken for a crash.
   *
   * @throws {Error} when the obligation no longer exists, so a finalization
   * whose row was force-resolved stops copying instead of recreating an object
   * that account deletion already swept.
   */
  async touch(id: string): Promise<void> {
    const rows = await this.db
      .update(mediaFinalizations)
      .set({ updatedAt: sql`now()` })
      .where(eq(mediaFinalizations.id, id))
      .returning({ id: mediaFinalizations.id });
    if (rows.length === 0) {
      throw new Error(`Media finalization obligation ${id} is no longer active`);
    }
  }

  /**
   * Moves an obligation to `COMPENSATION_REQUIRED`, recording the reason so
   * operators can see why the permanent object must be removed.
   */
  async markCompensationRequired(id: string, lastError?: string): Promise<void> {
    await this.db
      .update(mediaFinalizations)
      .set({
        status: 'COMPENSATION_REQUIRED',
        lastError: lastError ?? null,
        updatedAt: sql`now()`,
      })
      .where(eq(mediaFinalizations.id, id));
  }

  /** Records a resolution error while keeping the obligation retryable. */
  async recordError(id: string, lastError: string): Promise<void> {
    await this.db
      .update(mediaFinalizations)
      .set({ lastError, updatedAt: sql`now()` })
      .where(eq(mediaFinalizations.id, id));
  }

  /** Returns obligations whose last heartbeat predates the given timestamp. */
  async findStale(updatedBefore: Date, limit = 20): Promise<MediaFinalization[]> {
    return this.db
      .select()
      .from(mediaFinalizations)
      .where(lte(mediaFinalizations.updatedAt, updatedBefore))
      .orderBy(mediaFinalizations.updatedAt)
      .limit(limit);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(mediaFinalizations).where(eq(mediaFinalizations.id, id));
  }
}

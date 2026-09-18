import { and, eq, gte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { commentQuotaAdmissions, commentReports, postReports } from '../database/schema';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { AppError } from '../common/errors/app.errors';

type DrizzleDB = NodePgDatabase<typeof schema>;
type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];
type DbExecutor = DrizzleDB | DbTransaction;

/** Durable admission action for the shared moderation-report allowance. */
export const MODERATION_REPORT_ACTION = 'MODERATION_REPORT';

/**
 * Admissions recorded by Comment Reports before the shared seam existed.
 * They stay part of the rolling count so alternating report types cannot
 * bypass the allowance during rollout.
 */
export const HISTORICAL_COMMENT_REPORT_ACTION = 'COMMENT_REPORT';

/** One reporting Pupzy Account may commit ten moderation reports per rolling 24 hours. */
export const MODERATION_REPORT_DAILY_LIMIT = 10;

export interface ReportQuotaReservation {
  admissionId: string;
  /** Removes the reservation after the report work fails or is rejected. */
  rollback: () => Promise<void>;
}

/**
 * ModerationReportQuotaManager is the single admission seam for every
 * moderation report type: Comment Reports today, Post Reports and Pupzy
 * Account Reports on the same durable budget. Validators, duplicate checks,
 * and report inserts stay with their own modules; only the allowance lives
 * here.
 *
 * Admission runs in a short transaction guarded by a per-reporter PostgreSQL
 * advisory xact lock, so concurrent report types serialize against each other
 * across processes. A caller commits its report by inserting its row with
 * `id = reservation.admissionId`; quota counting links the admission to that
 * row, so a report is counted exactly once whether it is in flight to
 * commit or already committed. Admission rows persist and rollback deletes
 * only the reservation of work that failed or was rejected.
 *
 * The rolling 24-hour count is:
 * - one slot per admission row (successfully committed or still in flight),
 * - plus committed report rows that never admitted through this seam, with
 *   historical Comment Report admissions and unmatched Comment Report rows
 *   collapsed to their larger, conservative count.
 */
export class ModerationReportQuotaManager {
  constructor(private readonly db: DrizzleDB) {}

  /**
   * Reserves one slot of the shared allowance for `reporterId`.
   * Throws `RATE_LIMITED` at the ten-report rolling 24-hour boundary.
   */
  async reserveReportAllowance(reporterId: string): Promise<ReportQuotaReservation> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('comment_quota'), hashtext(${reporterId} || ':MODERATION_REPORT'))`,
      );

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const effectiveCount = await this.countRecentReports(tx, reporterId, oneDayAgo);

      if (effectiveCount >= MODERATION_REPORT_DAILY_LIMIT) {
        throw new AppError(`Daily report limit reached (${MODERATION_REPORT_DAILY_LIMIT} per day)`, 'RATE_LIMITED');
      }

      const admissionId = generateUuidV7();
      await tx.insert(commentQuotaAdmissions).values({
        id: admissionId,
        userId: reporterId,
        action: MODERATION_REPORT_ACTION,
        createdAt: new Date(),
      });

      return {
        admissionId,
        rollback: () => this.release(admissionId),
      };
    });
  }

  /**
   * Removes a reservation after its report work fails or is rejected. Kept
   * idempotent and non-throwing: a stale reservation can only make the
   * allowance more conservative, never bypass it.
   */
  async release(admissionId: string): Promise<void> {
    if (!admissionId) return;
    await this.db
      .delete(commentQuotaAdmissions)
      .where(eq(commentQuotaAdmissions.id, admissionId))
      .catch(() => {});
  }

  private async countRecentReports(tx: DbExecutor, reporterId: string, since: Date): Promise<number> {
    const [admissions] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(commentQuotaAdmissions)
      .where(
        and(
          eq(commentQuotaAdmissions.userId, reporterId),
          eq(commentQuotaAdmissions.action, MODERATION_REPORT_ACTION),
          gte(commentQuotaAdmissions.createdAt, since),
        ),
      );

    const [historicalAdmissions] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(commentQuotaAdmissions)
      .where(
        and(
          eq(commentQuotaAdmissions.userId, reporterId),
          eq(commentQuotaAdmissions.action, HISTORICAL_COMMENT_REPORT_ACTION),
          gte(commentQuotaAdmissions.createdAt, since),
        ),
      );

    const [unadmittedCommentRows] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(commentReports)
      .where(
        and(
          eq(commentReports.reporterId, reporterId),
          gte(commentReports.createdAt, since),
          sql`NOT EXISTS (
            SELECT 1 FROM ${commentQuotaAdmissions}
            WHERE ${commentQuotaAdmissions.id} = ${commentReports.id}
              AND ${commentQuotaAdmissions.action} = ${MODERATION_REPORT_ACTION}
          )`,
        ),
      );

    const [unadmittedPostRows] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(postReports)
      .where(
        and(
          eq(postReports.reporterId, reporterId),
          gte(postReports.createdAt, since),
          sql`NOT EXISTS (
            SELECT 1 FROM ${commentQuotaAdmissions}
            WHERE ${commentQuotaAdmissions.id} = ${postReports.id}
              AND ${commentQuotaAdmissions.action} = ${MODERATION_REPORT_ACTION}
          )`,
        ),
      );

    // Paired historical admissions and their report rows collapse to one
    // slot; crash orphans and rows recorded outside this seam stay counted.
    const historicalCommentSlots = Math.max(historicalAdmissions?.count ?? 0, unadmittedCommentRows?.count ?? 0);

    // Add committed Pupzy Account Report rows here when their table lands.
    // Never introduce a second admission method or allowance.
    return (admissions?.count ?? 0) + historicalCommentSlots + (unadmittedPostRows?.count ?? 0);
  }
}

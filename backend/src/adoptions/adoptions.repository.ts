import { Injectable, Inject, Logger } from '@nestjs/common';
import { sql, eq, and, or, lt, desc, getTableColumns, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import { adoptionApplications, posts, type AdoptionApplication, type NewAdoptionApplication } from '../database/schema';
import { ConflictError } from '../common/errors/app.errors';
import { excludeIsolatedAccounts } from '../blocks/account-isolation.sql';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

/** Drizzle executor: the pooled database handle or a caller-owned transaction. */
export type AdoptionsExecutor = NodePgDatabase<typeof schema> | DbTransaction;

/**
 * AdoptionsRepository — data access for the adoption_applications table.
 */
@Injectable()
export class AdoptionsRepository {
  private readonly logger = new Logger(AdoptionsRepository.name);

  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Creates a new adoption application.
   *
   * Accepts a caller-owned transaction so isolation-sensitive callers can
   * insert while holding the canonical account-pair lock.
   */
  async create(data: NewAdoptionApplication, executor: AdoptionsExecutor = this.db): Promise<AdoptionApplication> {
    try {
      const [application] = await executor.insert(adoptionApplications).values(data).returning();
      return application;
    } catch (error) {
      const pgErr = error as { code?: string; constraint?: string };
      if (pgErr.code === '23505' || pgErr.constraint === 'unique_adoption_application_per_post_and_applicant') {
        throw new ConflictError('You have already submitted an application for this post');
      }
      throw error;
    }
  }

  /**
   * Finds an adoption application by ID.
   */
  async findById(applicationId: string): Promise<AdoptionApplication | undefined> {
    const [application] = await this.db
      .select()
      .from(adoptionApplications)
      .where(eq(adoptionApplications.id, applicationId))
      .limit(1);
    return application;
  }

  /**
   * Checks if a user already has an application on a post.
   */
  async findExisting(targetPostId: string, applicantId: string): Promise<AdoptionApplication | undefined> {
    const [existing] = await this.db
      .select()
      .from(adoptionApplications)
      .where(
        and(eq(adoptionApplications.targetPostId, targetPostId), eq(adoptionApplications.applicantId, applicantId)),
      )
      .limit(1);
    return existing;
  }

  /**
   * Updates an application status (PENDING → APPROVED or REJECTED).
   * Atomic guard: only a row still in PENDING can transition. If the row was
   * concurrently transitioned by another request, the UPDATE matches 0 rows and
   * this returns undefined — the service converts that to a ConflictError.
   *
   * Accepts a caller-owned transaction so an approval can recheck account
   * isolation and transition the row atomically under the pair lock.
   */
  async updateStatus(
    applicationId: string,
    status: 'APPROVED' | 'REJECTED',
    executor: AdoptionsExecutor = this.db,
  ): Promise<AdoptionApplication | undefined> {
    const [updated] = await executor
      .update(adoptionApplications)
      .set({
        status,
        respondedAt: sql`now()`,
      })
      .where(and(eq(adoptionApplications.id, applicationId), eq(adoptionApplications.status, 'PENDING')))
      .returning();
    return updated;
  }

  /**
   * Paginated fetch of applications submitted BY a user.
   *
   * Applications targeting a Post whose creator is isolated from the viewer
   * are filtered in SQL before the limit, so preserved history never reaches a
   * user-facing list and pages stay dense.
   */
  async findByApplicant(parameters: {
    applicantId: string;
    viewerId?: string | null;
    limit: number;
    cursor: { createdAt: string; id: string } | null;
  }): Promise<{ rows: AdoptionApplication[]; hasNextPage: boolean }> {
    const { applicantId, limit, cursor } = parameters;
    const viewerId = parameters.viewerId ?? applicantId;

    const rows = await this.db
      .select({ ...getTableColumns(adoptionApplications) })
      .from(adoptionApplications)
      .innerJoin(posts, eq(posts.id, adoptionApplications.targetPostId))
      .where(
        and(
          eq(adoptionApplications.applicantId, applicantId),
          excludeIsolatedAccounts(viewerId, posts.creatorId),
          cursor
            ? or(
                lt(adoptionApplications.createdAt, new Date(cursor.createdAt)),
                and(
                  eq(adoptionApplications.createdAt, new Date(cursor.createdAt)),
                  lt(adoptionApplications.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(adoptionApplications.createdAt), desc(adoptionApplications.id))
      .limit(limit + 1);

    const hasNextPage = rows.length > limit;
    return { rows: hasNextPage ? rows.slice(0, limit) : rows, hasNextPage };
  }

  /**
   * Paginated fetch of applications ON a specific post.
   * Used by the post owner to review incoming applications.
   *
   * Applications authored by an account isolated from the viewer are filtered
   * in SQL before the limit, so the owner never sees preserved records across
   * a Block while history remains intact.
   */
  async findByPost(parameters: {
    targetPostId: string;
    viewerId?: string | null;
    status?: string | null;
    limit: number;
    cursor: { createdAt: string; id: string } | null;
  }): Promise<{ rows: AdoptionApplication[]; hasNextPage: boolean }> {
    const { targetPostId, status, limit, cursor } = parameters;

    const rows = await this.db
      .select()
      .from(adoptionApplications)
      .where(
        and(
          eq(adoptionApplications.targetPostId, targetPostId),
          excludeIsolatedAccounts(parameters.viewerId, adoptionApplications.applicantId),
          status ? eq(adoptionApplications.status, status as AdoptionApplication['status']) : undefined,
          cursor
            ? or(
                lt(adoptionApplications.createdAt, new Date(cursor.createdAt)),
                and(
                  eq(adoptionApplications.createdAt, new Date(cursor.createdAt)),
                  lt(adoptionApplications.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(adoptionApplications.createdAt), desc(adoptionApplications.id))
      .limit(limit + 1);

    const hasNextPage = rows.length > limit;
    return { rows: hasNextPage ? rows.slice(0, limit) : rows, hasNextPage };
  }

  /**
   * Rejects every PENDING adoption application between two accounts, in both
   * directions, without deleting rows. Already-approved history is untouched
   * (and is hidden by list/disclosure predicates while the Block remains).
   * Must run on a caller-owned transaction so the Block, the rejections, and
   * any pair lock commit atomically.
   */
  async rejectPendingBetweenAccounts(
    firstAccountId: string,
    secondAccountId: string,
    executor: AdoptionsExecutor,
  ): Promise<number> {
    if (firstAccountId === secondAccountId) return 0;

    let rejected = 0;
    const directions = [
      [firstAccountId, secondAccountId],
      [secondAccountId, firstAccountId],
    ] as const;

    for (const [applicantId, creatorId] of directions) {
      const updated = await executor
        .update(adoptionApplications)
        .set({ status: 'REJECTED', respondedAt: sql`now()` })
        .where(
          and(
            eq(adoptionApplications.status, 'PENDING'),
            eq(adoptionApplications.applicantId, applicantId),
            inArray(
              adoptionApplications.targetPostId,
              executor.select({ id: posts.id }).from(posts).where(eq(posts.creatorId, creatorId)),
            ),
          ),
        )
        .returning({ id: adoptionApplications.id });
      rejected += updated.length;
    }

    return rejected;
  }
}

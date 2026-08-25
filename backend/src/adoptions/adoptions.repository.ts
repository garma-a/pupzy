import { Injectable, Inject, Logger } from '@nestjs/common';
import { sql, eq, and, or, lt, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import { adoptionApplications, type AdoptionApplication, type NewAdoptionApplication } from '../database/schema';
import { ConflictError } from '../common/errors/app.errors';

/**
 * AdoptionsRepository — data access for the adoption_applications table.
 */
@Injectable()
export class AdoptionsRepository {
  private readonly logger = new Logger(AdoptionsRepository.name);

  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  /**
   * Creates a new adoption application.
   */
  async create(data: NewAdoptionApplication): Promise<AdoptionApplication> {
    try {
      const [application] = await this.db.insert(adoptionApplications).values(data).returning();
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
   */
  async updateStatus(applicationId: string, status: 'APPROVED' | 'REJECTED'): Promise<AdoptionApplication | undefined> {
    const [updated] = await this.db
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
   */
  async findByApplicant(parameters: {
    applicantId: string;
    limit: number;
    cursor: { createdAt: string; id: string } | null;
  }): Promise<{ rows: AdoptionApplication[]; hasNextPage: boolean }> {
    const { applicantId, limit, cursor } = parameters;

    const rows = await this.db
      .select()
      .from(adoptionApplications)
      .where(
        and(
          eq(adoptionApplications.applicantId, applicantId),
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
   */
  async findByPost(parameters: {
    targetPostId: string;
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
}

import { Injectable, Inject, Logger } from '@nestjs/common';
import { sql, eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import { adoptionApplications, type AdoptionApplication, type NewAdoptionApplication } from '../database/schema';

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
    const [application] = await this.db.insert(adoptionApplications).values(data).returning();
    return application;
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
   */
  async updateStatus(applicationId: string, status: 'APPROVED' | 'REJECTED'): Promise<AdoptionApplication | undefined> {
    const [updated] = await this.db
      .update(adoptionApplications)
      .set({
        status,
        respondedAt: sql`now()`,
      })
      .where(eq(adoptionApplications.id, applicationId))
      .returning();
    return updated;
  }

  /**
   * Paginated fetch of applications submitted BY a user.
   */
  async findByApplicant(params: {
    applicantId: string;
    limit: number;
    cursor: { createdAt: string; id: string } | null;
  }): Promise<{ rows: AdoptionApplication[]; hasNextPage: boolean }> {
    const { applicantId, limit, cursor } = params;
    const fetchLimit = limit + 1;

    const conditions = [sql`applicant_id = ${applicantId}`];
    if (cursor) {
      conditions.push(sql`(
        created_at < ${cursor.createdAt}::timestamptz
        OR (created_at = ${cursor.createdAt}::timestamptz AND id < ${cursor.id}::uuid)
      )`);
    }

    const whereClause = sql.join(conditions, sql` AND `);
    const result = await this.db.execute(sql`
      SELECT * FROM adoption_applications
      WHERE ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ${fetchLimit}
    `);

    const rawRows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
    const hasNextPage = rawRows.length > limit;
    const trimmed = hasNextPage ? rawRows.slice(0, limit) : rawRows;

    return {
      rows: trimmed.map((raw) => this.mapRaw(raw)),
      hasNextPage,
    };
  }

  /**
   * Paginated fetch of applications ON a specific post.
   * Used by the post owner to review incoming applications.
   */
  async findByPost(params: {
    targetPostId: string;
    status?: string | null;
    limit: number;
    cursor: { createdAt: string; id: string } | null;
  }): Promise<{ rows: AdoptionApplication[]; hasNextPage: boolean }> {
    const { targetPostId, status, limit, cursor } = params;
    const fetchLimit = limit + 1;

    const conditions = [sql`target_post_id = ${targetPostId}`];
    if (status) conditions.push(sql`status = ${status}`);
    if (cursor) {
      conditions.push(sql`(
        created_at < ${cursor.createdAt}::timestamptz
        OR (created_at = ${cursor.createdAt}::timestamptz AND id < ${cursor.id}::uuid)
      )`);
    }

    const whereClause = sql.join(conditions, sql` AND `);
    const result = await this.db.execute(sql`
      SELECT * FROM adoption_applications
      WHERE ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ${fetchLimit}
    `);

    const rawRows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
    const hasNextPage = rawRows.length > limit;
    const trimmed = hasNextPage ? rawRows.slice(0, limit) : rawRows;

    return {
      rows: trimmed.map((raw) => this.mapRaw(raw)),
      hasNextPage,
    };
  }

  /**
   * Maps a raw PostgreSQL row to an AdoptionApplication object.
   * Check the actual schema columns from the schema file you read.
   */
  private mapRaw(raw: Record<string, unknown>): AdoptionApplication {
    return {
      id: raw.id as string,
      targetPostId: raw.target_post_id as string,
      applicantId: raw.applicant_id as string,
      status: raw.status as AdoptionApplication['status'],
      speciesPreference: (raw.species_preference as AdoptionApplication['speciesPreference']) ?? null,
      breedPreference: (raw.breed_preference as string) ?? null,
      agePreference: (raw.age_preference as string) ?? null,
      genderPreference: (raw.gender_preference as AdoptionApplication['genderPreference']) ?? null,
      livingSituation: raw.living_situation as AdoptionApplication['livingSituation'],
      hasOutdoorAccess: raw.has_outdoor_access as boolean,
      hasOtherPetsAtHome: raw.has_other_pets_at_home as boolean,
      hasChildrenAtHome: raw.has_children_at_home as boolean,
      hoursAtHomePerDay: (raw.hours_at_home_per_day as number) ?? null,
      previousPetExperience: (raw.previous_pet_experience as string) ?? null,
      whyAdopt: raw.why_adopt as string,
      consentHomeVisit: raw.consent_home_visit as boolean,
      canProvideVetReference: raw.can_provide_vet_reference as boolean,
      respondedAt: raw.responded_at ? new Date(raw.responded_at as string) : null,
      createdAt: new Date(raw.created_at as string),
    };
  }
}

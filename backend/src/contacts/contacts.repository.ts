import { Injectable, Inject, Logger } from '@nestjs/common';
import { sql, eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import { contactRequests, type ContactRequest, type NewContactRequest } from '../database/schema';

/**
 * ContactsRepository — data access for the contact_requests table.
 */
@Injectable()
export class ContactsRepository {
  private readonly logger = new Logger(ContactsRepository.name);

  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  /**
   * Creates a new contact request.
   * The DB unique constraint (uq_contact_request) prevents duplicates.
   */
  async create(data: NewContactRequest): Promise<ContactRequest> {
    const [request] = await this.db.insert(contactRequests).values(data).returning();
    return request;
  }

  /**
   * Finds a contact request by ID.
   */
  async findById(requestId: string): Promise<ContactRequest | undefined> {
    const [request] = await this.db.select().from(contactRequests).where(eq(contactRequests.id, requestId)).limit(1);
    return request;
  }

  /**
   * Checks if a user already has a contact request on a post.
   */
  async findExisting(postId: string, requesterId: string): Promise<ContactRequest | undefined> {
    const [existing] = await this.db
      .select()
      .from(contactRequests)
      .where(and(eq(contactRequests.postId, postId), eq(contactRequests.requesterId, requesterId)))
      .limit(1);
    return existing;
  }

  /**
   * Updates a contact request status (PENDING → APPROVED or REJECTED).
   * Also sets respondedAt timestamp.
   */
  async updateStatus(requestId: string, status: 'APPROVED' | 'REJECTED'): Promise<ContactRequest | undefined> {
    const [updated] = await this.db
      .update(contactRequests)
      .set({
        status,
        respondedAt: sql`now()`,
      })
      .where(eq(contactRequests.id, requestId))
      .returning();
    return updated;
  }

  /**
   * Paginated fetch of contact requests sent BY a user.
   * Cursor: { createdAt, id } keyset pagination.
   */
  async findByRequester(params: {
    requesterId: string;
    postId?: string | null;
    status?: string | null;
    limit: number;
    cursor: { createdAt: string; id: string } | null;
  }): Promise<{ rows: ContactRequest[]; hasNextPage: boolean }> {
    const { requesterId, postId, status, limit, cursor } = params;
    const fetchLimit = limit + 1;

    const conditions = [sql`requester_id = ${requesterId}`];
    if (postId) conditions.push(sql`post_id = ${postId}`);
    if (status) conditions.push(sql`status = ${status}`);
    if (cursor) {
      conditions.push(sql`(
        created_at < ${cursor.createdAt}::timestamptz
        OR (created_at = ${cursor.createdAt}::timestamptz AND id < ${cursor.id}::uuid)
      )`);
    }

    const whereClause = sql.join(conditions, sql` AND `);
    const result = await this.db.execute(sql`
      SELECT * FROM contact_requests
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
   * Paginated fetch of contact requests ON a specific post.
   * Used by the post owner to review incoming requests.
   */
  async findByPost(params: {
    postId: string;
    status?: string | null;
    limit: number;
    cursor: { createdAt: string; id: string } | null;
  }): Promise<{ rows: ContactRequest[]; hasNextPage: boolean }> {
    const { postId, status, limit, cursor } = params;
    const fetchLimit = limit + 1;

    const conditions = [sql`post_id = ${postId}`];
    if (status) conditions.push(sql`status = ${status}`);
    if (cursor) {
      conditions.push(sql`(
        created_at < ${cursor.createdAt}::timestamptz
        OR (created_at = ${cursor.createdAt}::timestamptz AND id < ${cursor.id}::uuid)
      )`);
    }

    const whereClause = sql.join(conditions, sql` AND `);
    const result = await this.db.execute(sql`
      SELECT * FROM contact_requests
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
   * Maps a raw PostgreSQL row to a ContactRequest object.
   */
  private mapRaw(raw: Record<string, unknown>): ContactRequest {
    return {
      id: raw.id as string,
      postId: raw.post_id as string,
      requesterId: raw.requester_id as string,
      message: raw.message as string,
      status: raw.status as ContactRequest['status'],
      respondedAt: raw.responded_at ? new Date(raw.responded_at as string) : null,
      createdAt: new Date(raw.created_at as string),
    };
  }
}

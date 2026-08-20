import { Injectable, Inject, Logger } from '@nestjs/common';
import { sql, eq, and, or, lt, desc } from 'drizzle-orm';
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
  async findByRequester(parameters: {
    requesterId: string;
    postId?: string | null;
    status?: string | null;
    limit: number;
    cursor: { createdAt: string; id: string } | null;
  }): Promise<{ rows: ContactRequest[]; hasNextPage: boolean }> {
    const { requesterId, postId, status, limit, cursor } = parameters;

    const rows = await this.db
      .select()
      .from(contactRequests)
      .where(
        and(
          eq(contactRequests.requesterId, requesterId),
          postId ? eq(contactRequests.postId, postId) : undefined,
          status ? eq(contactRequests.status, status as ContactRequest['status']) : undefined,
          cursor
            ? or(
                lt(contactRequests.createdAt, new Date(cursor.createdAt)),
                and(eq(contactRequests.createdAt, new Date(cursor.createdAt)), lt(contactRequests.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(contactRequests.createdAt), desc(contactRequests.id))
      .limit(limit + 1);

    const hasNextPage = rows.length > limit;
    return { rows: hasNextPage ? rows.slice(0, limit) : rows, hasNextPage };
  }

  /**
   * Paginated fetch of contact requests ON a specific post.
   * Used by the post owner to review incoming requests.
   */
  async findByPost(parameters: {
    postId: string;
    status?: string | null;
    limit: number;
    cursor: { createdAt: string; id: string } | null;
  }): Promise<{ rows: ContactRequest[]; hasNextPage: boolean }> {
    const { postId, status, limit, cursor } = parameters;

    const rows = await this.db
      .select()
      .from(contactRequests)
      .where(
        and(
          eq(contactRequests.postId, postId),
          status ? eq(contactRequests.status, status as ContactRequest['status']) : undefined,
          cursor
            ? or(
                lt(contactRequests.createdAt, new Date(cursor.createdAt)),
                and(eq(contactRequests.createdAt, new Date(cursor.createdAt)), lt(contactRequests.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(contactRequests.createdAt), desc(contactRequests.id))
      .limit(limit + 1);

    const hasNextPage = rows.length > limit;
    return { rows: hasNextPage ? rows.slice(0, limit) : rows, hasNextPage };
  }
}

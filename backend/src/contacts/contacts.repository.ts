import { Injectable, Inject, Logger } from '@nestjs/common';
import { sql, eq, and, or, lt, desc, getTableColumns, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import * as schema from '../database/schema';
import { contactRequests, posts, type ContactRequest, type NewContactRequest } from '../database/schema';
import { ConflictError } from '../common/errors/app.errors';
import { excludeIsolatedAccounts } from '../blocks/account-isolation.sql';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

/** Drizzle executor: the pooled database handle or a caller-owned transaction. */
export type ContactsExecutor = NodePgDatabase<typeof schema> | DbTransaction;

/**
 * ContactsRepository — data access for the contact_requests table.
 */
@Injectable()
export class ContactsRepository {
  private readonly logger = new Logger(ContactsRepository.name);

  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Creates a new contact request. The DB unique constraint
   * (unique_contact_request_per_post_and_requester) is the real duplicate
   * protection; the 23505 it raises on a double-tap race is mapped here to a
   * clean ConflictError instead of a 500.
   *
   * Accepts a caller-owned transaction so isolation-sensitive callers can
   * insert while holding the canonical account-pair lock.
   */
  async create(data: NewContactRequest, executor: ContactsExecutor = this.db): Promise<ContactRequest> {
    try {
      const [request] = await executor.insert(contactRequests).values(data).returning();
      return request;
    } catch (error) {
      const pgErr = error as { code?: string; constraint?: string };
      if (pgErr.code === '23505' || pgErr.constraint === 'unique_contact_request_per_post_and_requester') {
        throw new ConflictError('You have already sent a contact request for this post');
      }
      throw error;
    }
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
   * Atomic guard: only a row still in PENDING can transition. If the row was
   * concurrently transitioned by another request, the UPDATE matches 0 rows and
   * this returns undefined — the service converts that to a ConflictError.
   *
   * Accepts a caller-owned transaction so an approval can recheck account
   * isolation and transition the row atomically under the pair lock.
   */
  async updateStatus(
    requestId: string,
    status: 'APPROVED' | 'REJECTED',
    executor: ContactsExecutor = this.db,
  ): Promise<ContactRequest | undefined> {
    const [updated] = await executor
      .update(contactRequests)
      .set({
        status,
        respondedAt: sql`now()`,
      })
      .where(
        and(
          eq(contactRequests.id, requestId),
          eq(contactRequests.status, 'PENDING'), // ← the race guard
        ),
      )
      .returning();
    return updated; // undefined ⇔ lost the race
  }

  /**
   * Paginated fetch of contact requests sent BY a user.
   * Cursor: { createdAt, id } keyset pagination.
   *
   * Requests aimed at a Post whose creator is isolated from the viewer are
   * filtered in SQL before the limit, so preserved history never reaches a
   * user-facing list and pages stay dense.
   */
  async findByRequester(parameters: {
    requesterId: string;
    viewerId?: string | null;
    postId?: string | null;
    status?: string | null;
    limit: number;
    cursor: { createdAt: string; id: string } | null;
  }): Promise<{ rows: ContactRequest[]; hasNextPage: boolean }> {
    const { requesterId, postId, status, limit, cursor } = parameters;
    const viewerId = parameters.viewerId ?? requesterId;

    const rows = await this.db
      .select({ ...getTableColumns(contactRequests) })
      .from(contactRequests)
      .innerJoin(posts, eq(posts.id, contactRequests.postId))
      .where(
        and(
          eq(contactRequests.requesterId, requesterId),
          excludeIsolatedAccounts(viewerId, posts.creatorId),
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
   *
   * Requests authored by an account isolated from the viewer are filtered in
   * SQL before the limit, so the owner never sees preserved records across a
   * Block while history remains intact.
   */
  async findByPost(parameters: {
    postId: string;
    viewerId?: string | null;
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
          excludeIsolatedAccounts(parameters.viewerId, contactRequests.requesterId),
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
   * Rejects every PENDING contact request between two accounts, in both
   * directions, without deleting rows. Already-approved history is untouched
   * (and is hidden by list/disclosure predicates while the Block remains).
   * Must run on a caller-owned transaction so the Block, the rejections, and
   * any pair lock commit atomically.
   */
  async rejectPendingBetweenAccounts(
    firstAccountId: string,
    secondAccountId: string,
    executor: ContactsExecutor,
  ): Promise<number> {
    if (firstAccountId === secondAccountId) return 0;

    let rejected = 0;
    const directions = [
      [firstAccountId, secondAccountId],
      [secondAccountId, firstAccountId],
    ] as const;

    for (const [requesterId, creatorId] of directions) {
      const updated = await executor
        .update(contactRequests)
        .set({ status: 'REJECTED', respondedAt: sql`now()` })
        .where(
          and(
            eq(contactRequests.status, 'PENDING'),
            eq(contactRequests.requesterId, requesterId),
            inArray(
              contactRequests.postId,
              executor.select({ id: posts.id }).from(posts).where(eq(posts.creatorId, creatorId)),
            ),
          ),
        )
        .returning({ id: contactRequests.id });
      rejected += updated.length;
    }

    return rejected;
  }
}

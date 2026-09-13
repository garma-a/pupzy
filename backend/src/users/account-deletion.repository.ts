import { Inject, Injectable } from '@nestjs/common';
import { eq, and, or, isNull, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import { accountDeletions, type AccountDeletion, type NewAccountDeletion } from '../database/schema';

@Injectable()
export class AccountDeletionRepository {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: NodePgDatabase<Record<string, unknown>>) {}

  async create(data: NewAccountDeletion, tx?: NodePgDatabase<Record<string, unknown>>): Promise<AccountDeletion> {
    const executor = tx ?? this.db;
    const [record] = await executor.insert(accountDeletions).values(data).returning();
    return record;
  }

  async findByFirebaseUserId(firebaseUserId: string): Promise<AccountDeletion | undefined> {
    const [record] = await this.db
      .select()
      .from(accountDeletions)
      .where(eq(accountDeletions.firebaseUserId, firebaseUserId))
      .orderBy(sql`${accountDeletions.createdAt} DESC`)
      .limit(1);
    return record;
  }

  async findByUserId(userId: string): Promise<AccountDeletion | undefined> {
    const [record] = await this.db
      .select()
      .from(accountDeletions)
      .where(eq(accountDeletions.userId, userId))
      .orderBy(sql`${accountDeletions.createdAt} DESC`)
      .limit(1);
    return record;
  }

  async findById(id: string): Promise<AccountDeletion | undefined> {
    const [record] = await this.db.select().from(accountDeletions).where(eq(accountDeletions.id, id)).limit(1);
    return record;
  }

  async update(id: string, data: Partial<NewAccountDeletion>): Promise<AccountDeletion> {
    const [updated] = await this.db
      .update(accountDeletions)
      .set({
        ...data,
        updatedAt: sql`now()`,
      })
      .where(eq(accountDeletions.id, id))
      .returning();
    return updated;
  }

  async findPendingForRetry(limit = 50): Promise<AccountDeletion[]> {
    const now = new Date();
    return this.db
      .select()
      .from(accountDeletions)
      .where(
        and(
          or(eq(accountDeletions.status, 'PENDING'), eq(accountDeletions.status, 'FAILED')),
          or(isNull(accountDeletions.nextRetryAt), lte(accountDeletions.nextRetryAt, now)),
        ),
      )
      .orderBy(accountDeletions.createdAt)
      .limit(limit);
  }

  async findExpiredForPurge(limit = 100): Promise<AccountDeletion[]> {
    const now = new Date();
    return this.db
      .select()
      .from(accountDeletions)
      .where(and(eq(accountDeletions.status, 'COMPLETED'), lte(accountDeletions.purgeAt, now)))
      .limit(limit);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(accountDeletions).where(eq(accountDeletions.id, id));
  }
}

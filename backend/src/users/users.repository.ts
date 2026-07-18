import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import { users, type User, type NewUser } from '../database/schema';
import type * as schema from '../database/schema';

@Injectable()
export class UsersRepository {
  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findByFirebaseUserId(firebaseUserId: string): Promise<User | undefined> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.firebaseUserId, firebaseUserId))
      .limit(1);
    return user;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return user;
  }

  async findById(id: string): Promise<User | undefined> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return user;
  }

  /**
   * Batch-loads users by an array of IDs.
   * Used exclusively by the DataLoader to resolve N user IDs in one query.
   *
   * Returns results in the same order as the input IDs array,
   * with `null` for any ID that was not found — required by the DataLoader contract.
   */
  async findByIds(ids: readonly string[]): Promise<(User | null)[]> {
    if (ids.length === 0) return [];

    const rows = await this.db
      .select()
      .from(users)
      .where(inArray(users.id, ids as string[]));

    const userMap = new Map<string, User>(rows.map((u) => [u.id, u]));
    return ids.map((id) => userMap.get(id) ?? null);
  }

  async create(data: NewUser): Promise<User> {
    const [user] = await this.db.insert(users).values(data).returning();
    return user;
  }

  async update(id: string, data: Partial<NewUser>): Promise<User> {
    const [user] = await this.db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }
}

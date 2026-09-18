import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import { users, type User, type NewUser } from '../database/schema';
import type * as schema from '../database/schema';

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

/** Drizzle executor: the pooled database handle or a caller-owned transaction. */
export type UsersExecutor = NodePgDatabase<typeof schema> | DbTransaction;

@Injectable()
export class UsersRepository {
  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findByFirebaseUserId(firebaseUserId: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.firebaseUserId, firebaseUserId)).limit(1);
    return user;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  }

  async findById(id: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  async findActiveById(id: string, executor: UsersExecutor = this.db): Promise<User | undefined> {
    const [user] = await executor
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.isBanned, false)))
      .limit(1);
    return user;
  }

  /**
   * Batch-loads users by their IDs for the `userById` DataLoader.
   * Returns users in the exact order of the requested IDs, padded
   * with `null` for any ID that was not found — required by the DataLoader contract.
   * Excludes banned/deleting accounts to prevent relationship profile leaks.
   */
  async findByIds(ids: readonly string[]): Promise<(User | null)[]> {
    if (ids.length === 0) return [];

    const rows = await this.db
      .select()
      .from(users)
      .where(and(inArray(users.id, ids as string[]), eq(users.isBanned, false)));

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

  async delete(id: string): Promise<boolean> {
    const result = await this.db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    return result.length > 0;
  }
}

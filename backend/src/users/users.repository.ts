import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import { users, mediaDeletionWork, type User, type NewUser } from '../database/schema';
import { ConflictError, ForbiddenError } from '../common/errors/app.errors';
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

  /**
   * Re-links an account to a new Firebase UID and optionally seeds the
   * provider picture.
   *
   * The avatar-choice guard is evaluated in the same SQL statement as the
   * write: the provider picture is applied only while
   * `profile_photo_changed_at IS NULL`. A concurrent set/removal therefore
   * can never be overwritten by a stale read of the avatar decision.
   */
  async linkFirebaseUserId(id: string, firebaseUserId: string, photoUrl?: string | null): Promise<User> {
    const [user] = await this.db
      .update(users)
      .set({
        firebaseUserId,
        ...(photoUrl !== undefined
          ? {
              profilePictureUrl: sql`CASE WHEN ${users.profilePhotoChangedAt} IS NULL THEN ${photoUrl} ELSE ${users.profilePictureUrl} END`,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  /**
   * Activates a finalized owned profile photo.
   *
   * Locks the user row so the previous-avatar comparison, the user update and
   * the obsolete-media enqueue commit atomically. `expectedStorageKey` is the
   * owned key observed before finalization: when another replacement (or an
   * explicit removal) won the race, this throws `PROFILE_PHOTO_REPLACED`
   * instead of overwriting a decision that was never observed. The caller
   * compensates the losing finalized object.
   *
   * Provider URLs are never enqueued: only a previously owned storage key
   * becomes deletion work.
   */
  async activateProfilePhoto(
    userId: string,
    input: { expectedStorageKey: string | null; storageKey: string; publicUrl: string },
  ): Promise<User> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
      if (!user || user.isBanned) {
        throw new ForbiddenError('ACCOUNT_DELETED');
      }

      const currentStorageKey = user.profilePhotoStorageKey ?? null;
      if (currentStorageKey !== (input.expectedStorageKey ?? null)) {
        throw new ConflictError(
          'The profile photo was changed by another request. Refresh and try again.',
          'PROFILE_PHOTO_REPLACED',
        );
      }

      if (currentStorageKey && currentStorageKey !== input.storageKey) {
        await tx.insert(mediaDeletionWork).values({
          storageKey: currentStorageKey,
          cdnUrl: '',
          status: 'PENDING',
          attempts: 0,
        });
      }

      const [updated] = await tx
        .update(users)
        .set({
          profilePictureUrl: input.publicUrl,
          profilePhotoStorageKey: input.storageKey,
          profilePhotoChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      return updated;
    });
  }

  /**
   * Clears the user's profile picture explicitly.
   *
   * The row lock makes removal atomic with the decision marker, so a
   * concurrent replacement can only win before or after the removal, never
   * silently undo it. The previously owned key is enqueued for deletion in
   * the same transaction; a provider URL is never treated as owned media.
   * Idempotent: repeating removal queues nothing.
   */
  async clearProfilePhoto(userId: string): Promise<User> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
      if (!user) {
        throw new ForbiddenError('ACCOUNT_DELETED');
      }

      if (user.profilePhotoStorageKey) {
        await tx.insert(mediaDeletionWork).values({
          storageKey: user.profilePhotoStorageKey,
          cdnUrl: '',
          status: 'PENDING',
          attempts: 0,
        });
      }

      const [updated] = await tx
        .update(users)
        .set({
          profilePictureUrl: null,
          profilePhotoStorageKey: null,
          profilePhotoChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      return updated;
    });
  }
}

import { Injectable, Inject } from '@nestjs/common';
import { and, desc, eq, getTableColumns, lt, ne, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_TOKEN } from '../database/database.provider';
import {
  posts,
  users,
  matingPosts,
  postMedia,
  type Post,
  type NewPost,
  type NewPostMedia,
  type MatingPostRow,
  type NewMatingPostRow,
} from '../database/schema';
import type * as schema from '../database/schema';

import { ForbiddenError } from '../common/errors/app.errors';
import { excludeIsolatedAccounts } from '../blocks/account-isolation.sql';
export type NewMatingDetailsInput = Omit<NewMatingPostRow, 'postId'>;

type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

@Injectable()
export class MatingRepository {
  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Rechecks the creator while holding the same User row lock as the active
   * Post trigger. This closes the gap between authentication and an AdminJS
   * ban, returning the established safe Forbidden error for legacy MATING
   * creation rather than exposing the trigger constraint failure. If creation
   * wins that race, the durable ban cascade removes its committed ACTIVE Post.
   */
  private async lockActiveCreator(tx: DbTransaction, creatorId: string): Promise<void> {
    const [creator] = await tx
      .select({ id: users.id, isBanned: users.isBanned })
      .from(users)
      .where(eq(users.id, creatorId))
      .for('update');
    if (!creator || creator.isBanned) throw new ForbiddenError('ACCOUNT_DELETED');
  }
  /**
   * Atomically creates the parent posts row + mating_posts extension row +
   * post_media rows (if any) in ONE transaction — same shape as
   * PostsRepository.createAdoptionPost. `baseData` is fully prepared by the
   * service (city already resolved, coordinates already set to the city's
   * centroid, id already pre-generated) — this method does not resolve
   * anything itself.
   */
  async createMatingPost(
    baseData: NewPost,
    matingData: NewMatingDetailsInput,
    mediaRows: Array<Omit<NewPostMedia, 'postId' | 'displayOrder'>>,
  ): Promise<Post> {
    return this.db.transaction(async (tx) => {
      await this.lockActiveCreator(tx, baseData.creatorId);
      const [post] = await tx.insert(posts).values(baseData).returning();

      await tx.insert(matingPosts).values({
        postId: post.id,
        ...matingData,
      });

      if (mediaRows.length > 0) {
        await tx.insert(postMedia).values(
          mediaRows.map((m, index) => ({
            ...m,
            postId: post.id,
            displayOrder: index,
          })),
        );
      }

      return post;
    });
  }

  /**
   * Fetches the MATING extension row only while its base Post is accessible:
   * type MATING, not REMOVED, and not created by an account isolated from the
   * viewer by a Block in either direction. Mirrors the base-Post guard used by
   * the other type-specific detail lookups in PostsRepository.
   */
  async findDetailsByPostId(postId: string, viewerId?: string | null): Promise<MatingPostRow | undefined> {
    const [row] = await this.db
      .select(getTableColumns(matingPosts))
      .from(matingPosts)
      .innerJoin(posts, eq(matingPosts.postId, posts.id))
      .where(
        and(
          eq(matingPosts.postId, postId),
          eq(posts.postType, 'MATING'),
          ne(posts.status, 'REMOVED'),
          excludeIsolatedAccounts(viewerId, posts.creatorId),
        ),
      )
      .limit(1);
    return row;
  }

  /** Keyset feed: posts (MATING + ACTIVE) INNER JOIN mating_posts, newest first. */
  async findFeed(params: {
    filter: {
      species?: string | null;
      gender?: string | null;
      breed?: string | null;
      cityId?: string | null;
    };
    limit: number;
    cursor: { createdAt: string; id: string } | null;
    viewerId?: string | null;
  }): Promise<{ rows: Post[]; hasNextPage: boolean }> {
    const { filter, limit, cursor, viewerId } = params;
    // Escape LIKE wildcards so user input can't scan the whole table
    const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

    const rows = await this.db
      .select({ post: posts })
      .from(posts)
      .innerJoin(matingPosts, eq(matingPosts.postId, posts.id))
      .where(
        and(
          eq(posts.postType, 'MATING'),
          eq(posts.status, 'ACTIVE'),
          excludeIsolatedAccounts(viewerId, posts.creatorId),
          filter.species ? eq(matingPosts.species, filter.species as never) : undefined,
          filter.gender ? eq(matingPosts.gender, filter.gender as never) : undefined,
          filter.cityId ? eq(posts.cityId, filter.cityId) : undefined,
          filter.breed ? sql`${matingPosts.breed} ILIKE ${'%' + escapeLike(filter.breed) + '%'}` : undefined,
          cursor
            ? or(
                lt(posts.createdAt, new Date(cursor.createdAt)),
                and(eq(posts.createdAt, new Date(cursor.createdAt)), lt(posts.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(limit + 1);

    const hasNextPage = rows.length > limit;
    return {
      rows: (hasNextPage ? rows.slice(0, limit) : rows).map((r) => r.post),
      hasNextPage,
    };
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, ne, inArray, asc, desc, and, or, gt, lt, sql, getTableColumns, type SQL } from 'drizzle-orm';
import DataLoader from 'dataloader';
import { DATABASE_TOKEN } from '../database/database.provider';
import {
  posts,
  cities,
  rescuePosts,
  lostPosts,
  adoptionPosts,
  productPosts,
  postMedia,
  postUpvotes,
  postSaves,
  type Post,
  type PostMedia,
  type NewPost,
  type NewRescuePost,
  type NewLostPost,
  type NewAdoptionPost,
  type NewProductPost,
  type NewPostMedia,
  type RescuePost,
  type LostPost,
  type AdoptionPost,
  type ProductPost,
} from '../database/schema';
import type * as schema from '../database/schema';
import { NotFoundError } from '../common/errors/app.errors';

/**
 * PostsRepository — data-access layer for post creation.
 *
 * ## Transaction boundary
 * Every create method runs **three inserts inside one database transaction**:
 * 1. `INSERT INTO posts` (CTI base row)
 * 2. `INSERT INTO {extension_table}` (type-specific data)
 * 3. `INSERT INTO post_media` (one row per image, if any)
 *
 * If any insert fails (e.g. a CHECK constraint violation), the entire
 * transaction rolls back — no partial data is ever committed.
 *
 * ## Counter maintenance
 * The DB trigger `trg_sync_user_post_counts` automatically increments
 * the appropriate counter on the `users` table when a `posts` row is
 * inserted. This repository does NOT manually update user counters.
 */

/**
 * Runtime-safe numeric parser for a nullable raw sql fragment. Needed
 * because a plain sql`` fragment (unlike a real column) has no declared
 * Drizzle type to decode with automatically — without this, Number(null)
 * would incorrectly return 0 instead of staying null.
 */
function parseNullableDouble(value: unknown): number | null {
  return value == null ? null : Number(value);
}

/**
 * A single row returned by feed queries.
 * Wraps the Drizzle Post type with a computed distance field.
 */
export interface FeedResultRow {
  post: Post;
  distanceKm: number | null;
  /** Present only for findPostsSavedByCurrentUser — the timestamp when the user saved this post. */
  savedAt?: Date;
}

/**
 * Result shape for all feed queries.
 * Uses the limit+1 trick to determine hasNextPage without COUNT(*).
 */
export interface FeedResult {
  rows: FeedResultRow[];
  hasNextPage: boolean;
}

@Injectable()
export class PostsRepository {
  constructor(
    @Inject(DATABASE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Creates a RESCUE post atomically.
   *
   * @param baseData - Common fields for the `posts` base table
   * @param rescueData - RESCUE-specific fields (species, conditionSummary, reporterRole)
   * @param mediaRows - Pre-finalized media rows (moved from staging to final R2 path)
   * @returns The newly created base post row
   */
  async createRescuePost(
    baseData: NewPost,
    rescueData: Omit<NewRescuePost, 'postId'>,
    mediaRows: Omit<NewPostMedia, 'postId'>[],
  ): Promise<Post> {
    return this.db.transaction(async (tx) => {
      const [post] = await tx.insert(posts).values(baseData).returning();

      await tx.insert(rescuePosts).values({
        postId: post.id,
        ...rescueData,
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
   * Creates a LOST post atomically.
   * Handles both LOST_PET and FOUND_STRAY subtypes — the discriminator
   * is in `lostData.reportType`.
   *
   * The CHECK constraint `chk_lost_posts_report_fields` will reject
   * any field-set mismatch, but the service layer validates first.
   */
  async createLostPost(
    baseData: NewPost,
    lostData: Omit<NewLostPost, 'postId'>,
    mediaRows: Omit<NewPostMedia, 'postId'>[],
  ): Promise<Post> {
    return this.db.transaction(async (tx) => {
      const [post] = await tx.insert(posts).values(baseData).returning();

      await tx.insert(lostPosts).values({
        postId: post.id,
        ...lostData,
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
   * Creates an ADOPTION post atomically.
   *
   * ADOPTION posts have no urgency (NULL on the base table).
   * The CHECK constraint `chk_adoption_age_pairing` ensures
   * ageValue/ageUnit are both set or both null.
   */
  async createAdoptionPost(
    baseData: NewPost,
    adoptionData: Omit<NewAdoptionPost, 'postId'>,
    mediaRows: Omit<NewPostMedia, 'postId'>[],
  ): Promise<Post> {
    return this.db.transaction(async (tx) => {
      const [post] = await tx.insert(posts).values(baseData).returning();

      await tx.insert(adoptionPosts).values({
        postId: post.id,
        ...adoptionData,
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
   * Creates a PRODUCT post atomically.
   *
   * ## Denormalization sync
   * The `baseData.marketCategory` MUST be set to the same value as
   * `productData.category` by the calling service — both are written
   * in the same transaction so they are always consistent.
   *
   * PRODUCT posts have no urgency (NULL on the base table).
   * The CHECK constraint `chk_product_price_by_free` ensures
   * priceAmount is NULL when isFree=true and NOT NULL when isFree=false.
   */
  async createProductPost(
    baseData: NewPost,
    productData: Omit<NewProductPost, 'postId'>,
    mediaRows: Omit<NewPostMedia, 'postId'>[],
  ): Promise<Post> {
    return this.db.transaction(async (tx) => {
      const [post] = await tx.insert(posts).values(baseData).returning();

      await tx.insert(productPosts).values({
        postId: post.id,
        ...productData,
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
   * Finds a single post by ID.
   * Used by the resolver for single-post detail queries.
   */
  async findById(id: string): Promise<Post | undefined> {
    const [post] = await this.db.select().from(posts).where(eq(posts.id, id)).limit(1);
    return post;
  }

  /**
   * Batch-loads media rows for multiple posts in a single query.
   * Used exclusively by the DataLoader to resolve N post media sets.
   *
   * Returns results in the same order as the input post IDs array,
   * with empty arrays for posts that have no media — required by DataLoader.
   * Within each post's media array, items are ordered by display_order ASC.
   */
  async findMediaByPostIds(postIds: readonly string[]): Promise<PostMedia[][]> {
    if (postIds.length === 0) return [];

    const rows = await this.db
      .select()
      .from(postMedia)
      .where(inArray(postMedia.postId, postIds as string[]))
      .orderBy(asc(postMedia.displayOrder));

    // Group by postId while preserving the display_order from the query
    const mediaMap = new Map<string, PostMedia[]>();
    for (const row of rows) {
      const existing = mediaMap.get(row.postId) ?? [];
      existing.push(row);
      mediaMap.set(row.postId, existing);
    }

    return postIds.map((id) => mediaMap.get(id) ?? []);
  }

  /**
   * Creates a fresh DataLoader instance for batch-loading media by post ID.
   *
   * Returns an ordered array of PostMedia for each post.
   * Posts with no media get an empty array (not null).
   */
  createMediaByPostIdLoader(): DataLoader<string, PostMedia[]> {
    return new DataLoader<string, PostMedia[]>((ids) => this.findMediaByPostIds(ids), {
      cache: true,
      maxBatchSize: 100,
    });
  }

  // ─── Read ─────────────────────────────────────────────────────────────

  /**
   * Finds a single RESCUE extension row by post ID.
   * Returns undefined if the post ID doesn't have a rescue extension.
   */
  async findRescueDetail(postId: string): Promise<RescuePost | undefined> {
    const [row] = await this.db
      .select(getTableColumns(rescuePosts))
      .from(rescuePosts)
      .innerJoin(posts, eq(rescuePosts.postId, posts.id))
      .where(and(eq(rescuePosts.postId, postId), eq(posts.postType, 'RESCUE'), ne(posts.status, 'REMOVED')))
      .limit(1);
    return row;
  }

  /**
   * Finds a single LOST extension row by post ID.
   */
  async findLostDetail(postId: string): Promise<LostPost | undefined> {
    const [row] = await this.db
      .select(getTableColumns(lostPosts))
      .from(lostPosts)
      .innerJoin(posts, eq(lostPosts.postId, posts.id))
      .where(and(eq(lostPosts.postId, postId), eq(posts.postType, 'LOST'), ne(posts.status, 'REMOVED')))
      .limit(1);
    return row;
  }

  /**
   * Finds a single ADOPTION extension row by post ID.
   */
  async findAdoptionDetail(postId: string): Promise<AdoptionPost | undefined> {
    const [row] = await this.db
      .select(getTableColumns(adoptionPosts))
      .from(adoptionPosts)
      .innerJoin(posts, eq(adoptionPosts.postId, posts.id))
      .where(and(eq(adoptionPosts.postId, postId), eq(posts.postType, 'ADOPTION'), ne(posts.status, 'REMOVED')))
      .limit(1);
    return row;
  }

  /**
   * Finds a single PRODUCT extension row by post ID.
   */
  async findProductDetail(postId: string): Promise<ProductPost | undefined> {
    const [row] = await this.db
      .select(getTableColumns(productPosts))
      .from(productPosts)
      .innerJoin(posts, eq(productPosts.postId, posts.id))
      .where(and(eq(productPosts.postId, postId), eq(posts.postType, 'PRODUCT'), ne(posts.status, 'REMOVED')))
      .limit(1);
    return row;
  }

  // ─── Update / Delete ──────────────────────────────────────────────────

  /**
   * Updates a post's status (e.g., ACTIVE → RESOLVED, ADOPTED, SOLD).
   * The DB trigger `trg_sync_user_post_counts` handles counter adjustments.
   * The DB trigger `trg_posts_updated_at` handles updated_at automatically.
   *
   * @returns The updated post row, or undefined when it is no longer ACTIVE
   *          or no longer belongs to the caller.
   */
  async updateStatus(postId: string, creatorId: string, status: string): Promise<Post | undefined> {
    const [post] = await this.db
      .update(posts)
      .set({ status: status as Post['status'] })
      .where(and(eq(posts.id, postId), eq(posts.creatorId, creatorId), eq(posts.status, 'ACTIVE')))
      .returning();
    return post;
  }

  /**
   * Soft-deletes a non-removed post by setting status to 'REMOVED'.
   * The DB trigger `trg_sync_user_post_counts` decrements user counters.
   */
  async softDelete(postId: string, creatorId: string): Promise<Post | undefined> {
    const [post] = await this.db
      .update(posts)
      .set({ status: 'REMOVED' })
      .where(and(eq(posts.id, postId), eq(posts.creatorId, creatorId), ne(posts.status, 'REMOVED')))
      .returning();
    return post;
  }

  // ─── Engagement Toggles ───────────────────────────────────────────────

  /**
   * Toggles an upvote on a post. If the user has already upvoted, removes it.
   * If not, inserts a new upvote. All operations run in a single transaction:
   *   1. Check existing upvote
   *   2. INSERT or DELETE the upvote row
   *   3. Update counter + recompute score + RETURNING * (single query)
   *
   * PostgreSQL evaluates all SET expressions using the OLD row values, so the
   * merged score formula explicitly uses (upvote_count + delta) to account for
   * the counter change within the same UPDATE statement.
   *
   * @returns Object with `added` (true if upvote was added, false if removed)
   *          and the `updatedPost` row.
   */
  async toggleUpvote(postId: string, userId: string): Promise<{ added: boolean; updatedPost: Post }> {
    return this.db.transaction(async (tx) => {
      const [availablePost] = await tx
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.id, postId), ne(posts.status, 'REMOVED')))
        .for('update');
      if (!availablePost) throw new NotFoundError('Post', postId);

      // 1. Check if upvote already exists
      const [existing] = await tx
        .select()
        .from(postUpvotes)
        .where(and(eq(postUpvotes.postId, postId), eq(postUpvotes.userId, userId)))
        .limit(1);

      if (existing) {
        // 2. Remove upvote
        const deleted = await tx
          .delete(postUpvotes)
          .where(and(eq(postUpvotes.postId, postId), eq(postUpvotes.userId, userId)))
          .returning({ postId: postUpvotes.postId });

        if (deleted.length > 0) {
          // 3. Decrement counter + recompute score + return updated post in one query
          const [updatedPost] = await tx
            .update(posts)
            .set({
              upvoteCount: sql`${posts.upvoteCount} - 1`,
              lastEngagedAt: sql`now()`,
              effectiveScore: sql`
                CASE WHEN ${posts.postType} = 'ADOPTION' THEN
                  ((${posts.upvoteCount} - 1) * 3 + ${posts.saveCount} * 2 + ${posts.viewCount} * 0.1 + 1)
                  / POWER(EXTRACT(EPOCH FROM (now() - ${posts.createdAt})) / 3600.0 + 2, 1.5)
                ELSE ${posts.effectiveScore}
                END
              `,
            })
            .where(eq(posts.id, postId))
            .returning();
          return { added: false, updatedPost };
        }

        // Edge case: DELETE returned empty (concurrent toggle removed it first)
        const [currentPost] = await tx.select().from(posts).where(eq(posts.id, postId)).limit(1);
        return { added: false, updatedPost: currentPost };
      } else {
        // 2. Add upvote — handle concurrent duplicate via unique constraint
        try {
          const inserted = await tx
            .insert(postUpvotes)
            .values({ postId, userId })
            .onConflictDoNothing()
            .returning({ postId: postUpvotes.postId });

          if (inserted.length > 0) {
            // 3. Increment counter + recompute score + return updated post in one query
            const [updatedPost] = await tx
              .update(posts)
              .set({
                upvoteCount: sql`${posts.upvoteCount} + 1`,
                lastEngagedAt: sql`now()`,
                effectiveScore: sql`
                  CASE WHEN ${posts.postType} = 'ADOPTION' THEN
                    ((${posts.upvoteCount} + 1) * 3 + ${posts.saveCount} * 2 + ${posts.viewCount} * 0.1 + 1)
                    / POWER(EXTRACT(EPOCH FROM (now() - ${posts.createdAt})) / 3600.0 + 2, 1.5)
                  ELSE ${posts.effectiveScore}
                  END
                `,
              })
              .where(eq(posts.id, postId))
              .returning();
            return { added: true, updatedPost };
          }

          // onConflictDoNothing returned empty — concurrent insert won
          const [currentPost] = await tx.select().from(posts).where(eq(posts.id, postId)).limit(1);
          return { added: true, updatedPost: currentPost };
        } catch (err) {
          if ((err as Record<string, unknown>)?.code === '23505') {
            const [currentPost] = await tx.select().from(posts).where(eq(posts.id, postId)).limit(1);
            return { added: true, updatedPost: currentPost };
          }
          throw err;
        }
      }
    });
  }

  /**
   * Toggles a save/bookmark on a post. Same 3-query pattern as toggleUpvote.
   * Works on all 4 post types.
   *
   * Merges counter update + effective_score recomputation into a single
   * UPDATE ... RETURNING to minimize round trips within the transaction.
   *
   * @returns Object with `added` and the `updatedPost` row.
   */
  async toggleSave(postId: string, userId: string): Promise<{ added: boolean; updatedPost: Post }> {
    return this.db.transaction(async (tx) => {
      const [availablePost] = await tx
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.id, postId), ne(posts.status, 'REMOVED')))
        .for('update');
      if (!availablePost) throw new NotFoundError('Post', postId);

      // 1. Check if save already exists
      const [existing] = await tx
        .select()
        .from(postSaves)
        .where(and(eq(postSaves.postId, postId), eq(postSaves.userId, userId)))
        .limit(1);

      if (existing) {
        // 2. Remove save
        const deleted = await tx
          .delete(postSaves)
          .where(and(eq(postSaves.postId, postId), eq(postSaves.userId, userId)))
          .returning({ postId: postSaves.postId });

        if (deleted.length > 0) {
          // 3. Decrement counter + recompute score + return in one query
          const [updatedPost] = await tx
            .update(posts)
            .set({
              saveCount: sql`${posts.saveCount} - 1`,
              lastEngagedAt: sql`now()`,
              effectiveScore: sql`
                CASE
                  WHEN ${posts.postType} = 'ADOPTION' THEN
                    (${posts.upvoteCount} * 3 + (${posts.saveCount} - 1) * 2 + ${posts.viewCount} * 0.1 + 1)
                    / POWER(EXTRACT(EPOCH FROM (now() - ${posts.createdAt})) / 3600.0 + 2, 1.5)
                  WHEN ${posts.postType} = 'PRODUCT' THEN
                    (${posts.viewCount} * 1 + (${posts.saveCount} - 1) * 5 + 1)
                    / POWER(EXTRACT(EPOCH FROM (now() - ${posts.createdAt})) / 3600.0 + 2, 1.5)
                  ELSE ${posts.effectiveScore}
                END
              `,
            })
            .where(eq(posts.id, postId))
            .returning();
          return { added: false, updatedPost };
        }

        // Edge case: DELETE returned empty (concurrent toggle removed it first)
        const [currentPost] = await tx.select().from(posts).where(eq(posts.id, postId)).limit(1);
        return { added: false, updatedPost: currentPost };
      } else {
        // 2. Add save — handle concurrent duplicate via unique constraint
        try {
          const inserted = await tx
            .insert(postSaves)
            .values({ postId, userId })
            .onConflictDoNothing()
            .returning({ postId: postSaves.postId });

          if (inserted.length > 0) {
            // 3. Increment counter + recompute score + return in one query
            const [updatedPost] = await tx
              .update(posts)
              .set({
                saveCount: sql`${posts.saveCount} + 1`,
                lastEngagedAt: sql`now()`,
                effectiveScore: sql`
                  CASE
                    WHEN ${posts.postType} = 'ADOPTION' THEN
                      (${posts.upvoteCount} * 3 + (${posts.saveCount} + 1) * 2 + ${posts.viewCount} * 0.1 + 1)
                      / POWER(EXTRACT(EPOCH FROM (now() - ${posts.createdAt})) / 3600.0 + 2, 1.5)
                    WHEN ${posts.postType} = 'PRODUCT' THEN
                      (${posts.viewCount} * 1 + (${posts.saveCount} + 1) * 5 + 1)
                      / POWER(EXTRACT(EPOCH FROM (now() - ${posts.createdAt})) / 3600.0 + 2, 1.5)
                    ELSE ${posts.effectiveScore}
                  END
                `,
              })
              .where(eq(posts.id, postId))
              .returning();
            return { added: true, updatedPost };
          }

          // onConflictDoNothing returned empty — concurrent insert won
          const [currentPost] = await tx.select().from(posts).where(eq(posts.id, postId)).limit(1);
          return { added: true, updatedPost: currentPost };
        } catch (err) {
          if ((err as Record<string, unknown>)?.code === '23505') {
            const [currentPost] = await tx.select().from(posts).where(eq(posts.id, postId)).limit(1);
            return { added: true, updatedPost: currentPost };
          }
          throw err;
        }
      }
    });
  }

  // ─── DataLoader batch methods for viewer state ────────────────────────

  /**
   * Batch-checks which posts from a list have been upvoted by a specific user.
   * Returns a Set of post IDs that the user has upvoted.
   * Used by the `isUpvotedByMe` DataLoader.
   */
  async findUpvotesByUserForPosts(userId: string, postIds: readonly string[]): Promise<Set<string>> {
    if (postIds.length === 0) return new Set();

    const rows = await this.db
      .select({ postId: postUpvotes.postId })
      .from(postUpvotes)
      .where(and(eq(postUpvotes.userId, userId), inArray(postUpvotes.postId, postIds as string[])));

    return new Set(rows.map((r) => r.postId));
  }

  /**
   * Batch-checks which posts from a list have been saved by a specific user.
   * Returns a Set of post IDs that the user has saved.
   * Used by the `isSavedByMe` DataLoader.
   */
  async findSavesByUserForPosts(userId: string, postIds: readonly string[]): Promise<Set<string>> {
    if (postIds.length === 0) return new Set();

    const rows = await this.db
      .select({ postId: postSaves.postId })
      .from(postSaves)
      .where(and(eq(postSaves.userId, userId), inArray(postSaves.postId, postIds as string[])));

    return new Set(rows.map((r) => r.postId));
  }

  /**
   * Creates a DataLoader that batch-checks "has this user upvoted each post?"
   * Accepts composite keys in the format `${userId}:${postId}` so that viewer
   * identity is passed explicitly from the resolver rather than captured in an
   * early context closure.
   *
   * Returns boolean per key.
   */
  createUpvotedByMeLoader(): DataLoader<string, boolean> {
    return new DataLoader<string, boolean>(
      async (keys: readonly string[]) => {
        if (keys.length === 0) return [];

        const pairs = keys.map((key) => {
          const colonIndex = key.indexOf(':');
          return {
            key,
            userId: key.substring(0, colonIndex),
            postId: key.substring(colonIndex + 1),
          };
        });

        const userToPostIds = new Map<string, string[]>();
        for (const { userId, postId } of pairs) {
          if (!userId || !postId) continue;
          const list = userToPostIds.get(userId) ?? [];
          list.push(postId);
          userToPostIds.set(userId, list);
        }

        const upvotedSet = new Set<string>();

        await Promise.all(
          Array.from(userToPostIds.entries()).map(async ([userId, postIds]) => {
            const rows = await this.db
              .select({ postId: postUpvotes.postId })
              .from(postUpvotes)
              .where(and(eq(postUpvotes.userId, userId), inArray(postUpvotes.postId, postIds)));

            for (const row of rows) {
              upvotedSet.add(`${userId}:${row.postId}`);
            }
          }),
        );

        return keys.map((key) => upvotedSet.has(key));
      },
      { cache: true, maxBatchSize: 100 },
    );
  }

  /**
   * Creates a DataLoader that batch-checks "has this user saved each post?"
   * Accepts composite keys in the format `${userId}:${postId}`.
   *
   * Returns boolean per key.
   */
  createSavedByMeLoader(): DataLoader<string, boolean> {
    return new DataLoader<string, boolean>(
      async (keys: readonly string[]) => {
        if (keys.length === 0) return [];

        const pairs = keys.map((key) => {
          const colonIndex = key.indexOf(':');
          return {
            key,
            userId: key.substring(0, colonIndex),
            postId: key.substring(colonIndex + 1),
          };
        });

        const userToPostIds = new Map<string, string[]>();
        for (const { userId, postId } of pairs) {
          if (!userId || !postId) continue;
          const list = userToPostIds.get(userId) ?? [];
          list.push(postId);
          userToPostIds.set(userId, list);
        }

        const savedSet = new Set<string>();

        await Promise.all(
          Array.from(userToPostIds.entries()).map(async ([userId, postIds]) => {
            const rows = await this.db
              .select({ postId: postSaves.postId })
              .from(postSaves)
              .where(and(eq(postSaves.userId, userId), inArray(postSaves.postId, postIds)));

            for (const row of rows) {
              savedSet.add(`${userId}:${row.postId}`);
            }
          }),
        );

        return keys.map((key) => savedSet.has(key));
      },
      { cache: true, maxBatchSize: 100 },
    );
  }

  // ─── Feed Query Helpers ──────────────────────────────────────────────

  /**
   * Builds the city/governorate equality filter for feed queries. Returns
   * undefined when no administrative-boundary filter applies (radius-only
   * mode) — and() silently drops an undefined condition, so callers pass
   * this straight into and(...) with no manual null check.
   */
  private buildLocationFilterCondition(
    governorate: string | null | undefined,
    cityId: string | null | undefined,
  ): SQL | undefined {
    if (cityId) return eq(posts.cityId, cityId);
    if (governorate) return eq(posts.governorate, governorate);
    return undefined;
  }

  /**
   * Resolves the center point for radius-based filtering, as EWKT text.
   *
   * Priority:
   * 1. viewerLocation (GPS) — user is physically there
   * 2. cityId center_point — user manually browsing another city
   * 3. null — no radius filtering possible
   */
  private async resolveRadiusCenter(
    viewerLocation: { latitude: number; longitude: number } | null | undefined,
    cityId: string | null | undefined,
  ): Promise<string | null> {
    if (viewerLocation) {
      return `SRID=4326;POINT(${viewerLocation.longitude} ${viewerLocation.latitude})`;
    }
    if (cityId) {
      const [row] = await this.db
        .select({ centerPointAsText: sql<string>`ST_AsEWKT(${cities.centerPoint})` })
        .from(cities)
        .where(eq(cities.id, cityId))
        .limit(1);
      return row?.centerPointAsText ?? null;
    }
    return null;
  }

  /**
   * Builds the PostGIS radius-filter condition for feed queries. Two
   * ST_DWithin calls: the raw-geometry one lets PostgreSQL use the GIST
   * index on posts.coordinates for fast pre-filtering, and the ::geography
   * one gives an accurate, Earth-curvature-aware distance cutoff in meters.
   * No Drizzle operator exists for PostGIS functions, so this is "the
   * manual way" — an sql fragment used as a plain condition inside and().
   */
  private buildRadiusCondition(centerPointAsEwkt: string, radiusInMeters: number): SQL {
    const radiusInDegrees = radiusInMeters / 111320.0;
    return sql`
      ST_DWithin(${posts.coordinates}, ST_GeomFromEWKT(${centerPointAsEwkt}), ${radiusInDegrees})
      AND ST_DWithin(${posts.coordinates}::geography, ST_GeomFromEWKT(${centerPointAsEwkt})::geography, ${radiusInMeters})
    `;
  }

  /**
   * Builds the ST_Distance-in-kilometers expression used as a computed
   * column in every feed query. Returns SQL NULL when there's no viewer
   * point to measure from. mapWith(parseNullableDouble) guarantees a real
   * JS number (or null) at runtime regardless of how the pg driver would
   * otherwise decode a bare double-precision value — a raw sql fragment has
   * no column-level type decoder the way a real column does, so this is not
   * optional.
   */
  private buildDistanceInKilometersExpression(viewerPoint: string | null, roundToNearestKilometer = false) {
    if (!viewerPoint) {
      return sql<number | null>`NULL::double precision`.mapWith(parseNullableDouble);
    }
    const distanceInMeters = sql`ST_Distance(${posts.coordinates}::geography, ST_GeomFromEWKT(${viewerPoint})::geography)`;
    const distanceInKilometers = roundToNearestKilometer
      ? sql`ROUND((${distanceInMeters}) / 1000.0)`
      : sql`(${distanceInMeters}) / 1000.0`;
    return distanceInKilometers.mapWith(parseNullableDouble);
  }

  /**
   * Shared keyset-pagination cursor condition for the Adopt Feed and Market
   * Feed, which both sort by effectiveScore (HOT) or plain id (NEWEST).
   * Fully expressible with builder operators — no sql fragment needed, since
   * gt()/lt()/eq() work correctly against Postgres enum and numeric columns
   * without a manual ::cast.
   */
  private buildScoredFeedCursorCondition(
    sort: 'HOT' | 'NEWEST',
    cursor: { score?: number; createdAt?: string; id: string } | null,
  ): SQL | undefined {
    if (!cursor) return undefined;
    if (sort === 'NEWEST') return lt(posts.id, cursor.id);

    const score = cursor.score!;
    const createdAt = new Date(cursor.createdAt!);
    return or(
      lt(posts.effectiveScore, score),
      and(eq(posts.effectiveScore, score), lt(posts.createdAt, createdAt)),
      and(eq(posts.effectiveScore, score), eq(posts.createdAt, createdAt), lt(posts.id, cursor.id)),
    );
  }

  /**
   * Applies the limit+1 "has next page" trick to an already-typed array of
   * feed rows coming straight from the query builder (posts columns plus a
   * computed distanceKm column) and splits each row back into the
   * { post, distanceKm } shape FeedResultRow expects.
   */
  private mapFeedRows(rows: (Post & { distanceKm: number | null })[], limit: number): FeedResult {
    const hasNextPage = rows.length > limit;
    const trimmedRows = hasNextPage ? rows.slice(0, limit) : rows;
    return {
      rows: trimmedRows.map((row) => {
        const { distanceKm, ...post } = row;
        return { post: post, distanceKm };
      }),
      hasNextPage,
    };
  }

  // ─── Feed Queries ───────────────────────────────────────────────────────

  /**
   * Help Feed — RESCUE + LOST posts sorted by urgency ASC, then newest.
   * Index: idx_posts_help_feed (city_id, post_type, urgency ASC, created_at DESC)
   *   WHERE status='ACTIVE' AND post_type IN ('RESCUE','LOST')
   */
  async findHelpFeed(parameters: {
    governorate: string | null | undefined;
    cityId: string | null | undefined;
    viewerLocation: { latitude: number; longitude: number } | null | undefined;
    radiusKm: number;
    limit: number;
    cursor: { urgency: NonNullable<Post['urgency']>; createdAt: string; id: string } | null;
  }): Promise<FeedResult> {
    const { governorate, cityId, viewerLocation, radiusKm, limit, cursor } = parameters;
    const radiusInMeters = radiusKm * 1000;

    const centerPointAsEwkt = await this.resolveRadiusCenter(viewerLocation, cityId);
    const locationCondition = centerPointAsEwkt
      ? this.buildRadiusCondition(centerPointAsEwkt, radiusInMeters)
      : this.buildLocationFilterCondition(governorate, cityId);

    const cursorCondition = cursor
      ? or(
          gt(posts.urgency, cursor.urgency),
          and(eq(posts.urgency, cursor.urgency), lt(posts.createdAt, new Date(cursor.createdAt))),
          and(
            eq(posts.urgency, cursor.urgency),
            eq(posts.createdAt, new Date(cursor.createdAt)),
            lt(posts.id, cursor.id),
          ),
        )
      : undefined;

    const rows = await this.db
      .select({ ...getTableColumns(posts), distanceKm: this.buildDistanceInKilometersExpression(centerPointAsEwkt) })
      .from(posts)
      .where(
        and(
          eq(posts.status, 'ACTIVE'),
          inArray(posts.postType, ['RESCUE', 'LOST']),
          locationCondition,
          cursorCondition,
        ),
      )
      .orderBy(asc(posts.urgency), desc(posts.createdAt), desc(posts.id))
      .limit(limit + 1);

    return this.mapFeedRows(rows, limit);
  }

  /**
   * Adopt Feed — ADOPTION posts sorted by effective_score (HOT) or newest.
   * Index (HOT): idx_posts_adopt_score (city_id, effective_score DESC, created_at DESC)
   * Index (NEWEST): primary key (UUIDv7 id is time-ordered)
   */
  async findAdoptFeed(parameters: {
    governorate: string | null | undefined;
    cityId: string | null | undefined;
    viewerLocation: { latitude: number; longitude: number } | null | undefined;
    radiusKm: number;
    sort: 'HOT' | 'NEWEST';
    limit: number;
    cursor: { score?: number; createdAt?: string; id: string } | null;
  }): Promise<FeedResult> {
    const { governorate, cityId, viewerLocation, radiusKm, sort, limit, cursor } = parameters;
    const radiusInMeters = radiusKm * 1000;

    const centerPointAsEwkt = await this.resolveRadiusCenter(viewerLocation, cityId);
    const locationCondition = centerPointAsEwkt
      ? this.buildRadiusCondition(centerPointAsEwkt, radiusInMeters)
      : this.buildLocationFilterCondition(governorate, cityId);
    const cursorCondition = this.buildScoredFeedCursorCondition(sort, cursor);
    const orderByClauses =
      sort === 'HOT' ? [desc(posts.effectiveScore), desc(posts.createdAt), desc(posts.id)] : [desc(posts.id)];

    const rows = await this.db
      .select({
        ...getTableColumns(posts),
        distanceKm: this.buildDistanceInKilometersExpression(centerPointAsEwkt, true),
      })
      .from(posts)
      .where(and(eq(posts.status, 'ACTIVE'), eq(posts.postType, 'ADOPTION'), locationCondition, cursorCondition))
      .orderBy(...orderByClauses)
      .limit(limit + 1);

    return this.mapFeedRows(rows, limit);
  }

  /**
   * Market Feed — PRODUCT posts sorted by effective_score (HOT) or newest.
   * Supports optional category filtering using denormalized market_category.
   * Index (HOT, no category): idx_posts_market_score
   * Index (HOT, with category): idx_posts_market_category
   * Index (NEWEST): primary key (UUIDv7 id is time-ordered)
   */
  async findMarketFeed(parameters: {
    governorate: string | null | undefined;
    cityId: string | null | undefined;
    viewerLocation: { latitude: number; longitude: number } | null | undefined;
    radiusKm: number;
    sort: 'HOT' | 'NEWEST';
    category: Post['marketCategory'] | null | undefined;
    limit: number;
    cursor: { score?: number; createdAt?: string; id: string } | null;
  }): Promise<FeedResult> {
    const { governorate, cityId, viewerLocation, radiusKm, sort, category, limit, cursor } = parameters;
    const radiusInMeters = radiusKm * 1000;

    const centerPointAsEwkt = await this.resolveRadiusCenter(viewerLocation, cityId);
    const locationCondition = centerPointAsEwkt
      ? this.buildRadiusCondition(centerPointAsEwkt, radiusInMeters)
      : this.buildLocationFilterCondition(governorate, cityId);
    const cursorCondition = this.buildScoredFeedCursorCondition(sort, cursor);
    const orderByClauses =
      sort === 'HOT' ? [desc(posts.effectiveScore), desc(posts.createdAt), desc(posts.id)] : [desc(posts.id)];

    const rows = await this.db
      .select({
        ...getTableColumns(posts),
        distanceKm: this.buildDistanceInKilometersExpression(centerPointAsEwkt, true),
      })
      .from(posts)
      .where(
        and(
          eq(posts.status, 'ACTIVE'),
          eq(posts.postType, 'PRODUCT'),
          locationCondition,
          category ? eq(posts.marketCategory, category) : undefined,
          cursorCondition,
        ),
      )
      .orderBy(...orderByClauses)
      .limit(limit + 1);

    return this.mapFeedRows(rows, limit);
  }

  /**
   * Home Feed — all post types combined, sorted by newest (UUIDv7 id DESC).
   * Cursor: plain id — no composite needed, single-column sort.
   */
  async findHomeFeed(parameters: {
    governorate: string | null | undefined;
    cityId: string | null | undefined;
    viewerLocation: { latitude: number; longitude: number } | null | undefined;
    radiusKm: number;
    limit: number;
    cursor: { id: string } | null;
  }): Promise<FeedResult> {
    const { governorate, cityId, viewerLocation, radiusKm, limit, cursor } = parameters;
    const radiusInMeters = radiusKm * 1000;

    const centerPointAsEwkt = await this.resolveRadiusCenter(viewerLocation, cityId);
    const locationCondition = centerPointAsEwkt
      ? this.buildRadiusCondition(centerPointAsEwkt, radiusInMeters)
      : this.buildLocationFilterCondition(governorate, cityId);

    const rows = await this.db
      .select({ ...getTableColumns(posts), distanceKm: this.buildDistanceInKilometersExpression(centerPointAsEwkt) })
      .from(posts)
      .where(and(eq(posts.status, 'ACTIVE'), locationCondition, cursor ? lt(posts.id, cursor.id) : undefined))
      .orderBy(desc(posts.id))
      .limit(limit + 1);

    return this.mapFeedRows(rows, limit);
  }

  // ─── Favorites & User Post Lists ────────────────────────────────────────

  /**
   * Returns a paginated page of posts saved by the given user, ordered by
   * the time of the save action DESC (newest save first), with the post ID
   * as a tiebreaker. Keyset pagination on (post_saves.created_at, post_saves.post_id).
   */
  async findPostsSavedByCurrentUser(parameters: {
    userId: string;
    limit: number;
    cursor: { savedAt: string; postId: string } | null;
  }): Promise<FeedResult> {
    const { userId, limit, cursor } = parameters;

    const cursorCondition = cursor
      ? or(
          lt(postSaves.createdAt, new Date(cursor.savedAt)),
          and(eq(postSaves.createdAt, new Date(cursor.savedAt)), lt(postSaves.postId, cursor.postId)),
        )
      : undefined;

    const rows = await this.db
      .select({
        ...getTableColumns(posts),
        savedAt: postSaves.createdAt,
        distanceKm: sql<number | null>`NULL::double precision`.mapWith(parseNullableDouble),
      })
      .from(postSaves)
      .innerJoin(posts, eq(postSaves.postId, posts.id))
      .where(and(eq(postSaves.userId, userId), ne(posts.status, 'REMOVED'), cursorCondition))
      .orderBy(desc(postSaves.createdAt), desc(postSaves.postId))
      .limit(limit + 1);

    const hasNextPage = rows.length > limit;
    const trimmedRows = hasNextPage ? rows.slice(0, limit) : rows;

    return {
      rows: trimmedRows.map((row) => {
        const { distanceKm, savedAt, ...post } = row;
        return { post, distanceKm, savedAt };
      }),
      hasNextPage,
    };
  }

  /**
   * Returns a paginated page of posts created by the given user, filtered
   * by postType (the section they were created in) and excluding soft-deleted
   * (REMOVED) rows. Keyset pagination on posts.id DESC.
   */
  async findPostsCreatedByCurrentUser(parameters: {
    creatorId: string;
    postType: Post['postType'];
    limit: number;
    cursor: { id: string } | null;
  }): Promise<FeedResult> {
    const { creatorId, postType, limit, cursor } = parameters;

    const rows = await this.db
      .select({
        ...getTableColumns(posts),
        distanceKm: sql<number | null>`NULL::double precision`.mapWith(parseNullableDouble),
      })
      .from(posts)
      .where(
        and(
          eq(posts.creatorId, creatorId),
          eq(posts.postType, postType),
          ne(posts.status, 'REMOVED'),
          cursor ? lt(posts.id, cursor.id) : undefined,
        ),
      )
      .orderBy(desc(posts.id))
      .limit(limit + 1);

    return this.mapFeedRows(rows, limit);
  }

  // ─── View Count Batch Update ────────────────────────────────────────────

  /**
   * Atomically increments view counts for multiple posts in a single SQL UPDATE.
   * Also recomputes effective_score for ADOPTION and PRODUCT posts.
   * Updates last_engaged_at for PRODUCT posts (views are primary organic signal).
   *
   * ## SQL strategy
   * Uses a VALUES list joined via FROM clause for O(1) round-trips:
   *   UPDATE posts SET view_count += v.additional_view_count
   *   FROM (VALUES ('id1', 5), ('id2', 3)) AS v(post_id, additional_view_count)
   *   WHERE posts.id = v.post_id
   *
   * ## Called by
   * ViewFlushCron.handleFlush() — every 3 minutes.
   */
  async bulkIncrementViews(viewCounts: Map<string, number>): Promise<void> {
    if (viewCounts.size === 0) return;

    const valueRows = [...viewCounts.entries()].map(([postId, count]) => sql`(${postId}::uuid, ${count}::int)`);

    // The one remaining db.execute() call with a hand-written statement in
    // this file — see the ground rules above for why: a bulk, multi-row
    // UPDATE driven by a VALUES list has no query-builder equivalent, and
    // the alternative (hundreds of individual .update() calls) would defeat
    // the batching this cron job exists for. Column references still go
    // through the typed posts.* schema objects rather than a hand-typed
    // p.column_name string.
    await this.db.execute(sql`
      UPDATE posts
      SET
        view_count = ${posts.viewCount} + v.additional_view_count,
        effective_score = CASE
          WHEN ${posts.postType} = 'ADOPTION' THEN
            (${posts.upvoteCount} * 3 + ${posts.saveCount} * 2 + (${posts.viewCount} + v.additional_view_count) * 0.1 + 1)
            / POWER(EXTRACT(EPOCH FROM (now() - ${posts.createdAt})) / 3600.0 + 2, 1.5)
          WHEN ${posts.postType} = 'PRODUCT' THEN
            ((${posts.viewCount} + v.additional_view_count) * 1 + ${posts.saveCount} * 5 + 1)
            / POWER(EXTRACT(EPOCH FROM (now() - ${posts.createdAt})) / 3600.0 + 2, 1.5)
          ELSE ${posts.effectiveScore}
        END,
        last_engaged_at = CASE
          WHEN ${posts.postType} = 'PRODUCT' THEN now()
          ELSE ${posts.lastEngagedAt}
        END
      FROM (VALUES ${sql.join(valueRows, sql`, `)}) AS v(post_id, additional_view_count)
      WHERE ${posts.id} = v.post_id AND ${posts.status} = 'ACTIVE'
    `);
  }
}

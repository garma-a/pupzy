import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, inArray, asc } from 'drizzle-orm';
import DataLoader from 'dataloader';
import { DATABASE_TOKEN } from '../database/database.provider';
import {
  posts,
  rescuePosts,
  lostPosts,
  adoptionPosts,
  productPosts,
  postMedia,
  type Post,
  type PostMedia,
  type NewPost,
  type NewRescuePost,
  type NewLostPost,
  type NewAdoptionPost,
  type NewProductPost,
  type NewPostMedia,
} from '../database/schema';
import type * as schema from '../database/schema';

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
    const [post] = await this.db
      .select()
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);
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
    return new DataLoader<string, PostMedia[]>(
      (ids) => this.findMediaByPostIds(ids),
      { cache: true, maxBatchSize: 100 },
    );
  }
}

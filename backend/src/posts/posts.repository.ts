import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, inArray, asc, desc, sql, and, ne, type SQL } from 'drizzle-orm';
import DataLoader from 'dataloader';
import { DATABASE_TOKEN } from '../database/database.provider';
import {
  posts,
  rescuePosts,
  lostPosts,
  adoptionPosts,
  productPosts,
  postMedia,
  postUpvotes,
  postSaves,
  cities,
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
 * A single row returned by feed queries.
 * Wraps the Drizzle Post type with a computed distance field.
 */
export interface FeedResultRow {
  post: Post;
  distanceKm: number | null;
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

  // ─── Read ─────────────────────────────────────────────────────────────

  /**
   * Finds a single RESCUE extension row by post ID.
   * Returns undefined if the post ID doesn't have a rescue extension.
   */
  async findRescueDetail(postId: string): Promise<RescuePost | undefined> {
    const [row] = await this.db
      .select()
      .from(rescuePosts)
      .where(eq(rescuePosts.postId, postId))
      .limit(1);
    return row;
  }

  /**
   * Finds a single LOST extension row by post ID.
   */
  async findLostDetail(postId: string): Promise<LostPost | undefined> {
    const [row] = await this.db
      .select()
      .from(lostPosts)
      .where(eq(lostPosts.postId, postId))
      .limit(1);
    return row;
  }

  /**
   * Finds a single ADOPTION extension row by post ID.
   */
  async findAdoptionDetail(postId: string): Promise<AdoptionPost | undefined> {
    const [row] = await this.db
      .select()
      .from(adoptionPosts)
      .where(eq(adoptionPosts.postId, postId))
      .limit(1);
    return row;
  }

  /**
   * Finds a single PRODUCT extension row by post ID.
   */
  async findProductDetail(postId: string): Promise<ProductPost | undefined> {
    const [row] = await this.db
      .select()
      .from(productPosts)
      .where(eq(productPosts.postId, postId))
      .limit(1);
    return row;
  }

  // ─── Update / Delete ──────────────────────────────────────────────────

  /**
   * Updates a post's status (e.g., ACTIVE → RESOLVED, ADOPTED, SOLD).
   * The DB trigger `trg_sync_user_post_counts` handles counter adjustments.
   * The DB trigger `trg_posts_updated_at` handles updated_at automatically.
   *
   * @returns The updated post row.
   * @throws If the post does not exist (no rows affected).
   */
  async updateStatus(postId: string, status: string): Promise<Post> {
    const [post] = await this.db
      .update(posts)
      .set({ status: status as Post['status'] })
      .where(eq(posts.id, postId))
      .returning();
    return post;
  }

  /**
   * Soft-deletes a post by setting status to 'REMOVED'.
   * The DB trigger `trg_sync_user_post_counts` decrements user counters.
   */
  async softDelete(postId: string): Promise<Post> {
    const [post] = await this.db
      .update(posts)
      .set({ status: 'REMOVED' as Post['status'] })
      .where(eq(posts.id, postId))
      .returning();
    return post;
  }

  // ─── Engagement Toggles ───────────────────────────────────────────────

  /**
   * Toggles an upvote on a post. If the user has already upvoted, removes it.
   * If not, inserts a new upvote. All operations run in a single transaction:
   *   1. Check existing upvote
   *   2. INSERT or DELETE the upvote row
   *   3. Increment or decrement posts.upvote_count
   *   4. Update posts.last_engaged_at
   *   5. Recompute effective_score (ADOPTION only)
   *
   * @returns Object with `added` (true if upvote was added, false if removed)
   *          and the `updatedPost` row.
   */
  async toggleUpvote(postId: string, userId: string): Promise<{ added: boolean; updatedPost: Post }> {
    return this.db.transaction(async (tx) => {
      // Check if upvote already exists
      const [existing] = await tx
        .select()
        .from(postUpvotes)
        .where(and(eq(postUpvotes.postId, postId), eq(postUpvotes.userId, userId)))
        .limit(1);

      let added: boolean;

      if (existing) {
        // Remove upvote
        await tx
          .delete(postUpvotes)
          .where(and(eq(postUpvotes.postId, postId), eq(postUpvotes.userId, userId)));

        await tx
          .update(posts)
          .set({
            upvoteCount: sql`${posts.upvoteCount} - 1`,
            lastEngagedAt: sql`now()`,
          })
          .where(eq(posts.id, postId));

        added = false;
      } else {
        // Add upvote
        await tx.insert(postUpvotes).values({ postId, userId });

        await tx
          .update(posts)
          .set({
            upvoteCount: sql`${posts.upvoteCount} + 1`,
            lastEngagedAt: sql`now()`,
          })
          .where(eq(posts.id, postId));

        added = true;
      }

      // Recompute effective_score for ADOPTION posts
      // RESCUE/LOST always have score 0 (urgency sort). PRODUCT has no upvotes.
      await tx.execute(sql`
        UPDATE posts SET effective_score =
          CASE WHEN post_type = 'ADOPTION' THEN
            (upvote_count * 3 + save_count * 2 + view_count * 0.1 + 1)
            / POWER(EXTRACT(EPOCH FROM (now() - created_at)) / 3600.0 + 2, 1.5)
          ELSE effective_score
          END
        WHERE id = ${postId}
      `);

      // Return the updated post
      const [updatedPost] = await tx
        .select()
        .from(posts)
        .where(eq(posts.id, postId))
        .limit(1);

      return { added, updatedPost };
    });
  }

  /**
   * Toggles a save/bookmark on a post. Same pattern as toggleUpvote.
   * Works on all 4 post types.
   * Recomputes effective_score for ADOPTION and PRODUCT.
   *
   * @returns Object with `added` and the `updatedPost` row.
   */
  async toggleSave(postId: string, userId: string): Promise<{ added: boolean; updatedPost: Post }> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(postSaves)
        .where(and(eq(postSaves.postId, postId), eq(postSaves.userId, userId)))
        .limit(1);

      let added: boolean;

      if (existing) {
        await tx
          .delete(postSaves)
          .where(and(eq(postSaves.postId, postId), eq(postSaves.userId, userId)));

        await tx
          .update(posts)
          .set({
            saveCount: sql`${posts.saveCount} - 1`,
            lastEngagedAt: sql`now()`,
          })
          .where(eq(posts.id, postId));

        added = false;
      } else {
        await tx.insert(postSaves).values({ postId, userId });

        await tx
          .update(posts)
          .set({
            saveCount: sql`${posts.saveCount} + 1`,
            lastEngagedAt: sql`now()`,
          })
          .where(eq(posts.id, postId));

        added = true;
      }

      // Recompute effective_score for ADOPTION and PRODUCT
      await tx.execute(sql`
        UPDATE posts SET effective_score =
          CASE
            WHEN post_type = 'ADOPTION' THEN
              (upvote_count * 3 + save_count * 2 + view_count * 0.1 + 1)
              / POWER(EXTRACT(EPOCH FROM (now() - created_at)) / 3600.0 + 2, 1.5)
            WHEN post_type = 'PRODUCT' THEN
              (view_count * 1 + save_count * 5 + 1)
              / POWER(EXTRACT(EPOCH FROM (now() - created_at)) / 3600.0 + 2, 1.5)
            ELSE effective_score
          END
        WHERE id = ${postId}
      `);

      const [updatedPost] = await tx
        .select()
        .from(posts)
        .where(eq(posts.id, postId))
        .limit(1);

      return { added, updatedPost };
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
      .where(
        and(
          eq(postUpvotes.userId, userId),
          inArray(postUpvotes.postId, postIds as string[]),
        ),
      );

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
      .where(
        and(
          eq(postSaves.userId, userId),
          inArray(postSaves.postId, postIds as string[]),
        ),
      );

    return new Set(rows.map((r) => r.postId));
  }

  /**
   * Creates a DataLoader that batch-checks "has this user upvoted each post?"
   * Returns boolean per post ID.
   */
  createUpvotedByMeLoader(userId: string | undefined): DataLoader<string, boolean> {
    return new DataLoader<string, boolean>(
      async (postIds) => {
        if (!userId) return postIds.map(() => false);
        const upvotedSet = await this.findUpvotesByUserForPosts(userId, postIds);
        return postIds.map((id) => upvotedSet.has(id));
      },
      { cache: true, maxBatchSize: 100 },
    );
  }

  /**
   * Creates a DataLoader that batch-checks "has this user saved each post?"
   * Returns boolean per post ID.
   */
  createSavedByMeLoader(userId: string | undefined): DataLoader<string, boolean> {
    return new DataLoader<string, boolean>(
      async (postIds) => {
        if (!userId) return postIds.map(() => false);
        const savedSet = await this.findSavesByUserForPosts(userId, postIds);
        return postIds.map((id) => savedSet.has(id));
      },
      { cache: true, maxBatchSize: 100 },
    );
  }

  // ─── Feed Query Helpers ──────────────────────────────────────────────

  /**
   * Builds the city/governorate WHERE condition.
   * If cityId is provided, filters to that exact city.
   * Otherwise, includes all cities in the governorate via subquery.
   */
  private buildLocationFilter(
    governorate: string,
    cityId: string | null | undefined,
  ): SQL {
    if (cityId) {
      return sql`p.city_id = ${cityId}`;
    }
    return sql`p.city_id IN (SELECT id FROM cities WHERE governorate = ${governorate})`;
  }

  /**
   * Converts viewer GPS coordinates to PostGIS EWKT point string.
   * Returns null if no viewer location provided.
   */
  private buildViewerPointEwkt(
    viewerLocation: { latitude: number; longitude: number } | null | undefined,
  ): string | null {
    if (!viewerLocation) return null;
    return `SRID=4326;POINT(${viewerLocation.longitude} ${viewerLocation.latitude})`;
  }

  /**
   * Builds the ST_Distance expression for distance-in-km calculation.
   * Returns NULL::double precision when no viewer location is provided.
   *
   * Uses ::geography cast for accurate meter-based distance on Earth's surface.
   */
  private buildDistanceExpr(viewerPoint: string | null): SQL {
    if (viewerPoint) {
      return sql`ST_Distance(p.coordinates::geography, ST_GeomFromEWKT(${viewerPoint})::geography) / 1000.0`;
    }
    return sql`NULL::double precision`;
  }

  /**
   * Maps a raw PostgreSQL row (snake_case) to a Drizzle Post object (camelCase).
   * Required because raw SQL via db.execute() returns snake_case column names.
   */
  private mapRawToPost(raw: Record<string, unknown>): Post {
    return {
      id: raw.id as string,
      creatorId: raw.creator_id as string,
      postType: raw.post_type as Post['postType'],
      title: raw.title as string,
      description: raw.description as string,
      status: raw.status as Post['status'],
      moderationStatus: raw.moderation_status as Post['moderationStatus'],
      urgency: (raw.urgency as Post['urgency']) ?? null,
      cityId: raw.city_id as string,
      areaName: (raw.area_name as string) ?? null,
      coordinates: raw.coordinates as Post['coordinates'],
      marketCategory: (raw.market_category as Post['marketCategory']) ?? null,
      upvoteCount: Number(raw.upvote_count),
      saveCount: Number(raw.save_count),
      viewCount: Number(raw.view_count),
      reportCount: Number(raw.report_count),
      effectiveScore: Number(raw.effective_score),
      lastEngagedAt: new Date(raw.last_engaged_at as string),
      createdAt: new Date(raw.created_at as string),
      updatedAt: new Date(raw.updated_at as string),
    };
  }

  /**
   * Maps raw SQL result rows to FeedResultRow[] with hasNextPage detection.
   * Uses the limit+1 trick: if we got more rows than requested, there are more pages.
   */
  private mapFeedResult(
    rawRows: Record<string, unknown>[],
    limit: number,
  ): FeedResult {
    const hasNextPage = rawRows.length > limit;
    const trimmed = hasNextPage ? rawRows.slice(0, limit) : rawRows;

    return {
      rows: trimmed.map((raw) => ({
        post: this.mapRawToPost(raw),
        distanceKm:
          raw.distance_km != null ? Number(raw.distance_km) : null,
      })),
      hasNextPage,
    };
  }

  // ─── Feed Queries ───────────────────────────────────────────────────────

  /**
   * Help Feed — RESCUE + LOST posts sorted by urgency ASC, then newest.
   *
   * ## Index
   * `idx_posts_help_feed (city_id, post_type, urgency ASC, created_at DESC)`
   * `WHERE status = 'ACTIVE' AND post_type IN ('RESCUE', 'LOST')`
   *
   * ## Cursor (keyset pagination, no OFFSET)
   * Composite: `urgency|createdAt|id`
   * Uses UUIDv7 id as final tiebreaker for deterministic ordering.
   *
   * ## PostGIS
   * - ST_DWithin: radius filter (uses GIST index on coordinates)
   * - ST_Distance: computes distance in meters, converted to km
   * - Both use ::geography cast for accurate Earth-surface distances
   */
  async findHelpFeed(params: {
    governorate: string;
    cityId: string | null | undefined;
    viewerLocation: { latitude: number; longitude: number } | null | undefined;
    radiusKm: number;
    limit: number;
    cursor: { urgency: string; createdAt: string; id: string } | null;
  }): Promise<FeedResult> {
    const { governorate, cityId, viewerLocation, radiusKm, limit, cursor } = params;
    const fetchLimit = limit + 1;
    const viewerPoint = this.buildViewerPointEwkt(viewerLocation);
    const radiusMeters = radiusKm * 1000;

    const conditions: SQL[] = [
      sql`p.status = 'ACTIVE'`,
      sql`p.post_type IN ('RESCUE', 'LOST')`,
      this.buildLocationFilter(governorate, cityId),
    ];

    if (viewerPoint) {
      conditions.push(
        sql`ST_DWithin(p.coordinates::geography, ST_GeomFromEWKT(${viewerPoint})::geography, ${radiusMeters})`,
      );
    }

    if (cursor) {
      conditions.push(sql`(
        p.urgency > ${cursor.urgency}::urgency_tier
        OR (p.urgency = ${cursor.urgency}::urgency_tier AND p.created_at < ${cursor.createdAt}::timestamptz)
        OR (p.urgency = ${cursor.urgency}::urgency_tier AND p.created_at = ${cursor.createdAt}::timestamptz AND p.id < ${cursor.id}::uuid)
      )`);
    }

    const whereClause = sql.join(conditions, sql` AND `);
    const distanceExpr = this.buildDistanceExpr(viewerPoint);

    const result = await this.db.execute(sql`
      SELECT p.*, ${distanceExpr} AS distance_km
      FROM posts p
      WHERE ${whereClause}
      ORDER BY p.urgency ASC, p.created_at DESC, p.id DESC
      LIMIT ${fetchLimit}
    `);

    const rawRows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
    return this.mapFeedResult(rawRows, limit);
  }

  /**
   * Adopt Feed — ADOPTION posts sorted by effective_score (HOT) or newest.
   *
   * ## Indexes
   * HOT:  `idx_posts_adopt_score (city_id, effective_score DESC, created_at DESC)`
   * NEWEST: Primary key index (UUIDv7 id is time-ordered)
   *
   * ## Cursor
   * HOT: `score|createdAt|id` — composite keyset
   * NEWEST: `id` — simple UUIDv7 cursor (embeds timestamp)
   */
  async findAdoptFeed(params: {
    governorate: string;
    cityId: string | null | undefined;
    viewerLocation: { latitude: number; longitude: number } | null | undefined;
    radiusKm: number;
    sort: 'HOT' | 'NEWEST';
    limit: number;
    cursor: { score?: string; createdAt?: string; id: string } | null;
  }): Promise<FeedResult> {
    const { governorate, cityId, viewerLocation, radiusKm, sort, limit, cursor } = params;
    const fetchLimit = limit + 1;
    const viewerPoint = this.buildViewerPointEwkt(viewerLocation);
    const radiusMeters = radiusKm * 1000;

    const conditions: SQL[] = [
      sql`p.status = 'ACTIVE'`,
      sql`p.post_type = 'ADOPTION'`,
      this.buildLocationFilter(governorate, cityId),
    ];

    if (viewerPoint) {
      conditions.push(
        sql`ST_DWithin(p.coordinates::geography, ST_GeomFromEWKT(${viewerPoint})::geography, ${radiusMeters})`,
      );
    }

    let orderClause: SQL;

    if (sort === 'HOT') {
      if (cursor) {
        conditions.push(sql`(
          p.effective_score < ${Number(cursor.score)}
          OR (p.effective_score = ${Number(cursor.score)} AND p.created_at < ${cursor.createdAt!}::timestamptz)
          OR (p.effective_score = ${Number(cursor.score)} AND p.created_at = ${cursor.createdAt!}::timestamptz AND p.id < ${cursor.id}::uuid)
        )`);
      }
      orderClause = sql`p.effective_score DESC, p.created_at DESC, p.id DESC`;
    } else {
      if (cursor) {
        conditions.push(sql`p.id < ${cursor.id}::uuid`);
      }
      orderClause = sql`p.id DESC`;
    }

    const whereClause = sql.join(conditions, sql` AND `);
    const distanceExpr = this.buildDistanceExpr(viewerPoint);

    const result = await this.db.execute(sql`
      SELECT p.*, ${distanceExpr} AS distance_km
      FROM posts p
      WHERE ${whereClause}
      ORDER BY ${orderClause}
      LIMIT ${fetchLimit}
    `);

    const rawRows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
    return this.mapFeedResult(rawRows, limit);
  }

  /**
   * Market Feed — PRODUCT posts sorted by effective_score (HOT) or newest.
   * Supports optional category filtering using denormalized market_category.
   *
   * ## Indexes
   * HOT (no category):  `idx_posts_market_score (city_id, effective_score DESC, created_at DESC)`
   * HOT (with category): `idx_posts_market_category (city_id, market_category, effective_score DESC, created_at DESC)`
   * NEWEST: Primary key index (UUIDv7)
   */
  async findMarketFeed(params: {
    governorate: string;
    cityId: string | null | undefined;
    viewerLocation: { latitude: number; longitude: number } | null | undefined;
    radiusKm: number;
    sort: 'HOT' | 'NEWEST';
    category: string | null | undefined;
    limit: number;
    cursor: { score?: string; createdAt?: string; id: string } | null;
  }): Promise<FeedResult> {
    const { governorate, cityId, viewerLocation, radiusKm, sort, category, limit, cursor } = params;
    const fetchLimit = limit + 1;
    const viewerPoint = this.buildViewerPointEwkt(viewerLocation);
    const radiusMeters = radiusKm * 1000;

    const conditions: SQL[] = [
      sql`p.status = 'ACTIVE'`,
      sql`p.post_type = 'PRODUCT'`,
      this.buildLocationFilter(governorate, cityId),
    ];

    if (category) {
      conditions.push(sql`p.market_category = ${category}`);
    }

    if (viewerPoint) {
      conditions.push(
        sql`ST_DWithin(p.coordinates::geography, ST_GeomFromEWKT(${viewerPoint})::geography, ${radiusMeters})`,
      );
    }

    let orderClause: SQL;

    if (sort === 'HOT') {
      if (cursor) {
        conditions.push(sql`(
          p.effective_score < ${Number(cursor.score)}
          OR (p.effective_score = ${Number(cursor.score)} AND p.created_at < ${cursor.createdAt!}::timestamptz)
          OR (p.effective_score = ${Number(cursor.score)} AND p.created_at = ${cursor.createdAt!}::timestamptz AND p.id < ${cursor.id}::uuid)
        )`);
      }
      orderClause = sql`p.effective_score DESC, p.created_at DESC, p.id DESC`;
    } else {
      if (cursor) {
        conditions.push(sql`p.id < ${cursor.id}::uuid`);
      }
      orderClause = sql`p.id DESC`;
    }

    const whereClause = sql.join(conditions, sql` AND `);
    const distanceExpr = this.buildDistanceExpr(viewerPoint);

    const result = await this.db.execute(sql`
      SELECT p.*, ${distanceExpr} AS distance_km
      FROM posts p
      WHERE ${whereClause}
      ORDER BY ${orderClause}
      LIMIT ${fetchLimit}
    `);

    const rawRows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
    return this.mapFeedResult(rawRows, limit);
  }

  /**
   * Home Feed — All post types combined, sorted by newest (UUIDv7 id DESC).
   *
   * ## Sort rationale
   * Mixing post types with different scoring algorithms (urgency for RESCUE,
   * effective_score for ADOPTION) in a single ranked feed would be confusing.
   * Chronological order (newest first) is the industry standard for mixed-type
   * home feeds (Instagram, Twitter/X).
   *
   * ## Cursor
   * Simple UUIDv7 id cursor — no composite needed since sort is single-column.
   */
  async findHomeFeed(params: {
    governorate: string;
    cityId: string | null | undefined;
    viewerLocation: { latitude: number; longitude: number } | null | undefined;
    radiusKm: number;
    limit: number;
    cursor: { id: string } | null;
  }): Promise<FeedResult> {
    const { governorate, cityId, viewerLocation, radiusKm, limit, cursor } = params;
    const fetchLimit = limit + 1;
    const viewerPoint = this.buildViewerPointEwkt(viewerLocation);
    const radiusMeters = radiusKm * 1000;

    const conditions: SQL[] = [
      sql`p.status = 'ACTIVE'`,
      this.buildLocationFilter(governorate, cityId),
    ];

    if (viewerPoint) {
      conditions.push(
        sql`ST_DWithin(p.coordinates::geography, ST_GeomFromEWKT(${viewerPoint})::geography, ${radiusMeters})`,
      );
    }

    if (cursor) {
      conditions.push(sql`p.id < ${cursor.id}::uuid`);
    }

    const whereClause = sql.join(conditions, sql` AND `);
    const distanceExpr = this.buildDistanceExpr(viewerPoint);

    const result = await this.db.execute(sql`
      SELECT p.*, ${distanceExpr} AS distance_km
      FROM posts p
      WHERE ${whereClause}
      ORDER BY p.id DESC
      LIMIT ${fetchLimit}
    `);

    const rawRows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
    return this.mapFeedResult(rawRows, limit);
  }

  // ─── View Count Batch Update ────────────────────────────────────────────

  /**
   * Atomically increments view counts for multiple posts in a single SQL UPDATE.
   * Also recomputes effective_score for ADOPTION and PRODUCT posts.
   * Updates last_engaged_at for PRODUCT posts (views are primary organic signal).
   *
   * ## SQL strategy
   * Uses a VALUES list joined via FROM clause for O(1) round-trips:
   *   UPDATE posts SET view_count += v.cnt
   *   FROM (VALUES ('id1', 5), ('id2', 3)) AS v(post_id, cnt)
   *   WHERE posts.id = v.post_id
   *
   * ## Called by
   * ViewFlushCron.handleFlush() — every 3 minutes.
   */
  async bulkIncrementViews(viewCounts: Map<string, number>): Promise<void> {
    if (viewCounts.size === 0) return;

    const entries = [...viewCounts.entries()];
    const valuesList = entries.map(
      ([postId, count]) => sql`(${postId}::uuid, ${count}::int)`,
    );

    await this.db.execute(sql`
      UPDATE posts p
      SET
        view_count = p.view_count + v.cnt,
        effective_score = CASE
          WHEN p.post_type = 'ADOPTION' THEN
            ((p.upvote_count * 3 + p.save_count * 2 + (p.view_count + v.cnt) * 0.1 + 1)
             / POWER(EXTRACT(EPOCH FROM (now() - p.created_at)) / 3600.0 + 2, 1.5))
          WHEN p.post_type = 'PRODUCT' THEN
            (((p.view_count + v.cnt) * 1 + p.save_count * 5 + 1)
             / POWER(EXTRACT(EPOCH FROM (now() - p.created_at)) / 3600.0 + 2, 1.5))
          ELSE p.effective_score
        END,
        last_engaged_at = CASE
          WHEN p.post_type = 'PRODUCT' THEN now()
          ELSE p.last_engaged_at
        END
      FROM (VALUES ${sql.join(valuesList, sql`, `)}) AS v(post_id, cnt)
      WHERE p.id = v.post_id AND p.status = 'ACTIVE'
    `);
  }
}

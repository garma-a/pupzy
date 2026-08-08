import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { PostsRepository } from './posts.repository';
import { CitiesService } from '../cities/cities.service';
import { UploadService } from '../upload/upload.service';
import { shouldFlagContent } from '../common/utils/moderation.util';
import { ValidationError, NotFoundError, ForbiddenError } from '../common/errors/app.errors';
import { assertUuid } from '../common/utils/validate-uuid';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { Post, NewPost, NewPostMedia, RescuePost, LostPost, AdoptionPost, ProductPost } from '../database/schema';
import type { CreateRescuePostInput } from './dto/create-rescue-post.input';
import type { CreateLostPostInput } from './dto/create-lost-post.input';
import type { CreateAdoptionPostInput } from './dto/create-adoption-post.input';
import type { CreateProductPostInput } from './dto/create-product-post.input';
import type { FeedResult } from './posts.repository';
import type { HelpFeedInput, AdoptFeedInput, MarketFeedInput, HomeFeedInput } from './dto/feed-query.input';
import { ViewFlushCron } from './view-flush.cron';

/**
 * PostsService — business logic layer for post creation.
 *
 * ## Responsibilities
 * 1. **City resolution** — resolves cityId from dropdown OR auto-resolves from GPS
 * 2. **Moderation** — runs keyword blocklist check, sets moderation_status
 * 3. **Media finalization** — generates URLs for DB, then moves files asynchronously
 * 4. **Data assembly** — builds base + extension table data
 * 5. **Transaction delegation** — calls PostsRepository for atomic insert
 */
@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly postsRepository: PostsRepository,
    private readonly citiesService: CitiesService,
    private readonly uploadService: UploadService,
    private readonly viewFlushCron: ViewFlushCron,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  // ─── RESCUE ──────────────────────────────────────────────────────────────

  async createRescuePost(creatorId: string, input: CreateRescuePostInput): Promise<Post> {
    const postId = generateUuidV7();
    const cityId = await this.resolveCity(input.cityId, input.coordinates);
    const moderationStatus = this.checkModeration(input.title, input.description);
    const mediaRows = await this.prepareMedia(input.mediaIds, postId);

    const baseData: NewPost = {
      id: postId,
      creatorId,
      postType: 'RESCUE',
      title: input.title,
      description: input.description,
      status: 'ACTIVE',
      moderationStatus,
      urgency: input.urgency,
      cityId,
      areaName: input.areaName,
      coordinates: [input.coordinates.longitude, input.coordinates.latitude],
      effectiveScore: 0.0,
    };

    const post = await this.postsRepository.createRescuePost(
      baseData,
      {
        species: input.species,
        conditionSummary: input.conditionSummary,
        reporterRole: input.reporterRole,
      },
      mediaRows,
    );

    this.runFinalizeMediaAsync(input.mediaIds, creatorId, postId);
    // Bust stale user cache — DB trigger updated post counts
    this.usersService.invalidateUserCacheById(creatorId).catch(() => {});
    return post;
  }

  // ─── LOST ────────────────────────────────────────────────────────────────

  async createLostPost(creatorId: string, input: CreateLostPostInput): Promise<Post> {
    const postId = generateUuidV7();
    const cityId = await this.resolveCity(input.cityId, input.coordinates);
    const moderationStatus = this.checkModeration(input.title, input.description);
    const mediaRows = await this.prepareMedia(input.mediaIds, postId);

    const baseData: NewPost = {
      id: postId,
      creatorId,
      postType: 'LOST',
      title: input.title,
      description: input.description,
      status: 'ACTIVE',
      moderationStatus,
      urgency: input.urgency,
      cityId,
      areaName: input.areaName,
      coordinates: [input.coordinates.longitude, input.coordinates.latitude],
      effectiveScore: 0.0,
    };

    const post = await this.postsRepository.createLostPost(
      baseData,
      {
        reportType: input.reportType,
        species: input.species,
        breed: input.breed,
        colorAndMarkings: input.colorAndMarkings,
        hasCollarWithIdentificationTag: input.hasCollarWithIdentificationTag,
        circumstances: input.circumstances,
        petName: input.petName,
        dateLastSeen: input.dateLastSeen,
        currentCondition: input.currentCondition,
        isCurrentlySafeWithReporter: input.isCurrentlySafeWithReporter,
        dateFound: input.dateFound,
      },
      mediaRows,
    );

    this.runFinalizeMediaAsync(input.mediaIds, creatorId, postId);
    // Bust stale user cache — DB trigger updated post counts
    this.usersService.invalidateUserCacheById(creatorId).catch(() => {});
    return post;
  }

  // ─── ADOPTION ────────────────────────────────────────────────────────────

  async createAdoptionPost(creatorId: string, input: CreateAdoptionPostInput): Promise<Post> {
    const postId = generateUuidV7();
    const cityId = await this.resolveCity(input.cityId, input.coordinates);
    const moderationStatus = this.checkModeration(input.title, input.description);
    const mediaRows = await this.prepareMedia(input.mediaIds, postId);

    const baseData: NewPost = {
      id: postId,
      creatorId,
      postType: 'ADOPTION',
      title: input.title,
      description: input.description,
      status: 'ACTIVE',
      moderationStatus,
      urgency: undefined,
      cityId,
      areaName: input.areaName,
      coordinates: [input.coordinates.longitude, input.coordinates.latitude],
      effectiveScore: 0.0,
    };

    const post = await this.postsRepository.createAdoptionPost(
      baseData,
      {
        petName: input.petName,
        species: input.species,
        breed: input.breed,
        ageValue: input.ageValue,
        ageUnit: input.ageUnit,
        gender: input.gender,
        vaccinated: input.vaccinated,
        neutered: input.neutered,
        healthNotes: input.healthNotes,
        personalityTags: input.personalityTags ?? [],
        spaceRequirement: input.spaceRequirement,
        priorPetExperienceRequired: input.priorPetExperienceRequired,
        additionalRequirements: input.additionalRequirements,
        currentlyWith: input.currentlyWith,
      },
      mediaRows,
    );

    this.runFinalizeMediaAsync(input.mediaIds, creatorId, postId);
    // Bust stale user cache — DB trigger updated post counts
    this.usersService.invalidateUserCacheById(creatorId).catch(() => {});
    return post;
  }

  // ─── PRODUCT ─────────────────────────────────────────────────────────────

  async createProductPost(creatorId: string, input: CreateProductPostInput): Promise<Post> {
    const postId = generateUuidV7();
    const cityId = await this.resolveCity(input.cityId, input.coordinates);
    const moderationStatus = this.checkModeration(input.title, input.description);
    const mediaRows = await this.prepareMedia(input.mediaIds, postId);

    const baseData: NewPost = {
      id: postId,
      creatorId,
      postType: 'PRODUCT',
      title: input.title,
      description: input.description,
      status: 'ACTIVE',
      moderationStatus,
      urgency: undefined,
      cityId,
      areaName: input.areaName,
      coordinates: [input.coordinates.longitude, input.coordinates.latitude],
      marketCategory: input.category,
      effectiveScore: 0.0,
    };

    const post = await this.postsRepository.createProductPost(
      baseData,
      {
        category: input.category,
        condition: input.condition,
        priceAmount: input.isFree ? undefined : String(input.priceAmount),
        priceCurrency: input.priceCurrency ?? 'EGP',
        isFree: input.isFree,
        openToOffers: input.openToOffers ?? false,
      },
      mediaRows,
    );

    this.runFinalizeMediaAsync(input.mediaIds, creatorId, postId);
    // Bust stale user cache — DB trigger updated post counts
    this.usersService.invalidateUserCacheById(creatorId).catch(() => {});
    return post;
  }

  // ─── Read ───────────────────────────────────────────────────────────────

  /**
   * Fetches a single post by ID.
   * Returns null if the post does not exist or has been soft-deleted (REMOVED).
   * Used by the `post(id)` query resolver.
   */
  async getPost(postId: string): Promise<Post | null> {
    assertUuid(postId, 'postId');
    const post = await this.postsRepository.findById(postId);
    if (!post || post.status === 'REMOVED') return null;
    return post;
  }

  /**
   * Fetches the RESCUE extension data for a post's detail screen.
   * @throws {NotFoundError} if the extension row does not exist.
   */
  async getRescueDetail(postId: string): Promise<RescuePost> {
    assertUuid(postId, 'postId');
    const detail = await this.postsRepository.findRescueDetail(postId);
    if (!detail) throw new NotFoundError('RescuePost', postId);
    return detail;
  }

  /**
   * Fetches the LOST extension data for a post's detail screen.
   * @throws {NotFoundError} if the extension row does not exist.
   */
  async getLostDetail(postId: string): Promise<LostPost> {
    assertUuid(postId, 'postId');
    const detail = await this.postsRepository.findLostDetail(postId);
    if (!detail) throw new NotFoundError('LostPost', postId);
    return detail;
  }

  /**
   * Fetches the ADOPTION extension data for a post's detail screen.
   * @throws {NotFoundError} if the extension row does not exist.
   */
  async getAdoptionDetail(postId: string): Promise<AdoptionPost> {
    assertUuid(postId, 'postId');
    const detail = await this.postsRepository.findAdoptionDetail(postId);
    if (!detail) throw new NotFoundError('AdoptionPost', postId);
    return detail;
  }

  /**
   * Fetches the PRODUCT extension data for a post's detail screen.
   * @throws {NotFoundError} if the extension row does not exist.
   */
  async getProductDetail(postId: string): Promise<ProductPost> {
    assertUuid(postId, 'postId');
    const detail = await this.postsRepository.findProductDetail(postId);
    if (!detail) throw new NotFoundError('ProductPost', postId);
    return detail;
  }

  // ─── Delete ─────────────────────────────────────────────────────────────

  /**
   * Soft-deletes a post by setting its status to REMOVED.
   * Only the post creator can delete their own post.
   *
   * The DB trigger `trg_sync_user_post_counts` automatically decrements
   * the user's post counters when status changes to REMOVED.
   *
   * @throws {NotFoundError} if the post does not exist or is already REMOVED.
   * @throws {ForbiddenError} if the caller is not the post creator.
   */
  async deletePost(postId: string, userId: string): Promise<void> {
    assertUuid(postId, 'postId');
    const post = await this.postsRepository.findById(postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', postId);
    }
    if (post.creatorId !== userId) {
      throw new ForbiddenError('You can only delete your own posts');
    }
    await this.postsRepository.softDelete(postId);
    await this.usersService.invalidateUserCacheById(userId).catch(() => {});
  }

  // ─── Status Update ──────────────────────────────────────────────────────

  /**
   * Valid status transitions per post type.
   * - RESCUE  → RESOLVED (animal was helped)
   * - LOST    → REUNITED (pet was found)
   * - ADOPTION → ADOPTED (pet was adopted)
   * - PRODUCT  → SOLD (item was sold)
   *
   * All transitions are from ACTIVE to a terminal state.
   * REMOVED is handled by `deletePost`, not this method.
   */
  private static readonly ALLOWED_TRANSITIONS: Record<string, string[]> = {
    RESCUE: ['RESOLVED'],
    LOST: ['REUNITED'],
    ADOPTION: ['ADOPTED'],
    PRODUCT: ['SOLD'],
  };

  /**
   * Updates a post's lifecycle status with transition validation.
   *
   * @throws {NotFoundError} if the post does not exist or is REMOVED.
   * @throws {ForbiddenError} if the caller is not the post creator.
   * @throws {ValidationError} if the status transition is invalid for this post type.
   */
  async updatePostStatus(postId: string, userId: string, status: string): Promise<Post> {
    assertUuid(postId, 'postId');
    const post = await this.postsRepository.findById(postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', postId);
    }
    if (post.creatorId !== userId) {
      throw new ForbiddenError('You can only update the status of your own posts');
    }
    if (post.status !== 'ACTIVE') {
      throw new ValidationError(`Post is already in "${post.status}" status and cannot be changed`);
    }

    const allowed = PostsService.ALLOWED_TRANSITIONS[post.postType] ?? [];
    if (!allowed.includes(status)) {
      throw new ValidationError(
        `${post.postType} posts can only transition to: ${allowed.join(', ')}. Got: "${status}"`,
      );
    }

    const updatedPost = await this.postsRepository.updateStatus(postId, status);
    await this.usersService.invalidateUserCacheById(post.creatorId).catch(() => {});
    return updatedPost;
  }

  // ─── Engagement Toggles ─────────────────────────────────────────────────

  /**
   * Toggles an upvote on a post.
   *
   * ## Business rules
   * - PRODUCT posts cannot be upvoted (Market has no upvote button).
   * - RESCUE/LOST upvotes exist but don't affect effective_score (urgency sort).
   * - ADOPTION upvotes recalculate effective_score inside the transaction.
   *
   * @throws {NotFoundError} if the post does not exist or is REMOVED.
   * @throws {ValidationError} if the post is a PRODUCT post.
   * @throws {ForbiddenError} if the user tries to upvote their own post.
   */
  async toggleUpvote(postId: string, userId: string): Promise<Post> {
    assertUuid(postId, 'postId');
    const post = await this.postsRepository.findById(postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', postId);
    }
    if (post.postType === 'PRODUCT') {
      throw new ValidationError('PRODUCT posts cannot be upvoted — Market has no upvote button');
    }
    if (post.creatorId === userId) {
      throw new ForbiddenError('You cannot upvote your own post');
    }

    const { added, updatedPost } = await this.postsRepository.toggleUpvote(postId, userId);

    // Fire notification to post owner on new upvote (non-blocking)
    if (added) {
      const voter = await this.usersService.findById(userId);
      this.notificationsService.fireNotification(
        {
          recipientId: post.creatorId,
          type: 'NEW_UPVOTE',
          title: 'New upvote',
          body: `${voter?.fullName ?? 'Someone'} upvoted your post "${post.title}"`,
          relatedPostId: postId,
        },
        userId,
      );
    }

    return updatedPost;
  }

  /**
   * Toggles a save/bookmark on a post.
   *
   * ## Business rules
   * - All 4 post types support saves.
   * - On PRODUCT, a save acts as a buyer wishlist/bookmark.
   * - Recalculates effective_score for ADOPTION and PRODUCT.
   *
   * @throws {NotFoundError} if the post does not exist or is REMOVED.
   */
  async toggleSave(postId: string, userId: string): Promise<Post> {
    assertUuid(postId, 'postId');
    const post = await this.postsRepository.findById(postId);
    if (!post || post.status === 'REMOVED') {
      throw new NotFoundError('Post', postId);
    }

    const { added, updatedPost } = await this.postsRepository.toggleSave(postId, userId);

    // Fire notification to post owner on new save (non-blocking)
    if (added && post.creatorId !== userId) {
      const saver = await this.usersService.findById(userId);
      this.notificationsService.fireNotification(
        {
          recipientId: post.creatorId,
          type: 'POST_SAVED',
          title: 'Post saved',
          body: `${saver?.fullName ?? 'Someone'} saved your post "${post.title}"`,
          relatedPostId: postId,
        },
        userId,
      );
    }

    return updatedPost;
  }

  // ─── Feeds ──────────────────────────────────────────────────────────────

  private decodeCursor<T = Record<string, unknown>>(cursorBase64: string | null | undefined): T | null {
    if (!cursorBase64) return null;
    try {
      return JSON.parse(Buffer.from(cursorBase64, 'base64url').toString('utf8')) as T;
    } catch {
      throw new ValidationError('Invalid cursor format');
    }
  }

  private encodeCursor(cursorObj: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(cursorObj), 'utf8').toString('base64url');
  }

  private mapFeedResultToConnection(result: FeedResult, buildCursorObj: (post: Post) => Record<string, unknown>) {
    return {
      edges: result.rows.map((row) => ({
        node: row.post,
        cursor: this.encodeCursor(buildCursorObj(row.post)),
        distanceKm: row.distanceKm,
      })),
      pageInfo: {
        hasNextPage: result.hasNextPage,
        endCursor:
          result.rows.length > 0 ? this.encodeCursor(buildCursorObj(result.rows[result.rows.length - 1].post)) : null,
      },
    };
  }

  async getHelpFeed(input: HelpFeedInput) {
    const result = await this.postsRepository.findHelpFeed({
      governorate: input.governorate,
      cityId: input.cityId,
      viewerLocation: input.viewerLocation,
      radiusKm: input.radiusKm ?? 25,
      limit: Math.min(input.first ?? 20, 50),
      cursor: this.decodeCursor<{ urgency: string; createdAt: string; id: string }>(input.after),
    });
    return this.mapFeedResultToConnection(result, (post) => ({
      urgency: post.urgency,
      createdAt: post.createdAt.toISOString(),
      id: post.id,
    }));
  }

  async getAdoptFeed(input: AdoptFeedInput) {
    const sort = input.sort ?? 'HOT';
    const result = await this.postsRepository.findAdoptFeed({
      governorate: input.governorate,
      cityId: input.cityId,
      viewerLocation: input.viewerLocation,
      radiusKm: input.radiusKm ?? 25,
      sort,
      limit: Math.min(input.first ?? 20, 50),
      cursor: this.decodeCursor<{ score?: string; createdAt?: string; id: string }>(input.after),
    });
    return this.mapFeedResultToConnection(result, (post) =>
      sort === 'HOT'
        ? { score: post.effectiveScore, createdAt: post.createdAt.toISOString(), id: post.id }
        : { id: post.id },
    );
  }

  async getMarketFeed(input: MarketFeedInput) {
    const sort = input.sort ?? 'HOT';
    const result = await this.postsRepository.findMarketFeed({
      governorate: input.governorate,
      cityId: input.cityId,
      viewerLocation: input.viewerLocation,
      radiusKm: input.radiusKm ?? 25,
      sort,
      category: input.category,
      limit: Math.min(input.first ?? 20, 50),
      cursor: this.decodeCursor<{ score?: string; createdAt?: string; id: string }>(input.after),
    });
    return this.mapFeedResultToConnection(result, (post) =>
      sort === 'HOT'
        ? { score: post.effectiveScore, createdAt: post.createdAt.toISOString(), id: post.id }
        : { id: post.id },
    );
  }

  async getHomeFeed(input: HomeFeedInput) {
    const result = await this.postsRepository.findHomeFeed({
      governorate: input.governorate,
      cityId: input.cityId,
      viewerLocation: input.viewerLocation,
      radiusKm: input.radiusKm ?? 25,
      limit: Math.min(input.first ?? 20, 50),
      cursor: this.decodeCursor<{ id: string }>(input.after),
    });
    return this.mapFeedResultToConnection(result, (post) => ({ id: post.id }));
  }

  // ─── View Tracking ──────────────────────────────────────────────────────

  /**
   * Records a view on a post. Deduplicated per user per hour.
   * If not seen in the last hour, buffers the view for the cron to flush.
   */
  async recordView(postId: string, userId: string): Promise<boolean> {
    assertUuid(postId, 'postId');
    const lockKey = `view_dedup:${postId}:${userId}`;
    const alreadyViewed = await this.cacheManager.get(lockKey);

    if (!alreadyViewed) {
      await this.cacheManager.set(lockKey, true, 3600_000); // 1 hour TTL
      this.viewFlushCron.bufferView(postId);
    }

    return true; // Always return true (fire and forget)
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async resolveCity(
    cityId: string | undefined,
    coordinates: { latitude: number; longitude: number },
  ): Promise<string> {
    if (cityId) {
      const city = await this.citiesService.findById(cityId);
      if (!city) {
        throw new ValidationError(`cityId "${cityId}" does not correspond to a known city`);
      }
      return city.id;
    }

    const city = await this.citiesService.findNearest(coordinates.latitude, coordinates.longitude);
    if (!city) {
      throw new NotFoundError('No nearby city found for the provided coordinates.');
    }
    return city.id;
  }

  private checkModeration(title: string, description: string): 'FLAGGED' | 'PENDING_AUTO_REVIEW' {
    const flagged = shouldFlagContent(title, description);
    if (flagged) {
      this.logger.warn(`Post flagged by keyword blocklist: "${title.substring(0, 50)}..."`);
    }
    return flagged ? 'FLAGGED' : 'PENDING_AUTO_REVIEW';
  }

  private async prepareMedia(mediaIds: string[] | undefined, postId: string): Promise<Omit<NewPostMedia, 'postId'>[]> {
    if (!mediaIds || mediaIds.length === 0) return [];
    if (mediaIds.length > 4) {
      throw new ValidationError('Maximum 4 images allowed per post');
    }
    return Promise.all(mediaIds.map((mediaId) => this.uploadService.getExpectedMediaUrls(mediaId, postId)));
  }

  /**
   * Runs the actual R2 finalization AFTER the database transaction succeeds.
   * If this fails, the post remains but the images will appear broken to the client.
   * This is much safer than moving images before the DB transaction and risking orphans.
   */
  private runFinalizeMediaAsync(mediaIds: string[] | undefined, userId: string, postId: string): void {
    if (!mediaIds || mediaIds.length === 0) return;

    void Promise.allSettled(mediaIds.map((mediaId) => this.uploadService.finalizeMedia(mediaId, userId, postId))).then(
      (results) => {
        const failures = results.filter((r) => r.status === 'rejected');
        if (failures.length > 0) {
          this.logger.error(`Failed to finalize ${failures.length} media items for post ${postId}`);
        }
      },
    );
  }
}

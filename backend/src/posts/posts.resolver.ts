import { Resolver, Mutation, Query, Args, Context, ResolveField, Root } from '@nestjs/graphql';
import { PostsService } from './posts.service';
import { validateCreateRescuePostInput } from './dto/create-rescue-post.input';
import { validateCreateLostPostInput } from './dto/create-lost-post.input';
import { validateCreateAdoptionPostInput } from './dto/create-adoption-post.input';
import { validateCreateProductPostInput } from './dto/create-product-post.input';
import { validateUpdatePostStatusInput } from './dto/update-post-status.input';
import {
  validateHelpFeedInput,
  validateAdoptFeedInput,
  validateMarketFeedInput,
  validateHomeFeedInput,
  validateMySavedPostsInput,
  validateMyPostsInput,
} from './dto/feed-query.input';
import type { Post, City, PostMedia, RescuePost, LostPost, AdoptionPost, ProductPost } from '../database/schema';
import type { GqlContext } from '../common/types/gql-context.type';

/**
 * PostsResolver — GraphQL resolver for post CRUD, engagement, and field resolution.
 *
 * ## Authentication
 * All mutations are protected by the global `FirebaseAuthGuard`.
 * `@CurrentUser()` is available via `ctx.user` from GqlContext.
 *
 * ## Validation flow
 * 1. Raw GraphQL input arrives as `unknown`
 * 2. Zod DTO `validate*` function parses and validates
 * 3. Validated input is passed to PostsService
 *
 * ## Coordinate privacy
 * The `coordinates` field resolver enforces the privacy rule:
 * - RESCUE / LOST → coordinates returned as { latitude, longitude }
 * - ADOPTION / PRODUCT → coordinates always null (even if client requests them)
 */
@Resolver('Post')
export class PostsResolver {
  constructor(private readonly postsService: PostsService) {}

  // ─── Queries ────────────────────────────────────────────────────────────

  /**
   * Fetches a single post by ID.
   * Returns null if the post does not exist or has been soft-deleted.
   */
  @Query('post')
  async post(@Args('id') id: string): Promise<Post | null> {
    return this.postsService.getPost(id);
  }

  /**
   * Fetches RESCUE extension data for the single-post detail screen.
   * Returns null if the post is not of type RESCUE.
   */
  @Query('rescuePostDetail')
  async rescuePostDetail(@Args('postId') postId: string): Promise<RescuePost> {
    return this.postsService.getRescueDetail(postId);
  }

  /**
   * Fetches LOST extension data for the single-post detail screen.
   * Returns null if the post is not of type LOST.
   */
  @Query('lostPostDetail')
  async lostPostDetail(@Args('postId') postId: string): Promise<LostPost> {
    return this.postsService.getLostDetail(postId);
  }

  /**
   * Fetches ADOPTION extension data for the single-post detail screen.
   * Returns null if the post is not of type ADOPTION.
   */
  @Query('adoptionPostDetail')
  async adoptionPostDetail(@Args('postId') postId: string): Promise<AdoptionPost> {
    return this.postsService.getAdoptionDetail(postId);
  }

  /**
   * Fetches PRODUCT extension data for the single-post detail screen.
   * Returns null if the post is not of type PRODUCT.
   */
  @Query('productPostDetail')
  async productPostDetail(@Args('postId') postId: string): Promise<ProductPost> {
    return this.postsService.getProductDetail(postId);
  }

  // ─── Feeds ──────────────────────────────────────────────────────────────

  /**
   * Help Feed — RESCUE and LOST posts.
   */
  @Query('helpFeed')
  async helpFeed(@Args() args: unknown) {
    const input = validateHelpFeedInput(args);
    return this.postsService.getHelpFeed(input);
  }

  /**
   * Adopt Feed — ADOPTION posts.
   */
  @Query('adoptFeed')
  async adoptFeed(@Args() args: unknown) {
    const input = validateAdoptFeedInput(args);
    return this.postsService.getAdoptFeed(input);
  }

  /**
   * Market Feed — PRODUCT posts.
   */
  @Query('marketFeed')
  async marketFeed(@Args() args: unknown) {
    const input = validateMarketFeedInput(args);
    return this.postsService.getMarketFeed(input);
  }

  /**
   * Home Feed — All post types combined.
   */
  @Query('homeFeed')
  async homeFeed(@Args() args: unknown) {
    const input = validateHomeFeedInput(args);
    return this.postsService.getHomeFeed(input);
  }

  /**
   * Favorites / Saved Posts — posts saved/bookmarked by the current viewer,
   * newest save first. Keyset-paginated on (post_saves.created_at, post_saves.post_id).
   */
  @Query('mySavedPosts')
  async mySavedPosts(@Args() args: unknown, @Context() ctx: GqlContext) {
    const input = validateMySavedPostsInput(args);
    return this.postsService.getPostsSavedByCurrentUser(ctx.user!.id, input);
  }

  /**
   * My Posts — posts created by the current viewer, filtered by section (postType),
   * newest first. Keyset-paginated on UUIDv7 id DESC.
   */
  @Query('myPosts')
  async myPosts(@Args() args: unknown, @Context() ctx: GqlContext) {
    const input = validateMyPostsInput(args);
    return this.postsService.getPostsCreatedByCurrentUser(ctx.user!.id, input);
  }

  // ─── Create Mutations ──────────────────────────────────────────────────

  /**
   * Creates a RESCUE post.
   * Urgency is required. Coordinates visible to clients.
   */
  @Mutation('createRescuePost')
  async createRescuePost(@Args('input') input: unknown, @Context() ctx: GqlContext): Promise<Post> {
    const validated = validateCreateRescuePostInput(input);
    return this.postsService.createRescuePost(ctx.user!.id, validated);
  }

  /**
   * Creates a LOST post (LOST_PET or FOUND_STRAY).
   * Urgency is required. Coordinates visible to clients.
   */
  @Mutation('createLostPost')
  async createLostPost(@Args('input') input: unknown, @Context() ctx: GqlContext): Promise<Post> {
    const validated = validateCreateLostPostInput(input);
    return this.postsService.createLostPost(ctx.user!.id, validated);
  }

  /**
   * Creates an ADOPTION post.
   * No urgency. Coordinates hidden from clients.
   */
  @Mutation('createAdoptionPost')
  async createAdoptionPost(@Args('input') input: unknown, @Context() ctx: GqlContext): Promise<Post> {
    const validated = validateCreateAdoptionPostInput(input);
    return this.postsService.createAdoptionPost(ctx.user!.id, validated);
  }

  /**
   * Creates a PRODUCT post.
   * No urgency. Coordinates hidden from clients.
   */
  @Mutation('createProductPost')
  async createProductPost(@Args('input') input: unknown, @Context() ctx: GqlContext): Promise<Post> {
    const validated = validateCreateProductPostInput(input);
    return this.postsService.createProductPost(ctx.user!.id, validated);
  }

  // ─── Engagement Mutations ──────────────────────────────────────────────

  /**
   * Soft-deletes a post by setting status to REMOVED.
   * Only the post creator can delete their own post.
   */
  @Mutation('deletePost')
  async deletePost(@Args('postId') postId: string, @Context() ctx: GqlContext): Promise<boolean> {
    await this.postsService.deletePost(postId, ctx.user!.id);
    return true;
  }

  /**
   * Toggles an upvote on a post.
   * Rejected for PRODUCT posts (Market has no upvote button).
   * Recalculates effective_score for ADOPTION posts.
   */
  @Mutation('toggleUpvote')
  async toggleUpvote(@Args('postId') postId: string, @Context() ctx: GqlContext): Promise<Post> {
    return this.postsService.toggleUpvote(postId, ctx.user!.id);
  }

  /**
   * Toggles a save/bookmark on a post.
   * Works on all 4 post types. On PRODUCT acts as buyer wishlist.
   * Recalculates effective_score for ADOPTION and PRODUCT.
   */
  @Mutation('toggleSave')
  async toggleSave(@Args('postId') postId: string, @Context() ctx: GqlContext): Promise<Post> {
    return this.postsService.toggleSave(postId, ctx.user!.id);
  }

  /**
   * Updates a post's lifecycle status (e.g., ACTIVE → RESOLVED).
   * Only the post creator can change their own post's status.
   * Status transitions are validated per post type.
   */
  @Mutation('updatePostStatus')
  async updatePostStatus(
    @Args('postId') postId: string,
    @Args('status') status: string,
    @Context() ctx: GqlContext,
  ): Promise<Post> {
    const validated = validateUpdatePostStatusInput({ postId, status });
    return this.postsService.updatePostStatus(validated.postId, ctx.user!.id, validated.status);
  }

  // ─── View Tracking ──────────────────────────────────────────────────────

  /**
   * Records a view on a post. Deduplicated per user per hour.
   */
  @Mutation('recordView')
  async recordView(@Args('postId') postId: string, @Context() ctx: GqlContext): Promise<boolean> {
    return this.postsService.recordView(postId, ctx.user!.id);
  }

  // ─── Field Resolvers ───────────────────────────────────────────────────

  /**
   * Coordinate privacy enforcement.
   *
   * ## CRITICAL RULE
   * Coordinates are ONLY returned for RESCUE and LOST posts.
   * ADOPTION and PRODUCT coordinates are always nulled out — even if
   * the client explicitly requests them in the GraphQL query.
   * This is the single enforcement point for coordinate privacy.
   *
   * ## EWKT parsing
   * DB stores coordinates as "SRID=4326;POINT(lng lat)".
   * This resolver parses the EWKT string into { latitude, longitude }.
   */
  @ResolveField('coordinates')
  coordinates(@Root() post: Post): { latitude: number; longitude: number } | null {
    if (post.postType === 'ADOPTION' || post.postType === 'PRODUCT') {
      return null;
    }

    // Drizzle geometry(point) is mapped to [longitude, latitude] tuple
    if (Array.isArray(post.coordinates)) {
      const [longitude, latitude] = post.coordinates;
      return { latitude, longitude };
    }

    // Fallback if returned as EWKT string by pg driver
    if (typeof post.coordinates === 'string') {
      const match = (post.coordinates as string).match(/POINT\(([^ ]+) ([^ ]+)\)/);
      if (!match) return null;
      return {
        latitude: parseFloat(match[2]),
        longitude: parseFloat(match[1]),
      };
    }

    return null;
  }

  /**
   * Resolves the full City object for a post via the per-request DataLoader.
   * Batches all city-ID lookups within the same event-loop tick into
   * a single `WHERE id = ANY($1)` query.
   */
  @ResolveField('city')
  city(@Root() post: Post, @Context() ctx: GqlContext): Promise<City | null> {
    return ctx.loaders.cityById.load(post.cityId);
  }

  /**
   * Resolves the creator User object via DataLoader.
   * Returns the full user profile of whoever created this post.
   */
  @ResolveField('creator')
  creator(@Root() post: Post, @Context() ctx: GqlContext) {
    return ctx.loaders.userById.load(post.creatorId);
  }

  /**
   * Resolves all media (images) attached to this post via DataLoader.
   * Returns an ordered array — display_order 0 is the primary thumbnail.
   */
  @ResolveField('media')
  media(@Root() post: Post, @Context() ctx: GqlContext): Promise<PostMedia[]> {
    return ctx.loaders.mediaByPostId.load(post.id);
  }

  /**
   * Resolves whether the current viewer has upvoted this post.
   * Uses the per-request DataLoader to batch all checks into a single query.
   * Returns `false` for unauthenticated viewers.
   */
  @ResolveField('isUpvotedByMe')
  isUpvotedByMe(@Root() post: Post, @Context() ctx: GqlContext): Promise<boolean> {
    return ctx.loaders.upvotedByMe.load(post.id);
  }

  /**
   * Resolves whether the current viewer has saved/bookmarked this post.
   * Uses the per-request DataLoader to batch all checks into a single query.
   * Returns `false` for unauthenticated viewers.
   */
  @ResolveField('isSavedByMe')
  isSavedByMe(@Root() post: Post, @Context() ctx: GqlContext): Promise<boolean> {
    return ctx.loaders.savedByMe.load(post.id);
  }
}

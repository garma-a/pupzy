import { Resolver, Mutation, Args, Context, ResolveField, Root } from '@nestjs/graphql';
import { PostsService } from './posts.service';
import { validateCreateRescuePostInput } from './dto/create-rescue-post.input';
import { validateCreateLostPostInput } from './dto/create-lost-post.input';
import { validateCreateAdoptionPostInput } from './dto/create-adoption-post.input';
import { validateCreateProductPostInput } from './dto/create-product-post.input';
import type { Post, City, PostMedia } from '../database/schema';
import type { GqlContext } from '../common/types/gql-context.type';

/**
 * PostsResolver — GraphQL resolver for post creation and field resolution.
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

  // ─── Create Mutations ──────────────────────────────────────────────────

  /**
   * Creates a RESCUE post.
   * Urgency is required. Coordinates visible to clients.
   */
  @Mutation('createRescuePost')
  async createRescuePost(
    @Args('input') input: unknown,
    @Context() ctx: GqlContext,
  ): Promise<Post> {
    const validated = validateCreateRescuePostInput(input);
    return this.postsService.createRescuePost(ctx.user!.id, validated);
  }

  /**
   * Creates a LOST post (LOST_PET or FOUND_STRAY).
   * Urgency is required. Coordinates visible to clients.
   */
  @Mutation('createLostPost')
  async createLostPost(
    @Args('input') input: unknown,
    @Context() ctx: GqlContext,
  ): Promise<Post> {
    const validated = validateCreateLostPostInput(input);
    return this.postsService.createLostPost(ctx.user!.id, validated);
  }

  /**
   * Creates an ADOPTION post.
   * No urgency. Coordinates hidden from clients.
   */
  @Mutation('createAdoptionPost')
  async createAdoptionPost(
    @Args('input') input: unknown,
    @Context() ctx: GqlContext,
  ): Promise<Post> {
    const validated = validateCreateAdoptionPostInput(input);
    return this.postsService.createAdoptionPost(ctx.user!.id, validated);
  }

  /**
   * Creates a PRODUCT post.
   * No urgency. Coordinates hidden from clients.
   */
  @Mutation('createProductPost')
  async createProductPost(
    @Args('input') input: unknown,
    @Context() ctx: GqlContext,
  ): Promise<Post> {
    const validated = validateCreateProductPostInput(input);
    return this.postsService.createProductPost(ctx.user!.id, validated);
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

    // Parse EWKT: "SRID=4326;POINT(lng lat)"
    const match = post.coordinates.match(/POINT\(([^ ]+) ([^ ]+)\)/);
    if (!match) return null;
    return {
      latitude: parseFloat(match[2]),
      longitude: parseFloat(match[1]),
    };
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
}

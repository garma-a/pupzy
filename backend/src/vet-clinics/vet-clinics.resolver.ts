import { Resolver, ResolveField, Root, Parent, Context, Query, Args } from '@nestjs/graphql';
import { VetClinicsService, type VetClinicDto } from './vet-clinics.service';
import type { Post, City } from '../database/schema';
import type { GqlContext } from '../common/types/gql-context.type';

/**
 * VetClinicsResolver — GraphQL resolver for VetClinic type fields and root queries.
 *
 * ## Responsibility
 * - Owns root query `Query.nearbyVetClinics`
 * - Owns field resolver `VetClinic.city`
 *
 * ## Performance & DataLoader batching
 * Field `VetClinic.city` resolves via the per-request `cityById` DataLoader,
 * batching all City lookups within the same event-loop tick into a single query
 * across all returned clinics in lists or details.
 */
@Resolver('VetClinic')
export class VetClinicsResolver {
  constructor(private readonly vetClinicsService: VetClinicsService) {}

  @Query('nearbyVetClinics')
  async nearbyVetClinics(@Args('cityId') cityId: string): Promise<VetClinicDto[]> {
    return this.vetClinicsService.nearbyVetClinicsForCity(cityId);
  }

  /**
   * Resolves the full City object for a VetClinic via the per-request DataLoader.
   *
   * Batches all city-ID lookups within the same event-loop tick into
   * a single `WHERE id = ANY($1)` query across all returned clinics.
   * Returns null if the clinic has no associated city (cityId = null).
   */
  @ResolveField('city')
  async city(@Parent() clinic: VetClinicDto, @Context() ctx: GqlContext): Promise<City | null> {
    if (!clinic.cityId) return null;
    return ctx.loaders.cityById.load(clinic.cityId);
  }
}

/**
 * VetClinicsPostResolver — GraphQL field resolver for Post.nearestVetClinics.
 *
 * ## Why @Resolver('Post') here and not in PostsResolver?
 *
 * NestJS + Apollo support multiple resolvers per type. Splitting the vet clinic
 * field into its own module keeps the posts module clean and follows the
 * Single Responsibility Principle. PostsResolver owns the post-centric
 * fields; VetClinicsPostResolver owns `nearestVetClinics`.
 *
 * ## Authentication
 * The global `FirebaseAuthGuard` protects all GraphQL operations. This resolver
 * does NOT need `@Public()` — any authenticated user who can see a post can
 * also see the clinic list. No additional guard is required.
 *
 * ## N+1 safeguard
 * This field is designed for detail queries. If a client includes
 * `nearestVetClinics` in a feed query, each post triggers a separate cache
 * lookup + potentially a separate DB query. The SDL comment warns clients
 * about this misuse pattern. The service always short-circuits for PRODUCT
 * posts (no DB query issued), keeping feed-level misuse cheap for Market.
 *
 * ## Coordinate extraction
 * Drizzle's `geometry(point)` type is returned by the pg driver in two
 * possible formats:
 *   1. `[longitude, latitude]` tuple (Drizzle ORM select)
 *   2. `"SRID=4326;POINT(lng lat)"` EWKT string (raw db.execute results)
 *
 * This resolver handles both formats to be robust against any code-path change
 * in how the parent resolver fetches the post. The coordinate extraction logic
 * is identical to PostsResolver.coordinates, which is the established pattern
 * in this codebase.
 */
@Resolver('Post')
export class VetClinicsPostResolver {
  constructor(private readonly vetClinicsService: VetClinicsService) {}

  /**
   * Resolves `Post.nearestVetClinics`.
   *
   * Extracts the post's WGS-84 lat/lng from the Drizzle geometry field
   * (handles both array and EWKT string formats), then delegates to the
   * service which applies the per-type routing logic + caching.
   *
   * @param post   Parent post object from the enclosing query
   * @param _ctx   GqlContext — unused here, kept as param for future-proofing
   */
  @ResolveField('nearestVetClinics')
  async nearestVetClinics(
    @Root() post: Post,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Context() _ctx: GqlContext,
  ): Promise<VetClinicDto[]> {
    // ── Extract lat/lng from the Drizzle geometry field ─────────────────────
    //
    // The pg driver may return geometry values in either of two formats.
    // We handle both here, matching the exact logic in PostsResolver.coordinates.
    //
    // ADOPTION and PRODUCT: the service handles these cases (adoption → city
    // center, product → empty list) without needing coordinates, so
    // we pass null and let the service decide.

    let latitude: number | null = null;
    let longitude: number | null = null;

    if (Array.isArray(post.coordinates)) {
      // Drizzle ORM select path: geometry is returned as [longitude, latitude]
      const [lng, lat] = post.coordinates;
      latitude = lat;
      longitude = lng;
    } else if (typeof post.coordinates === 'string') {
      // Raw db.execute path: geometry is returned as EWKT "SRID=4326;POINT(lng lat)"
      const match = (post.coordinates as string).match(/POINT\(([^ ]+) ([^ ]+)\)/);
      if (match) {
        longitude = parseFloat(match[1]);
        latitude = parseFloat(match[2]);
      }
    }

    return this.vetClinicsService.nearestVetClinicsForPost({
      id: post.id,
      postType: post.postType,
      cityId: post.cityId,
      latitude,
      longitude,
    });
  }
}

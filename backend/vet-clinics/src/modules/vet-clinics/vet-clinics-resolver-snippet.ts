/**
 * vet-clinics-resolver-snippet.ts
 *
 * Add these methods into your existing PostsResolver.
 * They attach nearestVetClinics as a computed field on the Post type
 * — loaded only when the client explicitly requests it (no N+1 risk
 * on list feeds since feeds never return this field).
 *
 * The coordinate privacy rule is enforced here:
 *  - RESCUE / LOST  → use exact post coordinates (already exposed to client)
 *  - ADOPTION       → use city center_point (exact coords are private)
 *  - PRODUCT        → omit entirely (vet clinics don't make sense for listings)
 */

import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { Post } from '../posts/models/post.model';        // your existing Post model
import { VetClinicDto } from './models/vet-clinic.model';
import { VetClinicsService } from './vet-clinics.service';

// ─── Extend your PostsResolver with these two pieces ─────────────────────────
//
//  1. Inject VetClinicsService in the constructor
//  2. Add the @ResolveField below

@Resolver(() => Post)
export class PostsResolver {
  constructor(
    // ... your existing injections ...
    private readonly vetClinicsService: VetClinicsService,
  ) {}

  // ── Nearest vet clinics ──────────────────────────────────────────────────
  /**
   * Returns 3 nearest active vet clinics to the post location.
   *
   * - RESCUE/LOST: uses exact coordinates (already public for map deep-links).
   * - ADOPTION:    uses city.center_point (exact location is private).
   * - PRODUCT:     returns empty array (vet proximity not relevant).
   *
   * Called only when the client includes nearestVetClinics in the query.
   * Never called on list feeds → zero performance impact on feed queries.
   *
   * Flutter GraphQL query example:
   *
   *   query GetRescueDetail($id: ID!) {
   *     post(id: $id) {
   *       id
   *       title
   *       nearestVetClinics {
   *         id
   *         nameEnglish
   *         nameArabic
   *         distanceKm
   *         phoneNumber
   *         googleMapsUrl
   *         whatsappPhoneUrl
   *       }
   *     }
   *   }
   */
  @ResolveField(() => [VetClinicDto], {
    name: 'nearestVetClinics',
    description:
      'Up to 3 nearest active vet clinics. ' +
      'RESCUE/LOST: from exact post coordinates. ' +
      'ADOPTION: from city center. ' +
      'PRODUCT: always empty.',
  })
  async nearestVetClinics(@Parent() post: Post): Promise<VetClinicDto[]> {
    switch (post.post_type) {
      case 'RESCUE':
      case 'LOST':
        // Exact coordinates already exposed for these types — use them directly.
        return this.vetClinicsService.findNearest(
          post.coordinates.latitude,
          post.coordinates.longitude,
          3,
        );

      case 'ADOPTION':
        // Exact coords are private. Use the city center_point as anchor.
        // Result is "nearest clinics in/around this city" — useful & safe.
        return this.vetClinicsService.findNearestForCity(post.city_id, 3);

      case 'PRODUCT':
      default:
        return [];
    }
  }
}

// ─── NestJS Module wiring ─────────────────────────────────────────────────────
//
// In your VetClinicsModule (or directly in PostsModule):
//
//   @Module({
//     providers: [VetClinicsService, PostsResolver],
//     exports: [VetClinicsService],
//   })
//   export class VetClinicsModule {}
//
// Import VetClinicsModule into PostsModule:
//
//   @Module({
//     imports: [VetClinicsModule, ...],
//     providers: [PostsResolver, PostsService],
//   })
//   export class PostsModule {}

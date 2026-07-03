import { Resolver, Query, ResolveField, Root, Context } from '@nestjs/graphql';
import { CitiesService } from './cities.service';
import { Public } from '../auth/firebase.guard';
import type { City } from '../database/schema';
import type { GqlContext } from '../common/types/gql-context.type';

/**
 * CitiesResolver — serves the city list for the onboarding city picker,
 * and resolves the `city` field on the `User` type via DataLoader.
 *
 * ## Why @Public()?
 * The frontend needs to populate the city dropdown **before** the user
 * has completed their profile. Cities contain no sensitive data.
 *
 * ## Caching strategy for `cities` query
 * The list of Egyptian cities is seeded once and virtually never changes.
 * We use NestJS CacheManager (backed by in-memory LRU) with a 1-hour TTL
 * so the DB is only hit once per server restart in practice.
 */
@Resolver('City')
export class CitiesResolver {
  constructor(private readonly citiesService: CitiesService) {}

  /**
   * Returns all Egyptian cities sorted A-Z by English name.
   *
   * Used to populate the city dropdown on the onboarding screen.
   * The selected city's `id` is passed as `cityId` in `completeProfile`.
   *
   * This query is public — no Firebase token required.
   */
  @Query()
  @Public()
  cities(): Promise<City[]> {
    return this.citiesService.findAll();
  }
}

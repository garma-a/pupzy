import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import DataLoader from 'dataloader';
import { CitiesRepository } from './cities.repository';
import type { City } from '../database/schema';

/**
 * CitiesService — city lookup with in-memory caching.
 *
 * ## Caching strategy
 * Cities are static reference data (rarely change). We cache:
 * - `findAll()`: 24h TTL — city list for onboarding dropdown
 * - `findById()`: 24h TTL — city resolution during post creation
 * - `findNearest()`: NOT cached — GPS-dependent, always different
 *
 * Cache invalidation is not needed for cities unless an admin adds a new city,
 * in which case a server restart clears the cache.
 */
const CITIES_TTL_MS = 86_400_000; // 24 hours

@Injectable()
export class CitiesService {
  private readonly logger = new Logger(CitiesService.name);

  constructor(
    private readonly citiesRepository: CitiesRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * Returns all cities sorted A-Z by English name.
   * Cached for 24 hours — city list never changes during normal operation.
   */
  async findAll(): Promise<City[]> {
    const cacheKey = 'cities:all';
    const cached = await this.cacheManager.get<City[]>(cacheKey);
    if (cached) return cached;

    const cities = await this.citiesRepository.findAll();
    await this.cacheManager.set(cacheKey, cities, CITIES_TTL_MS);
    return cities;
  }

  /**
   * Validates that a cityId exists in the database.
   * Called by UsersService.completeProfile() before saving.
   *
   * @returns the City row if found, undefined otherwise
   */
  async findById(id: string): Promise<City | undefined> {
    const cacheKey = `cities:id:${id}`;
    const cached = await this.cacheManager.get<City | undefined>(cacheKey);
    if (cached !== undefined && cached !== null) return cached;

    const city = await this.citiesRepository.findById(id);
    if (city) {
      await this.cacheManager.set(cacheKey, city, CITIES_TTL_MS);
    }
    return city;
  }

  /**
   * Finds the nearest city to the given GPS coordinates.
   * Used by UsersService during profile completion and location updates.
   * NOT cached — result depends on exact GPS coordinates.
   */
  findNearest(latitude: number, longitude: number): Promise<City | undefined> {
    return this.citiesRepository.findNearest(latitude, longitude);
  }

  /**
   * Clears the in-memory cached city listings.
   * Called during migrations and reconciliation to prevent serving stale reference data.
   */
  async clearCache(): Promise<void> {
    await this.cacheManager.del('cities:all');
    this.logger.log('Cities cache invalidated successfully.');
  }

  /**
   * Creates a fresh DataLoader instance for batch-loading cities by ID.
   *
   * ## Why a factory method?
   * DataLoader instances must be created per-request so each request gets
   * its own in-memory cache. This factory is called once per request from
   * the GraphQLModule context factory in app.module.ts.
   *
   * ## Batching behaviour
   * DataLoader collects all `cityById.load(id)` calls that happen within
   * the same event-loop tick and resolves them with a single
   * `WHERE id = ANY($1)` query instead of N separate SELECTs.
   */
  createCityByIdLoader(): DataLoader<string, City | null> {
    return new DataLoader<string, City | null>((ids) => this.citiesRepository.findByIds(ids), {
      // Cache is scoped to this request instance — safe to enable.
      cache: true,
      // Max keys batched per DB call — protects against pathological queries.
      maxBatchSize: 100,
    });
  }
}

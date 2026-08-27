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
 * Cities are authoritative reference data. We cache:
 * - `findAll()`: 24h TTL — official city list for onboarding dropdown
 * - `findById()`: 24h TTL — city resolution by UUID across all lifecycles
 * - `findNearest()`: NOT cached — GPS-dependent, always different
 *
 * Cache invalidation is triggered post-commit during migrations, dataset reconciliation,
 * and seeding routines via `clearCache()`, invalidating both list and per-ID entries in O(1) time.
 */
const CITIES_TTL_MS = 86_400_000; // 24 hours

@Injectable()
export class CitiesService {
  private readonly logger = new Logger(CitiesService.name);
  private cacheGeneration = 0;
  private readonly cachedKeys = new Set<string>();

  constructor(
    private readonly citiesRepository: CitiesRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  private getCacheKey(suffix: string): string {
    return `cities:g${this.cacheGeneration}:${suffix}`;
  }

  /**
   * Returns all cities sorted A-Z by English name.
   * Cached for 24 hours — city list never changes during normal operation.
   */
  async findAll(): Promise<City[]> {
    const cacheKey = this.getCacheKey('all');
    const cached = await this.cacheManager.get<City[]>(cacheKey);
    if (cached) return cached;

    const cities = await this.citiesRepository.findAll();
    await this.cacheManager.set(cacheKey, cities, CITIES_TTL_MS);
    this.cachedKeys.add(cacheKey);
    return cities;
  }

  /**
   * Validates that a cityId exists in the database.
   * Called by UsersService.completeProfile() before saving.
   *
   * @returns the City row if found, undefined otherwise
   */
  async findById(id: string): Promise<City | undefined> {
    const cacheKey = this.getCacheKey(`id:${id}`);
    const cached = await this.cacheManager.get<City | undefined>(cacheKey);
    if (cached !== undefined && cached !== null) return cached;

    const city = await this.citiesRepository.findById(id);
    if (city) {
      await this.cacheManager.set(cacheKey, city, CITIES_TTL_MS);
      this.cachedKeys.add(cacheKey);
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
   * Clears the in-memory cached city listings and per-ID lookups.
   *
   * ## Logical O(1) Invalidation
   * Advances the internal cache generation immediately, rendering all previously cached
   * entries unreachable and invalid in O(1) time without blocking on cache-manager I/O.
   * Physical cleanup of previously tracked keys is dispatched asynchronously on a best-effort basis
   * and cannot delay or fail generation advancement.
   *
   * Called during migrations, seeding, and reconciliation to prevent serving stale reference data.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async clearCache(): Promise<void> {
    const prevGeneration = this.cacheGeneration;
    this.cacheGeneration++;
    const keysToDelete = Array.from(new Set([...this.cachedKeys, `cities:g${prevGeneration}:all`, 'cities:all']));
    this.cachedKeys.clear();

    // Physical cleanup is best-effort and asynchronous, not delaying generation advancement
    void Promise.all(
      keysToDelete.map(async (key) => {
        try {
          await this.cacheManager.del(key);
        } catch {
          // ignore individual deletion errors
        }
      }),
    ).catch(() => {
      // ignore background deletion errors
    });

    this.logger.log(`Cities cache invalidated successfully (generation ${this.cacheGeneration}).`);
  }

  /**
   * Returns the current active cache generation index.
   */
  getCacheGeneration(): number {
    return this.cacheGeneration;
  }

  /**
   * Returns the number of tracked active cache keys in the current generation.
   */
  getTrackedKeyCount(): number {
    return this.cachedKeys.size;
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

import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import {
  VetClinicsRepository,
  type VetClinicProximityResult,
  type VetClinicCatalogRevisionReader,
} from './vet-clinics.repository';

// ─── DTO ─────────────────────────────────────────────────────────────────────
/**
 * VetClinicDto — the shape the resolver receives and GraphQL serialises.
 *
 * Field names are camelCase (Pupzy convention for all TypeScript public APIs).
 * They correspond 1-to-1 to the SDL fields in `VetClinic` type.
 * DB row fields (snake_case) are never exposed outside this service.
 */
export interface VetClinicDto {
  id: string;
  nameEnglish: string | null;
  nameArabic: string | null;
  phoneNumber: string | null;
  address: string | null;
  addressEnglish: string | null;
  addressArabic: string | null;
  website: string | null;
  latitude: number;
  longitude: number;
  distanceKm: number;
  /** https://maps.google.com/?q=lat,lon — pre-built for Flutter url_launcher */
  googleMapsUrl: string;
  /** https://wa.me/PHONE (no leading '+') — null when phoneNumber is null */
  whatsappPhoneUrl: string | null;
  cityId: string | null;
}

// ─── Cache TTLs ───────────────────────────────────────────────────────────────
// cache-manager v7+ uses milliseconds (NOT seconds — common gotcha).

/**
 * 24 hours — vet clinic locations almost never change day-to-day.
 * All adoption posts in the same city share this cache entry, so a single
 * DB query serves every adoption post detail opened in that city for 24 hours.
 * Highest ROI cache in this feature.
 */
const CITY_CACHE_TTL_MILLISECONDS = 86_400_000; // 24 h

/**
 * 1 hour — post coordinates are immutable after creation (no update path).
 * The result is always the same for a given post. Prevents repeated KNN
 * queries when a rescue/lost post detail is viewed many times in succession.
 */
const POST_CACHE_TTL_MILLISECONDS = 3_600_000; // 1 h

// ─── Google Maps Handoff Contract ────────────────────────────────────────────
export {
  GOOGLE_MAPS_SEARCH_BASE_URL,
  WGS84_BOUNDS,
  validateWgs84Coordinates,
  isValidWgs84Coordinates,
  buildGoogleMapsUrl,
  tryBuildGoogleMapsUrl,
} from '../common/contracts/google-maps-handoff.contract';
import { buildGoogleMapsUrl } from '../common/contracts/google-maps-handoff.contract';

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class VetClinicsService {
  private readonly logger = new Logger(VetClinicsService.name);
  private cacheGeneration = 0;
  private readonly cachedKeys = new Set<string>();
  private catalogRevision: number | undefined;

  constructor(
    private readonly vetClinicsRepository: VetClinicsRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  private getCacheKey(suffix: string): string {
    return `vet:g${this.cacheGeneration}:${suffix}`;
  }

  /**
   * Rejects this process's cache generation when PostgreSQL has committed a
   * newer catalog revision. This is intentionally a source-of-truth read, not a
   * background poll or distributed cache: the Vet Clinic payload cache stays local.
   */
  private async synchronizeCatalogRevision(currentRevision: number): Promise<void> {
    if (this.catalogRevision === undefined) {
      this.catalogRevision = currentRevision;
      return;
    }
    if (this.catalogRevision === currentRevision) return;

    this.catalogRevision = currentRevision;
    await this.clearCache();
  }

  /**
   * Clears the in-memory cached vet clinic proximity results and browse listings.
   *
   * ## Logical O(1) Invalidation
   * Advances the internal cache generation immediately, rendering all previously cached
   * entries unreachable and invalid in O(1) time without blocking on cache-manager I/O.
   * Physical cleanup of previously tracked keys is dispatched asynchronously on a best-effort basis
   * and cannot delay or fail generation advancement.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async clearCache(): Promise<void> {
    this.cacheGeneration++;
    const keysToDelete = Array.from(new Set(this.cachedKeys));
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

    this.logger.log(`Vet clinics cache invalidated successfully (generation ${this.cacheGeneration}).`);
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
   * nearestVetClinicsForPost
   *
   * Returns up to 3 nearest active vet clinics appropriate for the given post.
   *
   * ## Routing logic
   *
   * | postType | Source    | Cache key                | TTL  |
   * |----------|-----------|--------------------------|------|
   * | RESCUE   | post GPS  | vet:g{gen}:post:{id}     | 1h   |
   * | LOST     | post GPS  | vet:g{gen}:post:{id}     | 1h   |
   * | ADOPTION | city CTR  | vet:g{gen}:city:{id}     | 24h  |
   * | MATING   | city CTR  | vet:g{gen}:city:{id}     | 24h  |
   * | PRODUCT  | —         | (no cache/query)         | N/A  |
   *
   * ## Cache failures
   * Both get and set calls are wrapped in try-catch.
   * A cache failure never throws — the method logs a warning and continues
   * with a live DB query. This matches the cache-resilience pattern in
   * PostsService and CitiesService.
   *
   * ## N+1 warning
   * This field is intended for detail queries only. If a client includes
   * `nearestVetClinics` on a feed query (20+ posts), this fires 20 cache
   * lookups + up to 20 KNN DB queries. Document this as a misuse pattern
   * to Matheo (Flutter) — the SDL comment already contains this warning.
   *
   * @param post Minimal post data provided by the @Root() parent in the resolver
   */
  async nearestVetClinicsForPost(post: {
    id: string;
    postType: string;
    cityId: string;
    latitude: number | null;
    longitude: number | null;
  }): Promise<VetClinicDto[]> {
    // PRODUCT: vet proximity is irrelevant for marketplace listings.
    // Short-circuit before any cache or DB access.
    if (post.postType === 'PRODUCT') {
      return [];
    }

    // ADOPTION and MATING: exact coordinates are private — use city center instead.
    if (post.postType === 'ADOPTION' || post.postType === 'MATING') {
      return this.vetClinicsRepository.withCatalogRevision((revision, reader) =>
        this.findNearestForCityCached(post.cityId, revision, reader),
      );
    }

    // RESCUE and LOST: use exact post GPS coordinates (already public).
    const { latitude, longitude } = post;
    if (latitude === null || longitude === null) {
      this.logger.warn(
        { postId: post.id, postType: post.postType },
        'Post has null coordinates — skipping vet clinic lookup',
      );
      return [];
    }

    return this.vetClinicsRepository.withCatalogRevision((revision, reader) =>
      this.findNearestCached(post.id, latitude, longitude, revision, reader),
    );
  }

  // ─── Private cached query methods ──────────────────────────────────────────

  /**
   * Cache-aside for RESCUE/LOST posts (post-level granularity).
   * Key: vet:g{gen}:post:{postId}  TTL: 1 hour
   */
  private async findNearestCached(
    postId: string,
    latitude: number,
    longitude: number,
    revision: number,
    reader: VetClinicCatalogRevisionReader,
  ): Promise<VetClinicDto[]> {
    await this.synchronizeCatalogRevision(revision);
    const key = this.getCacheKey(`post:${postId}`);

    // ── Cache get ───────────────────────────────────────────────────────────
    try {
      const cached = await this.cacheManager.get<VetClinicDto[]>(key);
      if (cached) {
        this.logger.debug({ postId }, 'vet:post cache hit');
        return cached;
      }
    } catch (error) {
      // Cache is not guaranteed available — log and fall through to DB.
      this.logger.warn(
        { key, err: error instanceof Error ? error.message : String(error) },
        'Cache GET failed for vet:post key',
      );
    }

    // ── DB query ────────────────────────────────────────────────────────────
    const rows = await reader.findNearest(latitude, longitude);
    const dtos = rows.map(this.proximityResultToDto);

    // ── Cache set ───────────────────────────────────────────────────────────
    try {
      await this.cacheManager.set(key, dtos, POST_CACHE_TTL_MILLISECONDS);
      this.cachedKeys.add(key);
    } catch (error) {
      this.logger.warn(
        { key, err: error instanceof Error ? error.message : String(error) },
        'Cache SET failed for vet:post key',
      );
    }

    return dtos;
  }

  /**
   * Cache-aside for ADOPTION and MATING posts (city-level granularity).
   * Key: vet:g{gen}:city:{cityId}  TTL: 24 hours
   *
   * All adoption and mating posts in the same city share the same cache entry.
   * This is the primary cache optimization — adoption is the most common
   * post type likely to display this field.
   */
  private async findNearestForCityCached(
    cityId: string,
    revision: number,
    reader: VetClinicCatalogRevisionReader,
  ): Promise<VetClinicDto[]> {
    await this.synchronizeCatalogRevision(revision);
    const key = this.getCacheKey(`city:${cityId}`);

    // ── Cache get ───────────────────────────────────────────────────────────
    try {
      const cached = await this.cacheManager.get<VetClinicDto[]>(key);
      if (cached) {
        this.logger.debug({ cityId }, 'vet:city cache hit');
        return cached;
      }
    } catch (error) {
      this.logger.warn(
        { key, err: error instanceof Error ? error.message : String(error) },
        'Cache GET failed for vet:city key',
      );
    }

    // ── DB query ────────────────────────────────────────────────────────────
    const rows = await reader.findNearestForCity(cityId);
    const dtos = rows.map(this.proximityResultToDto);

    // ── Cache set ───────────────────────────────────────────────────────────
    try {
      await this.cacheManager.set(key, dtos, CITY_CACHE_TTL_MILLISECONDS);
      this.cachedKeys.add(key);
    } catch (error) {
      this.logger.warn(
        { key, err: error instanceof Error ? error.message : String(error) },
        'Cache SET failed for vet:city key',
      );
    }

    return dtos;
  }

  // ─── ProximityResult → DTO mapper ──────────────────────────────────────────
  /**
   * Maps a VetClinicProximityResult from the query builder to a VetClinicDto
   * (adds pre-built deep-links for Google Maps and WhatsApp).
   */
  private readonly proximityResultToDto = (row: VetClinicProximityResult): VetClinicDto => {
    return {
      id: row.id,
      nameEnglish: row.nameEnglish,
      nameArabic: row.nameArabic,
      phoneNumber: row.phoneNumber,
      address: row.address ?? row.addressEnglish ?? row.addressArabic ?? null,
      addressEnglish: row.addressEnglish ?? null,
      addressArabic: row.addressArabic ?? null,
      website: row.website,
      latitude: row.latitude,
      longitude: row.longitude,
      distanceKm: row.distanceKm,
      googleMapsUrl: buildGoogleMapsUrl(row.latitude, row.longitude),
      whatsappPhoneUrl: row.phoneNumber ? `https://wa.me/${row.phoneNumber.replace(/^\+/, '')}` : null,
      cityId: row.cityId ?? null,
    };
  };

  /**
   * nearbyVetClinicsForCity
   *
   * Returns up to 15 nearest active vet clinics to the given city's center_point.
   * This backs the standalone Query.nearbyVetClinics endpoint for the browse screen.
   *
   * Cached per city for 24 hours. Uses a distinct cache key (`vet:g{gen}:city:list:{cityId}`)
   * to avoid colliding with the 3-item limit cache (`vet:g{gen}:city:{cityId}`) used by post details.
   */
  async nearbyVetClinicsForCity(cityId: string): Promise<VetClinicDto[]> {
    return this.vetClinicsRepository.withCatalogRevision((revision, reader) =>
      this.nearbyVetClinicsForCityAtRevision(cityId, revision, reader),
    );
  }

  private async nearbyVetClinicsForCityAtRevision(
    cityId: string,
    revision: number,
    reader: VetClinicCatalogRevisionReader,
  ): Promise<VetClinicDto[]> {
    await this.synchronizeCatalogRevision(revision);
    const key = this.getCacheKey(`city:list:${cityId}`);

    // ── Cache get ───────────────────────────────────────────────────────────
    try {
      const cached = await this.cacheManager.get<VetClinicDto[]>(key);
      if (cached) {
        this.logger.debug({ cityId }, 'vet:city:list cache hit');
        return cached;
      }
    } catch (error) {
      this.logger.warn(
        { key, err: error instanceof Error ? error.message : String(error) },
        'Cache GET failed for vet:city:list key',
      );
    }

    // ── DB query ────────────────────────────────────────────────────────────
    const rows = await reader.findNearestForCity(cityId, 15);
    const dtos = rows.map(this.proximityResultToDto);

    // ── Cache set ───────────────────────────────────────────────────────────
    try {
      await this.cacheManager.set(key, dtos, CITY_CACHE_TTL_MILLISECONDS);
      this.cachedKeys.add(key);
    } catch (error) {
      this.logger.warn(
        { key, err: error instanceof Error ? error.message : String(error) },
        'Cache SET failed for vet:city:list key',
      );
    }

    return dtos;
  }
}

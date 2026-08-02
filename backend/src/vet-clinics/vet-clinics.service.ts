import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { VetClinicsRepository, type VetClinicQueryRow } from './vet-clinics.repository';

// ─── DTO ─────────────────────────────────────────────────────────────────────
/**
 * VetClinicDto — the shape the resolver receives and GraphQL serialises.
 *
 * Field names are camelCase (Pupzy convention for all TypeScript public APIs).
 * They correspond 1-to-1 to the SDL fields in `VetClinic` type.
 * DB row fields (snake_case) are never exposed outside this service.
 */
export interface VetClinicDto {
  id:               string;
  nameEnglish:      string | null;
  nameArabic:       string | null;
  phoneNumber:      string | null;
  address:          string | null;
  website:          string | null;
  latitude:         number;
  longitude:        number;
  distanceKm:       number;
  /** https://maps.google.com/?q=lat,lon — pre-built for Flutter url_launcher */
  googleMapsUrl:    string;
  /** https://wa.me/PHONE (no leading '+') — null when phoneNumber is null */
  whatsappPhoneUrl: string | null;
}

// ─── Cache TTLs ───────────────────────────────────────────────────────────────
// cache-manager v7+ uses milliseconds (NOT seconds — common gotcha).

/**
 * 24 hours — vet clinic locations almost never change day-to-day.
 * All adoption posts in the same city share this cache entry, so a single
 * DB query serves every adoption post detail opened in that city for 24 hours.
 * Highest ROI cache in this feature.
 */
const CITY_CACHE_TTL_MS = 86_400_000; // 24 h

/**
 * 1 hour — post coordinates are immutable after creation (no update path).
 * The result is always the same for a given post. Prevents repeated KNN
 * queries when a rescue/lost post detail is viewed many times in succession.
 */
const POST_CACHE_TTL_MS = 3_600_000; // 1 h

// ─── Cache key namespace ──────────────────────────────────────────────────────
// Prefix 'vet:' avoids collisions with other cache namespaces:
//   user_resolve:* — auth user caching
//   view_dedup:*   — view deduplication
//   idempotency:*  — idempotency interceptor

const toPostKey  = (postId: string)  => `vet:post:${postId}`;
const toCityKey  = (cityId: string)  => `vet:city:${cityId}`;

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class VetClinicsService {
  private readonly logger = new Logger(VetClinicsService.name);

  constructor(
    private readonly vetClinicsRepository: VetClinicsRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * nearestVetClinicsForPost
   *
   * Returns up to 3 nearest active vet clinics appropriate for the given post.
   *
   * ## Routing logic
   *
   * | postType | Source    | Cache key       | TTL  |
   * |----------|-----------|-----------------|------|
   * | RESCUE   | post GPS  | vet:post:{id}   | 1h   |
   * | LOST     | post GPS  | vet:post:{id}   | 1h   |
   * | ADOPTION | city CTR  | vet:city:{id}   | 24h  |
   * | PRODUCT  | —         | (no cache/query)| N/A  |
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
    id:        string;
    postType:  string;
    cityId:    string;
    latitude:  number | null;
    longitude: number | null;
  }): Promise<VetClinicDto[]> {

    // PRODUCT: vet proximity is irrelevant for marketplace listings.
    // Short-circuit before any cache or DB access.
    if (post.postType === 'PRODUCT') {
      return [];
    }

    // ADOPTION: exact coordinates are private — use city center instead.
    if (post.postType === 'ADOPTION') {
      return this.findNearestForCityCached(post.cityId);
    }

    // RESCUE and LOST: use exact post GPS coordinates (already public).
    if (post.latitude === null || post.longitude === null) {
      this.logger.warn(
        { postId: post.id, postType: post.postType },
        'Post has null coordinates — skipping vet clinic lookup',
      );
      return [];
    }

    return this.findNearestCached(post.id, post.latitude, post.longitude);
  }

  // ─── Private cached query methods ──────────────────────────────────────────

  /**
   * Cache-aside for RESCUE/LOST posts (post-level granularity).
   * Key: vet:post:{postId}  TTL: 1 hour
   */
  private async findNearestCached(
    postId: string,
    latitude: number,
    longitude: number,
  ): Promise<VetClinicDto[]> {
    const key = toPostKey(postId);

    // ── Cache get ───────────────────────────────────────────────────────────
    try {
      const cached = await this.cacheManager.get<VetClinicDto[]>(key);
      if (cached) {
        this.logger.debug({ postId }, 'vet:post cache hit');
        return cached;
      }
    } catch (err) {
      // Cache is not guaranteed available — log and fall through to DB.
      this.logger.warn({ key, err }, 'Cache GET failed for vet:post key');
    }

    // ── DB query ────────────────────────────────────────────────────────────
    const rows = await this.vetClinicsRepository.findNearest(latitude, longitude);
    const dtos = rows.map(this.rowToDto);

    // ── Cache set ───────────────────────────────────────────────────────────
    try {
      await this.cacheManager.set(key, dtos, POST_CACHE_TTL_MS);
    } catch (err) {
      this.logger.warn({ key, err }, 'Cache SET failed for vet:post key');
    }

    return dtos;
  }

  /**
   * Cache-aside for ADOPTION posts (city-level granularity).
   * Key: vet:city:{cityId}  TTL: 24 hours
   *
   * All adoption posts in the same city share the same cache entry.
   * This is the primary cache optimization — adoption is the most common
   * post type likely to display this field.
   */
  private async findNearestForCityCached(cityId: string): Promise<VetClinicDto[]> {
    const key = toCityKey(cityId);

    // ── Cache get ───────────────────────────────────────────────────────────
    try {
      const cached = await this.cacheManager.get<VetClinicDto[]>(key);
      if (cached) {
        this.logger.debug({ cityId }, 'vet:city cache hit');
        return cached;
      }
    } catch (err) {
      this.logger.warn({ key, err }, 'Cache GET failed for vet:city key');
    }

    // ── DB query ────────────────────────────────────────────────────────────
    const rows = await this.vetClinicsRepository.findNearestForCity(cityId);
    const dtos = rows.map(this.rowToDto);

    // ── Cache set ───────────────────────────────────────────────────────────
    try {
      await this.cacheManager.set(key, dtos, CITY_CACHE_TTL_MS);
    } catch (err) {
      this.logger.warn({ key, err }, 'Cache SET failed for vet:city key');
    }

    return dtos;
  }

  // ─── Row → DTO mapper ─────────────────────────────────────────────────────
  /**
   * Maps a raw DB row (snake_case, numeric strings) to a VetClinicDto
   * (camelCase, proper number types, pre-built deep-links).
   *
   * Uses an arrow function so `this` is always bound — safe to pass as a
   * callback to Array.prototype.map() without `.bind(this)`.
   */
  private readonly rowToDto = (row: VetClinicQueryRow): VetClinicDto => {
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);

    return {
      id:           row.id,
      nameEnglish:  row.name_english,
      nameArabic:   row.name_arabic,
      phoneNumber:  row.phone_number,
      address:      row.address,
      website:      row.website,
      latitude:     lat,
      longitude:    lng,
      distanceKm:   Number(row.distance_km),
      // Google Maps deep-link — opened by Flutter's url_launcher.
      // Format: https://maps.google.com/?q=lat,lon (WGS-84 decimal degrees)
      googleMapsUrl: `https://maps.google.com/?q=${lat},${lng}`,
      // WhatsApp deep-link — strip the leading '+' from E.164 format.
      // wa.me accepts the number without '+'. Null when no phone in OSM.
      whatsappPhoneUrl: row.phone_number
        ? `https://wa.me/${row.phone_number.replace(/^\+/, '')}`
        : null,
    };
  };
}

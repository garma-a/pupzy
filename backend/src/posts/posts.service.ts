import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PostsRepository } from './posts.repository';
import { CitiesService } from '../cities/cities.service';
import { UploadService } from '../upload/upload.service';
import { shouldFlagContent } from '../common/utils/moderation.util';
import { ValidationError, NotFoundError } from '../common/errors/app.errors';
import type { Post, NewPost, NewPostMedia } from '../database/schema';
import type { CreateRescuePostInput } from './dto/create-rescue-post.input';
import type { CreateLostPostInput } from './dto/create-lost-post.input';
import type { CreateAdoptionPostInput } from './dto/create-adoption-post.input';
import type { CreateProductPostInput } from './dto/create-product-post.input';

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
  ) {}

  // ─── RESCUE ──────────────────────────────────────────────────────────────

  async createRescuePost(creatorId: string, input: CreateRescuePostInput): Promise<Post> {
    const postId = randomUUID();
    const cityId = await this.resolveCity(input.cityId, input.coordinates);
    const moderationStatus = this.checkModeration(input.title, input.description);
    const mediaRows = this.prepareMedia(input.mediaIds, postId);

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
      coordinates: this.toEwkt(input.coordinates),
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
    return post;
  }

  // ─── LOST ────────────────────────────────────────────────────────────────

  async createLostPost(creatorId: string, input: CreateLostPostInput): Promise<Post> {
    const postId = randomUUID();
    const cityId = await this.resolveCity(input.cityId, input.coordinates);
    const moderationStatus = this.checkModeration(input.title, input.description);
    const mediaRows = this.prepareMedia(input.mediaIds, postId);

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
      coordinates: this.toEwkt(input.coordinates),
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
    return post;
  }

  // ─── ADOPTION ────────────────────────────────────────────────────────────

  async createAdoptionPost(creatorId: string, input: CreateAdoptionPostInput): Promise<Post> {
    const postId = randomUUID();
    const cityId = await this.resolveCity(input.cityId, input.coordinates);
    const moderationStatus = this.checkModeration(input.title, input.description);
    const mediaRows = this.prepareMedia(input.mediaIds, postId);

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
      coordinates: this.toEwkt(input.coordinates),
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
    return post;
  }

  // ─── PRODUCT ─────────────────────────────────────────────────────────────

  async createProductPost(creatorId: string, input: CreateProductPostInput): Promise<Post> {
    const postId = randomUUID();
    const cityId = await this.resolveCity(input.cityId, input.coordinates);
    const moderationStatus = this.checkModeration(input.title, input.description);
    const mediaRows = this.prepareMedia(input.mediaIds, postId);

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
      coordinates: this.toEwkt(input.coordinates),
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
    return post;
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

    const city = await this.citiesService.findNearest(
      coordinates.latitude,
      coordinates.longitude,
    );
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

  private prepareMedia(mediaIds: string[] | undefined, postId: string): Omit<NewPostMedia, 'postId'>[] {
    if (!mediaIds || mediaIds.length === 0) return [];
    if (mediaIds.length > 4) {
      throw new ValidationError('Maximum 4 images allowed per post');
    }
    return mediaIds.map(mediaId => this.uploadService.getExpectedMediaUrls(mediaId, postId));
  }

  /**
   * Runs the actual R2 finalization AFTER the database transaction succeeds.
   * If this fails, the post remains but the images will appear broken to the client.
   * This is much safer than moving images before the DB transaction and risking orphans.
   */
  private runFinalizeMediaAsync(mediaIds: string[] | undefined, userId: string, postId: string): void {
    if (!mediaIds || mediaIds.length === 0) return;

    Promise.allSettled(
      mediaIds.map((mediaId) => this.uploadService.finalizeMedia(mediaId, userId, postId))
    ).then((results) => {
      const failures = results.filter((r) => r.status === 'rejected');
      if (failures.length > 0) {
        this.logger.error(`Failed to finalize ${failures.length} media items for post ${postId}`);
      }
    });
  }

  private toEwkt(coordinates: { latitude: number; longitude: number }): string {
    return `SRID=4326;POINT(${coordinates.longitude} ${coordinates.latitude})`;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { MatingRepository } from './mating.repository';
import { CitiesService } from '../cities/cities.service';
import { UploadService } from '../upload/upload.service';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { clampFirst } from '../common/utils/pagination.util';
import { assertUuid } from '../common/utils/validate-uuid';
import { shouldFlagContent } from '../common/utils/moderation.util';
import { ValidationError, NotFoundError } from '../common/errors/app.errors';
import { validateCreateMatingPostInput } from './validate-create-mating-post.input';
import type { Post, NewPost, NewPostMedia } from '../database/schema';

export interface MatingFeedFilterInput {
  species?: string | null;
  gender?: string | null;
  breed?: string | null;
  cityId?: string | null;
}

/** DTO returned by matingPostDetail (snake_case DB row → camelCase). */
export interface MatingDetailsDto {
  petName: string;
  species: string;
  breed: string;
  gender: string;
  ageValue: number;
  ageUnit: string;
  isPurebred: boolean;
  hasPedigreeCertificate: boolean;
  vaccinated: boolean;
  dewormed: boolean;
  termsSummary: string | null;
  matingConditions: string | null;
}

@Injectable()
export class MatingService {
  private readonly logger = new Logger(MatingService.name);

  constructor(
    private readonly matingRepository: MatingRepository,
    private readonly citiesService: CitiesService,
    private readonly uploadService: UploadService,
  ) {}

  async createMatingPost(userId: string, rawInput: Record<string, unknown>): Promise<Post> {
    const input = validateCreateMatingPostInput(rawInput);

    // ── City resolution (see plan §0.3 decision 1) ──────────────────────────
    const city = await this.citiesService.findById(input.cityId);
    if (!city) throw new ValidationError(`cityId "${input.cityId}" does not correspond to a known city`);

    const genderLabel = input.gender === 'MALE' ? 'Male' : 'Female';
    const title = `${input.breed} • ${genderLabel} for mating`;
    const description = input.matingConditions ?? `${input.petName} — mating partner search`;

    const moderationStatus = shouldFlagContent(title, description) ? 'FLAGGED' : 'PENDING_AUTO_REVIEW';
    if (moderationStatus === 'FLAGGED') {
      this.logger.warn(`Mating post flagged by keyword blocklist: "${title.substring(0, 50)}..."`);
    }

    // ── Pre-generate the post id + predict media URLs BEFORE the transaction ─
    // (exact pattern from PostsService — see plan §2.1. Do not insert first and
    // attach media after; every other post type predicts URLs up front.)
    const postId = generateUuidV7();
    const mediaRows = await this.prepareMedia(input.mediaIds, postId);

    const baseData: NewPost = {
      id: postId,
      creatorId: userId,
      postType: 'MATING',
      title,
      description,
      status: 'ACTIVE',
      moderationStatus,
      urgency: undefined, // MATING has no urgency tier — must stay NULL (MAT-13's CHECK constraint enforces this)
      cityId: city.id,
      governorate: city.governorate,
      coordinates: city.centerPoint, // city centroid, NEVER the user's real GPS — see §0.3 decision 1
      effectiveScore: 0.0,
    };

    const post = await this.matingRepository.createMatingPost(
      baseData,
      {
        petName: input.petName,
        species: input.species,
        breed: input.breed,
        gender: input.gender,
        ageValue: input.ageValue,
        ageUnit: input.ageUnit,
        isPurebred: input.isPurebred,
        hasPedigreeCertificate: input.hasPedigreeCertificate,
        vaccinated: input.vaccinated,
        dewormed: input.dewormed,
        termsSummary: input.termsSummary,
        matingConditions: input.matingConditions,
      },
      mediaRows,
    );

    // AFTER the transaction commits — fire and forget, moves R2 objects from
    // staging/ to posts/{postId}/. See plan §2.1 for why this order matters.
    this.runFinalizeMediaAsync(input.mediaIds, userId, postId);

    this.logger.log({ postId: post.id, userId }, 'MATING post created');
    return post;
  }

  async matingFeed(
    filter: MatingFeedFilterInput | null,
    first: number | null | undefined,
    after: string | null | undefined,
  ) {
    const f = filter ?? {};
    if (f.cityId) assertUuid(f.cityId, 'filter.cityId');
    if (f.breed && f.breed.length > 100) throw new ValidationError('filter.breed is too long');

    const limit = clampFirst(first);
    const cursor = this.decodeCursor(after);

    const result = await this.matingRepository.findFeed({ filter: f, limit, cursor });

    return {
      edges: result.rows.map((post) => ({ node: post, cursor: this.encodeCursor(post) })),
      pageInfo: {
        hasNextPage: result.hasNextPage,
        endCursor: result.rows.length > 0 ? this.encodeCursor(result.rows[result.rows.length - 1]) : null,
      },
    };
  }

  /**
   * Fetches MATING extension data for the single-post detail screen.
   * Matches PostsService.getAdoptionDetail/getRescueDetail/etc. exactly:
   * throws NotFoundError if the row doesn't exist (including "this postId is
   * not a MATING post") — does NOT silently return null. See plan §0.3
   * decision 2 for why this is a top-level query, not a Post field resolver.
   */
  async getMatingPostDetail(postId: string): Promise<MatingDetailsDto> {
    assertUuid(postId, 'postId');
    const row = await this.matingRepository.findDetailsByPostId(postId);
    if (!row) throw new NotFoundError('MatingPost', postId);
    return row;
  }

  // ── Media (duplicated from PostsService — see plan §0.3 decision 8) ────────

  private async prepareMedia(mediaIds: string[] | undefined, postId: string): Promise<Omit<NewPostMedia, 'postId'>[]> {
    if (!mediaIds || mediaIds.length === 0) return [];
    if (mediaIds.length > 4) {
      throw new ValidationError('Maximum 4 images allowed per post');
    }
    return Promise.all(mediaIds.map((mediaId) => this.uploadService.getExpectedMediaUrls(mediaId, postId)));
  }

  private runFinalizeMediaAsync(mediaIds: string[] | undefined, userId: string, postId: string): void {
    if (!mediaIds || mediaIds.length === 0) return;
    void Promise.allSettled(mediaIds.map((mediaId) => this.uploadService.finalizeMedia(mediaId, userId, postId))).then(
      (results) => {
        const failures = results.filter((r) => r.status === 'rejected');
        if (failures.length > 0) {
          this.logger.error(`Failed to finalize ${failures.length} media items for post ${postId}`);
        }
      },
    );
  }

  // ── Cursor helpers (duplicated from ContactsService, incl. AUD-06 hardening —
  // see plan §0.3 decision 8 for why this is duplicated, not shared) ─────────

  private decodeCursor(after: string | null | undefined): { createdAt: string; id: string } | null {
    if (!after) return null;
    try {
      const parsed = JSON.parse(Buffer.from(after, 'base64url').toString('utf8')) as {
        createdAt: string;
        id: string;
      };
      if (Number.isNaN(new Date(parsed.createdAt).getTime()) || typeof parsed.id !== 'string') {
        throw new Error('bad shape');
      }
      return parsed;
    } catch {
      throw new ValidationError('Invalid cursor format');
    }
  }

  private encodeCursor(post: Post): string {
    return Buffer.from(JSON.stringify({ createdAt: post.createdAt.toISOString(), id: post.id }), 'utf8').toString(
      'base64url',
    );
  }
}

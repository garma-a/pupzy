import * as fs from 'fs';
import * as path from 'path';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { eq, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  users,
  cities,
  posts,
  postMedia,
  stagedUploads,
  rescuePosts,
  adoptionPosts,
  productPosts,
  matingPosts,
  mediaDeletionWork,
  mediaFinalizations,
  type User,
  type City,
  type StagedUpload,
} from '../database/schema';
import { PostsRepository } from '../posts/posts.repository';
import { MatingRepository } from '../mating/mating.repository';
import { CitiesRepository } from '../cities/cities.repository';
import { UsersRepository } from '../users/users.repository';
import { CitiesService } from '../cities/cities.service';
import { UsersService } from '../users/users.service';
import { UploadService } from './upload.service';
import { MEDIA_FINALIZATION_LEASE_MS, MediaFinalizationRepository } from './media-finalization.repository';
import { MediaDeletionProcessor } from './media-deletion.processor';
import { ViewFlushCron } from '../posts/view-flush.cron';
import { PostsService } from '../posts/posts.service';
import { MatingService } from '../mating/mating.service';
import { PostsResolver } from '../posts/posts.resolver';
import { UploadResolver } from './upload.resolver';
import { MatingResolver } from '../mating/mating.resolver';
import type { NotificationsService } from '../notifications/notifications.service';
import type { GqlContext } from '../common/types/gql-context.type';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';

interface R2Error extends Error {
  name: string;
  $metadata?: { httpStatusCode: number };
}

interface S3CommandLike {
  constructor?: { name?: string };
  name?: string;
  input?: { Key?: string; CopySource?: string; Body?: unknown };
}

interface S3ClientHolder {
  s3Client: { send: (cmd: unknown) => Promise<unknown> };
}

interface RequestMediaResponse {
  requestMediaUploadUrl: {
    mediaId: string;
    uploadUrl: string;
    expiresAt: string;
  };
}

interface PostMutationResponse {
  createRescuePost?: {
    id: string;
    title: string;
    postType: string;
    status: string;
    coordinates?: { latitude: number; longitude: number } | null;
    media: Array<{ id: string; publicUrl: string }>;
  };
  createLostPost?: {
    id: string;
    postType: string;
    media: Array<{ id: string; publicUrl: string }>;
  };
  createAdoptionPost?: {
    id: string;
    postType: string;
    coordinates?: { latitude: number; longitude: number } | null;
    media: Array<{ id: string; publicUrl: string }>;
  };
  createProductPost?: {
    id: string;
    postType: string;
    coordinates?: { latitude: number; longitude: number } | null;
    media: Array<{ id: string; publicUrl: string }>;
  };
  createMatingPost?: {
    id: string;
    postType: string;
    coordinates?: { latitude: number; longitude: number } | null;
    media: Array<{ id: string; publicUrl: string }>;
  };
}

/**
 * Controllable Cloudflare R2 adapter to simulate storage behavior,
 * transient failures, and staging object lifecycle outside database transactions.
 */
class ControllableR2Adapter {
  public objects = new Map<string, Buffer>();
  public shouldFailCopy = false;
  public shouldFailHead = false;
  public shouldFailDelete = false;
  /** Fires after copied bytes land, so a racing cleanup sees the new object. */
  public onCopyObject?: (key: string) => void | Promise<void>;
  /** Fires before a delete lands, so a test can observe persisted state first. */
  public onDeleteObject?: (key: string) => void | Promise<void>;

  putObject(key: string, content: Buffer = Buffer.from('test-image-content')): void {
    this.objects.set(key, content);
  }

  hasObject(key: string): boolean {
    return this.objects.has(key);
  }

  reset(): void {
    this.objects.clear();
    this.shouldFailCopy = false;
    this.shouldFailHead = false;
    this.shouldFailDelete = false;
    this.onCopyObject = undefined;
    this.onDeleteObject = undefined;
  }

  async send(command: S3CommandLike): Promise<Record<string, unknown>> {
    const cmdName = command.constructor?.name ?? command.name;
    const key = command.input?.Key ?? '';

    if (cmdName === 'HeadObjectCommand' || command instanceof HeadObjectCommand) {
      if (this.shouldFailHead || !this.objects.has(key)) {
        const err = new Error(`NotFound: ${key}`) as R2Error;
        err.name = 'NotFound';
        err.$metadata = { httpStatusCode: 404 };
        return Promise.reject(err);
      }
      return Promise.resolve({ ContentLength: this.objects.get(key)?.length ?? 1024 });
    }

    if (cmdName === 'CopyObjectCommand' || command instanceof CopyObjectCommand) {
      if (this.shouldFailCopy) {
        return Promise.reject(new Error('Simulated R2 transient copy failure'));
      }
      const copySource = command.input?.CopySource ?? '';
      const slashIdx = copySource.indexOf('/');
      const sourceKey = slashIdx >= 0 ? copySource.substring(slashIdx + 1) : copySource;
      const content = this.objects.get(sourceKey) ?? Buffer.from('staged-image-bytes');
      this.objects.set(key, content);
      if (this.onCopyObject) {
        await this.onCopyObject(key);
      }
      return Promise.resolve({});
    }

    if (cmdName === 'DeleteObjectCommand' || command instanceof DeleteObjectCommand) {
      if (this.onDeleteObject) {
        await this.onDeleteObject(key);
      }
      if (this.shouldFailDelete) {
        const err = new Error(`Simulated R2 delete failure for ${key}`) as R2Error;
        err.name = 'StorageServiceException';
        return Promise.reject(err);
      }
      this.objects.delete(key);
      return Promise.resolve({});
    }

    if (cmdName === 'GetObjectCommand' || command instanceof GetObjectCommand) {
      const content = this.objects.get(key);
      if (!content) {
        const err = new Error(`NoSuchKey: ${key}`) as R2Error;
        err.name = 'NoSuchKey';
        err.$metadata = { httpStatusCode: 404 };
        return Promise.reject(err);
      }
      return Promise.resolve({
        Body: {
          transformToByteArray: () => Promise.resolve(new Uint8Array(content)),
        },
      });
    }

    return Promise.resolve({});
  }
}

describe('Legacy Post Upload & Image Publishing Integration (Ticket 01)', () => {
  jest.setTimeout(120_000);

  let dbHelper: TestDatabaseHelper;
  let r2Adapter: ControllableR2Adapter;
  let cacheStore: Map<string, unknown>;
  let mockCache: Cache;
  let mockConfig: ConfigService;

  let postsRepo: PostsRepository;
  let matingRepo: MatingRepository;
  let citiesRepo: CitiesRepository;
  let usersRepo: UsersRepository;

  let citiesService: CitiesService;
  let usersService: UsersService;
  let uploadService: UploadService;
  let postsService: PostsService;
  let matingService: MatingService;
  let mediaDeletionProcessor: MediaDeletionProcessor;

  let postsResolver: PostsResolver;
  let uploadResolver: UploadResolver;
  let matingResolver: MatingResolver;

  let testCity: City;
  let testUser1: User;
  let testUser2: User;

  let executableSchema: GraphQLSchema;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    r2Adapter = new ControllableR2Adapter();
    cacheStore = new Map<string, unknown>();

    mockCache = {
      get: jest.fn((key: string) => Promise.resolve(cacheStore.get(key))),
      set: jest.fn((key: string, val: unknown) => {
        cacheStore.set(key, val);
        return Promise.resolve();
      }),
      del: jest.fn((key: string) => {
        cacheStore.delete(key);
        return Promise.resolve();
      }),
      reset: jest.fn(() => {
        cacheStore.clear();
        return Promise.resolve();
      }),
      wrap: jest.fn(),
      store: {
        get: (key: string) => Promise.resolve(cacheStore.get(key)),
        set: (key: string, val: unknown) => {
          cacheStore.set(key, val);
          return Promise.resolve();
        },
        del: (key: string) => {
          cacheStore.delete(key);
          return Promise.resolve();
        },
        reset: () => {
          cacheStore.clear();
          return Promise.resolve();
        },
        mget: (...keys: string[]) => Promise.resolve(keys.map((k) => cacheStore.get(k))),
        mset: (list: [string, unknown][]) => {
          list.forEach(([k, v]) => cacheStore.set(k, v));
          return Promise.resolve();
        },
        mdel: (...keys: string[]) => {
          keys.forEach((k) => cacheStore.delete(k));
          return Promise.resolve();
        },
      },
    } as unknown as Cache;

    mockConfig = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'R2_ACCOUNT_ID':
            return 'test-account';
          case 'R2_ACCESS_KEY_ID':
            return 'test-key';
          case 'R2_SECRET_ACCESS_KEY':
            return 'test-secret';
          case 'R2_BUCKET_NAME':
            return 'pupzy-bucket';
          case 'R2_PUBLIC_URL':
            return 'https://cdn.pupzy.com';
          case 'PHONE_ENCRYPTION_KEY':
            return '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
          case 'COMMENT_IMAGES_ENABLED':
            return 'true';
          default:
            return undefined;
        }
      }),
    } as unknown as ConfigService;

    postsRepo = new PostsRepository(dbHelper.db);
    matingRepo = new MatingRepository(dbHelper.db);
    citiesRepo = new CitiesRepository(dbHelper.db);
    usersRepo = new UsersRepository(dbHelper.db);

    citiesService = new CitiesService(citiesRepo, mockCache);
    usersService = new UsersService(usersRepo, citiesService, mockConfig, mockCache);
    uploadService = new UploadService(mockConfig, mockCache, dbHelper.db, new MediaFinalizationRepository(dbHelper.db));
    mediaDeletionProcessor = new MediaDeletionProcessor(dbHelper.db, uploadService);

    // Wire controllable R2 adapter into uploadService's S3Client
    (uploadService as unknown as S3ClientHolder).s3Client.send = jest.fn((cmd: unknown) =>
      r2Adapter.send(cmd as S3CommandLike),
    );

    const mockNotificationsService = {
      fireNotification: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService;
    const viewFlushCron = new ViewFlushCron(postsRepo, mockCache);

    postsService = new PostsService(
      postsRepo,
      citiesService,
      uploadService,
      viewFlushCron,
      usersService,
      mockNotificationsService,
      mockCache,
    );

    matingService = new MatingService(matingRepo, citiesService, uploadService);

    postsResolver = new PostsResolver(postsService);
    uploadResolver = new UploadResolver(uploadService);
    matingResolver = new MatingResolver(matingService);

    // Build executable GraphQL schema from the repository's authoritative SDL definitions
    const schemaFiles = [
      'src/common/graphql/enums.graphql',
      'src/users/users.graphql',
      'src/cities/cities.graphql',
      'src/posts/posts-enums.graphql',
      'src/posts/posts.graphql',
      'src/mating/mating.graphql',
      'src/upload/upload.graphql',
      'src/comments/comments.graphql',
      'src/notifications/notifications.graphql',
      'src/contacts/contacts.graphql',
      'src/adoptions/adoptions.graphql',
      'src/vet-clinics/vet-clinics.graphql',
    ];

    const typeDefs = schemaFiles.map((relPath) => fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf8'));

    executableSchema = makeExecutableSchema({
      typeDefs,
      resolvers: {
        DateTime: {
          __parseValue(v: unknown) {
            return v;
          },
          __serialize(v: unknown) {
            return v instanceof Date ? v.toISOString() : (v as string);
          },
        },
        Query: {
          post: (_root: unknown, args: { id: string }, ctx: GqlContext) => postsResolver.post(args.id, ctx),
          rescuePostDetail: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.rescuePostDetail(args.postId, ctx),
          lostPostDetail: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.lostPostDetail(args.postId, ctx),
          adoptionPostDetail: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.adoptionPostDetail(args.postId, ctx),
          productPostDetail: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            postsResolver.productPostDetail(args.postId, ctx),
          matingPostDetail: (_root: unknown, args: { postId: string }, ctx: GqlContext) =>
            matingResolver.matingPostDetail(args.postId, ctx),
        },
        Mutation: {
          requestMediaUploadUrl: (
            _root: unknown,
            args: { input: Parameters<typeof uploadResolver.requestMediaUploadUrl>[0] },
            ctx: GqlContext,
          ) => uploadResolver.requestMediaUploadUrl(args.input, ctx),
          createRescuePost: (
            _root: unknown,
            args: { input: Parameters<typeof postsResolver.createRescuePost>[0] },
            ctx: GqlContext,
          ) => postsResolver.createRescuePost(args.input, ctx),
          createLostPost: (
            _root: unknown,
            args: { input: Parameters<typeof postsResolver.createLostPost>[0] },
            ctx: GqlContext,
          ) => postsResolver.createLostPost(args.input, ctx),
          createAdoptionPost: (
            _root: unknown,
            args: { input: Parameters<typeof postsResolver.createAdoptionPost>[0] },
            ctx: GqlContext,
          ) => postsResolver.createAdoptionPost(args.input, ctx),
          createProductPost: (
            _root: unknown,
            args: { input: Parameters<typeof postsResolver.createProductPost>[0] },
            ctx: GqlContext,
          ) => postsResolver.createProductPost(args.input, ctx),
          createMatingPost: (
            _root: unknown,
            args: { input: Parameters<typeof matingResolver.createMatingPost>[0] },
            ctx: GqlContext,
          ) => matingResolver.createMatingPost(args.input, ctx),
        },
        Post: {
          coordinates: (root: Parameters<typeof postsResolver.coordinates>[0]) => postsResolver.coordinates(root),
          city: (root: Parameters<typeof postsResolver.city>[0], _args: unknown, ctx: GqlContext) =>
            postsResolver.city(root, ctx),
          creator: (root: Parameters<typeof postsResolver.creator>[0], _args: unknown, ctx: GqlContext) =>
            postsResolver.creator(root, ctx),
          media: (root: Parameters<typeof postsResolver.media>[0], _args: unknown, ctx: GqlContext) =>
            postsResolver.media(root, ctx),
          isUpvotedByMe: (root: Parameters<typeof postsResolver.isUpvotedByMe>[0], _args: unknown, ctx: GqlContext) =>
            postsResolver.isUpvotedByMe(root, ctx),
          isSavedByMe: (root: Parameters<typeof postsResolver.isSavedByMe>[0], _args: unknown, ctx: GqlContext) =>
            postsResolver.isSavedByMe(root, ctx),
          commentCount: (root: Parameters<typeof postsResolver.commentCount>[0]) => postsResolver.commentCount(root),
        },
      },
    });
  }, 120_000);

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();
    r2Adapter.reset();
    cacheStore.clear();

    // Ensure foreign key constraint is dropped for standard tests
    await dbHelper.pool.query(`
      ALTER TABLE staged_uploads DROP CONSTRAINT IF EXISTS staged_uploads_post_id_posts_id_fk;
    `);

    // Seed official city
    const [city] = await dbHelper.db
      .insert(cities)
      .values({
        nameEnglish: 'Cairo',
        nameArabic: 'القاهرة',
        governorate: 'Cairo',
        status: 'OFFICIAL',
        centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    testCity = city;

    // Seed test users
    const [user1] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `firebase-${generateUuidV7()}`,
        email: `user1-${generateUuidV7()}@example.com`,
        fullName: 'Test User One',
      })
      .returning();
    testUser1 = user1;

    const [user2] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `firebase-${generateUuidV7()}`,
        email: `user2-${generateUuidV7()}@example.com`,
        fullName: 'Test User Two',
      })
      .returning();
    testUser2 = user2;
  });

  /** Helper to execute GraphQL queries/mutations with context */
  async function executeGql<TData = Record<string, unknown>>(
    source: string,
    variables: Record<string, unknown> = {},
    user: User = testUser1,
  ): Promise<ExecutionResult<TData>> {
    const ctx: GqlContext = {
      req: {} as unknown as GqlContext['req'],
      user,
      loaders: {
        cityById: citiesService.createCityByIdLoader(),
        userById: usersService.createUserByIdLoader(),
        mediaByPostId: postsRepo.createMediaByPostIdLoader(),
        upvotedByMe: postsRepo.createUpvotedByMeLoader(),
        savedByMe: postsRepo.createSavedByMeLoader(),
        commentBoostedByMe: {
          load: jest.fn().mockResolvedValue(false),
        } as unknown as GqlContext['loaders']['commentBoostedByMe'],
        pinnedCommentIdByPostId: {
          load: jest.fn().mockResolvedValue(null),
        } as unknown as GqlContext['loaders']['pinnedCommentIdByPostId'],
        commentMediaByCommentId: {
          load: jest.fn().mockResolvedValue([]),
        } as unknown as GqlContext['loaders']['commentMediaByCommentId'],
      },
    };

    return graphql({
      schema: executableSchema,
      source,
      variableValues: variables,
      contextValue: ctx,
    }) as Promise<ExecutionResult<TData>>;
  }

  /** Helper to request a media upload ticket via GraphQL and simulate staging upload in R2 */
  async function stageMedia(
    user: User = testUser1,
    contentType = 'image/jpeg',
    fileSizeBytes = 1024,
  ): Promise<{ mediaId: string; stagingKey: string }> {
    const REQUEST_MEDIA_MUTATION = `
      mutation RequestMedia($input: RequestMediaUploadInput!) {
        requestMediaUploadUrl(input: $input) {
          mediaId
          uploadUrl
          expiresAt
        }
      }
    `;

    const res = await executeGql<RequestMediaResponse>(
      REQUEST_MEDIA_MUTATION,
      { input: { contentType, fileSizeBytes } },
      user,
    );

    expect(res.errors).toBeUndefined();
    const mediaId = res.data!.requestMediaUploadUrl.mediaId;
    expect(mediaId).toBeDefined();

    const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(ticket).toBeDefined();

    // Stage bytes into controllable R2 adapter
    r2Adapter.putObject(ticket.stagingKey, Buffer.alloc(fileSizeBytes, 0x7f));

    return { mediaId, stagingKey: ticket.stagingKey };
  }

  // Input builders conforming to authoritative GraphQL SDL schemas
  function makeValidRescueInput(mediaIds?: string[], overrides: Record<string, unknown> = {}) {
    return {
      title: 'Injured stray dog near Tahrir',
      description: 'Dog needs urgent rescue and vet attention',
      coordinates: { latitude: 30.0444, longitude: 31.2357 },
      species: 'DOG',
      conditionSummary: 'Limping and unable to walk properly',
      reporterRole: 'ON_SITE',
      isLifeThreatening: true,
      hasVisibleSeriousInjury: true,
      isInDangerousLocation: false,
      canAnimalMoveOrEscape: false,
      cityId: testCity.id,
      mediaIds,
      ...overrides,
    };
  }

  function makeValidLostPetInput(mediaIds?: string[], overrides: Record<string, unknown> = {}) {
    return {
      title: 'Lost Golden Retriever',
      description: 'Wearing a red collar, ran away during fireworks.',
      coordinates: { latitude: 30.0444, longitude: 31.2357 },
      reportType: 'LOST_PET',
      species: 'DOG',
      petName: 'Max',
      dateLastSeen: '2026-08-01',
      hasMedicalNeeds: false,
      isElderlyOrVeryYoung: true,
      lastSeenNearHazard: true,
      cityId: testCity.id,
      mediaIds,
      ...overrides,
    };
  }

  function makeValidFoundStrayInput(mediaIds?: string[], overrides: Record<string, unknown> = {}) {
    return {
      title: 'Found stray kitten',
      description: 'Found shivering in a box near the market.',
      coordinates: { latitude: 30.0444, longitude: 31.2357 },
      reportType: 'FOUND_STRAY',
      species: 'CAT',
      currentCondition: 'HEALTHY',
      isCurrentlySafeWithReporter: true,
      dateFound: '2026-08-02',
      cityId: testCity.id,
      mediaIds,
      ...overrides,
    };
  }

  function makeValidAdoptionInput(mediaIds?: string[], overrides: Record<string, unknown> = {}) {
    return {
      title: 'Loving Labrador Puppy',
      description: 'Healthy and vaccinated Labrador looking for a good home.',
      coordinates: { latitude: 30.0444, longitude: 31.2357 },
      petName: 'Bella',
      species: 'DOG',
      breed: 'Labrador',
      ageValue: 6,
      ageUnit: 'MONTHS',
      gender: 'FEMALE',
      vaccinated: true,
      neutered: false,
      priorPetExperienceRequired: false,
      cityId: testCity.id,
      mediaIds,
      ...overrides,
    };
  }

  function makeValidProductInput(mediaIds?: string[], overrides: Record<string, unknown> = {}) {
    return {
      title: 'Wooden Bird Cage',
      description: 'Handmade wooden bird cage in great condition.',
      coordinates: { latitude: 30.0444, longitude: 31.2357 },
      category: 'CARE',
      condition: 'LIKE_NEW',
      isFree: false,
      priceAmount: 350,
      priceCurrency: 'EGP',
      openToOffers: true,
      cityId: testCity.id,
      mediaIds,
      ...overrides,
    };
  }

  function makeValidMatingInput(mediaIds: string[], overrides: Record<string, unknown> = {}) {
    return {
      petName: 'Rocky',
      species: 'DOG',
      breed: 'German Shepherd',
      gender: 'MALE',
      ageValue: 3,
      ageUnit: 'YEARS',
      isPurebred: true,
      hasPedigreeCertificate: true,
      vaccinated: true,
      dewormed: true,
      termsSummary: 'Puppy share agreement',
      matingConditions: 'Healthy, vaccinated female GSD only',
      cityId: testCity.id,
      mediaIds,
      ...overrides,
    };
  }

  // ─── 1. Reproduction of the Foreign Key Failure (AC 1) ───────────────────────

  describe('Acceptance Criterion 1: Reproduce new-Post claim foreign-key failure and verify correction', () => {
    const CREATE_RESCUE_MUTATION = `
      mutation CreateRescue($input: CreateRescuePostInput!) {
        createRescuePost(input: $input) {
          id
          title
          status
          media {
            id
            publicUrl
          }
        }
      }
    `;

    it('reproduces foreign key violation when constraint exists, and succeeds when constraint is dropped', async () => {
      // 1. Stage a valid media ticket
      const { mediaId } = await stageMedia(testUser1);
      const rescueInput = makeValidRescueInput([mediaId]);

      try {
        // 2. Explicit reproduction: Re-apply the pre-remediation constraint to demonstrate the bug
        await dbHelper.pool.query(`
          DO $$ BEGIN
            ALTER TABLE staged_uploads ADD CONSTRAINT staged_uploads_post_id_posts_id_fk
            FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL;
          EXCEPTION
            WHEN duplicate_object THEN null;
          END $$;
        `);

        // 3. Attempt to publish the post through GraphQL
        const failRes = await executeGql(CREATE_RESCUE_MUTATION, { input: rescueInput }, testUser1);

        // Verify that PostgreSQL throws the foreign key constraint violation
        expect(failRes.errors).toBeDefined();
        expect(failRes.errors!.length).toBeGreaterThan(0);
        const origErr = failRes.errors![0].originalError as
          { cause?: { constraint?: string; message?: string }; constraint?: string; message?: string } | undefined;
        const pgErr = origErr?.cause ?? origErr;
        const constraintOrMsg = pgErr?.constraint ?? pgErr?.message ?? failRes.errors![0].message;
        expect(constraintOrMsg).toContain('staged_uploads_post_id_posts_id_fk');

        // Verify no post was inserted into PostgreSQL
        const postsCountPre = await dbHelper.db.select().from(posts);
        expect(postsCountPre.length).toBe(0);
      } finally {
        // 4. Correct the schema: Drop the foreign key constraint (as done by migration 0030)
        await dbHelper.pool.query(`
          ALTER TABLE staged_uploads DROP CONSTRAINT IF EXISTS staged_uploads_post_id_posts_id_fk;
        `);
      }

      // Reset ticket status to ISSUED so it can be claimed cleanly
      await dbHelper.db
        .update(stagedUploads)
        .set({ status: 'ISSUED', postId: null, updatedAt: new Date() })
        .where(eq(stagedUploads.id, mediaId));

      // 5. Execute the exact same GraphQL mutation again
      const successRes = await executeGql<PostMutationResponse>(
        CREATE_RESCUE_MUTATION,
        { input: rescueInput },
        testUser1,
      );

      expect(successRes.errors).toBeUndefined();
      const createdPost = successRes.data!.createRescuePost!;
      expect(createdPost).toBeDefined();
      expect(createdPost.title).toBe(rescueInput.title);
      expect(createdPost.status).toBe('ACTIVE');
      expect(createdPost.media).toHaveLength(1);
      expect(createdPost.media[0].id).toBeDefined();
      expect(createdPost.media[0].publicUrl).toBe(`https://cdn.pupzy.com/posts/${createdPost.id}/${mediaId}.jpg`);

      // Verify durable state in PostgreSQL:
      // - Post exists
      const [savedPost] = await dbHelper.db.select().from(posts).where(eq(posts.id, createdPost.id));
      expect(savedPost).toBeDefined();

      // - staged_uploads ticket is FINALIZED with post_id and finalStorageKey
      const [finalTicket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(finalTicket.status).toBe('FINALIZED');
      expect(finalTicket.postId).toBe(createdPost.id);
      expect(finalTicket.finalStorageKey).toBe(`posts/${createdPost.id}/${mediaId}.jpg`);

      // - post_media contains the attached media row
      const mediaRows = await dbHelper.db.select().from(postMedia).where(eq(postMedia.postId, createdPost.id));
      expect(mediaRows).toHaveLength(1);
      expect(mediaRows[0].cloudflareStorageKey).toBe(finalTicket.finalStorageKey);
      expect(mediaRows[0].publicUrl).toContain(mediaId);
    });
  });

  // ─── 2. All 5 Post Types with Images (AC 2, 3, 5) ────────────────────────────

  describe('Acceptance Criteria 2 & 3: Publishing all 5 Post types with ready images', () => {
    it('publishes RESCUE post with ready images', async () => {
      const { mediaId } = await stageMedia(testUser1, 'image/jpeg');

      const mutation = `
        mutation CreateRescue($input: CreateRescuePostInput!) {
          createRescuePost(input: $input) {
            id
            postType
            media { id publicUrl }
          }
        }
      `;
      const res = await executeGql<PostMutationResponse>(
        mutation,
        { input: makeValidRescueInput([mediaId]) },
        testUser1,
      );

      expect(res.errors).toBeUndefined();
      expect(res.data?.createRescuePost?.postType).toBe('RESCUE');
      expect(res.data?.createRescuePost?.media).toHaveLength(1);

      const [ext] = await dbHelper.db
        .select()
        .from(rescuePosts)
        .where(eq(rescuePosts.postId, res.data!.createRescuePost!.id));
      expect(ext).toBeDefined();
    });

    it('publishes LOST post (LOST_PET and FOUND_STRAY) with ready images', async () => {
      // LOST_PET
      const { mediaId: m1 } = await stageMedia(testUser1, 'image/png');
      const lostMutation = `
        mutation CreateLost($input: CreateLostPostInput!) {
          createLostPost(input: $input) {
            id
            postType
            media { id publicUrl }
          }
        }
      `;
      const lostRes = await executeGql<PostMutationResponse>(
        lostMutation,
        { input: makeValidLostPetInput([m1]) },
        testUser1,
      );

      expect(lostRes.errors).toBeUndefined();
      expect(lostRes.data?.createLostPost?.postType).toBe('LOST');
      expect(lostRes.data?.createLostPost?.media).toHaveLength(1);

      // FOUND_STRAY
      const { mediaId: m2 } = await stageMedia(testUser1, 'image/webp');
      const strayRes = await executeGql<PostMutationResponse>(
        lostMutation,
        { input: makeValidFoundStrayInput([m2]) },
        testUser1,
      );

      expect(strayRes.errors).toBeUndefined();
      expect(strayRes.data?.createLostPost?.media).toHaveLength(1);
    });

    it('publishes ADOPTION post with ready images and privacy-enforced null coordinates', async () => {
      const { mediaId } = await stageMedia(testUser1, 'image/webp');

      const mutation = `
        mutation CreateAdoption($input: CreateAdoptionPostInput!) {
          createAdoptionPost(input: $input) {
            id
            postType
            coordinates { latitude longitude }
            media { id publicUrl }
          }
        }
      `;
      const res = await executeGql<PostMutationResponse>(
        mutation,
        { input: makeValidAdoptionInput([mediaId]) },
        testUser1,
      );

      expect(res.errors).toBeUndefined();
      expect(res.data?.createAdoptionPost?.postType).toBe('ADOPTION');
      expect(res.data?.createAdoptionPost?.coordinates).toBeNull(); // Privacy rule
      expect(res.data?.createAdoptionPost?.media).toHaveLength(1);

      const [ext] = await dbHelper.db
        .select()
        .from(adoptionPosts)
        .where(eq(adoptionPosts.postId, res.data!.createAdoptionPost!.id));
      expect(ext).toBeDefined();
    });

    it('publishes PRODUCT post with ready images', async () => {
      const { mediaId } = await stageMedia(testUser1, 'image/jpeg');

      const mutation = `
        mutation CreateProduct($input: CreateProductPostInput!) {
          createProductPost(input: $input) {
            id
            postType
            coordinates { latitude longitude }
            media { id publicUrl }
          }
        }
      `;
      const res = await executeGql<PostMutationResponse>(
        mutation,
        { input: makeValidProductInput([mediaId]) },
        testUser1,
      );

      expect(res.errors).toBeUndefined();
      expect(res.data?.createProductPost?.postType).toBe('PRODUCT');
      expect(res.data?.createProductPost?.coordinates).toBeNull(); // Privacy rule
      expect(res.data?.createProductPost?.media).toHaveLength(1);

      const [ext] = await dbHelper.db
        .select()
        .from(productPosts)
        .where(eq(productPosts.postId, res.data!.createProductPost!.id));
      expect(ext).toBeDefined();
    });

    it('publishes MATING post with ready images', async () => {
      const { mediaId } = await stageMedia(testUser1, 'image/jpeg');

      const mutation = `
        mutation CreateMating($input: CreateMatingPostInput!) {
          createMatingPost(input: $input) {
            id
            postType
            coordinates { latitude longitude }
            media { id publicUrl }
          }
        }
      `;
      const res = await executeGql<PostMutationResponse>(
        mutation,
        { input: makeValidMatingInput([mediaId]) },
        testUser1,
      );

      expect(res.errors).toBeUndefined();
      expect(res.data?.createMatingPost?.postType).toBe('MATING');
      expect(res.data?.createMatingPost?.coordinates).toBeNull();
      expect(res.data?.createMatingPost?.media).toHaveLength(1);

      const [ext] = await dbHelper.db
        .select()
        .from(matingPosts)
        .where(eq(matingPosts.postId, res.data!.createMatingPost!.id));
      expect(ext).toBeDefined();
      expect(ext.petName).toBe('Rocky');
    });
    it('Ticket 11: returns a safe Forbidden error for a stale authorized MATING creation after a ban', async () => {
      const { mediaId } = await stageMedia(testUser1, 'image/jpeg');
      await dbHelper.db
        .update(users)
        .set({ isBanned: true, bannedAt: new Date(), banReason: 'Ticket 11 race test' })
        .where(eq(users.id, testUser1.id));

      const result = await executeGql(
        `mutation CreateMating($input: CreateMatingPostInput!) {
          createMatingPost(input: $input) { id }
        }`,
        { input: makeValidMatingInput([mediaId]) },
        testUser1,
      );

      expect(result.errors).toHaveLength(1);
      expect((result.errors?.[0].originalError as { code?: string }).code).toBe('FORBIDDEN');
      const created = await dbHelper.db.select({ id: posts.id }).from(posts).where(eq(posts.creatorId, testUser1.id));
      expect(created).toHaveLength(0);
    });
  });

  // ─── 3. Text-Only Publishing Unchanged (AC 3) ─────────────────────────────────

  describe('Acceptance Criterion 3: Text-only workflows remain unchanged', () => {
    it('publishes RESCUE, LOST, ADOPTION, and PRODUCT posts without mediaIds', async () => {
      // RESCUE text-only
      const rescueRes = await executeGql<PostMutationResponse>(
        `mutation CreateRescue($input: CreateRescuePostInput!) {
          createRescuePost(input: $input) { id postType media { id } }
        }`,
        { input: makeValidRescueInput() },
        testUser1,
      );
      expect(rescueRes.errors).toBeUndefined();
      expect(rescueRes.data?.createRescuePost?.media).toEqual([]);

      // LOST text-only
      const lostRes = await executeGql<PostMutationResponse>(
        `mutation CreateLost($input: CreateLostPostInput!) {
          createLostPost(input: $input) { id postType media { id } }
        }`,
        { input: makeValidLostPetInput() },
        testUser1,
      );
      expect(lostRes.errors).toBeUndefined();
      expect(lostRes.data?.createLostPost?.media).toEqual([]);

      // ADOPTION text-only
      const adoptRes = await executeGql<PostMutationResponse>(
        `mutation CreateAdopt($input: CreateAdoptionPostInput!) {
          createAdoptionPost(input: $input) { id postType media { id } }
        }`,
        { input: makeValidAdoptionInput() },
        testUser1,
      );
      expect(adoptRes.errors).toBeUndefined();
      expect(adoptRes.data?.createAdoptionPost?.media).toEqual([]);

      // PRODUCT text-only
      const prodRes = await executeGql<PostMutationResponse>(
        `mutation CreateProd($input: CreateProductPostInput!) {
          createProductPost(input: $input) { id postType media { id } }
        }`,
        { input: makeValidProductInput() },
        testUser1,
      );
      expect(prodRes.errors).toBeUndefined();
      expect(prodRes.data?.createProductPost?.media).toEqual([]);

      // Verify MATING business rule: requires at least one photo
      const matingRes = await executeGql(
        `mutation CreateMating($input: CreateMatingPostInput!) {
          createMatingPost(input: $input) { id }
        }`,
        { input: makeValidMatingInput([]) },
        testUser1,
      );
      expect(matingRes.errors).toBeDefined();
      expect(matingRes.errors![0].message).toContain('At least one photo of the pet is required');
    });
  });

  // ─── 4. Cache Loss and API Restart Resilience (AC 4) ──────────────────────────

  describe('Acceptance Criterion 4: Cache loss and API restart resilience', () => {
    it('claims and finalizes upload ticket successfully after total cache loss', async () => {
      // 1. User requests presigned upload URL (persisted in DB, cached in memory)
      const { mediaId } = await stageMedia(testUser1);

      // Verify cache has entries
      expect(cacheStore.size).toBeGreaterThan(0);

      // 2. Simulate abrupt container crash / cache flush / API restart
      cacheStore.clear();
      expect(cacheStore.size).toBe(0);

      // 3. User publishes post referencing the staged mediaId
      const mutation = `
        mutation CreateRescue($input: CreateRescuePostInput!) {
          createRescuePost(input: $input) {
            id
            media { id publicUrl }
          }
        }
      `;
      const res = await executeGql<PostMutationResponse>(
        mutation,
        { input: makeValidRescueInput([mediaId], { title: 'Rescue After Cache Loss' }) },
        testUser1,
      );

      expect(res.errors).toBeUndefined();
      const post = res.data!.createRescuePost!;
      expect(post).toBeDefined();
      expect(post.media).toHaveLength(1);
      expect(post.media[0].id).toBeDefined();
      expect(post.media[0].publicUrl).toBe(`https://cdn.pupzy.com/posts/${post.id}/${mediaId}.jpg`);

      // Verify DB authority confirmed finalization
      const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('FINALIZED');
      expect(ticket.postId).toBe(post.id);
    });
  });

  // ─── 5. Security & Isolation: Cross-User, Replay, Purpose, Expiry (AC 2, 9) ───

  describe('Acceptance Criteria 2 & 9: Regression scenarios (cross-user, replay, purpose confusion, expiry)', () => {
    it('rejects claiming a ticket owned by another user (cross-user isolation)', async () => {
      // User 1 requests and stages media
      const { mediaId } = await stageMedia(testUser1);

      // User 2 attempts to use User 1's mediaId
      const mutation = `
        mutation CreateRescue($input: CreateRescuePostInput!) {
          createRescuePost(input: $input) { id }
        }
      `;
      const res = await executeGql(
        mutation,
        { input: makeValidRescueInput([mediaId], { title: 'Stolen Media Attempt' }) },
        testUser2, // Authenticated as User 2!
      );

      expect(res.errors).toBeDefined();
      expect(res.errors![0].message).toContain('not found');

      // Verify User 1's ticket was untouched and remains ISSUED
      const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('ISSUED');
      expect(ticket.postId).toBeNull();
    });

    it('enforces single-use semantics and rejects replay attempts', async () => {
      const { mediaId } = await stageMedia(testUser1);

      const mutation = `
        mutation CreateRescue($input: CreateRescuePostInput!) {
          createRescuePost(input: $input) { id }
        }
      `;
      const input = makeValidRescueInput([mediaId], { title: 'Single-Use Test Post' });

      // First creation succeeds
      const res1 = await executeGql(mutation, { input }, testUser1);
      expect(res1.errors).toBeUndefined();

      // Second creation attempting to reuse the same mediaId must fail
      const res2 = await executeGql(
        mutation,
        { input: { ...input, title: 'Replay Attempt With Same Media' } },
        testUser1,
      );
      expect(res2.errors).toBeDefined();
      expect(res2.errors![0].message).toContain('not found');
    });

    it('rejects purpose confusion (cannot use COMMENT_IMAGE for a Post)', async () => {
      // Create a ticket explicitly for COMMENT_IMAGE
      const commentMediaId = generateUuidV7();
      const stagingKey = `staging/${testUser1.id}/${commentMediaId}.webp`;
      r2Adapter.putObject(stagingKey, Buffer.alloc(1024, 0x11));

      await dbHelper.db.insert(stagedUploads).values({
        id: commentMediaId,
        userId: testUser1.id,
        purpose: 'COMMENT_IMAGE',
        stagingKey,
        declaredContentType: 'image/webp',
        declaredFileSizeBytes: 1024,
        status: 'ISSUED',
        expiresAt: new Date(Date.now() + 900_000),
      });

      const mutation = `
        mutation CreateRescue($input: CreateRescuePostInput!) {
          createRescuePost(input: $input) { id }
        }
      `;
      const res = await executeGql(
        mutation,
        { input: makeValidRescueInput([commentMediaId], { title: 'Purpose Confusion Test' }) },
        testUser1,
      );

      expect(res.errors).toBeDefined();
      expect(res.errors![0].message).toContain('not found');
    });

    it('rejects expired tickets', async () => {
      const expiredMediaId = generateUuidV7();
      const stagingKey = `staging/${testUser1.id}/${expiredMediaId}.jpg`;
      r2Adapter.putObject(stagingKey, Buffer.alloc(1024, 0x22));

      await dbHelper.db.insert(stagedUploads).values({
        id: expiredMediaId,
        userId: testUser1.id,
        purpose: 'POST_MEDIA',
        stagingKey,
        declaredContentType: 'image/jpeg',
        declaredFileSizeBytes: 1024,
        status: 'ISSUED',
        expiresAt: new Date(Date.now() - 60_000), // Expired 1 minute ago
      });

      const mutation = `
        mutation CreateRescue($input: CreateRescuePostInput!) {
          createRescuePost(input: $input) { id }
        }
      `;
      const res = await executeGql(
        mutation,
        { input: makeValidRescueInput([expiredMediaId], { title: 'Expired Ticket Test' }) },
        testUser1,
      );

      expect(res.errors).toBeDefined();
      expect(res.errors![0].message).toContain('not found');
    });
  });

  // ─── 6. Fault Injection: Unready Objects, Storage & DB Failures (AC 6, 7) ────

  describe('Acceptance Criteria 6 & 7: Fault injection & durable failure tracking', () => {
    it('fails fast when staged object is missing in R2, marking ticket FAILED without creating post', async () => {
      // Issue ticket in DB, but DO NOT put object in R2
      const mediaId = generateUuidV7();
      const stagingKey = `staging/${testUser1.id}/${mediaId}.jpg`;

      await dbHelper.db.insert(stagedUploads).values({
        id: mediaId,
        userId: testUser1.id,
        purpose: 'POST_MEDIA',
        stagingKey,
        declaredContentType: 'image/jpeg',
        declaredFileSizeBytes: 1024,
        status: 'ISSUED',
        expiresAt: new Date(Date.now() + 900_000),
      });

      const mutation = `
        mutation CreateRescue($input: CreateRescuePostInput!) {
          createRescuePost(input: $input) { id }
        }
      `;
      const res = await executeGql(
        mutation,
        { input: makeValidRescueInput([mediaId], { title: 'Missing R2 Object Test' }) },
        testUser1,
      );

      expect(res.errors).toBeDefined();

      // Verify ticket was marked FAILED in PostgreSQL
      const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('FAILED');
      expect(ticket.errorMessage).toBe('Staged object not found in R2');

      // Verify zero posts created
      const allPosts = await dbHelper.db.select().from(posts);
      expect(allPosts).toHaveLength(0);
    });

    it('marks ticket FAILED durably on transient R2 copy failure without persisting post', async () => {
      const { mediaId } = await stageMedia(testUser1);

      // Inject transient R2 copy error
      r2Adapter.shouldFailCopy = true;

      const mutation = `
        mutation CreateRescue($input: CreateRescuePostInput!) {
          createRescuePost(input: $input) { id }
        }
      `;
      const res = await executeGql(
        mutation,
        { input: makeValidRescueInput([mediaId], { title: 'Copy Failure Test' }) },
        testUser1,
      );

      expect(res.errors).toBeDefined();

      // Verify ticket state in DB: marked FAILED with CopyObject error
      const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('FAILED');
      expect(ticket.errorMessage).toContain('CopyObject failed');

      // Verify zero posts created
      const allPosts = await dbHelper.db.select().from(posts);
      expect(allPosts).toHaveLength(0);
    });

    it('marks ticket FAILED durably when post entity persistence fails', async () => {
      const { mediaId } = await stageMedia(testUser1);

      // Spy on postsRepository.createRescuePost to simulate DB transaction failure
      const repoSpy = jest
        .spyOn(postsRepo, 'createRescuePost')
        .mockRejectedValueOnce(new Error('Simulated PostgreSQL transaction error'));

      const mutation = `
        mutation CreateRescue($input: CreateRescuePostInput!) {
          createRescuePost(input: $input) { id }
        }
      `;
      const res = await executeGql(
        mutation,
        { input: makeValidRescueInput([mediaId], { title: 'Entity Persistence Failure Test' }) },
        testUser1,
      );

      expect(res.errors).toBeDefined();
      expect(res.errors![0].message).toContain('Simulated PostgreSQL transaction error');

      // Verify markMediaFailed marked ticket FAILED durably in DB
      const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('FAILED');
      expect(ticket.errorMessage).toBe('Post creation database transaction failed');

      // Verify zero posts created
      const allPosts = await dbHelper.db.select().from(posts);
      expect(allPosts).toHaveLength(0);

      repoSpy.mockRestore();
    });
  });

  // ─── 7. Validation Limits & Signatures (AC 5) ─────────────────────────────────

  describe('Acceptance Criterion 5: Validation limits & signatures', () => {
    it('rejects post creation with more than 4 images', async () => {
      const mediaIds = [generateUuidV7(), generateUuidV7(), generateUuidV7(), generateUuidV7(), generateUuidV7()];

      const mutation = `
        mutation CreateRescue($input: CreateRescuePostInput!) {
          createRescuePost(input: $input) { id }
        }
      `;
      const res = await executeGql(
        mutation,
        { input: makeValidRescueInput(mediaIds, { title: 'Five Images Post' }) },
        testUser1,
      );

      expect(res.errors).toBeDefined();
      expect(res.errors![0].message).toContain('Maximum 4 images allowed');
    });

    it('rejects duplicate media IDs in post creation', async () => {
      const id = generateUuidV7();

      const mutation = `
        mutation CreateRescue($input: CreateRescuePostInput!) {
          createRescuePost(input: $input) { id }
        }
      `;
      const res = await executeGql(
        mutation,
        { input: makeValidRescueInput([id, id], { title: 'Duplicate Media Post' }) },
        testUser1,
      );

      expect(res.errors).toBeDefined();
      expect(res.errors![0].message).toContain('Duplicate media IDs are not allowed');
    });
  });

  // ─── 8. Expired-staging cleanup coordination with post media finalization ─────

  describe('Expired-staging cleanup coordination with post media finalization', () => {
    const createRescueMutation = `
      mutation CreateRescue($input: CreateRescuePostInput!) {
        createRescuePost(input: $input) { id media { id publicUrl } }
      }
    `;

    function publishRescue(mediaId: string, title: string) {
      return executeGql<PostMutationResponse>(
        createRescueMutation,
        { input: makeValidRescueInput([mediaId], { title }) },
        testUser1,
      );
    }

    /**
     * Marks an in-flight copy's ticket as the expired CLAIMED candidate the
     * hourly cleanup selects, with the intended permanent key already recorded
     * (the state a reclaimable post-media candidate carries).
     */
    async function markCandidateExpired(mediaId: string, finalKey: string, postId: string): Promise<void> {
      await dbHelper.db
        .update(stagedUploads)
        .set({
          status: 'CLAIMED',
          finalStorageKey: finalKey,
          postId,
          expiresAt: new Date(Date.now() - 1000),
          updatedAt: new Date(),
        })
        .where(eq(stagedUploads.id, mediaId));
    }

    it('keeps a post’s media live when expired-staging cleanup selects its in-flight ticket', async () => {
      const { mediaId, stagingKey } = await stageMedia(testUser1, 'image/jpeg');

      let finalKey: string | undefined;
      let cleanupRan = false;
      r2Adapter.onCopyObject = async (key) => {
        if (cleanupRan) return;
        cleanupRan = true;
        finalKey = key;

        // The ticket was claimed just before expiry and the durable candidate
        // already records its permanent key (the key embeds the intended post).
        // Cleanup selects it while the copy's finalization obligation is fresh.
        await markCandidateExpired(mediaId, key, key.split('/')[1]);
        await mediaDeletionProcessor.cleanupExpiredStaging({ olderThanMs: 0 });
      };

      const res = await publishRescue(mediaId, 'In-flight cleanup post');
      r2Adapter.onCopyObject = undefined;

      expect(cleanupRan).toBe(true);
      expect(res.errors).toBeUndefined();

      const post = res.data!.createRescuePost!;
      const key = finalKey!;

      // The post committed against live bytes: the copied object survives and
      // no deletion work was queued for it.
      expect(r2Adapter.hasObject(key)).toBe(true);
      expect(r2Adapter.hasObject(stagingKey)).toBe(false);
      const queued = await dbHelper.db.select().from(mediaDeletionWork).where(eq(mediaDeletionWork.storageKey, key));
      expect(queued).toHaveLength(0);

      const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('FINALIZED');
      expect(ticket.finalStorageKey).toBe(key);

      const mediaRows = await dbHelper.db.select().from(postMedia).where(eq(postMedia.postId, post.id));
      expect(mediaRows).toHaveLength(1);
      expect(mediaRows[0].cloudflareStorageKey).toBe(key);
      expect(post.media[0].publicUrl).toBe(`https://cdn.pupzy.com/${key}`);

      // The successful finalization settled its durable obligation.
      const obligations = await dbHelper.db
        .select()
        .from(mediaFinalizations)
        .where(eq(mediaFinalizations.mediaId, mediaId));
      expect(obligations).toHaveLength(0);
    });

    it('skips the real no-key in-flight post-media candidate while its finalization obligation is fresh', async () => {
      const { mediaId, stagingKey } = await stageMedia(testUser1, 'image/jpeg');

      let finalKey: string | undefined;
      let cleanupRan = false;

      r2Adapter.onCopyObject = async (key) => {
        if (cleanupRan) return;
        cleanupRan = true;
        finalKey = key;

        // The real production in-flight state: `claimMedia` wrote only
        // status/postId, so there is no `finalStorageKey` for the
        // reclaim-candidate guard to coordinate on. The ticket has just
        // passed expiry while the copy is mid-flight.
        await dbHelper.db
          .update(stagedUploads)
          .set({ expiresAt: new Date(Date.now() - 1000), updatedAt: new Date() })
          .where(eq(stagedUploads.id, mediaId));

        const [beforeCleanup] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
        expect(beforeCleanup.status).toBe('CLAIMED');
        expect(beforeCleanup.finalStorageKey).toBeNull();

        await mediaDeletionProcessor.cleanupExpiredStaging({ olderThanMs: 0 });

        // The fresh obligation keeps the ticket and both objects live; the
        // candidate stays untouched and re-selectable.
        const [candidate] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
        expect(candidate.status).toBe('CLAIMED');
        expect(candidate.finalStorageKey).toBeNull();
        expect(candidate.stagingKey).toBe(stagingKey);
        expect(r2Adapter.hasObject(stagingKey)).toBe(true);
        expect(r2Adapter.hasObject(key)).toBe(true);

        const queued = await dbHelper.db.select().from(mediaDeletionWork).where(eq(mediaDeletionWork.storageKey, key));
        expect(queued).toHaveLength(0);
      };

      const res = await publishRescue(mediaId, 'Real in-flight no-key cleanup post');
      r2Adapter.onCopyObject = undefined;

      expect(cleanupRan).toBe(true);
      expect(res.errors).toBeUndefined();

      const post = res.data!.createRescuePost!;
      const key = finalKey!;

      // The finalization won the race and the post committed against live bytes.
      expect(r2Adapter.hasObject(key)).toBe(true);
      expect(r2Adapter.hasObject(stagingKey)).toBe(false);

      const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('FINALIZED');
      expect(ticket.finalStorageKey).toBe(key);

      const mediaRows = await dbHelper.db.select().from(postMedia).where(eq(postMedia.postId, post.id));
      expect(mediaRows).toHaveLength(1);
      expect(mediaRows[0].cloudflareStorageKey).toBe(key);

      const obligations = await dbHelper.db
        .select()
        .from(mediaFinalizations)
        .where(eq(mediaFinalizations.mediaId, mediaId));
      expect(obligations).toHaveLength(0);
    });

    it('re-selects and terminalizes the no-key candidate once its finalization obligation settles', async () => {
      const { mediaId, stagingKey } = await stageMedia(testUser1, 'image/jpeg');
      const finalKey = `posts/${generateUuidV7()}/${mediaId}.jpg`;

      await dbHelper.db
        .update(stagedUploads)
        .set({
          status: 'CLAIMED',
          finalStorageKey: null,
          postId: generateUuidV7(),
          expiresAt: new Date(Date.now() - 1000),
          updatedAt: new Date(),
        })
        .where(eq(stagedUploads.id, mediaId));
      r2Adapter.putObject(finalKey, Buffer.alloc(64, 0x44));

      await dbHelper.db.insert(mediaFinalizations).values({
        userId: testUser1.id,
        mediaId,
        stagingKey,
        finalKey,
        status: 'IN_FLIGHT',
      });

      const cleaned = await mediaDeletionProcessor.cleanupExpiredStaging({ olderThanMs: 0 });
      expect(cleaned).toBeGreaterThanOrEqual(1);

      // Fresh obligation: the candidate is skipped untouched.
      let [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('CLAIMED');
      expect(ticket.finalStorageKey).toBeNull();
      expect(ticket.stagingKey).toBe(stagingKey);
      expect(r2Adapter.hasObject(stagingKey)).toBe(true);
      expect(r2Adapter.hasObject(finalKey)).toBe(true);

      const queuedBefore = await dbHelper.db
        .select()
        .from(mediaDeletionWork)
        .where(eq(mediaDeletionWork.storageKey, finalKey));
      expect(queuedBefore).toHaveLength(0);

      // Once the obligation settles (its finalization resolved without
      // consuming the ticket), the candidate becomes reclaimable again.
      await dbHelper.db.delete(mediaFinalizations).where(eq(mediaFinalizations.mediaId, mediaId));

      await mediaDeletionProcessor.cleanupExpiredStaging({ olderThanMs: 0 });

      [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('EXPIRED');
      expect(ticket.stagingKey).toBe(`cleaned/${stagingKey}`);
      expect(r2Adapter.hasObject(stagingKey)).toBe(false);
    });

    it('latches a discarded no-key post-media key so the stale-FAILED scan can reclaim it', async () => {
      const { mediaId, stagingKey } = await stageMedia(testUser1, 'image/jpeg');

      let finalKey: string | undefined;
      let cleanupRan = false;
      let latchedAtDelete: { status: string; finalStorageKey: string | null } | undefined;

      r2Adapter.onDeleteObject = async (key) => {
        if (key !== finalKey) return;
        const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
        latchedAtDelete = { status: ticket.status, finalStorageKey: ticket.finalStorageKey };
      };

      r2Adapter.onCopyObject = async (key) => {
        if (cleanupRan) return;
        cleanupRan = true;
        finalKey = key;

        // The real in-flight state: CLAIMED with no finalStorageKey.
        await dbHelper.db
          .update(stagedUploads)
          .set({ expiresAt: new Date(Date.now() - 1000), updatedAt: new Date() })
          .where(eq(stagedUploads.id, mediaId));

        // The copy stalls past its lease, so cleanup terminalizes the
        // candidate before the finalization records its transition.
        await dbHelper.db
          .update(mediaFinalizations)
          .set({ updatedAt: new Date(Date.now() - MEDIA_FINALIZATION_LEASE_MS - 60_000) })
          .where(eq(mediaFinalizations.mediaId, mediaId));
        await mediaDeletionProcessor.cleanupExpiredStaging({ olderThanMs: 0 });

        // Keep the copied object alive so the crash window is observable:
        // the discard delete fails and the key must be durably queued.
        r2Adapter.shouldFailDelete = true;
      };

      const res = await publishRescue(mediaId, 'Lost no-key post media finalization');
      r2Adapter.onCopyObject = undefined;
      r2Adapter.onDeleteObject = undefined;
      r2Adapter.shouldFailDelete = false;

      expect(cleanupRan).toBe(true);
      expect(res.errors).toBeDefined();
      const appError = res.errors![0].originalError as
        { code?: string; extensions?: { retryable?: boolean } } | undefined;
      expect(appError?.code).toBe('POST_MEDIA_PROCESSING_FAILED');
      expect(appError?.extensions?.retryable).toBe(true);

      // The latch was durable before any storage I/O.
      expect(latchedAtDelete).toEqual({ status: 'FAILED', finalStorageKey: finalKey });

      const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('FAILED');
      expect(ticket.finalStorageKey).toBe(finalKey);
      expect(ticket.stagingKey).toBe(stagingKey);

      // The immediate delete failed, so the object is durably queued.
      const key = finalKey!;
      expect(r2Adapter.hasObject(key)).toBe(true);
      const queued = await dbHelper.db.select().from(mediaDeletionWork).where(eq(mediaDeletionWork.storageKey, key));
      expect(queued.length).toBeGreaterThanOrEqual(1);

      // The stale-FAILED scan re-selects the latched ticket and reclaims the
      // object, proving a crash before the delete/queue cannot orphan it.
      await mediaDeletionProcessor.cleanupExpiredStaging({ olderThanMs: 0 });

      expect(r2Adapter.hasObject(key)).toBe(false);
      const [reclaimed] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(reclaimed.stagingKey).toBe(`cleaned/${stagingKey}`);
    });

    it('keeps a latched discarded key reclaimable when a slow cleanup pass still holds the pre-latch snapshot', async () => {
      const { mediaId, stagingKey } = await stageMedia(testUser1, 'image/jpeg');

      let finalKey: string | undefined;
      let cleanupRan = false;
      let staleSnapshot: StagedUpload | undefined;

      r2Adapter.onCopyObject = async (key) => {
        if (cleanupRan) return;
        cleanupRan = true;
        finalKey = key;

        await dbHelper.db
          .update(stagedUploads)
          .set({ expiresAt: new Date(Date.now() - 1000), updatedAt: new Date() })
          .where(eq(stagedUploads.id, mediaId));

        // A concurrent cleanup pass scanned the candidate while it still read
        // CLAIMED with no permanent key, then stalled before processing it.
        [staleSnapshot] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));

        // The copy stalls past its lease, so cleanup terminalizes the
        // candidate; the finalization then loses its transition and latches.
        await dbHelper.db
          .update(mediaFinalizations)
          .set({ updatedAt: new Date(Date.now() - MEDIA_FINALIZATION_LEASE_MS - 60_000) })
          .where(eq(mediaFinalizations.mediaId, mediaId));
        await mediaDeletionProcessor.cleanupExpiredStaging({ olderThanMs: 0 });

        // The discard delete fails, so the latched key (and not the immediate
        // delete) is the durable way back to the copied object.
        r2Adapter.shouldFailDelete = true;
      };

      const res = await publishRescue(mediaId, 'Stale snapshot cleanup pass');
      r2Adapter.onCopyObject = undefined;
      r2Adapter.shouldFailDelete = false;

      expect(cleanupRan).toBe(true);
      expect(res.errors).toBeDefined();

      const key = finalKey!;
      let [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('FAILED');
      expect(ticket.finalStorageKey).toBe(key);

      // Simulate the crash window: neither the immediate delete nor the queued
      // fallback survived, so the latched ticket is the only reclaim path.
      await dbHelper.db.delete(mediaDeletionWork);

      // The stalled pass now processes its pre-latch snapshot. It must not
      // clobber the latch; otherwise the stale-FAILED scan can never select
      // the row again and the copied object is orphaned.
      const processor = mediaDeletionProcessor as unknown as {
        cleanupExpiredCandidate(row: StagedUpload): Promise<void>;
      };
      await processor.cleanupExpiredCandidate(staleSnapshot!);

      [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('FAILED');
      expect(ticket.finalStorageKey).toBe(key);
      expect(ticket.stagingKey).toBe(stagingKey);

      // A later pass must still reclaim the latched object.
      await mediaDeletionProcessor.cleanupExpiredStaging({ olderThanMs: 0 });

      expect(r2Adapter.hasObject(key)).toBe(false);
      const [reclaimed] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(reclaimed.stagingKey).toBe(`cleaned/${stagingKey}`);
    });

    it('discards a copied post image and fails retryably when cleanup reclaimed the ticket first', async () => {
      const { mediaId, stagingKey } = await stageMedia(testUser1, 'image/jpeg');

      let finalKey: string | undefined;
      let cleanupRan = false;
      r2Adapter.onCopyObject = async (key) => {
        if (cleanupRan) return;
        cleanupRan = true;
        finalKey = key;

        await markCandidateExpired(mediaId, key, key.split('/')[1]);

        // The copy stalled past its finalization lease, so the obligation no
        // longer proves a live copy and the cleanup reclaims the candidate
        // before the finalization records its transition.
        await dbHelper.db
          .update(mediaFinalizations)
          .set({ updatedAt: new Date(Date.now() - MEDIA_FINALIZATION_LEASE_MS - 60_000) })
          .where(eq(mediaFinalizations.mediaId, mediaId));
        await mediaDeletionProcessor.cleanupExpiredStaging({ olderThanMs: 0 });
      };

      const res = await publishRescue(mediaId, 'Lost post media finalization race');
      r2Adapter.onCopyObject = undefined;

      expect(cleanupRan).toBe(true);

      // The post is never created against reclaimed bytes; the copied object
      // is discarded/queued and the caller gets a stable retryable error.
      expect(res.errors).toBeDefined();
      const appError = res.errors![0].originalError as
        { code?: string; extensions?: { retryable?: boolean } } | undefined;
      expect(appError?.code).toBe('POST_MEDIA_PROCESSING_FAILED');
      expect(appError?.extensions?.retryable).toBe(true);

      const key = finalKey!;
      expect(r2Adapter.hasObject(key)).toBe(false);
      expect(r2Adapter.hasObject(stagingKey)).toBe(false);

      const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      // The lost transition latched the discarded key onto the terminal
      // ticket so the stale-FAILED scan can reclaim it after a crash.
      expect(ticket.status).toBe('FAILED');
      expect(ticket.finalStorageKey).toBe(key);

      expect(await dbHelper.db.select().from(posts)).toHaveLength(0);
      expect(await dbHelper.db.select().from(postMedia)).toHaveLength(0);

      // The reclaimed key stays durably tracked for deletion.
      const queued = await dbHelper.db.select().from(mediaDeletionWork).where(eq(mediaDeletionWork.storageKey, key));
      expect(queued.length).toBeGreaterThanOrEqual(1);

      // The lost transition also settled its obligation instead of leaking it.
      const obligations = await dbHelper.db
        .select()
        .from(mediaFinalizations)
        .where(eq(mediaFinalizations.mediaId, mediaId));
      expect(obligations).toHaveLength(0);
    });

    it('never deletes post media referenced by a committed post when a stale candidate is processed', async () => {
      const { mediaId } = await stageMedia(testUser1, 'image/jpeg');

      const res = await publishRescue(mediaId, 'Committed media reference');
      expect(res.errors).toBeUndefined();
      const post = res.data!.createRescuePost!;
      const [mediaRow] = await dbHelper.db.select().from(postMedia).where(eq(postMedia.postId, post.id));
      const finalKey = mediaRow.cloudflareStorageKey;
      expect(r2Adapter.hasObject(finalKey)).toBe(true);

      // The candidate scan saw the ticket while it still looked reclaimable;
      // by processing time the committed post references its final key.
      await markCandidateExpired(mediaId, finalKey, post.id);

      await mediaDeletionProcessor.cleanupExpiredStaging({ olderThanMs: 0 });

      // The referenced bytes survive and the ticket is never terminalized.
      expect(r2Adapter.hasObject(finalKey)).toBe(true);
      const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('CLAIMED');
      const queued = await dbHelper.db
        .select()
        .from(mediaDeletionWork)
        .where(eq(mediaDeletionWork.storageKey, finalKey));
      expect(queued).toHaveLength(0);
    });

    it('cleans an expired unconsumed post upload and durably queues its unreferenced final object', async () => {
      const { mediaId, stagingKey } = await stageMedia(testUser1, 'image/jpeg');
      const finalKey = `posts/${generateUuidV7()}/${mediaId}.jpg`;

      await markCandidateExpired(mediaId, finalKey, generateUuidV7());
      r2Adapter.putObject(finalKey, Buffer.alloc(1024, 0x33));

      const cleaned = await mediaDeletionProcessor.cleanupExpiredStaging({ olderThanMs: 0 });
      expect(cleaned).toBeGreaterThanOrEqual(1);

      expect(r2Adapter.hasObject(stagingKey)).toBe(false);
      expect(r2Adapter.hasObject(finalKey)).toBe(false);

      const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('EXPIRED');
      expect(ticket.stagingKey).toBe(`cleaned/${stagingKey}`);

      const queued = await dbHelper.db
        .select()
        .from(mediaDeletionWork)
        .where(eq(mediaDeletionWork.storageKey, finalKey));
      expect(queued).toHaveLength(1);
      expect(queued[0].cdnUrl).toBe('');
    });
  });
});

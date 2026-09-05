import * as fs from 'fs';
import * as path from 'path';
import { graphql } from 'graphql';
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
  lostPosts,
  adoptionPosts,
  productPosts,
  matingPosts,
  type User,
  type City,
} from '../database/schema';
import { PostsRepository } from '../posts/posts.repository';
import { MatingRepository } from '../mating/mating.repository';
import { CitiesRepository } from '../cities/cities.repository';
import { UsersRepository } from '../users/users.repository';
import { CitiesService } from '../cities/cities.service';
import { UsersService } from '../users/users.service';
import { UploadService } from './upload.service';
import { ViewFlushCron } from '../posts/view-flush.cron';
import { PostsService } from '../posts/posts.service';
import { MatingService } from '../mating/mating.service';
import { PostsResolver } from '../posts/posts.resolver';
import { UploadResolver } from './upload.resolver';
import { MatingResolver } from '../mating/mating.resolver';
import type { GqlContext } from '../common/types/gql-context.type';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';

/**
 * Controllable Cloudflare R2 adapter to simulate storage behavior,
 * transient failures, and staging object lifecycle outside database transactions.
 */
class ControllableR2Adapter {
  public objects = new Map<string, Buffer>();
  public shouldFailCopy = false;
  public shouldFailHead = false;

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
  }

  async send(command: any): Promise<any> {
    const cmdName = command.constructor?.name ?? command.name;
    const key = command.input?.Key;

    if (cmdName === 'HeadObjectCommand' || command instanceof HeadObjectCommand) {
      if (this.shouldFailHead || !this.objects.has(key)) {
        const err: any = new Error(`NotFound: ${key}`);
        err.name = 'NotFound';
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      return { ContentLength: this.objects.get(key)?.length ?? 1024 };
    }

    if (cmdName === 'CopyObjectCommand' || command instanceof CopyObjectCommand) {
      if (this.shouldFailCopy) {
        throw new Error('Simulated R2 transient copy failure');
      }
      const copySource: string = command.input?.CopySource ?? '';
      const slashIdx = copySource.indexOf('/');
      const sourceKey = slashIdx >= 0 ? copySource.substring(slashIdx + 1) : copySource;
      const content = this.objects.get(sourceKey) ?? Buffer.from('staged-image-bytes');
      this.objects.set(key, content);
      return {};
    }

    if (cmdName === 'DeleteObjectCommand' || command instanceof DeleteObjectCommand) {
      this.objects.delete(key);
      return {};
    }

    if (cmdName === 'GetObjectCommand' || command instanceof GetObjectCommand) {
      const content = this.objects.get(key);
      if (!content) {
        const err: any = new Error(`NoSuchKey: ${key}`);
        err.name = 'NoSuchKey';
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      return {
        Body: {
          transformToByteArray: async () => new Uint8Array(content),
        },
      };
    }

    return {};
  }
}

describe('Legacy Post Upload & Image Publishing Integration (Ticket 01)', () => {
  jest.setTimeout(120_000);

  let dbHelper: TestDatabaseHelper;
  let r2Adapter: ControllableR2Adapter;
  let cacheStore: Map<string, any>;
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

  let postsResolver: PostsResolver;
  let uploadResolver: UploadResolver;
  let matingResolver: MatingResolver;

  let testCity: City;
  let testUser1: User;
  let testUser2: User;

  let executableSchema: any;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    r2Adapter = new ControllableR2Adapter();
    cacheStore = new Map<string, any>();

    mockCache = {
      get: jest.fn(async (key: string) => cacheStore.get(key)),
      set: jest.fn(async (key: string, val: any) => {
        cacheStore.set(key, val);
      }),
      del: jest.fn(async (key: string) => {
        cacheStore.delete(key);
      }),
      reset: jest.fn(async () => {
        cacheStore.clear();
      }),
      wrap: jest.fn(),
      store: {
        get: async (key: string) => cacheStore.get(key),
        set: async (key: string, val: any) => {
          cacheStore.set(key, val);
        },
        del: async (key: string) => {
          cacheStore.delete(key);
        },
        reset: async () => {
          cacheStore.clear();
        },
        mget: async (...keys: string[]) => keys.map((k) => cacheStore.get(k)),
        mset: async (list: [string, any][]) => {
          list.forEach(([k, v]) => cacheStore.set(k, v));
        },
        mdel: async (...keys: string[]) => {
          keys.forEach((k) => cacheStore.delete(k));
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
    uploadService = new UploadService(mockConfig, mockCache, dbHelper.db);

    // Wire controllable R2 adapter into uploadService's S3Client
    (uploadService as any).s3Client.send = jest.fn((cmd) => r2Adapter.send(cmd));

    const mockNotificationsService = {
      fireNotification: jest.fn().mockResolvedValue(undefined),
    };
    const viewFlushCron = new ViewFlushCron(postsRepo, mockCache);

    postsService = new PostsService(
      postsRepo,
      citiesService,
      uploadService,
      viewFlushCron,
      usersService,
      mockNotificationsService as any,
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
          __parseValue(v: any) {
            return v;
          },
          __serialize(v: any) {
            return v instanceof Date ? v.toISOString() : v;
          },
        },
        Query: {
          post: (_root, args) => postsResolver.post(args.id),
          rescuePostDetail: (_root, args) => postsResolver.rescuePostDetail(args.postId),
          lostPostDetail: (_root, args) => postsResolver.lostPostDetail(args.postId),
          adoptionPostDetail: (_root, args) => postsResolver.adoptionPostDetail(args.postId),
          productPostDetail: (_root, args) => postsResolver.productPostDetail(args.postId),
          matingPostDetail: (_root, args) => matingResolver.matingPostDetail(args.postId),
        },
        Mutation: {
          requestMediaUploadUrl: (_root, args, ctx) => uploadResolver.requestMediaUploadUrl(args.input, ctx),
          createRescuePost: (_root, args, ctx) => postsResolver.createRescuePost(args.input, ctx),
          createLostPost: (_root, args, ctx) => postsResolver.createLostPost(args.input, ctx),
          createAdoptionPost: (_root, args, ctx) => postsResolver.createAdoptionPost(args.input, ctx),
          createProductPost: (_root, args, ctx) => postsResolver.createProductPost(args.input, ctx),
          createMatingPost: (_root, args, ctx) => matingResolver.createMatingPost(args.input, ctx),
        },
        Post: {
          coordinates: (root) => postsResolver.coordinates(root),
          city: (root, _args, ctx) => postsResolver.city(root, ctx),
          creator: (root, _args, ctx) => postsResolver.creator(root, ctx),
          media: (root, _args, ctx) => postsResolver.media(root, ctx),
          isUpvotedByMe: (root, _args, ctx) => postsResolver.isUpvotedByMe(root, ctx),
          isSavedByMe: (root, _args, ctx) => postsResolver.isSavedByMe(root, ctx),
          commentCount: (root) => postsResolver.commentCount(root),
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
  async function executeGql(source: string, variables: Record<string, any> = {}, user: User = testUser1) {
    const ctx: GqlContext = {
      req: {} as any,
      user: { id: user.id } as any,
      loaders: {
        cityById: citiesService.createCityByIdLoader(),
        userById: usersService.createUserByIdLoader(),
        mediaByPostId: postsRepo.createMediaByPostIdLoader(),
        upvotedByMe: postsRepo.createUpvotedByMeLoader(),
        savedByMe: postsRepo.createSavedByMeLoader(),
        commentBoostedByMe: { load: jest.fn().mockResolvedValue(false) } as any,
        pinnedCommentIdByPostId: { load: jest.fn().mockResolvedValue(null) } as any,
        commentMediaByCommentId: { load: jest.fn().mockResolvedValue([]) } as any,
      },
    };

    return graphql({
      schema: executableSchema,
      source,
      variableValues: variables,
      contextValue: ctx,
    });
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

    const res = await executeGql(REQUEST_MEDIA_MUTATION, { input: { contentType, fileSizeBytes } }, user);

    expect(res.errors).toBeUndefined();
    const mediaId = res.data?.requestMediaUploadUrl?.mediaId;
    expect(mediaId).toBeDefined();

    const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(ticket).toBeDefined();

    // Stage bytes into controllable R2 adapter
    r2Adapter.putObject(ticket.stagingKey, Buffer.alloc(fileSizeBytes, 0x7f));

    return { mediaId, stagingKey: ticket.stagingKey };
  }

  // Input builders conforming to authoritative GraphQL SDL schemas
  function makeValidRescueInput(mediaIds?: string[], overrides: Record<string, any> = {}) {
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

  function makeValidLostPetInput(mediaIds?: string[], overrides: Record<string, any> = {}) {
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

  function makeValidFoundStrayInput(mediaIds?: string[], overrides: Record<string, any> = {}) {
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

  function makeValidAdoptionInput(mediaIds?: string[], overrides: Record<string, any> = {}) {
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

  function makeValidProductInput(mediaIds?: string[], overrides: Record<string, any> = {}) {
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

  function makeValidMatingInput(mediaIds: string[], overrides: Record<string, any> = {}) {
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
        const origErr: any = failRes.errors![0].originalError;
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
      const successRes = await executeGql(CREATE_RESCUE_MUTATION, { input: rescueInput }, testUser1);

      expect(successRes.errors).toBeUndefined();
      const createdPost = successRes.data?.createRescuePost;
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
      const res = await executeGql(mutation, { input: makeValidRescueInput([mediaId]) }, testUser1);

      expect(res.errors).toBeUndefined();
      expect(res.data?.createRescuePost?.postType).toBe('RESCUE');
      expect(res.data?.createRescuePost?.media).toHaveLength(1);

      const [ext] = await dbHelper.db
        .select()
        .from(rescuePosts)
        .where(eq(rescuePosts.postId, res.data?.createRescuePost?.id));
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
      const lostRes = await executeGql(lostMutation, { input: makeValidLostPetInput([m1]) }, testUser1);

      expect(lostRes.errors).toBeUndefined();
      expect(lostRes.data?.createLostPost?.postType).toBe('LOST');
      expect(lostRes.data?.createLostPost?.media).toHaveLength(1);

      // FOUND_STRAY
      const { mediaId: m2 } = await stageMedia(testUser1, 'image/webp');
      const strayRes = await executeGql(lostMutation, { input: makeValidFoundStrayInput([m2]) }, testUser1);

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
      const res = await executeGql(mutation, { input: makeValidAdoptionInput([mediaId]) }, testUser1);

      expect(res.errors).toBeUndefined();
      expect(res.data?.createAdoptionPost?.postType).toBe('ADOPTION');
      expect(res.data?.createAdoptionPost?.coordinates).toBeNull(); // Privacy rule
      expect(res.data?.createAdoptionPost?.media).toHaveLength(1);

      const [ext] = await dbHelper.db
        .select()
        .from(adoptionPosts)
        .where(eq(adoptionPosts.postId, res.data?.createAdoptionPost?.id));
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
      const res = await executeGql(mutation, { input: makeValidProductInput([mediaId]) }, testUser1);

      expect(res.errors).toBeUndefined();
      expect(res.data?.createProductPost?.postType).toBe('PRODUCT');
      expect(res.data?.createProductPost?.coordinates).toBeNull(); // Privacy rule
      expect(res.data?.createProductPost?.media).toHaveLength(1);

      const [ext] = await dbHelper.db
        .select()
        .from(productPosts)
        .where(eq(productPosts.postId, res.data?.createProductPost?.id));
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
      const res = await executeGql(mutation, { input: makeValidMatingInput([mediaId]) }, testUser1);

      expect(res.errors).toBeUndefined();
      expect(res.data?.createMatingPost?.postType).toBe('MATING');
      expect(res.data?.createMatingPost?.coordinates).toBeNull();
      expect(res.data?.createMatingPost?.media).toHaveLength(1);

      const [ext] = await dbHelper.db
        .select()
        .from(matingPosts)
        .where(eq(matingPosts.postId, res.data?.createMatingPost?.id));
      expect(ext).toBeDefined();
      expect(ext.petName).toBe('Rocky');
    });
  });

  // ─── 3. Text-Only Publishing Unchanged (AC 3) ─────────────────────────────────

  describe('Acceptance Criterion 3: Text-only workflows remain unchanged', () => {
    it('publishes RESCUE, LOST, ADOPTION, and PRODUCT posts without mediaIds', async () => {
      // RESCUE text-only
      const rescueRes = await executeGql(
        `mutation CreateRescue($input: CreateRescuePostInput!) {
          createRescuePost(input: $input) { id postType media { id } }
        }`,
        { input: makeValidRescueInput() },
        testUser1,
      );
      expect(rescueRes.errors).toBeUndefined();
      expect(rescueRes.data?.createRescuePost?.media).toEqual([]);

      // LOST text-only
      const lostRes = await executeGql(
        `mutation CreateLost($input: CreateLostPostInput!) {
          createLostPost(input: $input) { id postType media { id } }
        }`,
        { input: makeValidLostPetInput() },
        testUser1,
      );
      expect(lostRes.errors).toBeUndefined();
      expect(lostRes.data?.createLostPost?.media).toEqual([]);

      // ADOPTION text-only
      const adoptRes = await executeGql(
        `mutation CreateAdopt($input: CreateAdoptionPostInput!) {
          createAdoptionPost(input: $input) { id postType media { id } }
        }`,
        { input: makeValidAdoptionInput() },
        testUser1,
      );
      expect(adoptRes.errors).toBeUndefined();
      expect(adoptRes.data?.createAdoptionPost?.media).toEqual([]);

      // PRODUCT text-only
      const prodRes = await executeGql(
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
      const res = await executeGql(
        mutation,
        { input: makeValidRescueInput([mediaId], { title: 'Rescue After Cache Loss' }) },
        testUser1,
      );

      expect(res.errors).toBeUndefined();
      const post = res.data?.createRescuePost;
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
});

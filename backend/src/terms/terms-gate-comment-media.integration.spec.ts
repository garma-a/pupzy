import * as crypto from 'crypto';
import { join } from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
const request = require('supertest');
import sharp from 'sharp';
import { eq, sql } from 'drizzle-orm';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));

import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  cities,
  commentMedia,
  comments,
  posts,
  stagedUploads,
  users,
  type City,
  type Post,
  type User,
} from '../database/schema';
import { TermsRepository } from './terms.repository';
import { TermsService } from './terms.service';
import { TermsResolver } from './terms.resolver';
import { TermsAcceptanceGuard } from './terms-acceptance.guard';
import { UsersRepository } from '../users/users.repository';
import { UsersService } from '../users/users.service';
import { AccountDeletionRepository } from '../users/account-deletion.repository';
import { PostsRepository } from '../posts/posts.repository';
import { CitiesRepository } from '../cities/cities.repository';
import { CitiesService } from '../cities/cities.service';
import { CommentsRepository } from '../comments/comments.repository';
import { CommentsService } from '../comments/comments.service';
import { CommentsResolver, CommentMediaResolver } from '../comments/comments.resolver';
import { UploadService } from '../upload/upload.service';
import { AccountIsolationPolicy } from '../blocks/account-isolation.policy';
import { GqlExceptionFilter } from '../common/filters/gql-exception.filter';
import { FirebaseAuthGuard } from '../auth/firebase.guard';
import { FIREBASE_ADMIN_TOKEN } from '../auth/firebase.module';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';

interface R2Object {
  bytes: Buffer;
  etag: string;
}

interface R2Error extends Error {
  name: string;
  $metadata?: { httpStatusCode: number };
}

interface S3CommandLike {
  constructor?: { name?: string };
  name?: string;
  input?: { Key?: string; Body?: unknown };
}

interface S3ClientHolder {
  s3Client: { send: (cmd: unknown) => Promise<unknown> };
}

interface GqlErrorBody {
  message: string;
  extensions?: { code?: string; currentVersion?: string; termsUrl?: string };
}

interface GqlResponseBody {
  data?: Record<string, unknown> | null;
  errors?: GqlErrorBody[];
}

interface CreateCommentData {
  createComment: {
    id: string;
    postId: string;
    text: string;
    media: Array<{ id: string; publicUrl: string; displayOrder: number }>;
  };
}

class ControllableR2Adapter {
  public objects = new Map<string, R2Object>();

  putObject(key: string, bytes: Buffer): void {
    const etag = `"${crypto.createHash('md5').update(bytes).digest('hex')}"`;
    this.objects.set(key, { bytes, etag });
  }

  hasObject(key: string): boolean {
    return this.objects.has(key);
  }

  reset(): void {
    this.objects.clear();
  }

  send(command: S3CommandLike): Promise<Record<string, unknown>> {
    const cmdName = command.constructor?.name ?? command.name;
    const key = command.input?.Key ?? '';

    if (cmdName === 'HeadObjectCommand' || command instanceof HeadObjectCommand) {
      if (!this.objects.has(key)) {
        const err = new Error(`NotFound: ${key}`) as R2Error;
        err.name = 'NotFound';
        err.$metadata = { httpStatusCode: 404 };
        return Promise.reject(err);
      }
      const item = this.objects.get(key)!;
      return Promise.resolve({ ContentLength: item.bytes.length, ETag: item.etag });
    }

    if (cmdName === 'GetObjectCommand' || command instanceof GetObjectCommand) {
      const item = this.objects.get(key);
      if (!item) {
        const err = new Error(`NoSuchKey: ${key}`) as R2Error;
        err.name = 'NoSuchKey';
        err.$metadata = { httpStatusCode: 404 };
        return Promise.reject(err);
      }
      return Promise.resolve({
        ContentLength: item.bytes.length,
        ETag: item.etag,
        Body: {
          transformToByteArray: () => Promise.resolve(new Uint8Array(item.bytes)),
        },
      });
    }

    if (cmdName === 'PutObjectCommand' || command instanceof PutObjectCommand) {
      const body = command.input?.Body;
      const bytes = Buffer.isBuffer(body) ? body : typeof body === 'string' ? Buffer.from(body) : Buffer.from('');
      this.putObject(key, bytes);
      return Promise.resolve({});
    }

    if (cmdName === 'DeleteObjectCommand' || command instanceof DeleteObjectCommand) {
      this.objects.delete(key);
      return Promise.resolve({});
    }

    return Promise.resolve({});
  }
}

const CREATE_COMMENT_MUTATION = `
  mutation CreateComment($input: CreateCommentInput!) {
    createComment(input: $input) {
      id
      postId
      text
      media {
        id
        publicUrl
        displayOrder
      }
    }
  }
`;

/**
 * Integrated release verification (ticket 22): the transport-level Terms
 * Acceptance gate and the Community Evidence image restriction are exercised
 * together, against real Postgres and a controllable object-storage adapter, so
 * the ordering guarantee holds as one release:
 *
 * - a stale/unaccepted account is rejected at the gate before any media work,
 * - after acceptance the resolver still rejects images on restricted types,
 * - a rejected staged upload remains retryable and is finalized on success.
 */
describe('Integrated release: Terms gate x Community Evidence media (Ticket 22)', () => {
  jest.setTimeout(180_000);

  let dbHelper: TestDatabaseHelper;
  let app: INestApplication;
  let r2Adapter: ControllableR2Adapter;
  let cacheStore: Map<string, unknown>;
  let mockVerifyIdToken: jest.Mock;
  let validWebp: Buffer;
  let sequence = 0;

  const TERMS_VERSION = '2026-10-01';
  const TERMS_URL = 'https://pupzy.net/terms';

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    validWebp = await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 120, g: 150, b: 200 } },
    })
      .webp()
      .toBuffer();

    r2Adapter = new ControllableR2Adapter();
    cacheStore = new Map<string, unknown>();

    const mockCache = {
      get: jest.fn((key: string) => Promise.resolve(cacheStore.get(key))),
      set: jest.fn((key: string, value: unknown) => {
        cacheStore.set(key, value);
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
    } as unknown as Cache;

    const mockConfig = {
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
          case 'COMMENT_IMAGES_ENABLED':
            return 'true';
          case 'PHONE_ENCRYPTION_KEY':
            return 'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=';
          case 'TERMS_VERSION':
            return TERMS_VERSION;
          case 'TERMS_URL':
            return TERMS_URL;
          default:
            return undefined;
        }
      }),
    } as unknown as ConfigService;

    mockVerifyIdToken = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
    const authModule = require('firebase-admin/auth');
    jest.spyOn(authModule, 'getAuth').mockReturnValue({
      verifyIdToken: mockVerifyIdToken,
      deleteUser: jest.fn().mockResolvedValue(undefined),
    });

    const citiesRepo = new CitiesRepository(dbHelper.db);
    const usersRepo = new UsersRepository(dbHelper.db);
    const postsRepo = new PostsRepository(dbHelper.db);
    const commentsRepo = new CommentsRepository(dbHelper.db);

    const citiesService = new CitiesService(citiesRepo, mockCache);
    const uploadService = new UploadService(mockConfig, mockCache, dbHelper.db);
    (uploadService as unknown as S3ClientHolder).s3Client.send = jest.fn((cmd: unknown) =>
      r2Adapter.send(cmd as S3CommandLike),
    );
    const usersService = new UsersService(
      usersRepo,
      citiesService,
      new AccountDeletionRepository(dbHelper.db),
      mockConfig,
      mockCache,
      uploadService,
    );
    const isolationPolicy = new AccountIsolationPolicy(dbHelper.db);

    const commentsService = new CommentsService(
      commentsRepo,
      postsRepo,
      uploadService,
      mockConfig,
      undefined,
      undefined,
      usersService,
      isolationPolicy,
    );

    const termsService = new TermsService(mockConfig, new TermsRepository(dbHelper.db));

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          typePaths: [join(process.cwd(), 'src/**/*.graphql')],
          context: ({ req }: { req: unknown }) => ({ req }),
        }),
      ],
      providers: [
        TermsResolver,
        { provide: TermsService, useValue: termsService },
        CommentsResolver,
        CommentMediaResolver,
        { provide: CommentsService, useValue: commentsService },
        { provide: UsersService, useValue: usersService },
        { provide: AccountDeletionRepository, useValue: new AccountDeletionRepository(dbHelper.db) },
        { provide: CACHE_MANAGER, useValue: mockCache },
        { provide: FIREBASE_ADMIN_TOKEN, useValue: {} },
        { provide: APP_GUARD, useClass: FirebaseAuthGuard },
        { provide: APP_GUARD, useClass: TermsAcceptanceGuard },
        { provide: APP_FILTER, useClass: GqlExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();
    r2Adapter.reset();
    cacheStore.clear();
    jest.clearAllMocks();
    sequence = 0;
  });

  async function seedUser(label: string, acceptedVersion: string | null = null): Promise<User> {
    sequence += 1;
    const uid = `fb-release-${label}-${sequence}-${generateUuidV7()}`;
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: uid,
        email: `${uid}@example.com`,
        fullName: `Release ${label}`,
        termsAcceptedVersion: acceptedVersion,
        termsAcceptedAt: acceptedVersion ? new Date() : null,
      })
      .returning();
    return user;
  }

  async function seedCity(): Promise<City> {
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
    return city;
  }

  async function seedPost(creator: User, city: City, postType: 'RESCUE' | 'ADOPTION'): Promise<Post> {
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId: creator.id,
        postType,
        title: `Integrated ${postType} ${generateUuidV7().slice(-4)}`,
        description: 'Integrated release verification fixture',
        status: 'ACTIVE',
        moderationStatus: 'CLEAN',
        urgency: postType === 'RESCUE' ? 'URGENT' : undefined,
        cityId: city.id,
        coordinates: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    return post;
  }

  async function stageCommentImage(user: User, imageBytes: Buffer): Promise<{ mediaId: string; stagingKey: string }> {
    const mediaId = generateUuidV7();
    const stagingKey = `staging/${user.id}/${mediaId}.webp`;

    await dbHelper.db.insert(stagedUploads).values({
      id: mediaId,
      userId: user.id,
      purpose: 'COMMENT_IMAGE',
      stagingKey,
      declaredContentType: 'image/webp',
      declaredFileSizeBytes: imageBytes.length,
      status: 'ISSUED',
      expiresAt: new Date(Date.now() + 900_000),
    });

    r2Adapter.putObject(stagingKey, imageBytes);

    return { mediaId, stagingKey };
  }

  function authenticateAs(user: User): void {
    mockVerifyIdToken.mockResolvedValue({
      uid: user.firebaseUserId,
      auth_time: Math.floor(Date.now() / 1000) - 5,
      firebase: { sign_in_provider: 'google.com' },
    });
  }

  async function gql(query: string, variables?: Record<string, unknown>): Promise<GqlResponseBody> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const req = request(app.getHttpServer()).post('/graphql');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    req.set('Authorization', 'Bearer valid-firebase-token');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const res = (await req.send({ query, variables })) as { body: GqlResponseBody };
    return res.body;
  }

  function errorCode(body: GqlResponseBody): string | undefined {
    return body.errors?.[0]?.extensions?.code;
  }

  it('rejects an image comment while terms are unaccepted, leaving the staged upload untouched and retryable', async () => {
    const city = await seedCity();
    const owner = await seedUser('owner');
    const commenter = await seedUser('commenter');
    const adoption = await seedPost(owner, city, 'ADOPTION');
    const { mediaId, stagingKey } = await stageCommentImage(commenter, validWebp);

    authenticateAs(commenter);

    const blocked = await gql(CREATE_COMMENT_MUTATION, {
      input: {
        postId: adoption.id,
        text: 'Evidence photo before accepting terms',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId],
      },
    });

    expect(errorCode(blocked)).toBe('TERMS_ACCEPTANCE_REQUIRED');
    expect(blocked.errors?.[0]?.extensions?.currentVersion).toBe(TERMS_VERSION);
    expect(blocked.errors?.[0]?.extensions?.termsUrl).toBe(TERMS_URL);

    // The gate runs before the resolver: no Comment, no finalized media, and
    // the durable ticket cannot have been consumed by the rejected attempt.
    expect(await dbHelper.db.select().from(comments).where(eq(comments.postId, adoption.id))).toHaveLength(0);
    expect(await dbHelper.db.select().from(commentMedia)).toHaveLength(0);

    const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(ticket.status).toBe('ISSUED');
    expect(r2Adapter.hasObject(stagingKey)).toBe(true);
    expect(Array.from(r2Adapter.objects.keys()).filter((key) => key.startsWith('comments/'))).toHaveLength(0);
  });

  it('still rejects restricted-type images after acceptance and reuses the same ticket on an eligible case', async () => {
    const city = await seedCity();
    const owner = await seedUser('owner');
    const commenter = await seedUser('commenter', TERMS_VERSION);
    const adoption = await seedPost(owner, city, 'ADOPTION');
    const rescue = await seedPost(owner, city, 'RESCUE');
    const { mediaId, stagingKey } = await stageCommentImage(commenter, validWebp);

    authenticateAs(commenter);

    const restricted = await gql(CREATE_COMMENT_MUTATION, {
      input: {
        postId: adoption.id,
        text: 'Photo on a restricted listing',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId],
      },
    });

    expect(errorCode(restricted)).toBe('COMMENT_MEDIA_NOT_ALLOWED');
    expect(await dbHelper.db.select().from(comments).where(eq(comments.postId, adoption.id))).toHaveLength(0);
    expect(await dbHelper.db.select().from(commentMedia)).toHaveLength(0);

    const [retryableTicket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(retryableTicket.status).toBe('ISSUED');
    expect(r2Adapter.hasObject(stagingKey)).toBe(true);

    // The same ticket publishes on an eligible case and is finalized there.
    const published = await gql(CREATE_COMMENT_MUTATION, {
      input: {
        postId: rescue.id,
        text: 'Retried evidence photo on rescue',
        clientRequestId: generateUuidV7(),
        mediaIds: [mediaId],
      },
    });

    expect(published.errors).toBeUndefined();
    const created = (published.data as CreateCommentData).createComment;
    expect(created.media).toHaveLength(1);
    expect(created.media[0].id).toBe(mediaId);

    const [finalizedTicket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(finalizedTicket.status).toBe('FINALIZED');
    expect(r2Adapter.hasObject(`comments/${created.id}/${mediaId}.webp`)).toBe(true);
    expect(r2Adapter.hasObject(stagingKey)).toBe(false);
    expect(await dbHelper.db.select().from(comments).where(eq(comments.postId, rescue.id))).toHaveLength(1);
    expect(await dbHelper.db.select().from(commentMedia)).toHaveLength(1);
  });
});

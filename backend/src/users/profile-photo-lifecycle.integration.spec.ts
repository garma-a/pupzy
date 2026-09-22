jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { graphql, GraphQLSchema, type ExecutionResult } from 'graphql';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { eq, sql } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import {
  users,
  cities,
  stagedUploads,
  mediaDeletionWork,
  blockedMediaHashes,
  type User,
  type City,
  type StagedUpload,
} from '../database/schema';
import { UsersRepository } from './users.repository';
import { AccountDeletionRepository } from './account-deletion.repository';
import { UsersService } from './users.service';
import { UsersResolver } from './users.resolver';
import type { AccountDeletionService } from './account-deletion.service';
import { CitiesRepository } from '../cities/cities.repository';
import { CitiesService } from '../cities/cities.service';
import { UploadService } from '../upload/upload.service';
import { UploadResolver } from '../upload/upload.resolver';
import { MediaDeletionProcessor } from '../upload/media-deletion.processor';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { AppError } from '../common/errors/app.errors';
import type { GqlContext } from '../common/types/gql-context.type';

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

interface GraphQLErrorExtensionsWithCode {
  code?: string;
  retryable?: boolean;
}

interface ProfilePhotoTicketResponse {
  requestProfilePhotoUploadUrl: {
    mediaId: string;
    uploadUrl: string;
    maxSizeBytes: number;
    maxWidth: number;
    maxHeight: number;
    allowedContentType: string;
  };
}

interface UserResponse {
  id: string;
  profilePictureUrl: string | null;
}

interface SetProfilePhotoResponse {
  setProfilePhoto: UserResponse;
}

interface RemoveProfilePhotoResponse {
  removeProfilePhoto: UserResponse;
}

/**
 * Controllable R2 adapter beneath the real UploadService: metadata-bound
 * staging, byte-preserving publication and provider failure injection.
 */
class ControllableR2Adapter {
  public objects = new Map<string, R2Object>();
  public shouldFailPut = false;
  public onGetObject?: (key: string) => void;
  public onPutObject?: (key: string) => void | Promise<void>;

  putObject(key: string, bytes: Buffer, etag?: string): void {
    const computedEtag = etag ?? `"${crypto.createHash('md5').update(bytes).digest('hex')}"`;
    this.objects.set(key, { bytes, etag: computedEtag });
  }

  hasObject(key: string): boolean {
    return this.objects.has(key);
  }

  getObject(key: string): R2Object | undefined {
    return this.objects.get(key);
  }

  avatarKeys(): string[] {
    return Array.from(this.objects.keys()).filter((key) => key.startsWith('avatars/'));
  }

  reset(): void {
    this.objects.clear();
    this.shouldFailPut = false;
    this.onGetObject = undefined;
    this.onPutObject = undefined;
  }

  async send(command: S3CommandLike): Promise<Record<string, unknown>> {
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
      if (this.onGetObject) {
        this.onGetObject(key);
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
      if (this.shouldFailPut) {
        return Promise.reject(new Error('Simulated R2 PutObject transient failure'));
      }
      if (this.onPutObject) {
        // Fires before the bytes land so a racing recovery can delete first.
        await this.onPutObject(key);
      }
      const body = command.input?.Body;
      const bytes = Buffer.isBuffer(body) ? body : typeof body === 'string' ? Buffer.from(body) : Buffer.from('');
      const etag = `"${crypto.createHash('md5').update(bytes).digest('hex')}"`;
      this.objects.set(key, { bytes, etag });
      return Promise.resolve({});
    }

    if (cmdName === 'DeleteObjectCommand' || command instanceof DeleteObjectCommand) {
      this.objects.delete(key);
      return Promise.resolve({});
    }

    return Promise.resolve({});
  }
}

/**
 * Builds a WebP carrying an arbitrary extra RIFF chunk (used to prove the
 * profile photo pipeline preserves the metadata protections).
 */
function injectChunk(webp: Buffer, fourCC: string, payload: Buffer): Buffer {
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.write(fourCC, 0, 'ascii');
  chunkHeader.writeUInt32LE(payload.length, 4);
  const pad = payload.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0);
  const body = Buffer.concat([webp.subarray(12), chunkHeader, payload, pad]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, body]);
}

/** Minimal 30-byte VP8X header with no frame chunk (invalid image). */
function createHeaderOnlyVp8x(): Buffer {
  const riff = Buffer.from('RIFF', 'ascii');
  const webp = Buffer.from('WEBP', 'ascii');
  const vp8x = Buffer.from('VP8X', 'ascii');
  const chunkSize = Buffer.alloc(4);
  chunkSize.writeUInt32LE(10, 0);
  const vp8xPayload = Buffer.alloc(10);
  vp8xPayload[0] = 0x00;
  vp8xPayload.writeUIntLE(319, 4, 3);
  vp8xPayload.writeUIntLE(239, 7, 3);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(4 + 4 + 4 + 10, 0);
  return Buffer.concat([riff, riffSize, webp, vp8x, chunkSize, vp8xPayload]);
}

describe('Profile Photo Lifecycle Integration (Ticket 17)', () => {
  jest.setTimeout(120_000);

  let dbHelper: TestDatabaseHelper;
  let r2Adapter: ControllableR2Adapter;
  let mockCache: Cache;
  let mockConfig: ConfigService;

  let usersRepo: UsersRepository;
  let accountDeletionRepo: AccountDeletionRepository;
  let citiesService: CitiesService;
  let usersService: UsersService;
  let uploadService: UploadService;
  let mediaDeletionProcessor: MediaDeletionProcessor;

  let usersResolver: UsersResolver;
  let uploadResolver: UploadResolver;
  let executableSchema: GraphQLSchema;

  let testCity: City;
  let user: User;

  let validWebp: Buffer;
  let secondWebp: Buffer;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    validWebp = await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 120, g: 150, b: 200 } },
    })
      .webp()
      .toBuffer();

    secondWebp = await sharp({
      create: { width: 240, height: 240, channels: 3, background: { r: 80, g: 210, b: 120 } },
    })
      .webp()
      .toBuffer();

    r2Adapter = new ControllableR2Adapter();

    const cacheStore = new Map<string, unknown>();
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
            return 'https://cdn.pupzy.net';
          case 'PHONE_ENCRYPTION_KEY':
            return 'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=';
          default:
            return undefined;
        }
      }),
    } as unknown as ConfigService;

    usersRepo = new UsersRepository(dbHelper.db);
    accountDeletionRepo = new AccountDeletionRepository(dbHelper.db);
    const citiesRepo = new CitiesRepository(dbHelper.db);

    citiesService = new CitiesService(citiesRepo, mockCache);
    uploadService = new UploadService(mockConfig, mockCache, dbHelper.db);
    (uploadService as unknown as S3ClientHolder).s3Client.send = jest.fn((cmd: unknown) =>
      r2Adapter.send(cmd as S3CommandLike),
    );

    usersService = new UsersService(
      usersRepo,
      citiesService,
      accountDeletionRepo,
      mockConfig,
      mockCache,
      uploadService,
    );

    mediaDeletionProcessor = new MediaDeletionProcessor(dbHelper.db, uploadService);

    usersResolver = new UsersResolver(usersService, {} as unknown as AccountDeletionService);
    uploadResolver = new UploadResolver(uploadService);

    const schemaFiles = [
      'src/common/graphql/enums.graphql',
      'src/cities/cities.graphql',
      'src/users/users.graphql',
      'src/upload/upload.graphql',
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
          me: (_root: unknown, _args: unknown, ctx: GqlContext) => ctx.user,
        },
        Mutation: {
          requestProfilePhotoUploadUrl: (_root: unknown, args: { input: unknown }, ctx: GqlContext) =>
            uploadResolver.requestProfilePhotoUploadUrl(args.input, ctx),
          setProfilePhoto: (_root: unknown, args: { mediaId: string }, ctx: GqlContext) =>
            usersResolver.setProfilePhoto(args.mediaId, ctx),
          removeProfilePhoto: (_root: unknown, _args: unknown, ctx: GqlContext) =>
            usersResolver.removeProfilePhoto(ctx),
        },
      },
    });
  });

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();
    r2Adapter.reset();

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

    user = await seedUser({});
  });

  async function seedUser(overrides: Partial<typeof users.$inferInsert>): Promise<User> {
    const [created] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `firebase-${generateUuidV7()}`,
        email: `user-${generateUuidV7()}@example.com`,
        fullName: 'Photo Owner',
        homeCityId: testCity.id,
        ...overrides,
      })
      .returning();
    return created;
  }

  async function executeGql<TData = Record<string, unknown>>(
    source: string,
    variables: Record<string, unknown> = {},
    contextUser: User = user,
  ): Promise<ExecutionResult<TData>> {
    const ctx = {
      req: {} as GqlContext['req'],
      user: contextUser,
      loaders: {} as GqlContext['loaders'],
    } as GqlContext;

    return graphql({
      schema: executableSchema,
      source,
      variableValues: variables,
      contextValue: ctx,
    }) as Promise<ExecutionResult<TData>>;
  }

  function gqlErrorCode(result: ExecutionResult<unknown>): string | undefined {
    const err = result.errors?.[0];
    if (!err) return undefined;
    return (
      (err.originalError as AppError | undefined)?.code ??
      (err.extensions as GraphQLErrorExtensionsWithCode | undefined)?.code
    );
  }

  /** Requests a ticket over GraphQL and puts bytes into the staging adapter. */
  async function stageProfilePhoto(
    bytes: Buffer,
    contextUser: User = user,
  ): Promise<{ mediaId: string; stagingKey: string }> {
    const res = await executeGql<ProfilePhotoTicketResponse>(
      `mutation Request($input: RequestProfilePhotoUploadInput!) {
        requestProfilePhotoUploadUrl(input: $input) {
          mediaId
          uploadUrl
          maxSizeBytes
          maxWidth
          maxHeight
          allowedContentType
        }
      }`,
      { input: { contentType: 'image/webp', fileSizeBytes: bytes.length } },
      contextUser,
    );

    expect(res.errors).toBeUndefined();
    expect(res.data!.requestProfilePhotoUploadUrl.uploadUrl).toContain('staging/');
    expect(res.data!.requestProfilePhotoUploadUrl.allowedContentType).toBe('image/webp');

    const mediaId = res.data!.requestProfilePhotoUploadUrl.mediaId;
    const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(ticket.purpose).toBe('PROFILE_PHOTO');
    expect(ticket.userId).toBe(contextUser.id);

    r2Adapter.putObject(ticket.stagingKey, bytes);
    return { mediaId, stagingKey: ticket.stagingKey };
  }

  async function setPhotoViaGql(
    mediaId: string,
    contextUser: User = user,
  ): Promise<ExecutionResult<SetProfilePhotoResponse>> {
    return executeGql<SetProfilePhotoResponse>(
      `mutation Set($mediaId: ID!) {
        setProfilePhoto(mediaId: $mediaId) { id profilePictureUrl }
      }`,
      { mediaId },
      contextUser,
    );
  }

  async function removePhotoViaGql(contextUser: User = user): Promise<ExecutionResult<RemoveProfilePhotoResponse>> {
    return executeGql<RemoveProfilePhotoResponse>(
      `mutation { removeProfilePhoto { id profilePictureUrl } }`,
      {},
      contextUser,
    );
  }

  async function currentUser(userId: string): Promise<User> {
    const [row] = await dbHelper.db.select().from(users).where(eq(users.id, userId));
    return row;
  }

  // ── Complete workflow: set → replace → remove ───────────────────────────────

  it('runs the complete owned upload workflow: set, replace and remove with cleanup', async () => {
    // 1. Set from owned media over the real GraphQL surface.
    const first = await stageProfilePhoto(validWebp);
    const setRes = await setPhotoViaGql(first.mediaId);
    expect(setRes.errors).toBeUndefined();
    expect(setRes.data!.setProfilePhoto.profilePictureUrl).toBe(
      `https://cdn.pupzy.net/avatars/${user.id}/${first.mediaId}.webp`,
    );

    const afterSet = await currentUser(user.id);
    expect(afterSet.profilePictureUrl).toBe(`https://cdn.pupzy.net/avatars/${user.id}/${first.mediaId}.webp`);
    expect(afterSet.profilePhotoStorageKey).toBe(`avatars/${user.id}/${first.mediaId}.webp`);
    expect(afterSet.profilePhotoChangedAt).toBeInstanceOf(Date);

    // Exact verified bytes published, staging removed and ticket finalized.
    const firstKey = `avatars/${user.id}/${first.mediaId}.webp`;
    expect(r2Adapter.getObject(firstKey)!.bytes).toEqual(validWebp);
    expect(r2Adapter.hasObject(first.stagingKey)).toBe(false);
    const [firstTicket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, first.mediaId));
    expect(firstTicket.status).toBe('FINALIZED');
    expect(firstTicket.finalStorageKey).toBe(firstKey);

    // Public rendering reflects the current selection.
    const meAfterSet = await executeGql<{ me: UserResponse }>(`query { me { id profilePictureUrl } }`, {}, afterSet);
    expect(meAfterSet.data!.me.profilePictureUrl).toBe(afterSet.profilePictureUrl);

    // 2. Replace: the previous owned object is queued and deleted.
    const second = await stageProfilePhoto(secondWebp);
    const replaceRes = await setPhotoViaGql(second.mediaId);
    expect(replaceRes.errors).toBeUndefined();
    const secondKey = `avatars/${user.id}/${second.mediaId}.webp`;
    expect(r2Adapter.getObject(secondKey)!.bytes).toEqual(secondWebp);

    const queuedOld = await dbHelper.db
      .select()
      .from(mediaDeletionWork)
      .where(eq(mediaDeletionWork.storageKey, firstKey));
    expect(queuedOld).toHaveLength(1);
    expect(queuedOld[0].cdnUrl).toBe('');

    const processed = await mediaDeletionProcessor.processPendingWork();
    expect(processed).toBeGreaterThanOrEqual(1);
    expect(r2Adapter.hasObject(firstKey)).toBe(false);
    expect(r2Adapter.hasObject(secondKey)).toBe(true);

    // 3. Explicit removal leaves initials and cleans the owned object.
    const removeRes = await removePhotoViaGql();
    expect(removeRes.errors).toBeUndefined();
    expect(removeRes.data!.removeProfilePhoto.profilePictureUrl).toBeNull();

    const afterRemove = await currentUser(user.id);
    expect(afterRemove.profilePictureUrl).toBeNull();
    expect(afterRemove.profilePhotoStorageKey).toBeNull();
    expect(afterRemove.profilePhotoChangedAt).toBeInstanceOf(Date);

    await mediaDeletionProcessor.processPendingWork();
    expect(r2Adapter.hasObject(secondKey)).toBe(false);
    expect(r2Adapter.avatarKeys()).toHaveLength(0);

    const meAfterRemove = await executeGql<{ me: UserResponse }>(
      `query { me { id profilePictureUrl } }`,
      {},
      afterRemove,
    );
    expect(meAfterRemove.data!.me.profilePictureUrl).toBeNull();
  });

  // ── Ownership, purpose and single-use ───────────────────────────────────────

  it('rejects another account’s staged upload without touching either profile', async () => {
    const other = await seedUser({});
    const { mediaId } = await stageProfilePhoto(validWebp, other);

    const res = await setPhotoViaGql(mediaId);
    expect(gqlErrorCode(res)).toBe('PROFILE_PHOTO_NOT_AVAILABLE');

    const mine = await currentUser(user.id);
    expect(mine.profilePictureUrl).toBeNull();
    expect(mine.profilePhotoStorageKey).toBeNull();

    const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(ticket.status).toBe('ISSUED');
    expect(r2Adapter.avatarKeys()).toHaveLength(0);
  });

  it('rejects a ticket that was consumed by an earlier set even after removal', async () => {
    const { mediaId } = await stageProfilePhoto(validWebp);
    await setPhotoViaGql(mediaId);
    await removePhotoViaGql();

    const res = await setPhotoViaGql(mediaId);
    expect(gqlErrorCode(res)).toBe('PROFILE_PHOTO_ALREADY_USED');

    const mine = await currentUser(user.id);
    expect(mine.profilePictureUrl).toBeNull();
    expect(mine.profilePhotoStorageKey).toBeNull();
  });

  it('rejects an upload ticket issued for a different purpose', async () => {
    // A normal Post media ticket cannot be attached as an avatar.
    const mediaId = generateUuidV7();
    const stagingKey = `staging/${user.id}/${mediaId}.webp`;
    await dbHelper.db.insert(stagedUploads).values({
      id: mediaId,
      userId: user.id,
      purpose: 'POST_MEDIA',
      stagingKey,
      declaredContentType: 'image/webp',
      declaredFileSizeBytes: validWebp.length,
      status: 'ISSUED',
      expiresAt: new Date(Date.now() + 900_000),
    });
    r2Adapter.putObject(stagingKey, validWebp);

    const res = await setPhotoViaGql(mediaId);
    expect(gqlErrorCode(res)).toBe('PROFILE_PHOTO_NOT_AVAILABLE');
    expect(r2Adapter.avatarKeys()).toHaveLength(0);
  });

  it('is idempotent when the same active mediaId is retried', async () => {
    const { mediaId } = await stageProfilePhoto(validWebp);
    await setPhotoViaGql(mediaId);

    const retry = await setPhotoViaGql(mediaId);
    expect(retry.errors).toBeUndefined();
    expect(retry.data!.setProfilePhoto.profilePictureUrl).toBe(
      `https://cdn.pupzy.net/avatars/${user.id}/${mediaId}.webp`,
    );

    const queued = await dbHelper.db.select().from(mediaDeletionWork);
    expect(queued).toHaveLength(0);
  });

  // ── Provider synchronization and explicit removal ───────────────────────────

  it('preserves an initial provider photo until a user change, then suppresses restoration', async () => {
    const providerUser = await seedUser({
      profilePictureUrl: 'https://provider.example/initial.png',
      profilePhotoChangedAt: null,
    });

    // Provider re-link before any explicit choice: the provider picture syncs.
    const synced = await usersService.findOrCreate({
      firebaseUserId: `firebase-${generateUuidV7()}`,
      email: providerUser.email,
      photoUrl: 'https://provider.example/synced.png',
      emailVerified: true,
    });
    expect(synced.profilePictureUrl).toBe('https://provider.example/synced.png');

    // Explicit removal: no picture, and no provider URL treated as owned media.
    const removed = await usersService.removeProfilePhoto(providerUser.id);
    expect(removed.profilePictureUrl).toBeNull();
    expect(removed.profilePhotoStorageKey).toBeNull();
    expect(await dbHelper.db.select().from(mediaDeletionWork)).toHaveLength(0);

    // A later provider synchronization must not undo the removal.
    const afterRemoval = await usersService.findOrCreate({
      firebaseUserId: `firebase-${generateUuidV7()}`,
      email: providerUser.email,
      photoUrl: 'https://provider.example/restored.png',
      emailVerified: true,
    });
    expect(afterRemoval.profilePictureUrl).toBeNull();
    expect(afterRemoval.profilePhotoStorageKey).toBeNull();
  });

  it('never lets provider synchronization overwrite an owned photo', async () => {
    const ownedUser = await seedUser({ profilePictureUrl: 'https://provider.example/initial.png' });
    const { mediaId } = await stageProfilePhoto(validWebp, ownedUser);
    await setPhotoViaGql(mediaId, ownedUser);

    const ownedUrl = `https://cdn.pupzy.net/avatars/${ownedUser.id}/${mediaId}.webp`;
    const afterSync = await usersService.findOrCreate({
      firebaseUserId: `firebase-${generateUuidV7()}`,
      email: ownedUser.email,
      photoUrl: 'https://provider.example/replacement.png',
      emailVerified: true,
    });

    expect(afterSync.profilePictureUrl).toBe(ownedUrl);
    expect(afterSync.profilePhotoStorageKey).toBe(`avatars/${ownedUser.id}/${mediaId}.webp`);
  });

  // ── Concurrent replacement ──────────────────────────────────────────────────

  it('compensates the losing request when two replacements race', async () => {
    const first = await stageProfilePhoto(validWebp);
    const second = await stageProfilePhoto(secondWebp);

    // Both requests observe the same pre-replacement profile (the race window
    // before either activation commits).
    const observed = await usersService.findActiveById(user.id);
    const spy = jest.spyOn(usersService, 'findActiveById').mockResolvedValue(observed);

    const [resultA, resultB] = await Promise.allSettled([
      usersService.setProfilePhoto(user.id, first.mediaId),
      usersService.setProfilePhoto(user.id, second.mediaId),
    ]);
    spy.mockRestore();

    const fulfilled = [resultA, resultB].filter((r) => r.status === 'fulfilled');
    const rejected = [resultA, resultB].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'PROFILE_PHOTO_REPLACED' });

    const winner = fulfilled[0];
    const winnerKey = winner.value.profilePhotoStorageKey!;
    const winnerMediaId = winnerKey.endsWith(`${first.mediaId}.webp`) ? first.mediaId : second.mediaId;
    const loser = winnerMediaId === first.mediaId ? second : first;
    const loserKey = `avatars/${user.id}/${loser.mediaId}.webp`;

    const finalUser = await currentUser(user.id);
    expect(finalUser.profilePhotoStorageKey).toBe(winnerKey);
    expect(finalUser.profilePictureUrl).toBe(`https://cdn.pupzy.net/${winnerKey}`);

    // The loser's finalized object is compensated away and never referenced.
    expect(r2Adapter.hasObject(winnerKey)).toBe(true);
    expect(r2Adapter.hasObject(loserKey)).toBe(false);
    const [loserTicket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, loser.mediaId));
    expect(loserTicket.status).toBe('FAILED');

    const queued = await dbHelper.db.select().from(mediaDeletionWork);
    expect(queued.map((row) => row.storageKey)).not.toContain(winnerKey);
  });

  // ── Delayed set versus explicit removal ─────────────────────────────────────

  it('keeps an explicit removal when the observed change marker changed before activation', async () => {
    // The account's only picture is provider-owned, so the owned storage key is
    // NULL both before and after removal. The change marker is the only value
    // that can tell the stale set apart from the removal.
    const providerUser = await seedUser({
      profilePictureUrl: 'https://provider.example/initial.png',
      profilePhotoStorageKey: null,
      profilePhotoChangedAt: null,
    });

    const observed = await usersService.findActiveById(providerUser.id);
    expect(observed).toBeDefined();
    const expectedStorageKey = observed!.profilePhotoStorageKey ?? null;
    const expectedChangedAt = observed!.profilePhotoChangedAt ?? null;
    expect(expectedStorageKey).toBeNull();
    expect(expectedChangedAt).toBeNull();

    // An explicit removal commits after the set request observed the row but
    // before its activation transaction runs.
    await usersRepo.clearProfilePhoto(providerUser.id);

    const contestedMediaId = generateUuidV7();
    const contestedKey = `avatars/${providerUser.id}/${contestedMediaId}.webp`;
    await dbHelper.db.insert(stagedUploads).values({
      id: contestedMediaId,
      userId: providerUser.id,
      purpose: 'PROFILE_PHOTO',
      stagingKey: `staging/${providerUser.id}/${contestedMediaId}.webp`,
      declaredContentType: 'image/webp',
      declaredFileSizeBytes: validWebp.length,
      status: 'FINALIZED',
      finalStorageKey: contestedKey,
      expiresAt: new Date(Date.now() + 900_000),
    });
    const activationInput = {
      stagedUploadId: contestedMediaId,
      expectedStorageKey,
      expectedChangedAt,
      storageKey: contestedKey,
      publicUrl: `https://cdn.pupzy.net/${contestedKey}`,
    };
    await expect(usersRepo.activateProfilePhoto(providerUser.id, activationInput)).rejects.toMatchObject({
      code: 'PROFILE_PHOTO_REPLACED',
    });

    const after = await currentUser(providerUser.id);
    expect(after.profilePictureUrl).toBeNull();
    expect(after.profilePhotoStorageKey).toBeNull();
    expect(after.profilePhotoChangedAt).toBeInstanceOf(Date);
    expect(r2Adapter.avatarKeys()).toHaveLength(0);
  });

  it('compensates a delayed set that loses to an explicit removal and preserves the removal', async () => {
    const initialStates: Array<{ profilePictureUrl: string | null }> = [
      { profilePictureUrl: 'https://provider.example/initial.png' },
      { profilePictureUrl: null },
    ];

    for (const initialState of initialStates) {
      const target = await seedUser({
        ...initialState,
        profilePhotoStorageKey: null,
        profilePhotoChangedAt: null,
      });
      const { mediaId } = await stageProfilePhoto(validWebp, target);

      const realFinalize = uploadService.finalizeProfilePhoto.bind(uploadService);
      const finalizeSpy = jest
        .spyOn(uploadService, 'finalizeProfilePhoto')
        .mockImplementation(async (stagedMediaId: string, ownerId: string) => {
          const finalized = await realFinalize(stagedMediaId, ownerId);
          // The explicit removal commits mid-flight, after finalization but
          // before the activation transaction observes the row.
          await usersRepo.clearProfilePhoto(ownerId);
          return finalized;
        });

      const res = await setPhotoViaGql(mediaId, target);
      finalizeSpy.mockRestore();

      expect(gqlErrorCode(res)).toBe('PROFILE_PHOTO_REPLACED');

      const finalizedKey = `avatars/${target.id}/${mediaId}.webp`;
      // The losing request is compensated: finalized object deleted and its
      // ticket terminal FAILED.
      expect(r2Adapter.hasObject(finalizedKey)).toBe(false);
      const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
      expect(ticket.status).toBe('FAILED');

      // The removal survives and no owned object is referenced or queued.
      const after = await currentUser(target.id);
      expect(after.profilePictureUrl).toBeNull();
      expect(after.profilePhotoStorageKey).toBeNull();
      expect(after.profilePhotoChangedAt).toBeInstanceOf(Date);
      const queued = await dbHelper.db.select().from(mediaDeletionWork);
      expect(queued.map((row) => row.storageKey)).not.toContain(finalizedKey);
      expect(r2Adapter.avatarKeys()).toHaveLength(0);
    }
  });

  // ── Upload/finalization failure compensation ────────────────────────────────

  it('rejects invalid image bytes without publishing or changing the profile', async () => {
    const { mediaId } = await stageProfilePhoto(createHeaderOnlyVp8x());

    const res = await setPhotoViaGql(mediaId);
    expect(gqlErrorCode(res)).toBe('PROFILE_PHOTO_INVALID_FORMAT');

    const mine = await currentUser(user.id);
    expect(mine.profilePictureUrl).toBeNull();
    const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(ticket.status).toBe('FAILED');
    expect(r2Adapter.avatarKeys()).toHaveLength(0);
  });

  it('rejects blocked hashes without leaking moderation details and without publishing', async () => {
    const blockedHash = crypto.createHash('sha256').update(validWebp).digest('hex');
    await dbHelper.db.insert(blockedMediaHashes).values({
      sha256: blockedHash,
      reason: 'Permanently removed inappropriate content',
    });

    const { mediaId } = await stageProfilePhoto(validWebp);
    const res = await setPhotoViaGql(mediaId);

    expect(gqlErrorCode(res)).toBe('PROFILE_PHOTO_INVALID_FORMAT');
    const message = res.errors![0].message;
    expect(message).not.toContain('blocked');
    expect(message).not.toContain('moderation');
    expect(r2Adapter.avatarKeys()).toHaveLength(0);
    const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(ticket.status).toBe('FAILED');
  });

  it('rejects embedded metadata with the avatar metadata protection', async () => {
    const exifWebp = injectChunk(validWebp, 'EXIF', Buffer.from('exif payload'));
    const { mediaId } = await stageProfilePhoto(exifWebp);

    const res = await setPhotoViaGql(mediaId);
    expect(gqlErrorCode(res)).toBe('PROFILE_PHOTO_METADATA_FORBIDDEN');
    expect(r2Adapter.avatarKeys()).toHaveLength(0);
  });

  it('rejects an oversized declared upload before any ticket exists', async () => {
    const res = await executeGql<unknown>(
      `mutation Request($input: RequestProfilePhotoUploadInput!) {
        requestProfilePhotoUploadUrl(input: $input) { mediaId }
      }`,
      { input: { contentType: 'image/webp', fileSizeBytes: 100_001 } },
    );

    expect(gqlErrorCode(res)).toBe('PROFILE_PHOTO_TOO_LARGE');
    const tickets = await dbHelper.db.select().from(stagedUploads);
    expect(tickets).toHaveLength(0);
  });

  it('compensates a failed permanent publication and keeps the ticket retryable', async () => {
    const { mediaId, stagingKey } = await stageProfilePhoto(validWebp);
    r2Adapter.shouldFailPut = true;

    const res = await setPhotoViaGql(mediaId);
    expect(gqlErrorCode(res)).toBe('PROFILE_PHOTO_PROCESSING_FAILED');
    expect(res.errors![0].extensions?.retryable).toBe(true);

    const mine = await currentUser(user.id);
    expect(mine.profilePictureUrl).toBeNull();
    expect(r2Adapter.avatarKeys()).toHaveLength(0);

    const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(ticket.status).toBe('ISSUED');
    expect(r2Adapter.hasObject(stagingKey)).toBe(true);

    // Retrying after the storage recovers succeeds with the same mediaId.
    r2Adapter.shouldFailPut = false;
    const retry = await setPhotoViaGql(mediaId);
    expect(retry.errors).toBeUndefined();
    expect(retry.data!.setProfilePhoto.profilePictureUrl).toContain(`avatars/${user.id}/${mediaId}.webp`);
  });

  it('compensates the finalized object when the profile activation fails', async () => {
    const { mediaId } = await stageProfilePhoto(validWebp);
    const activateSpy = jest
      .spyOn(usersRepo, 'activateProfilePhoto')
      .mockRejectedValueOnce(new Error('Simulated database failure'));

    const res = await setPhotoViaGql(mediaId);
    expect(res.errors).toBeDefined();
    activateSpy.mockRestore();

    const finalKey = `avatars/${user.id}/${mediaId}.webp`;
    expect(r2Adapter.hasObject(finalKey)).toBe(false);
    const mine = await currentUser(user.id);
    expect(mine.profilePictureUrl).toBeNull();
    const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(ticket.status).toBe('FAILED');
  });

  it('rejects staging replaced between download and publication and never publishes it', async () => {
    const { mediaId, stagingKey } = await stageProfilePhoto(validWebp);

    r2Adapter.onGetObject = (key) => {
      if (key === stagingKey) {
        r2Adapter.objects.set(stagingKey, {
          bytes: Buffer.from('malicious-replaced-bytes'),
          etag: '"tampered-attacker-etag"',
        });
      }
    };

    const res = await setPhotoViaGql(mediaId);
    expect(gqlErrorCode(res)).toBe('PROFILE_PHOTO_PROCESSING_FAILED');
    expect(res.errors![0].extensions?.retryable).toBe(true);

    expect(r2Adapter.avatarKeys()).toHaveLength(0);
    const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(ticket.status).toBe('ISSUED');
  });

  // ── Obsolete media recovery ─────────────────────────────────────────────────

  it('reclaims an unreferenced finalized avatar and never deletes the active one', async () => {
    const active = await stageProfilePhoto(validWebp);
    await setPhotoViaGql(active.mediaId);
    const activeKey = `avatars/${user.id}/${active.mediaId}.webp`;

    // Simulate a crash after finalization but before the owning row update.
    const orphanMediaId = generateUuidV7();
    const orphanKey = `avatars/${user.id}/${orphanMediaId}.webp`;
    await dbHelper.db.insert(stagedUploads).values({
      id: orphanMediaId,
      userId: user.id,
      purpose: 'PROFILE_PHOTO',
      stagingKey: `staging/${user.id}/${orphanMediaId}.webp`,
      declaredContentType: 'image/webp',
      declaredFileSizeBytes: validWebp.length,
      status: 'FINALIZED',
      finalStorageKey: orphanKey,
      expiresAt: new Date(Date.now() + 900_000),
    });
    r2Adapter.putObject(orphanKey, validWebp);

    await mediaDeletionProcessor.reconcile({ olderThanMs: 0 });

    expect(r2Adapter.hasObject(orphanKey)).toBe(false);
    expect(r2Adapter.hasObject(activeKey)).toBe(true);
    const finalUser = await currentUser(user.id);
    expect(finalUser.profilePhotoStorageKey).toBe(activeKey);

    // The reclaimed ticket is terminal and its durable deletion work survives.
    const [orphanTicket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, orphanMediaId));
    expect(orphanTicket.status).toBe('EXPIRED');
    const orphanWork = await dbHelper.db
      .select()
      .from(mediaDeletionWork)
      .where(eq(mediaDeletionWork.storageKey, orphanKey));
    expect(orphanWork).toHaveLength(1);
    expect(orphanWork[0].cdnUrl).toBe('');

    // The active avatar stays finalized and is never enqueued for deletion.
    const [activeTicket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, active.mediaId));
    expect(activeTicket.status).toBe('FINALIZED');
    const activeWork = await dbHelper.db
      .select()
      .from(mediaDeletionWork)
      .where(eq(mediaDeletionWork.storageKey, activeKey));
    expect(activeWork).toHaveLength(0);
  });

  it('cleans only the staging object of an avatar that is still active', async () => {
    const { mediaId, stagingKey } = await stageProfilePhoto(validWebp);
    await setPhotoViaGql(mediaId);
    const finalKey = `avatars/${user.id}/${mediaId}.webp`;

    // Simulate a crash that left the staging object behind after publication.
    r2Adapter.putObject(stagingKey, validWebp);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const report = await mediaDeletionProcessor.reconcile({ olderThanMs: 0 });

    expect(report.orphanedProfilePhotosRecovered).toBe(0);
    expect(r2Adapter.hasObject(finalKey)).toBe(true);
    expect(r2Adapter.hasObject(stagingKey)).toBe(false);

    const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(ticket.status).toBe('FINALIZED');
    expect(ticket.stagingKey).toBe(`cleaned/${stagingKey}`);
    const queued = await dbHelper.db.select().from(mediaDeletionWork);
    expect(queued.map((row) => row.storageKey)).not.toContain(finalKey);
  });

  it('re-checks the active reference inside its transaction when activation commits after the scan', async () => {
    const { mediaId } = await stageProfilePhoto(validWebp);
    const finalized = await uploadService.finalizeProfilePhoto(mediaId, user.id);
    const finalKey = finalized.storageKey;

    const observed = await currentUser(user.id);
    const expectedStorageKey = observed.profilePhotoStorageKey ?? null;
    const expectedChangedAt = observed.profilePhotoChangedAt ?? null;

    const internals = mediaDeletionProcessor as unknown as {
      reclaimOrphanedProfilePhoto: (orphan: StagedUpload) => Promise<'RECLAIMED' | 'REFERENCED' | 'SKIPPED'>;
    };
    const realReclaim = internals.reclaimOrphanedProfilePhoto.bind(mediaDeletionProcessor);
    let activated = false;
    const reclaimSpy = jest
      .spyOn(internals, 'reclaimOrphanedProfilePhoto')
      .mockImplementation(async (orphan: StagedUpload) => {
        if (!activated) {
          activated = true;
          // Activation commits after the recovery scan selected the ticket but
          // before recovery's coordination transaction runs.
          await usersRepo.activateProfilePhoto(user.id, {
            stagedUploadId: orphan.id,
            expectedStorageKey,
            expectedChangedAt,
            storageKey: orphan.finalStorageKey!,
            publicUrl: `https://cdn.pupzy.net/${orphan.finalStorageKey}`,
          });
        }
        return realReclaim(orphan);
      });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const report = await mediaDeletionProcessor.reconcile({ olderThanMs: 0 });
    reclaimSpy.mockRestore();

    expect(activated).toBe(true);
    expect(report.orphanedProfilePhotosRecovered).toBe(0);

    const after = await currentUser(user.id);
    expect(after.profilePhotoStorageKey).toBe(finalKey);
    expect(after.profilePictureUrl).toBe(`https://cdn.pupzy.net/${finalKey}`);
    expect(r2Adapter.hasObject(finalKey)).toBe(true);

    const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(ticket.status).toBe('FINALIZED');
    const queued = await dbHelper.db.select().from(mediaDeletionWork);
    expect(queued.map((row) => row.storageKey)).not.toContain(finalKey);
  });

  it('rejects a delayed activation after recovery reclaimed the ticket and compensates its object', async () => {
    const { mediaId } = await stageProfilePhoto(validWebp);
    const finalKey = `avatars/${user.id}/${mediaId}.webp`;

    const realFinalize = uploadService.finalizeProfilePhoto.bind(uploadService);
    const finalizeSpy = jest
      .spyOn(uploadService, 'finalizeProfilePhoto')
      .mockImplementation(async (stagedMediaId: string, ownerId: string) => {
        const finalized = await realFinalize(stagedMediaId, ownerId);
        // Recovery reclaims the finalized-but-unactivated avatar before the
        // caller's activation transaction runs.
        await new Promise((resolve) => setTimeout(resolve, 5));
        await mediaDeletionProcessor.reconcile({ olderThanMs: 0 });
        return finalized;
      });

    const res = await setPhotoViaGql(mediaId);
    finalizeSpy.mockRestore();

    expect(gqlErrorCode(res)).toBe('PROFILE_PHOTO_REPLACED');

    // The profile never references deleted bytes; the losing request is
    // compensated and its ticket terminal.
    const after = await currentUser(user.id);
    expect(after.profilePictureUrl).toBeNull();
    expect(after.profilePhotoStorageKey).toBeNull();
    expect(r2Adapter.hasObject(finalKey)).toBe(false);
    const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(ticket.status).toBe('FAILED');
  });

  // ── Recovery leak corners ───────────────────────────────────────────────────

  it('durably queues the final and staging keys when the owner row vanished before reclaim', async () => {
    // The scan selects the orphan candidate, then the owner cascades away
    // (account deletion) before recovery's coordination transaction runs. Its
    // ticket cascades with the user, so nothing can ever re-select the object;
    // recovery must queue both keys instead of skipping silently.
    const orphanMediaId = generateUuidV7();
    const orphanKey = `avatars/${user.id}/${orphanMediaId}.webp`;
    const orphanStagingKey = `staging/${user.id}/${orphanMediaId}.webp`;
    const [orphanTicket] = await dbHelper.db
      .insert(stagedUploads)
      .values({
        id: orphanMediaId,
        userId: user.id,
        purpose: 'PROFILE_PHOTO',
        stagingKey: orphanStagingKey,
        declaredContentType: 'image/webp',
        declaredFileSizeBytes: validWebp.length,
        status: 'FINALIZED',
        finalStorageKey: orphanKey,
        expiresAt: new Date(Date.now() + 900_000),
      })
      .returning();
    r2Adapter.putObject(orphanKey, validWebp);
    r2Adapter.putObject(orphanStagingKey, validWebp);

    const internals = mediaDeletionProcessor as unknown as {
      reclaimOrphanedProfilePhoto: (orphan: StagedUpload) => Promise<'RECLAIMED' | 'REFERENCED' | 'SKIPPED'>;
    };
    const realReclaim = internals.reclaimOrphanedProfilePhoto.bind(mediaDeletionProcessor);
    let ownerVanished = false;
    const reclaimSpy = jest
      .spyOn(internals, 'reclaimOrphanedProfilePhoto')
      .mockImplementation(async (orphan: StagedUpload) => {
        if (!ownerVanished) {
          ownerVanished = true;
          await dbHelper.db.delete(users).where(eq(users.id, orphan.userId));
        }
        return realReclaim(orphan);
      });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const report = await mediaDeletionProcessor.reconcile({ olderThanMs: 0 });
    reclaimSpy.mockRestore();

    expect(ownerVanished).toBe(true);
    expect(report.orphanedProfilePhotosRecovered).toBe(1);

    // Both keys are durably queued storage-only rather than silently skipped.
    const finalWork = await dbHelper.db
      .select()
      .from(mediaDeletionWork)
      .where(eq(mediaDeletionWork.storageKey, orphanKey));
    expect(finalWork).toHaveLength(1);
    expect(finalWork[0].cdnUrl).toBe('');
    const stagingWork = await dbHelper.db
      .select()
      .from(mediaDeletionWork)
      .where(eq(mediaDeletionWork.storageKey, orphanStagingKey));
    expect(stagingWork).toHaveLength(1);
    expect(stagingWork[0].cdnUrl).toBe('');

    // Reclaiming is idempotent: re-running on the same stale candidate does
    // not enqueue duplicate work rows.
    await expect(internals.reclaimOrphanedProfilePhoto(orphanTicket)).resolves.toBe('RECLAIMED');
    const afterRetry = await dbHelper.db.select().from(mediaDeletionWork);
    expect(afterRetry.filter((row) => row.storageKey === orphanKey)).toHaveLength(1);
    expect(afterRetry.filter((row) => row.storageKey === orphanStagingKey)).toHaveLength(1);

    // No live object survives the recovery pass.
    expect(r2Adapter.hasObject(orphanKey)).toBe(false);
    expect(r2Adapter.hasObject(orphanStagingKey)).toBe(false);
  });

  it('discards a published avatar when the ticket left CLAIMED before finalization was recorded', async () => {
    const { mediaId, stagingKey } = await stageProfilePhoto(validWebp);
    const finalKey = `avatars/${user.id}/${mediaId}.webp`;

    // Recovery reclaims the CLAIMED ticket while the PutObject is in flight,
    // after recovery's storage delete already ran: the late PutObject would
    // otherwise land behind a terminal EXPIRED ticket that is never rescanned.
    let reclaimed = false;
    r2Adapter.onPutObject = async (key) => {
      if (key !== finalKey || reclaimed) return;
      reclaimed = true;
      await new Promise((resolve) => setTimeout(resolve, 5));
      await mediaDeletionProcessor.reconcile({ olderThanMs: 0 });
    };

    await expect(uploadService.finalizeProfilePhoto(mediaId, user.id)).rejects.toMatchObject({
      code: 'PROFILE_PHOTO_PROCESSING_FAILED',
      extensions: { retryable: true },
    });
    r2Adapter.onPutObject = undefined;

    expect(reclaimed).toBe(true);
    const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(ticket.status).toBe('EXPIRED');

    // The late object is deleted/queued, never left behind a terminal ticket.
    expect(r2Adapter.hasObject(finalKey)).toBe(false);
    expect(r2Adapter.hasObject(stagingKey)).toBe(false);
    const queued = await dbHelper.db.select().from(mediaDeletionWork).where(eq(mediaDeletionWork.storageKey, finalKey));
    expect(queued.every((row) => row.cdnUrl === '')).toBe(true);

    // The profile stays untouched.
    const after = await currentUser(user.id);
    expect(after.profilePictureUrl).toBeNull();
    expect(after.profilePhotoStorageKey).toBeNull();
  });

  // ── Expired-staging cleanup coordination ───────────────────────────────────

  it('never deletes an avatar activated after the expired-cleanup scan selected its ticket', async () => {
    const { mediaId, stagingKey } = await stageProfilePhoto(validWebp);
    const finalKey = `avatars/${user.id}/${mediaId}.webp`;

    // The upload was claimed just before expiry, so hourly cleanup selects the
    // ticket as an expired CLAIMED candidate while the set request is still in
    // flight. Finalization and activation then complete from the stale
    // candidate list's point of view.
    await dbHelper.db
      .update(stagedUploads)
      .set({
        status: 'CLAIMED',
        finalStorageKey: finalKey,
        expiresAt: new Date(Date.now() - 1000),
        updatedAt: new Date(),
      })
      .where(eq(stagedUploads.id, mediaId));
    r2Adapter.putObject(stagingKey, validWebp);

    const realDelete = uploadService.deleteObject.bind(uploadService);
    let activated = false;
    const deleteSpy = jest.spyOn(uploadService, 'deleteObject').mockImplementation(async (key: string) => {
      if (!activated && key === stagingKey) {
        activated = true;
        // Finalization publishes the exact bytes and records FINALIZED, then
        // activation installs the key on the owner row — all after the cleanup
        // candidate was selected but before it is processed.
        r2Adapter.putObject(finalKey, validWebp);
        await dbHelper.db
          .update(stagedUploads)
          .set({ status: 'FINALIZED', finalStorageKey: finalKey, updatedAt: new Date() })
          .where(eq(stagedUploads.id, mediaId));
        await usersRepo.activateProfilePhoto(user.id, {
          stagedUploadId: mediaId,
          expectedStorageKey: null,
          expectedChangedAt: null,
          storageKey: finalKey,
          publicUrl: `https://cdn.pupzy.net/${finalKey}`,
        });
      }
      return realDelete(key);
    });

    await mediaDeletionProcessor.cleanupExpiredStaging({ olderThanMs: 0 });
    deleteSpy.mockRestore();

    expect(activated).toBe(true);

    // The active bytes survive, the ticket is never marked EXPIRED, and the
    // profile still references live bytes.
    expect(r2Adapter.hasObject(finalKey)).toBe(true);
    expect(r2Adapter.hasObject(stagingKey)).toBe(false);
    const after = await currentUser(user.id);
    expect(after.profilePhotoStorageKey).toBe(finalKey);
    expect(after.profilePictureUrl).toBe(`https://cdn.pupzy.net/${finalKey}`);

    const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(ticket.status).toBe('FINALIZED');
    const queued = await dbHelper.db.select().from(mediaDeletionWork).where(eq(mediaDeletionWork.storageKey, finalKey));
    expect(queued).toHaveLength(0);
  });

  it('cleans an expired unconsumed avatar and durably queues its unreferenced final object', async () => {
    const { mediaId, stagingKey } = await stageProfilePhoto(validWebp);
    const finalKey = `avatars/${user.id}/${mediaId}.webp`;

    await dbHelper.db
      .update(stagedUploads)
      .set({
        status: 'CLAIMED',
        finalStorageKey: finalKey,
        expiresAt: new Date(Date.now() - 1000),
        updatedAt: new Date(),
      })
      .where(eq(stagedUploads.id, mediaId));
    r2Adapter.putObject(stagingKey, validWebp);
    r2Adapter.putObject(finalKey, validWebp);

    const cleaned = await mediaDeletionProcessor.cleanupExpiredStaging({ olderThanMs: 0 });
    expect(cleaned).toBeGreaterThanOrEqual(1);

    expect(r2Adapter.hasObject(stagingKey)).toBe(false);
    expect(r2Adapter.hasObject(finalKey)).toBe(false);

    const [ticket] = await dbHelper.db.select().from(stagedUploads).where(eq(stagedUploads.id, mediaId));
    expect(ticket.status).toBe('EXPIRED');
    expect(ticket.stagingKey).toBe(`cleaned/${stagingKey}`);

    const queued = await dbHelper.db.select().from(mediaDeletionWork).where(eq(mediaDeletionWork.storageKey, finalKey));
    expect(queued).toHaveLength(1);
    expect(queued[0].cdnUrl).toBe('');

    const after = await currentUser(user.id);
    expect(after.profilePhotoStorageKey).toBeNull();
  });
});

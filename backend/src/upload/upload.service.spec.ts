/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import * as crypto from 'crypto';
import sharp from 'sharp';
import { UploadService } from './upload.service';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { NotFoundError } from '../common/errors/app.errors';
import type { StagedUpload } from '../database/schema';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/staging-presigned-url'),
}));

describe('UploadService', () => {
  let service: UploadService;
  let mockConfig: jest.Mocked<Partial<ConfigService>>;
  let mockCache: jest.Mocked<Partial<Cache>>;
  let mockDb: any;
  let ticketStore: Map<string, StagedUpload>;
  let mockRateLimitMinuteOverride: number | null = null;
  let mockRateLimitDayOverride: number | null = null;
  let mockBlockedHashes: string[] = [];
  let mockBlockedHashesQueryError: Error | null = null;
  let validImage: Buffer;
  let oversizedImage: Buffer;

  beforeAll(async () => {
    validImage = await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 120, g: 120, b: 120 } },
    })
      .webp()
      .toBuffer();

    oversizedImage = await sharp({
      create: { width: 640, height: 480, channels: 3, background: { r: 120, g: 120, b: 120 } },
    })
      .webp()
      .toBuffer();
  });

  const createMockTicket = (overrides: Partial<StagedUpload> = {}): StagedUpload => ({
    id: 'media-1',
    userId: 'user-1',
    purpose: 'POST_MEDIA',
    stagingKey: 'staging/user-1/media-1.jpg',
    declaredContentType: 'image/jpeg',
    declaredFileSizeBytes: 1024,
    status: 'ISSUED',
    expiresAt: new Date(Date.now() + 900_000),
    postId: null,
    finalStorageKey: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    ticketStore = new Map<string, StagedUpload>();
    ticketStore.set('media-1', createMockTicket());
    mockRateLimitMinuteOverride = null;
    mockRateLimitDayOverride = null;
    mockBlockedHashes = [];
    mockBlockedHashesQueryError = null;

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
          case 'COMMENT_IMAGES_ENABLED':
            return 'true';
          default:
            return undefined;
        }
      }),
    };

    mockCache = {
      get: jest.fn((key: string) => Promise.resolve(key.startsWith('media_owner:') ? 'user-1' : 'image/jpeg')),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    const findTicketKeysFromCondition = (cond: any): string[] => {
      const keys: string[] = [];
      if (!cond) return keys;
      if (typeof cond === 'string' && ticketStore.has(cond)) return [cond];
      if (cond && typeof cond.value === 'string' && ticketStore.has(cond.value as string)) {
        return [cond.value as string];
      }
      if (Array.isArray(cond.values)) {
        for (const v of cond.values) {
          if (typeof v === 'string' && ticketStore.has(v)) {
            keys.push(v);
          }
        }
      }
      if (Array.isArray(cond)) {
        for (const item of cond) {
          keys.push(...findTicketKeysFromCondition(item));
        }
      }
      if (Array.isArray(cond.queryChunks)) {
        for (const chunk of cond.queryChunks) {
          keys.push(...findTicketKeysFromCondition(chunk));
        }
      }
      return Array.from(new Set(keys));
    };

    const findTicketKeyFromCondition = (cond: any): string | undefined => {
      const keys = findTicketKeysFromCondition(cond);
      return keys.length > 0 ? keys[0] : undefined;
    };

    let countQueryCallCount = 0;

    mockDb = {
      insert: jest.fn().mockImplementation(() => ({
        values: jest.fn().mockImplementation((val) => {
          const row: StagedUpload = {
            id: val.id,
            userId: val.userId,
            purpose: val.purpose,
            stagingKey: val.stagingKey,
            declaredContentType: val.declaredContentType,
            declaredFileSizeBytes: val.declaredFileSizeBytes,
            status: val.status,
            expiresAt: val.expiresAt,
            postId: val.postId ?? null,
            finalStorageKey: val.finalStorageKey ?? null,
            errorMessage: val.errorMessage ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          ticketStore.set(val.id, row);
          return Promise.resolve([row]);
        }),
      })),
      select: jest.fn().mockImplementation((fields?: any) => ({
        from: jest.fn().mockImplementation(() => {
          const defaultRows = mockBlockedHashes.map((h) => ({ sha256: h }));
          return {
            where: jest.fn().mockImplementation((cond: any) => {
              if (fields && typeof fields === 'object' && 'count' in fields) {
                const queryIdx = countQueryCallCount++;
                let count = 0;
                if (queryIdx === 0) {
                  count = mockRateLimitMinuteOverride ?? 0;
                } else {
                  count = mockRateLimitDayOverride ?? 0;
                }
                const countResult = [{ count }];
                return {
                  limit: jest.fn().mockImplementation((n: number) => Promise.resolve(countResult.slice(0, n))),
                  then: (resolve: any, reject: any) => Promise.resolve(countResult).then(resolve, reject),
                };
              }
              if (fields && typeof fields === 'object' && 'sha256' in fields) {
                const queryErr = mockBlockedHashesQueryError;
                if (queryErr) {
                  return {
                    limit: jest.fn().mockRejectedValue(queryErr),
                    then: (resolve: any, reject: any) => Promise.reject(queryErr).then(resolve, reject),
                  };
                }
                return {
                  limit: jest.fn().mockImplementation((n: number) => Promise.resolve(defaultRows.slice(0, n))),
                  then: (resolve: any, reject: any) => Promise.resolve(defaultRows).then(resolve, reject),
                };
              }
              const ticketKey = findTicketKeyFromCondition(cond) ?? 'media-1';
              const ticket = ticketStore.get(ticketKey);
              const res = ticket ? [ticket] : [];
              return {
                limit: jest.fn().mockImplementation((n: number) => Promise.resolve(res.slice(0, n))),
                then: (resolve: any, reject: any) => Promise.resolve(res).then(resolve, reject),
              };
            }),
            limit: jest.fn().mockImplementation((n: number) => Promise.resolve(defaultRows.slice(0, n))),
            then: (resolve: any, reject: any) => Promise.resolve(defaultRows).then(resolve, reject),
          };
        }),
      })),
      update: jest.fn().mockImplementation(() => ({
        set: jest.fn().mockImplementation((setValues) => ({
          where: jest.fn().mockImplementation((cond: any) => {
            const executeUpdate = () => {
              const keys = findTicketKeysFromCondition(cond);
              const targetKeys = keys.length > 0 ? keys : [findTicketKeyFromCondition(cond) ?? 'media-1'];
              const updatedRows: StagedUpload[] = [];
              for (const ticketKey of targetKeys) {
                const ticket = ticketStore.get(ticketKey);
                if (ticket) {
                  Object.assign(ticket, setValues, { updatedAt: new Date() });
                  updatedRows.push(ticket);
                }
              }
              return updatedRows;
            };
            return {
              returning: jest.fn().mockImplementation(() => Promise.resolve(executeUpdate())),
              then: (resolve: any, reject: any) => Promise.resolve(executeUpdate()).then(resolve, reject),
            };
          }),
        })),
      })),
    };

    service = new UploadService(mockConfig as ConfigService, mockCache as Cache, mockDb);
  });

  describe('generatePresignedUrl', () => {
    it('commits upload ticket durably to PostgreSQL before returning presigned URL', async () => {
      const result = await service.generatePresignedUrl('user-1', 'image/jpeg', 1024);
      expect(result.mediaId).toBeDefined();
      expect(result.uploadUrl).toBe('https://r2.example.com/staging-presigned-url');
      expect(result.stagingKey).toContain('staging/user-1/');
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockCache.set).toHaveBeenCalled();

      // Verify ticket was committed to store
      const stored = ticketStore.get(result.mediaId);
      expect(stored).toBeDefined();
      expect(stored!.userId).toBe('user-1');
      expect(stored!.purpose).toBe('POST_MEDIA');
      expect(stored!.status).toBe('ISSUED');
      expect(stored!.declaredContentType).toBe('image/jpeg');
      expect(stored!.declaredFileSizeBytes).toBe(1024);
      expect(stored!.stagingKey).toBe(result.stagingKey);
      expect(stored!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 800_000);
    });
  });

  describe('getExpectedMediaUrls', () => {
    it('returns predicted publicUrl and storageKey and claims ticket atomically', async () => {
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = jest.fn().mockResolvedValue({});
      const result = await service.getExpectedMediaUrls('media-1', 'user-1', 'post-1');
      expect(result.publicUrl).toBe('https://cdn.pupzy.com/posts/post-1/media-1.jpg');
      expect(result.cloudflareStorageKey).toBe('posts/post-1/media-1.jpg');
      expect(result.fileContentType).toBe('image/jpeg');

      // Verify ticket is now CLAIMED by post-1
      const ticket = ticketStore.get('media-1');
      expect(ticket!.status).toBe('CLAIMED');
      expect(ticket!.postId).toBe('post-1');
    });

    it('consumes valid staged upload after cache loss (survives restart or cache flush)', async () => {
      // Simulate complete process-local cache loss
      mockCache.get = jest.fn().mockResolvedValue(undefined);
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = jest.fn().mockResolvedValue({});

      const result = await service.getExpectedMediaUrls('media-1', 'user-1', 'post-1');
      expect(result.publicUrl).toBe('https://cdn.pupzy.com/posts/post-1/media-1.jpg');
      expect(result.fileContentType).toBe('image/jpeg');
    });

    it('rejects staged media that belongs to another user without leaking existence', async () => {
      await expect(service.getExpectedMediaUrls('media-1', 'another-user', 'post-1')).rejects.toThrow(NotFoundError);
    });

    it('rejects expired staged media without leaking existence', async () => {
      ticketStore.set('media-1', createMockTicket({ expiresAt: new Date(Date.now() - 1000) }));
      await expect(service.getExpectedMediaUrls('media-1', 'user-1', 'post-1')).rejects.toThrow(NotFoundError);
    });

    it('rejects staged media with wrong purpose without leaking existence', async () => {
      ticketStore.set('media-1', createMockTicket({ purpose: 'COMMENT_IMAGE' }));
      await expect(service.getExpectedMediaUrls('media-1', 'user-1', 'post-1')).rejects.toThrow(NotFoundError);
    });

    it('rejects staged media already claimed by another post', async () => {
      ticketStore.set('media-1', createMockTicket({ status: 'CLAIMED', postId: 'other-post' }));
      await expect(service.getExpectedMediaUrls('media-1', 'user-1', 'post-1')).rejects.toThrow(NotFoundError);
    });

    it('marks ticket as FAILED in DB if staged object is missing in R2', async () => {
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = jest
        .fn()
        .mockRejectedValue(new Error('NoSuchKey'));

      await expect(service.getExpectedMediaUrls('media-1', 'user-1', 'post-1')).rejects.toThrow(NotFoundError);
      expect(ticketStore.get('media-1')!.status).toBe('FAILED');
    });
  });

  describe('finalizeMedia', () => {
    it('copies staged file to permanent location, deletes staging, and marks durable state as FINALIZED', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      const result = await service.finalizeMedia('media-1', 'user-1', 'post-1');
      expect(result.publicUrl).toBe('https://cdn.pupzy.com/posts/post-1/media-1.jpg');
      expect(mockSend).toHaveBeenCalledTimes(3); // HeadObject, CopyObject, DeleteObject
      expect(mockCache.del).toHaveBeenCalledWith('media_ct:media-1');

      // Verify ticket status is durably updated to FINALIZED
      const ticket = ticketStore.get('media-1');
      expect(ticket!.status).toBe('FINALIZED');
      expect(ticket!.finalStorageKey).toBe('posts/post-1/media-1.jpg');
    });

    it('finalizes valid staged upload after cache loss without requiring cache flush', async () => {
      // Simulate cache loss
      mockCache.get = jest.fn().mockResolvedValue(undefined);
      const mockSend = jest.fn().mockResolvedValue({});
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      const result = await service.finalizeMedia('media-1', 'user-1', 'post-1');
      expect(result.publicUrl).toBe('https://cdn.pupzy.com/posts/post-1/media-1.jpg');
      expect(ticketStore.get('media-1')!.status).toBe('FINALIZED');
    });

    it('throws NotFoundError and marks ticket FAILED if staged file does not exist in R2', async () => {
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = jest
        .fn()
        .mockRejectedValue(new Error('NoSuchKey'));

      await expect(service.finalizeMedia('media-1', 'user-1', 'post-1')).rejects.toThrow(NotFoundError);
      expect(ticketStore.get('media-1')!.status).toBe('FAILED');
    });

    it('is idempotent when called again for an already finalized ticket for the same post', async () => {
      ticketStore.set(
        'media-1',
        createMockTicket({
          status: 'FINALIZED',
          postId: 'post-1',
          finalStorageKey: 'posts/post-1/media-1.jpg',
        }),
      );

      const result = await service.finalizeMedia('media-1', 'user-1', 'post-1');
      expect(result.publicUrl).toBe('https://cdn.pupzy.com/posts/post-1/media-1.jpg');
      expect(result.cloudflareStorageKey).toBe('posts/post-1/media-1.jpg');
    });
  });

  describe('claimMedia atomicity', () => {
    it('prevents concurrent double-claim of the same ticket', async () => {
      // First claim succeeds
      const first = await service.claimMedia('media-1', 'user-1', 'post-1');
      expect(first.status).toBe('CLAIMED');

      // Second concurrent claim fails because status is now CLAIMED
      mockDb.update = jest.fn().mockImplementation(() => ({
        set: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation(() => ({
            returning: jest.fn().mockResolvedValue([]), // 0 rows updated
          })),
        })),
      }));

      await expect(service.claimMedia('media-1', 'user-1', 'post-2')).rejects.toThrow(NotFoundError);
    });
  });

  describe('markMediaFailed', () => {
    it('updates ticket status to FAILED with error message', async () => {
      await service.markMediaFailed(['media-1'], 'DB transaction aborted');
      expect(ticketStore.get('media-1')!.status).toBe('FAILED');
      expect(ticketStore.get('media-1')!.errorMessage).toBe('DB transaction aborted');
    });
  });

  describe('requestCommentImageUploadUrl', () => {
    it('blocks ticket issuance when COMMENT_IMAGES_ENABLED is false (kill switch)', async () => {
      (mockConfig.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'COMMENT_IMAGES_ENABLED') return false;
        return undefined;
      });

      await expect(
        service.requestCommentImageUploadUrl('user-1', {
          contentType: 'image/webp',
          fileSizeBytes: 50_000,
        }),
      ).rejects.toMatchObject({
        code: 'COMMENT_IMAGES_DISABLED',
      });
    });

    it('blocks ticket issuance when COMMENT_IMAGES_ENABLED is string "false" (kill switch)', async () => {
      (mockConfig.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'COMMENT_IMAGES_ENABLED') return 'false';
        return undefined;
      });

      await expect(
        service.requestCommentImageUploadUrl('user-1', {
          contentType: 'image/webp',
          fileSizeBytes: 50_000,
        }),
      ).rejects.toMatchObject({
        code: 'COMMENT_IMAGES_DISABLED',
      });
    });

    it('rejects contentType other than image/webp', async () => {
      await expect(
        service.requestCommentImageUploadUrl('user-1', {
          contentType: 'image/jpeg',
          fileSizeBytes: 50_000,
        }),
      ).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
      });
    });

    it('rejects fileSizeBytes exceeding 100,000 bytes', async () => {
      await expect(
        service.requestCommentImageUploadUrl('user-1', {
          contentType: 'image/webp',
          fileSizeBytes: 100_001,
        }),
      ).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_TOO_LARGE',
      });
    });

    it('enforces 6/minute rate limit', async () => {
      mockRateLimitMinuteOverride = 6;

      await expect(
        service.requestCommentImageUploadUrl('user-1', {
          contentType: 'image/webp',
          fileSizeBytes: 50_000,
        }),
      ).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        message: expect.stringContaining('max 6 per minute'),
      });
    });

    it('enforces 50/day rate limit', async () => {
      mockRateLimitDayOverride = 50;

      await expect(
        service.requestCommentImageUploadUrl('user-1', {
          contentType: 'image/webp',
          fileSizeBytes: 50_000,
        }),
      ).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        message: expect.stringContaining('max 50 per day'),
      });
    });

    it('successfully issues ticket and presigned URL with authoritative constraints', async () => {
      const result = await service.requestCommentImageUploadUrl('user-1', {
        contentType: 'image/webp',
        fileSizeBytes: 45_000,
      });

      expect(result.mediaId).toBeDefined();
      expect(result.uploadUrl).toBe('https://r2.example.com/staging-presigned-url');
      expect(result.maxSizeBytes).toBe(100_000);
      expect(result.maxWidth).toBe(480);
      expect(result.maxHeight).toBe(480);
      expect(result.allowedContentType).toBe('image/webp');
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

      const ticket = ticketStore.get(result.mediaId);
      expect(ticket).toBeDefined();
      expect(ticket!.userId).toBe('user-1');
      expect(ticket!.purpose).toBe('COMMENT_IMAGE');
      expect(ticket!.status).toBe('ISSUED');
      expect(ticket!.declaredContentType).toBe('image/webp');
      expect(ticket!.declaredFileSizeBytes).toBe(45_000);
      expect(ticket!.stagingKey).toBe(`staging/user-1/${result.mediaId}.webp`);
    });
  });

  describe('finalizeCommentImage', () => {
    const commentId = 'comment-123';

    const setupCommentTicket = (overrides: Partial<StagedUpload> = {}): string => {
      const id = 'comment-media-1';
      ticketStore.set(
        id,
        createMockTicket({
          id,
          userId: 'user-1',
          purpose: 'COMMENT_IMAGE',
          stagingKey: `staging/user-1/${id}.webp`,
          declaredContentType: 'image/webp',
          declaredFileSizeBytes: overrides.declaredFileSizeBytes ?? (validImage ? validImage.length : 20_000),
          status: 'ISSUED',
          expiresAt: new Date(Date.now() + 900_000),
          ...overrides,
        }),
      );
      return id;
    };

    it('rejects non-existent ticket with COMMENT_MEDIA_NOT_AVAILABLE', async () => {
      await expect(service.finalizeCommentImage('non-existent', 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_NOT_AVAILABLE',
      });
    });

    it('rejects ticket owned by another user with COMMENT_MEDIA_NOT_AVAILABLE', async () => {
      const mediaId = setupCommentTicket({ userId: 'other-user' });
      await expect(service.finalizeCommentImage(mediaId, 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_NOT_AVAILABLE',
      });
    });

    it('rejects ticket with POST_MEDIA purpose with COMMENT_MEDIA_NOT_AVAILABLE', async () => {
      const mediaId = setupCommentTicket({ purpose: 'POST_MEDIA' });
      await expect(service.finalizeCommentImage(mediaId, 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_NOT_AVAILABLE',
      });
    });

    it('rejects ticket that is already FINALIZED with COMMENT_MEDIA_ALREADY_USED', async () => {
      const mediaId = setupCommentTicket({ status: 'FINALIZED' });
      await expect(service.finalizeCommentImage(mediaId, 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_ALREADY_USED',
      });
    });

    it('rejects ticket that is already CLAIMED with COMMENT_MEDIA_ALREADY_USED', async () => {
      const mediaId = setupCommentTicket({ status: 'CLAIMED' });
      await expect(service.finalizeCommentImage(mediaId, 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_ALREADY_USED',
      });
    });

    it('rejects expired ticket with COMMENT_MEDIA_NOT_AVAILABLE', async () => {
      const mediaId = setupCommentTicket({ expiresAt: new Date(Date.now() - 1000) });
      await expect(service.finalizeCommentImage(mediaId, 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_NOT_AVAILABLE',
      });
    });

    it('rejects FAILED ticket with COMMENT_MEDIA_NOT_AVAILABLE', async () => {
      const mediaId = setupCommentTicket({ status: 'FAILED' });
      await expect(service.finalizeCommentImage(mediaId, 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_NOT_AVAILABLE',
      });
    });

    it('marks ticket FAILED and throws COMMENT_MEDIA_NOT_AVAILABLE when staged object missing in R2', async () => {
      const mediaId = setupCommentTicket();
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));

      await expect(service.finalizeCommentImage(mediaId, 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_NOT_AVAILABLE',
      });
      expect(ticketStore.get(mediaId)!.status).toBe('FAILED');
    });

    it('resets ticket to ISSUED and throws COMMENT_MEDIA_PROCESSING_FAILED with retryable=true on transient R2 fetch error', async () => {
      const mediaId = setupCommentTicket();
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = jest
        .fn()
        .mockRejectedValue(new Error('Connection timed out'));

      await expect(service.finalizeCommentImage(mediaId, 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_PROCESSING_FAILED',
      });
      expect(ticketStore.get(mediaId)!.status).toBe('ISSUED');
    });

    it('deletes staged object, marks ticket FAILED, and throws COMMENT_MEDIA_TOO_LARGE if actual bytes exceed 100,000', async () => {
      const mediaId = setupCommentTicket();
      const mockSend = jest.fn().mockImplementation((command: any) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToByteArray: () => Promise.resolve(new Uint8Array(Buffer.alloc(100_001))),
            },
          });
        }
        return Promise.resolve({});
      });
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await expect(service.finalizeCommentImage(mediaId, 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_TOO_LARGE',
      });
      expect(ticketStore.get(mediaId)!.status).toBe('FAILED');
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Key: `staging/user-1/${mediaId}.webp`,
          }),
        }),
      );
    });

    it('deletes staged object, marks ticket FAILED, and throws format error on invalid WebP', async () => {
      const mediaId = setupCommentTicket();
      const mockSend = jest.fn().mockImplementation((command: any) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToByteArray: () => Promise.resolve(new Uint8Array(Buffer.from('not-a-real-webp'))),
            },
          });
        }
        return Promise.resolve({});
      });
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await expect(service.finalizeCommentImage(mediaId, 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
      });
      expect(ticketStore.get(mediaId)!.status).toBe('FAILED');
    });

    it('deletes staged object, marks ticket FAILED, and throws dimension error when exceeding 480x480', async () => {
      const mediaId = setupCommentTicket();
      const mockSend = jest.fn().mockImplementation((command: any) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            ETag: '"etag-over"',
            ContentLength: oversizedImage.length,
            Body: {
              transformToByteArray: () => Promise.resolve(new Uint8Array(oversizedImage)),
            },
          });
        }
        return Promise.resolve({});
      });
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await expect(service.finalizeCommentImage(mediaId, 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_DIMENSIONS_EXCEEDED',
      });
      expect(ticketStore.get(mediaId)!.status).toBe('FAILED');
    });

    it('deletes staged object, marks ticket FAILED, and throws COMMENT_MEDIA_INVALID_FORMAT when media matches a blocked hash (Ticket 09)', async () => {
      const mediaId = setupCommentTicket();
      const hash = crypto.createHash('sha256').update(validImage).digest('hex');
      mockBlockedHashes = [hash];

      const mockSend = jest.fn().mockImplementation((command: any) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            ETag: '"etag-valid"',
            ContentLength: validImage.length,
            Body: {
              transformToByteArray: () => Promise.resolve(new Uint8Array(validImage)),
            },
          });
        }
        return Promise.resolve({});
      });
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await expect(service.finalizeCommentImage(mediaId, 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
      });
      expect(ticketStore.get(mediaId)!.status).toBe('FAILED');
    });

    it('resets ticket to ISSUED and throws COMMENT_MEDIA_PROCESSING_FAILED with retryable=true when blocked hash DB query fails', async () => {
      const mediaId = setupCommentTicket();
      const mockSend = jest.fn().mockImplementation((command: any) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            ETag: '"etag-valid"',
            ContentLength: validImage.length,
            Body: {
              transformToByteArray: () => Promise.resolve(new Uint8Array(validImage)),
            },
          });
        }
        return Promise.resolve({});
      });
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      mockBlockedHashesQueryError = new Error('Blocked hash DB timeout');

      await expect(service.finalizeCommentImage(mediaId, 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_PROCESSING_FAILED',
        extensions: expect.objectContaining({ retryable: true }),
      });
      expect(ticketStore.get(mediaId)!.status).toBe('ISSUED');
    });

    it('resets ticket to ISSUED and throws COMMENT_MEDIA_PROCESSING_FAILED when staging object was modified between download and publication (ETag mismatch)', async () => {
      const mediaId = setupCommentTicket();
      const mockSend = jest.fn().mockImplementation((command: any) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            ETag: '"original-etag"',
            ContentLength: validImage.length,
            Body: {
              transformToByteArray: () => Promise.resolve(new Uint8Array(validImage)),
            },
          });
        }
        if (command.constructor.name === 'HeadObjectCommand') {
          return Promise.resolve({ ETag: '"tampered-etag"' });
        }
        return Promise.resolve({});
      });
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await expect(service.finalizeCommentImage(mediaId, 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_PROCESSING_FAILED',
        message: expect.stringContaining('modified during processing'),
      });
      expect(ticketStore.get(mediaId)!.status).toBe('ISSUED');
    });

    it('resets ticket to ISSUED and throws COMMENT_MEDIA_PROCESSING_FAILED when PutObject fails', async () => {
      const mediaId = setupCommentTicket();
      const mockSend = jest.fn().mockImplementation((command: any) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            ETag: '"etag-valid"',
            ContentLength: validImage.length,
            Body: {
              transformToByteArray: () => Promise.resolve(new Uint8Array(validImage)),
            },
          });
        }
        if (command.constructor.name === 'HeadObjectCommand') {
          return Promise.resolve({ ETag: '"etag-valid"' });
        }
        if (command.constructor.name === 'PutObjectCommand') {
          return Promise.reject(new Error('PutObject failed'));
        }
        return Promise.resolve({});
      });
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await expect(service.finalizeCommentImage(mediaId, 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_PROCESSING_FAILED',
      });
      expect(ticketStore.get(mediaId)!.status).toBe('ISSUED');
    });

    it('successfully finalizes valid WebP comment image: publishes verified bytes to comments namespace, deletes staging, and returns metadata', async () => {
      const mediaId = setupCommentTicket();
      const mockSend = jest.fn().mockImplementation((command: any) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            ETag: '"etag-valid"',
            ContentLength: validImage.length,
            Body: {
              transformToByteArray: () => Promise.resolve(new Uint8Array(validImage)),
            },
          });
        }
        if (command.constructor.name === 'HeadObjectCommand') {
          return Promise.resolve({ ETag: '"etag-valid"' });
        }
        return Promise.resolve({});
      });
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      const result = await service.finalizeCommentImage(mediaId, 'user-1', commentId);

      expect(result).toEqual({
        id: mediaId,
        commentId,
        stagingKey: `staging/user-1/${mediaId}.webp`,
        storageKey: `comments/${commentId}/${mediaId}.webp`,
        sha256: expect.any(String),
        width: 320,
        height: 240,
        fileSizeBytes: validImage.length,
        fileContentType: 'image/webp',
        displayOrder: 0,
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Key: `staging/user-1/${mediaId}.webp`,
          }),
        }),
      );
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: 'pupzy-bucket',
            Key: `comments/${commentId}/${mediaId}.webp`,
            ContentType: 'image/webp',
            Body: validImage,
          }),
        }),
      );
    });
  });

  describe('deleteObject', () => {
    it('sends DeleteObjectCommand to S3 client', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await service.deleteObject('comments/c1/m1.webp');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: 'pupzy-bucket',
            Key: 'comments/c1/m1.webp',
          }),
        }),
      );
    });

    it('propagates provider deletion errors so they can be retried durably', async () => {
      const mockSend = jest.fn().mockRejectedValue(new Error('S3 error'));
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await expect(service.deleteObject('comments/c1/m1.webp')).rejects.toThrow('S3 error');
    });
  });

  describe('finalizeCommentImages (Ticket 07)', () => {
    const commentId = 'comment-multi';

    const setupTicket = (id: string, overrides: Partial<StagedUpload> = {}) => {
      ticketStore.set(
        id,
        createMockTicket({
          id,
          userId: 'user-1',
          purpose: 'COMMENT_IMAGE',
          declaredContentType: 'image/webp',
          stagingKey: `staging/user-1/${id}.webp`,
          declaredFileSizeBytes: overrides.declaredFileSizeBytes ?? (validImage ? validImage.length : 20_000),
          status: 'ISSUED',
          ...overrides,
        }),
      );
      return id;
    };

    it('rejects duplicate media IDs', async () => {
      const id = setupTicket('media-dup');
      await expect(service.finalizeCommentImages([id, id], 'user-1', commentId)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('rejects more than 2 media IDs', async () => {
      const id1 = setupTicket('m1');
      const id2 = setupTicket('m2');
      const id3 = setupTicket('m3');
      await expect(service.finalizeCommentImages([id1, id2, id3], 'user-1', commentId)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });

    it('successfully finalizes two valid images with displayOrder 0 and 1', async () => {
      const id1 = setupTicket('m1');
      const id2 = setupTicket('m2');

      const mockSend = jest.fn().mockImplementation((command: any) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            ETag: '"etag-valid"',
            ContentLength: validImage.length,
            Body: {
              transformToByteArray: () => Promise.resolve(new Uint8Array(validImage)),
            },
          });
        }
        if (command.constructor.name === 'HeadObjectCommand') {
          return Promise.resolve({ ETag: '"etag-valid"' });
        }
        return Promise.resolve({});
      });
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      const results = await service.finalizeCommentImages([id1, id2], 'user-1', commentId);
      expect(results).toHaveLength(2);
      expect(results[0].displayOrder).toBe(0);
      expect(results[1].displayOrder).toBe(1);
      expect(results[0].storageKey).toBe(`comments/${commentId}/${id1}.webp`);
      expect(results[1].storageKey).toBe(`comments/${commentId}/${id2}.webp`);
      expect(ticketStore.get(id1)!.status).toBe('FINALIZED');
      expect(ticketStore.get(id2)!.status).toBe('FINALIZED');
    });

    it('selective failure: if image 1 is valid and image 2 is oversized, image 2 is deleted and marked FAILED, image 1 remains ISSUED', async () => {
      const id1 = setupTicket('m1');
      const id2 = setupTicket('m2');

      const mockSend = jest.fn().mockImplementation((command: any) => {
        if (command.constructor.name === 'GetObjectCommand') {
          const key = String(command.input.Key);
          if (key.includes(id1)) {
            return Promise.resolve({
              ETag: '"etag-1"',
              ContentLength: validImage.length,
              Body: {
                transformToByteArray: () => Promise.resolve(new Uint8Array(validImage)),
              },
            });
          }
          // id2 is oversized (100,001 bytes)
          return Promise.resolve({
            ETag: '"etag-2"',
            ContentLength: 100_001,
            Body: {
              transformToByteArray: () => Promise.resolve(new Uint8Array(Buffer.alloc(100_001))),
            },
          });
        }
        return Promise.resolve({});
      });
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await expect(service.finalizeCommentImages([id1, id2], 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_TOO_LARGE',
      });

      // id1 remains ISSUED and was not deleted
      expect(ticketStore.get(id1)!.status).toBe('ISSUED');
      // id2 was marked FAILED and its staging key deleted
      expect(ticketStore.get(id2)!.status).toBe('FAILED');
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Key: `staging/user-1/${id2}.webp`,
          }),
        }),
      );
    });

    it('cleans up published final objects and resets tickets to ISSUED on transient put error', async () => {
      const id1 = setupTicket('m1');
      const id2 = setupTicket('m2');

      let putCount = 0;
      const mockSend = jest.fn().mockImplementation((command: any) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            ETag: '"etag-valid"',
            ContentLength: validImage.length,
            Body: {
              transformToByteArray: () => Promise.resolve(new Uint8Array(validImage)),
            },
          });
        }
        if (command.constructor.name === 'HeadObjectCommand') {
          return Promise.resolve({ ETag: '"etag-valid"' });
        }
        if (command.constructor.name === 'PutObjectCommand') {
          putCount++;
          if (putCount === 2) {
            return Promise.reject(new Error('Transient R2 error on second put'));
          }
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await expect(service.finalizeCommentImages([id1, id2], 'user-1', commentId)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_PROCESSING_FAILED',
      });

      // Both tickets reset to ISSUED
      expect(ticketStore.get(id1)!.status).toBe('ISSUED');
      expect(ticketStore.get(id2)!.status).toBe('ISSUED');
      // First published object was cleaned up
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Key: `comments/${commentId}/${id1}.webp`,
          }),
        }),
      );
    });
  });

  describe('getPublicCdnUrl & purgeCdn & getPurgeCdnUrls', () => {
    it('constructs public CDN URL with configured CDN base', () => {
      expect(service.getPublicCdnUrl('comments/c1/m1.webp')).toBe('https://cdn.pupzy.com/comments/c1/m1.webp');
    });

    it('throws error when Cloudflare credentials are missing', async () => {
      await expect(service.purgeCdn('https://cdn.pupzy.com/comments/c1/m1.webp')).rejects.toThrow(
        'Cloudflare credentials missing',
      );
    });

    it('successfully purges CDN when Cloudflare credentials are configured and response is ok', async () => {
      mockConfig.get = jest.fn((key: string) => {
        if (key === 'CLOUDFLARE_ZONE_ID') return 'zone-123';
        if (key === 'CLOUDFLARE_API_TOKEN') return 'token-abc';
        if (key === 'COMMENT_MEDIA_CDN_BASE') return 'https://cdn.pupzy.com';
        return undefined;
      });

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('ok'),
      });
      const originalFetch = global.fetch;
      global.fetch = mockFetch;

      try {
        await expect(service.purgeCdn('https://cdn.pupzy.com/comments/c1/m1.webp')).resolves.not.toThrow();
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.cloudflare.com/client/v4/zones/zone-123/purge_cache',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ files: ['https://cdn.pupzy.com/comments/c1/m1.webp'] }),
          }),
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('throws error when Cloudflare API responds with error', async () => {
      mockConfig.get = jest.fn((key: string) => {
        if (key === 'CLOUDFLARE_ZONE_ID') return 'zone-123';
        if (key === 'CLOUDFLARE_API_TOKEN') return 'token-abc';
        return undefined;
      });

      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Unauthorized'),
      });
      const originalFetch = global.fetch;
      global.fetch = mockFetch;

      try {
        await expect(service.purgeCdn('https://cdn.pupzy.com/comments/c1/m1.webp')).rejects.toThrow(
          'Cloudflare purge cache failed with status 403',
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('generates purge CDN URLs with fallback domain during transition', () => {
      mockConfig.get = jest.fn((key: string) => {
        if (key === 'COMMENT_MEDIA_CDN_BASE') return 'https://cdn.pupzy.net';
        if (key === 'COMMENT_MEDIA_DOMAIN_TRANSITION') return 'true';
        if (key === 'COMMENT_MEDIA_PREVIOUS_CDN_BASE') return 'https://legacy-cdn.pupzy.net';
        return undefined;
      });

      const urls = service.getPurgeCdnUrls('comments/c1/m1.webp');
      expect(urls).toContain('https://cdn.pupzy.net/comments/c1/m1.webp');
      expect(urls).toContain('https://legacy-cdn.pupzy.net/comments/c1/m1.webp');
    });
  });
});

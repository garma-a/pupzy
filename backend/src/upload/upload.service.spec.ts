import { UploadService } from './upload.service';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { NotFoundError } from '../common/errors/app.errors';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/staging-presigned-url'),
}));

describe('UploadService', () => {
  let service: UploadService;
  let mockConfig: jest.Mocked<Partial<ConfigService>>;
  let mockCache: jest.Mocked<Partial<Cache>>;

  beforeEach(() => {
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

    service = new UploadService(mockConfig as ConfigService, mockCache as Cache);
  });

  describe('generatePresignedUrl', () => {
    it('generates presigned url and caches content type', async () => {
      const result = await service.generatePresignedUrl('user-1', 'image/jpeg', 1024);
      expect(result.mediaId).toBeDefined();
      expect(result.uploadUrl).toBe('https://r2.example.com/staging-presigned-url');
      expect(result.stagingKey).toContain('staging/user-1/');
      expect(mockCache.set).toHaveBeenCalled();
    });
    it('binds persisted upload grace deadline and getSignedUrl signature to the exact same timestamp', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
      let capturedGraceUntil: Date | undefined;
      const mockDb = {
        transaction: jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            select: jest.fn().mockReturnValue({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  for: jest.fn().mockResolvedValue([{ id: 'user-1', isBanned: false }]),
                }),
              }),
            }),
            update: jest.fn().mockReturnValue({
              set: jest.fn().mockImplementation((val: { uploadGraceUntil: Date }) => {
                capturedGraceUntil = val.uploadGraceUntil;
                return {
                  where: jest.fn().mockResolvedValue([{ id: 'user-1' }]),
                };
              }),
            }),
          };
          return cb(mockTx);
        }),
      };

      const serviceWithDb = new UploadService(
        mockConfig as ConfigService,
        mockCache as Cache,
        mockDb as unknown as NodePgDatabase,
      );

      const result = await serviceWithDb.generatePresignedUrl('user-1', 'image/jpeg', 1024);

      expect(capturedGraceUntil).toBeDefined();
      expect(result.expiresAt).toEqual(capturedGraceUntil);

      const calls = (getSignedUrl as jest.Mock).mock.calls as Array<
        [unknown, unknown, { expiresIn: number; signingDate: Date }]
      >;
      const getSignedUrlCall = calls[calls.length - 1];
      const signingOptions = getSignedUrlCall[2];
      expect(signingOptions.expiresIn).toBe(600);
      expect(signingOptions.signingDate).toBeDefined();
      expect(signingOptions.signingDate.getTime() + 600_000).toBe(capturedGraceUntil!.getTime());

      expect(mockCache.set).toHaveBeenCalledWith(`media_ct:${result.mediaId}`, 'image/jpeg', 600_000);
      expect(mockCache.set).toHaveBeenCalledWith(`media_owner:${result.mediaId}`, 'user-1', 600_000);
    });
  });

  describe('getExpectedMediaUrls', () => {
    it('returns predicted publicUrl and storageKey', async () => {
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = jest.fn().mockResolvedValue({});
      const result = await service.getExpectedMediaUrls('media-1', 'user-1', 'post-1');
      expect(result.publicUrl).toBe('https://cdn.pupzy.com/posts/post-1/media-1.jpg');
      expect(result.cloudflareStorageKey).toBe('posts/post-1/media-1.jpg');
      expect(result.fileContentType).toBe('image/jpeg');
    });

    it('rejects staged media that belongs to another user', async () => {
      await expect(service.getExpectedMediaUrls('media-1', 'another-user', 'post-1')).rejects.toThrow(NotFoundError);
    });
  });

  describe('finalizeMedia', () => {
    it('copies staged file to permanent location, deletes staging, and cleans cache', async () => {
      // Mock s3Client.send
      const mockSend = jest.fn().mockResolvedValue({});
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      const result = await service.finalizeMedia('media-1', 'user-1', 'post-1');
      expect(result.publicUrl).toBe('https://cdn.pupzy.com/posts/post-1/media-1.jpg');
      expect(mockSend).toHaveBeenCalledTimes(3); // HeadObject, CopyObject, DeleteObject
      expect(mockCache.del).toHaveBeenCalledWith('media_ct:media-1');
    });

    it('throws NotFoundError if staged file does not exist in R2', async () => {
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = jest
        .fn()
        .mockRejectedValue(new Error('NoSuchKey'));

      await expect(service.finalizeMedia('media-1', 'user-1', 'post-1')).rejects.toThrow(NotFoundError);
    });

    it('aborts finalization and cleans up staging when user is deleted or deletion is pending', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      let selectCount = 0;
      const mockDb = {
        transaction: jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            execute: jest.fn().mockResolvedValue({}),
            select: jest.fn().mockImplementation(() => {
              selectCount++;
              if (selectCount === 1) {
                return {
                  from: jest.fn().mockReturnValue({
                    where: jest.fn().mockResolvedValue([{ isBanned: true }]),
                  }),
                };
              }
              return {
                from: jest.fn().mockReturnValue({
                  where: jest.fn().mockReturnValue({
                    orderBy: jest.fn().mockReturnValue({
                      limit: jest.fn().mockResolvedValue([{ id: 'del-1', status: 'PENDING' }]),
                    }),
                  }),
                }),
              };
            }),
          };
          return cb(mockTx);
        }),
      };

      const serviceWithDb = new UploadService(
        mockConfig as ConfigService,
        mockCache as Cache,
        mockDb as unknown as NodePgDatabase,
      );
      (serviceWithDb as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await expect(serviceWithDb.finalizeMedia('media-1', 'user-1', 'post-1')).rejects.toThrow('ACCOUNT_DELETED');
      const sendCalls = mockSend.mock.calls as Array<[{ input?: { Key?: string } }]>;
      const lastCall = sendCalls[sendCalls.length - 1];
      expect(lastCall?.[0]?.input?.Key).toBe('staging/user-1/media-1.jpg');
    });
  });

  describe('deleteObjects', () => {
    it('throws an error if bulk delete returns per-object errors and individual delete fails', async () => {
      const mockSend = jest
        .fn()
        .mockResolvedValueOnce({
          Errors: [{ Key: 'posts/p1/m1.jpg', Message: 'InternalError' }],
        })
        .mockRejectedValueOnce(new Error('Individual delete failed'));
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await expect(service.deleteObjects(['posts/p1/m1.jpg'])).rejects.toThrow(/Failed to delete 1 storage objects/);
    });

    it('throws an error if fallback individual delete fails', async () => {
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = jest
        .fn()
        .mockRejectedValue(new Error('Network error'));

      await expect(service.deleteObjects(['posts/p1/m1.jpg'])).rejects.toThrow(/Failed to delete 1 storage objects/);
    });
  });

  describe('deletePrefix', () => {
    it('propagates errors when listing objects fails', async () => {
      (service as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = jest
        .fn()
        .mockRejectedValue(new Error('R2 list failed'));

      await expect(service.deletePrefix('staging/user-1/')).rejects.toThrow('R2 list failed');
    });
  });

  describe('getLastUploadGraceUntil', () => {
    it('returns timestamp from cache when present', async () => {
      const now = Date.now() + 100_000;
      mockCache.get = jest.fn().mockResolvedValue(now);

      const result = await service.getLastUploadGraceUntil('user-1');
      expect(result).toEqual(new Date(now));
    });

    it('falls back to database when cache misses', async () => {
      mockCache.get = jest.fn().mockResolvedValue(null);
      const graceDate = new Date(Date.now() + 200_000);
      const mockDb = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ uploadGraceUntil: graceDate }]),
            }),
          }),
        }),
      };

      const serviceWithDb = new UploadService(
        mockConfig as ConfigService,
        mockCache as Cache,
        mockDb as unknown as NodePgDatabase,
      );

      const result = await serviceWithDb.getLastUploadGraceUntil('user-1');
      expect(result).toEqual(graceDate);
    });
  });
});

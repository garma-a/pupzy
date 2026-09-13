import { UploadService } from './upload.service';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { NotFoundError } from '../common/errors/app.errors';
import type { MediaFinalizationRepository } from './media-finalization.repository';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/staging-presigned-url'),
}));

/**
 * Builds a database mock for `finalizeMedia`: the start transaction allows the
 * creator, and the post-copy account check reports the account as blocked or
 * not based on `blockedAtSettle`.
 */
function createFinalizationDbMock({
  blockedAtSettle,
}: {
  blockedAtSettle: boolean;
}): NodePgDatabase<Record<string, unknown>> {
  let transactionSelectCount = 0;
  let topLevelSelectCount = 0;

  return {
    transaction: jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const mockTx = {
        select: jest.fn().mockImplementation(() => {
          transactionSelectCount++;
          if (transactionSelectCount === 1) {
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  for: jest.fn().mockResolvedValue([{ id: 'user-1', isBanned: false }]),
                }),
              }),
            };
          }
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
              }),
            }),
          };
        }),
      };
      return cb(mockTx);
    }),
    select: jest.fn().mockImplementation(() => {
      topLevelSelectCount++;
      if (topLevelSelectCount % 2 === 1) {
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ isBanned: blockedAtSettle }]),
          }),
        };
      }
      return {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
          }),
        }),
      };
    }),
  } as unknown as NodePgDatabase<Record<string, unknown>>;
}

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
      const mockDb = {
        transaction: jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            select: jest.fn().mockReturnValue({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  for: jest.fn().mockResolvedValue([{ id: 'user-1', isBanned: true, uploadGraceUntil: null }]),
                }),
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
      (serviceWithDb as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await expect(serviceWithDb.finalizeMedia('media-1', 'user-1', 'post-1')).rejects.toThrow('ACCOUNT_DELETED');
      const sendCalls = mockSend.mock.calls as Array<[{ input?: { Key?: string } }]>;
      const lastCall = sendCalls[sendCalls.length - 1];
      expect(lastCall?.[0]?.input?.Key).toBe('staging/user-1/media-1.jpg');
    });

    it('leaves the staged object untouched when the start check fails transiently', async () => {
      const mockSend = jest.fn().mockResolvedValue({});
      const mockDb = {
        transaction: jest.fn().mockRejectedValue(new Error('database unavailable')),
      };

      const serviceWithDb = new UploadService(
        mockConfig as ConfigService,
        mockCache as Cache,
        mockDb as unknown as NodePgDatabase,
      );
      (serviceWithDb as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await expect(serviceWithDb.finalizeMedia('media-1', 'user-1', 'post-1')).rejects.toThrow('database unavailable');
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('compensates by deleting the permanent object when acceptance commits during the copy', async () => {
      const sentKeys: Array<string | undefined> = [];
      const mockSend = jest.fn().mockImplementation((command: { input?: { Key?: string } }) => {
        sentKeys.push(command.input?.Key);
        return Promise.resolve({});
      });
      let transactionSelectCount = 0;
      const mockDb = {
        transaction: jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            select: jest.fn().mockImplementation(() => {
              transactionSelectCount++;
              if (transactionSelectCount === 1) {
                return {
                  from: jest.fn().mockReturnValue({
                    where: jest.fn().mockReturnValue({
                      for: jest.fn().mockResolvedValue([{ id: 'user-1', isBanned: false, uploadGraceUntil: null }]),
                    }),
                  }),
                };
              }
              return {
                from: jest.fn().mockReturnValue({
                  where: jest.fn().mockReturnValue({
                    orderBy: jest.fn().mockReturnValue({
                      limit: jest.fn().mockResolvedValue([]),
                    }),
                  }),
                }),
              };
            }),
            update: jest.fn().mockReturnValue({
              set: jest.fn().mockReturnValue({
                where: jest.fn().mockResolvedValue([]),
              }),
            }),
          };
          return cb(mockTx);
        }),
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ isBanned: true }]),
          }),
        }),
      };

      const serviceWithDb = new UploadService(
        mockConfig as ConfigService,
        mockCache as Cache,
        mockDb as unknown as NodePgDatabase,
      );
      (serviceWithDb as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await expect(serviceWithDb.finalizeMedia('media-1', 'user-1', 'post-1')).rejects.toThrow('ACCOUNT_DELETED');

      // Head (staging), copy (permanent), staging delete, then compensation delete of the permanent object.
      expect(sentKeys).toEqual([
        'staging/user-1/media-1.jpg',
        'posts/post-1/media-1.jpg',
        'staging/user-1/media-1.jpg',
        'posts/post-1/media-1.jpg',
      ]);
    });

    it('durably records an in-flight finalization obligation before copying and clears it on success', async () => {
      const mockRepository = {
        create: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue(undefined),
        markCompensationRequired: jest.fn().mockResolvedValue(undefined),
        recordError: jest.fn().mockResolvedValue(undefined),
        touch: jest.fn().mockResolvedValue(undefined),
      };
      const serviceWithDb = new UploadService(
        mockConfig as ConfigService,
        mockCache as Cache,
        createFinalizationDbMock({ blockedAtSettle: false }),
        mockRepository as unknown as MediaFinalizationRepository,
      );
      const mockSend = jest.fn().mockResolvedValue({});
      (serviceWithDb as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await serviceWithDb.finalizeMedia('media-1', 'user-1', 'post-1');

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          mediaId: 'media-1',
          stagingKey: 'staging/user-1/media-1.jpg',
          finalKey: 'posts/post-1/media-1.jpg',
          status: 'IN_FLIGHT',
        }),
        expect.anything(),
      );
      expect(mockRepository.touch).toHaveBeenCalledTimes(3);
      expect(mockRepository.delete).toHaveBeenCalledTimes(1);
      expect(mockRepository.markCompensationRequired).not.toHaveBeenCalled();
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('keeps the compensation obligation retryable when the permanent object cannot be deleted', async () => {
      const mockRepository = {
        create: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue(undefined),
        markCompensationRequired: jest.fn().mockResolvedValue(undefined),
        recordError: jest.fn().mockResolvedValue(undefined),
        touch: jest.fn().mockResolvedValue(undefined),
      };
      const serviceWithDb = new UploadService(
        mockConfig as ConfigService,
        mockCache as Cache,
        createFinalizationDbMock({ blockedAtSettle: true }),
        mockRepository as unknown as MediaFinalizationRepository,
      );
      const mockSend = jest
        .fn()
        .mockResolvedValueOnce({}) // Head
        .mockResolvedValueOnce({}) // Copy
        .mockResolvedValueOnce({}) // staging delete
        .mockRejectedValueOnce(new Error('R2 delete failed')); // compensation delete
      (serviceWithDb as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await expect(serviceWithDb.finalizeMedia('media-1', 'user-1', 'post-1')).rejects.toThrow('ACCOUNT_DELETED');

      expect(mockRepository.markCompensationRequired).toHaveBeenCalledWith(expect.any(String));
      // The obligation row survives so account deletion or the cron can retry.
      expect(mockRepository.delete).not.toHaveBeenCalled();
      expect(mockRepository.recordError).toHaveBeenCalledWith(expect.any(String), 'R2 delete failed');
    });

    it('aborts a finalization whose obligation was force-resolved instead of recreating media', async () => {
      const mockRepository = {
        create: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue(undefined),
        markCompensationRequired: jest.fn().mockResolvedValue(undefined),
        recordError: jest.fn().mockResolvedValue(undefined),
        touch: jest.fn().mockRejectedValue(new Error('Media finalization obligation mf-1 is no longer active')),
      };
      const serviceWithDb = new UploadService(
        mockConfig as ConfigService,
        mockCache as Cache,
        createFinalizationDbMock({ blockedAtSettle: true }),
        mockRepository as unknown as MediaFinalizationRepository,
      );
      const sentKeys: Array<string | undefined> = [];
      const mockSend = jest.fn().mockImplementation((command: { input?: { Key?: string } }) => {
        sentKeys.push(command.input?.Key);
        return Promise.resolve({});
      });
      (serviceWithDb as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = mockSend;

      await expect(serviceWithDb.finalizeMedia('media-1', 'user-1', 'post-1')).rejects.toThrow('no longer active');

      // The first heartbeat runs before any copy, so only the compensating
      // delete of the (never created) permanent object is dispatched.
      expect(sentKeys).toEqual(['posts/post-1/media-1.jpg']);
      expect(mockRepository.markCompensationRequired).toHaveBeenCalledWith(expect.any(String));
    });

    it('leaves the obligation in flight when the post-copy account check fails, for deletion to resolve', async () => {
      const mockRepository = {
        create: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue(undefined),
        markCompensationRequired: jest.fn().mockResolvedValue(undefined),
        recordError: jest.fn().mockResolvedValue(undefined),
        touch: jest.fn().mockResolvedValue(undefined),
      };
      const mockDb = {
        transaction: jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
          let transactionSelectCount = 0;
          const mockTx = {
            select: jest.fn().mockImplementation(() => {
              transactionSelectCount++;
              if (transactionSelectCount === 1) {
                return {
                  from: jest.fn().mockReturnValue({
                    where: jest.fn().mockReturnValue({
                      for: jest.fn().mockResolvedValue([{ id: 'user-1', isBanned: false }]),
                    }),
                  }),
                };
              }
              return {
                from: jest.fn().mockReturnValue({
                  where: jest.fn().mockReturnValue({
                    orderBy: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
                  }),
                }),
              };
            }),
          };
          return cb(mockTx);
        }),
        select: jest.fn().mockImplementation(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockRejectedValue(new Error('database unavailable')),
          }),
        })),
      };
      const serviceWithDb = new UploadService(
        mockConfig as ConfigService,
        mockCache as Cache,
        mockDb as unknown as NodePgDatabase,
        mockRepository as unknown as MediaFinalizationRepository,
      );
      (serviceWithDb as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = jest.fn().mockResolvedValue({});

      await serviceWithDb.finalizeMedia('media-1', 'user-1', 'post-1');

      // The copy may or may not exist; deletion resolves the row after the lease.
      expect(mockRepository.delete).not.toHaveBeenCalled();
      expect(mockRepository.markCompensationRequired).not.toHaveBeenCalled();
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

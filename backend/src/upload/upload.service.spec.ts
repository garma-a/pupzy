/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
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
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation(() => ({
            limit: jest.fn().mockImplementation(() => {
              const ticket = ticketStore.get('media-1');
              return Promise.resolve(ticket ? [ticket] : []);
            }),
          })),
        })),
      })),
      update: jest.fn().mockImplementation(() => ({
        set: jest.fn().mockImplementation((setValues) => ({
          where: jest.fn().mockImplementation(() => {
            const executeUpdate = () => {
              const ticket = ticketStore.get('media-1');
              if (ticket) {
                Object.assign(ticket, setValues, { updatedAt: new Date() });
                return [ticket];
              }
              return [];
            };
            return {
              returning: jest.fn().mockImplementation(() => Promise.resolve(executeUpdate())),
              then: (resolve: any) => Promise.resolve(executeUpdate()).then(resolve),
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
});

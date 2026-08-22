import { UploadService } from './upload.service';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
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
      get: jest.fn().mockResolvedValue('image/jpeg'),
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
  });

  describe('getExpectedMediaUrls', () => {
    it('returns predicted publicUrl and storageKey', async () => {
      const result = await service.getExpectedMediaUrls('media-1', 'post-1');
      expect(result.publicUrl).toBe('https://cdn.pupzy.com/posts/post-1/media-1.jpg');
      expect(result.cloudflareStorageKey).toBe('posts/post-1/media-1.jpg');
      expect(result.fileContentType).toBe('image/jpeg');
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
  });
});

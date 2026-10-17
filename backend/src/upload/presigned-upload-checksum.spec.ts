import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { UploadService } from './upload.service';

/**
 * Presigned upload URLs must not carry a request checksum. The SDK computes
 * one by default at signing time, when a presigned PUT has no body yet, so the
 * URL would pin the CRC32 of an empty file and R2 rejects every real upload
 * with 400 BadDigest. The other upload specs mock the presigner, so this one
 * signs a real URL with the service's own client.
 */
describe('UploadService presigned upload URLs', () => {
  const config = {
    get: (key: string) =>
      ({
        R2_ACCOUNT_ID: 'test-account',
        R2_ACCESS_KEY_ID: 'test-key',
        R2_SECRET_ACCESS_KEY: 'test-secret',
        R2_BUCKET_NAME: 'pupzy-bucket',
        R2_PUBLIC_URL: 'https://cdn.pupzy.com',
      })[key],
  } as unknown as ConfigService;

  it('carry no checksum, so R2 accepts the uploaded bytes', async () => {
    const service = new UploadService(config, {} as Cache, {} as NodePgDatabase<never>);
    const s3Client = (service as unknown as { s3Client: S3Client }).s3Client;

    const url = new URL(
      await getSignedUrl(
        s3Client,
        new PutObjectCommand({
          Bucket: 'pupzy-bucket',
          Key: 'staging/user/media.jpg',
          ContentType: 'image/jpeg',
          ContentLength: 1234,
        }),
        { expiresIn: 600 },
      ),
    );

    const params = [...url.searchParams.keys()].map((k) => k.toLowerCase());
    expect(params.filter((k) => k.includes('checksum'))).toEqual([]);
    // The declared size stays signed, so the upload still has to match it.
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
  });
});

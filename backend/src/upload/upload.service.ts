import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { NotFoundError } from '../common/errors/app.errors';

/**
 * UploadService — manages media uploads to Cloudflare R2 via presigned URLs.
 *
 * ## Two-Phase Upload Flow (staging → final)
 *
 * Media follows a two-phase lifecycle to prevent orphaned files in the final
 * namespace and to decouple the upload from post creation:
 *
 * 1. **Staging** (`generatePresignedUrl`):
 *    The client requests a presigned PUT URL. The file is uploaded to a
 *    `staging/{userId}/{mediaId}.webp` key. This key is isolated per user
 *    so one user cannot overwrite another's staging files.
 *
 * 2. **Finalization** (`finalizeMedia`):
 *    When the post is created, the server moves the staged file to its
 *    permanent location at `posts/{postId}/{mediaId}.webp` using a
 *    server-side copy + delete. This ensures only files attached to a valid
 *    post appear in the public namespace.
 *
 * If the user never creates a post, staged files can be garbage-collected
 * via an R2 lifecycle rule (e.g. delete objects in `staging/` older than 24h).
 */
@Injectable()
export class UploadService {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly publicUrl: string;

  constructor(private readonly config: ConfigService) {
    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.get('R2_ACCESS_KEY_ID')!,
        secretAccessKey: config.get('R2_SECRET_ACCESS_KEY')!,
      },
    });
    this.bucketName = config.get<string>('R2_BUCKET_NAME')!;
    this.publicUrl = config.get<string>('R2_PUBLIC_URL')!;
  }

  /**
   * Generates a presigned PUT URL for the client to upload an image directly to R2.
   *
   * The file lands in a staging namespace (`staging/{userId}/{mediaId}.webp`)
   * and is NOT publicly accessible until {@link finalizeMedia} moves it to
   * the permanent `posts/` namespace.
   *
   * The presigned URL embeds `ContentType` and `ContentLength` conditions,
   * so R2 will reject uploads that don't match the declared MIME type and size.
   *
   * @param userId - Authenticated user's ID, used to namespace staging keys.
   * @param contentType - MIME type declared by the client (e.g. `image/webp`).
   * @param fileSizeBytes - Exact byte count the client will upload.
   * @returns Object containing the `mediaId`, `uploadUrl`, `expiresAt`, and `stagingKey`.
   */
  async generatePresignedUrl(
    userId: string,
    contentType: string,
    fileSizeBytes: number,
  ): Promise<{
    mediaId: string;
    uploadUrl: string;
    expiresAt: Date;
    stagingKey: string;
  }> {
    const mediaId = randomUUID();
    const stagingKey = `staging/${userId}/${mediaId}.webp`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: stagingKey,
      ContentType: contentType,
      ContentLength: fileSizeBytes,
    });

    /** 10-minute expiry — long enough for mobile uploads on slow connections. */
    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 600 });

    return {
      mediaId,
      uploadUrl,
      expiresAt: new Date(Date.now() + 600_000),
      stagingKey,
    };
  }

  /**
   * Moves a staged upload to its permanent location under the post's namespace.
   *
   * This is called server-side during post creation — the client never touches
   * the final key directly. The method performs three steps:
   *
   * 1. **Verify** — `HeadObjectCommand` confirms the staging object exists.
   *    If the client never completed the upload, we throw `NotFoundError`
   *    rather than creating a post with a broken image.
   *
   * 2. **Copy** — `CopyObjectCommand` copies the object from staging to its
   *    final key (`posts/{postId}/{mediaId}.webp`).
   *
   * 3. **Delete** — `DeleteObjectCommand` removes the original staging object.
   *
   * @param mediaId - UUID returned by {@link generatePresignedUrl}.
   * @param userId - Authenticated user's ID (must match the staging namespace).
   * @param postId - The newly created post's ID for the final key namespace.
   * @returns Object with the `publicUrl` and `cloudflareStorageKey` for DB storage.
   *
   * @throws {NotFoundError} if the staging object does not exist in R2.
   */
  async finalizeMedia(
    mediaId: string,
    userId: string,
    postId: string,
  ): Promise<{
    publicUrl: string;
    cloudflareStorageKey: string;
  }> {
    const stagingKey = `staging/${userId}/${mediaId}.webp`;
    const finalKey = `posts/${postId}/${mediaId}.webp`;

    // Step 1: Verify the staged upload actually exists
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: stagingKey,
        }),
      );
    } catch {
      throw new NotFoundError(`Staged media "${mediaId}" — upload may have expired or was never completed`);
    }

    // Step 2: Copy to permanent location
    await this.s3Client.send(
      new CopyObjectCommand({
        Bucket: this.bucketName,
        CopySource: `${this.bucketName}/${stagingKey}`,
        Key: finalKey,
      }),
    );

    // Step 3: Remove the staging object to avoid orphaned duplicates
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: stagingKey,
      }),
    );

    return {
      publicUrl: `${this.publicUrl}/${finalKey}`,
      cloudflareStorageKey: finalKey,
    };
  }

  /**
   * Predicts the final URLs for a staged media file.
   * Useful for DB insertion before moving the actual bytes.
   */
  getExpectedMediaUrls(mediaId: string, postId: string): {
    publicUrl: string;
    cloudflareStorageKey: string;
    fileContentType: 'image/webp';
  } {
    const finalKey = `posts/${postId}/${mediaId}.webp`;
    return {
      publicUrl: `${this.publicUrl}/${finalKey}`,
      cloudflareStorageKey: finalKey,
      fileContentType: 'image/webp',
    };
  }
}

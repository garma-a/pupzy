import { Resolver, Mutation, Args, Context } from '@nestjs/graphql';
import { UploadService } from './upload.service';
import { validateRequestMediaUploadInput } from './dto/request-media-upload.input';
import type { GqlContext } from '../common/types/gql-context.type';

/**
 * UploadResolver — GraphQL resolver for media upload operations.
 *
 * ## Authentication
 * Protected by the global `FirebaseAuthGuard` applied in AppModule.
 * The authenticated user is extracted from `ctx.user` to namespace
 * staging keys and prevent cross-user file overwrites.
 *
 * ## Flow
 * 1. Client calls `requestMediaUploadUrl` with content type and file size
 * 2. Server returns a presigned R2 PUT URL and a `mediaId`
 * 3. Client uploads the image bytes directly to R2 via HTTP PUT
 * 4. Client passes the `mediaId` to `createPost` to attach the image
 */
@Resolver()
export class UploadResolver {
  constructor(private readonly uploadService: UploadService) {}

  /**
   * Generates a presigned Cloudflare R2 upload URL for the authenticated user.
   *
   * Input is validated via Zod to enforce MIME type allowlist and file size limits
   * before any S3 calls are made.
   */
  @Mutation('requestMediaUploadUrl')
  async requestMediaUploadUrl(
    @Args('input') input: unknown,
    @Context() context: GqlContext,
  ) {
    const validated = validateRequestMediaUploadInput(input);
    return this.uploadService.generatePresignedUrl(
      context.user!.id,
      validated.contentType,
      validated.fileSizeBytes,
    );
  }
}

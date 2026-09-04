import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadResolver } from './upload.resolver';
import { MediaDeletionProcessor } from './media-deletion.processor';

/**
 * UploadModule — provides media upload capabilities via Cloudflare R2.
 *
 * Exports `UploadService` and `MediaDeletionProcessor` so that other modules
 * can inject them for finalization, deletion, and cleanup.
 */
@Module({
  providers: [UploadService, UploadResolver, MediaDeletionProcessor],
  exports: [UploadService, MediaDeletionProcessor],
})
export class UploadModule {}

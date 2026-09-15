import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadResolver } from './upload.resolver';
import { MediaFinalizationRepository } from './media-finalization.repository';
import { MediaDeletionProcessor } from './media-deletion.processor';

/**
 * UploadModule — provides media upload capabilities via Cloudflare R2.
 *
 * Exports the upload service and cleanup components so other modules can
 * finalize media and resolve durable deletion/finalization work.
 */
@Module({
  providers: [UploadService, UploadResolver, MediaFinalizationRepository, MediaDeletionProcessor],
  exports: [UploadService, MediaFinalizationRepository, MediaDeletionProcessor],
})
export class UploadModule {}

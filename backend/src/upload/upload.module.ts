import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadResolver } from './upload.resolver';
import { MediaFinalizationRepository } from './media-finalization.repository';

/**
 * UploadModule — provides media upload capabilities via Cloudflare R2.
 *
 * Exports `UploadService` so that other modules (e.g. PostsModule) can
 * inject it to finalize staged uploads during post creation.
 * Exports `MediaFinalizationRepository` so account deletion can resolve
 * outstanding finalization obligations before sweeping storage.
 */
@Module({
  providers: [UploadService, UploadResolver, MediaFinalizationRepository],
  exports: [UploadService, MediaFinalizationRepository],
})
export class UploadModule {}

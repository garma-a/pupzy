import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadResolver } from './upload.resolver';

/**
 * UploadModule — provides media upload capabilities via Cloudflare R2.
 *
 * Exports `UploadService` so that other modules (e.g. PostsModule) can
 * inject it to finalize staged uploads during post creation.
 */
@Module({
  providers: [UploadService, UploadResolver],
  exports: [UploadService],
})
export class UploadModule {}

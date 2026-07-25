import { Module } from '@nestjs/common';
import { UploadModule } from '../upload/upload.module';
import { CitiesModule } from '../cities/cities.module';
import { PostsResolver } from './posts.resolver';
import { PostsService } from './posts.service';
import { PostsRepository } from './posts.repository';
import { ViewFlushCron } from './view-flush.cron';

/**
 * PostsModule — encapsulates all post CRUD, feed queries, and view tracking.
 *
 * ## Dependencies
 * - `UploadModule` — provides `UploadService` for R2 media finalization
 * - `CitiesModule` — provides `CitiesService` for city resolution
 *
 * ## Providers
 * - `PostsResolver` — GraphQL entry point for queries, mutations, and field resolvers
 * - `PostsService` — business logic orchestration (feeds, CRUD, engagement)
 * - `PostsRepository` — atomic transactional inserts/updates to Postgres
 * - `ViewFlushCron` — buffers views in-memory, flushes to Postgres every 3 minutes
 */
@Module({
  imports: [UploadModule, CitiesModule],
  providers: [PostsResolver, PostsService, PostsRepository, ViewFlushCron],
  exports: [PostsService, PostsRepository, ViewFlushCron],
})
export class PostsModule {}

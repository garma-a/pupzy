import { Module } from '@nestjs/common';
import { UploadModule } from '../upload/upload.module';
import { CitiesModule } from '../cities/cities.module';
import { PostsResolver } from './posts.resolver';
import { PostsService } from './posts.service';
import { PostsRepository } from './posts.repository';

/**
 * PostsModule — encapsulates all post creation logic.
 *
 * ## Dependencies
 * - `UploadModule` — provides `UploadService` for R2 media finalization
 * - `CitiesModule` — provides `CitiesService` for city resolution
 *
 * ## Providers
 * - `PostsResolver` — GraphQL entry point for create mutations + field resolvers
 * - `PostsService` — business logic orchestration
 * - `PostsRepository` — atomic transactional inserts to Postgres
 */
@Module({
  imports: [UploadModule, CitiesModule],
  providers: [PostsResolver, PostsService, PostsRepository],
  exports: [PostsService, PostsRepository],
})
export class PostsModule {}

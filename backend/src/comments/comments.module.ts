import { Module } from '@nestjs/common';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';
import { CommentsResolver } from './comments.resolver';
import { PostsModule } from '../posts/posts.module';

@Module({
  imports: [PostsModule],
  providers: [CommentsRepository, CommentsService, CommentsResolver],
  exports: [CommentsRepository, CommentsService],
})
export class CommentsModule {}

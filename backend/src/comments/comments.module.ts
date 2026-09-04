import { Module } from '@nestjs/common';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';
import { CommentsResolver, CommentMediaResolver } from './comments.resolver';
import { PostsModule } from '../posts/posts.module';
import { UploadModule } from '../upload/upload.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PostsModule, UploadModule, NotificationsModule, UsersModule],
  providers: [CommentsRepository, CommentsService, CommentsResolver, CommentMediaResolver],
  exports: [CommentsRepository, CommentsService],
})
export class CommentsModule {}

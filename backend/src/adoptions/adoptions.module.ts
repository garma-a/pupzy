import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdoptionsResolver } from './adoptions.resolver';
import { AdoptionsService } from './adoptions.service';
import { AdoptionsRepository } from './adoptions.repository';

/**
 * AdoptionsModule — owns the adoption application lifecycle.
 *
 * ## Dependencies
 * - `PostsModule` — provides PostsRepository for post lookups
 * - `UsersModule` — provides UsersService for phone decryption + user names
 * - `NotificationsModule` — provides NotificationsService for fire-and-forget alerts
 */
@Module({
  imports: [PostsModule, UsersModule, NotificationsModule],
  providers: [AdoptionsResolver, AdoptionsService, AdoptionsRepository],
  exports: [AdoptionsService],
})
export class AdoptionsModule {}

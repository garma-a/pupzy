import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AccountIsolationModule } from '../blocks/account-isolation.module';
import { ContactsResolver } from './contacts.resolver';
import { ContactsService } from './contacts.service';
import { ContactsRepository } from './contacts.repository';

/**
 * ContactsModule — owns the contact request lifecycle.
 *
 * ## Dependencies
 * - `PostsModule` — provides PostsRepository for post lookups
 * - `UsersModule` — provides UsersService for phone decryption + user names
 * - `NotificationsModule` — provides NotificationsService for fire-and-forget alerts
 * - `AccountIsolationModule` — provides the account-pair lock/recheck policy
 */
@Module({
  imports: [PostsModule, UsersModule, NotificationsModule, AccountIsolationModule],
  providers: [ContactsResolver, ContactsService, ContactsRepository],
  exports: [ContactsService],
})
export class ContactsModule {}

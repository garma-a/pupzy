import { Module } from '@nestjs/common';
import { NotificationsResolver } from './notifications.resolver';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';
import { DiscussionNotificationProcessor } from './discussion-notification.processor';
import { AccountIsolationModule } from '../blocks/account-isolation.module';

/**
 * NotificationsModule — owns the notification lifecycle.
 *
 * ## Exports
 * `NotificationsService` is exported so other modules (PostsModule,
 * ContactsModule, AdoptionsModule) can fire notifications.
 *
 * ## Dependencies
 * - `DatabaseModule` — global, provides DATABASE_TOKEN for Drizzle.
 * - `AccountIsolationModule` — provides the Block pair lock/recheck seam used
 *   to suppress immediate and delayed notifications across a Block.
 */
@Module({
  imports: [AccountIsolationModule],
  providers: [NotificationsResolver, NotificationsService, NotificationsRepository, DiscussionNotificationProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}

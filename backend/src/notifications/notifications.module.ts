import { Module } from '@nestjs/common';
import { NotificationsResolver } from './notifications.resolver';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';

/**
 * NotificationsModule — owns the notification lifecycle.
 *
 * ## Exports
 * `NotificationsService` is exported so other modules (PostsModule,
 * ContactsModule, AdoptionsModule) can fire notifications.
 *
 * ## Dependencies
 * - `DatabaseModule` — global, provides DATABASE_TOKEN for Drizzle.
 */
@Module({
  providers: [NotificationsResolver, NotificationsService, NotificationsRepository],
  exports: [NotificationsService],
})
export class NotificationsModule {}

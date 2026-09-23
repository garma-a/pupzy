import { Module } from '@nestjs/common';
import { NotificationsResolver } from './notifications.resolver';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';
import { DiscussionNotificationProcessor } from './discussion-notification.processor';
import { DeviceRegistrationsRepository } from './device-registrations.repository';
import { DeviceRegistrationsResolver } from './device-registrations.resolver';
import { DeviceRegistrationsService } from './device-registrations.service';
import { PushDeliveryRepository } from './push-delivery.repository';
import { PushDeliveryProcessor } from './push-delivery.processor';
import { FirebasePushProvider, PUSH_PROVIDER } from './push.provider';
import { PostCompletionNotificationRepository } from './post-completion-notification.repository';
import { PostCompletionNotificationProcessor } from './post-completion-notification.processor';

/**
 * NotificationsModule — owns the notification lifecycle.
 *
 * ## Exports
 * `NotificationsService` is exported so other modules (PostsModule,
 * ContactsModule, AdoptionsModule) can fire notifications.
 * `PushDeliveryRepository` is exported so direct notification-insert sites
 * (inactivity reminders, the ban cascade) enqueue durable push intents in the
 * same transaction through the shared outbox.
 * `PostCompletionNotificationRepository` and `PostCompletionNotificationProcessor`
 * are exported to support post completion notification lifecycle and background batching.
 *
 * ## Dependencies
 * - `DatabaseModule` — global, provides DATABASE_TOKEN for Drizzle.
 * - `AccountIsolationModule` — provides the Block pair lock/recheck seam used
 *   to suppress immediate and delayed notifications across a Block, including
 *   the push worker's send-time recheck.
 * - `FirebaseModule` — global, provides the Firebase app used by the FCM
 *   push provider.
 */
@Module({
  imports: [AccountIsolationModule],
  providers: [
    NotificationsResolver,
    NotificationsService,
    NotificationsRepository,
    DiscussionNotificationProcessor,
    DeviceRegistrationsResolver,
    DeviceRegistrationsService,
    DeviceRegistrationsRepository,
    PushDeliveryRepository,
    PushDeliveryProcessor,
    { provide: PUSH_PROVIDER, useClass: FirebasePushProvider },
    PostCompletionNotificationRepository,
    PostCompletionNotificationProcessor,
  ],
  exports: [
    NotificationsService,
    PushDeliveryRepository,
    PostCompletionNotificationRepository,
    PostCompletionNotificationProcessor,
  ],
})
export class NotificationsModule {}

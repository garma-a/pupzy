import type { NotificationType } from './notification-templates';

/**
 * Notification types whose persistence also writes durable push delivery
 * intents.
 *
 * Ticket 11 proved the device registry and delivery machinery end to end with
 * the existing adoption-approval notification. Ticket 20 extends the covered
 * workflow set: contacts, discussion, moderation, administrator outcomes and
 * reopening, and expiry/reminders — plus the remaining existing engagement and
 * adoption notifications.
 *
 * `SYSTEM_ANNOUNCEMENT` is deliberately excluded: it belonged to the retired
 * saved-search alert feature, has no creation site, and saved-search alerts are
 * out of push scope. Nearby-rescue broadcasts do not exist as notification
 * types.
 *
 * For types persisted through `NotificationsService.fireNotification`, adding
 * a type here is the only change needed. A durable outbox that inserts its
 * notification row directly (the discussion processor, the expiry reminder,
 * the ban cascade and the AdminJS moderation actions) also enqueues delivery
 * intents in that same transaction.
 */
export const PUSH_ENABLED_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'NEW_UPVOTE',
  'POST_SAVED',
  'CONTACT_REQUEST_RECEIVED',
  'CONTACT_REQUEST_APPROVED',
  'CONTACT_REQUEST_REJECTED',
  'ADOPTION_APPLICATION_RECEIVED',
  'ADOPTION_APPLICATION_APPROVED',
  'ADOPTION_APPLICATION_REJECTED',
  'POST_REMOVED_BY_ADMIN',
  'POST_RESOLVED_BY_ADMIN',
  'POST_REOPENED_BY_ADMIN',
  'POST_INACTIVITY_NUDGE',
  'NEW_COMMENT',
  'NEW_REPLY',
  'COMMENT_BOOSTED',
  'COMMENT_PINNED',
  'POST_COMPLETED',
  'POST_REOPENED',
  'RESCUE_COMPLETED',
  'RESCUE_REOPENED',
]);

/** True when a notification type should enqueue durable push delivery intents. */
export function isPushDeliveryEnabled(type: NotificationType): boolean {
  return PUSH_ENABLED_NOTIFICATION_TYPES.has(type);
}

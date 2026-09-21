import type { NotificationType } from './notification-templates';

/**
 * Notification types whose persistence also writes durable push delivery
 * intents.
 *
 * Ticket 11 proves the device registry and delivery machinery end to end with
 * the existing adoption-approval notification. Later work (the remaining
 * workflow pushes) extends this set; adding a type here is the only change a
 * new push-enabled notification needs.
 */
export const PUSH_ENABLED_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'ADOPTION_APPLICATION_APPROVED',
]);

/** True when a notification type should enqueue durable push delivery intents. */
export function isPushDeliveryEnabled(type: NotificationType): boolean {
  return PUSH_ENABLED_NOTIFICATION_TYPES.has(type);
}

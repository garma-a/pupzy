import { createHash } from 'crypto';
import { localizeNotification } from './notification-templates';
import type { PushDeliveryMessage } from './push.provider';
import type { Notification } from '../database/schema';

/**
 * Stable, platform-bounded collapse key for one notification.
 *
 * Repeated alerts for the same notification type and routing target share a
 * key, so the platform may collapse them instead of stacking. The key is a
 * hash because APNs limits `apns-collapse-id` to 64 bytes while type names and
 * UUIDs can exceed that together.
 */
export function buildPushCollapseId(notification: Notification): string {
  const target = notification.relatedPostId ?? notification.relatedCommentId ?? notification.id;
  return createHash('sha256').update(`${notification.type}:${target}`).digest('hex').slice(0, 32);
}

/**
 * Tap-routing metadata attached to every push. Null routing columns are
 * omitted rather than sent as empty strings, and every value is a string
 * because FCM data payloads cannot carry non-string values.
 */
export function buildPushRoutingData(notification: Notification): Record<string, string> {
  const data: Record<string, string> = {
    notificationId: notification.id,
    type: notification.type,
  };
  if (notification.relatedPostId) data.relatedPostId = notification.relatedPostId;
  if (notification.relatedCommentId) data.relatedCommentId = notification.relatedCommentId;
  if (notification.relatedContactRequestId) data.relatedContactRequestId = notification.relatedContactRequestId;
  if (notification.relatedApplicationId) data.relatedApplicationId = notification.relatedApplicationId;
  return data;
}

/**
 * Builds one provider message from the durable notification row.
 *
 * Localization reads the same stored Arabic/English columns as the in-app
 * inbox through `localizeNotification`, so push and inbox cannot drift. A
 * legacy row without Arabic content keeps its English text even for an
 * Arabic recipient.
 */
export function buildPushMessage(params: {
  notification: Notification;
  languagePreference: string | null | undefined;
  token: string;
}): PushDeliveryMessage {
  const localized = localizeNotification(params.notification, params.languagePreference);
  return {
    token: params.token,
    title: localized.title,
    body: localized.body,
    collapseId: buildPushCollapseId(params.notification),
    data: buildPushRoutingData(params.notification),
  };
}

import { Inject, Injectable } from '@nestjs/common';
import type { App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { FIREBASE_ADMIN_TOKEN } from '../auth/firebase.module';

/** One provider-neutral push message produced from a durable delivery intent. */
export interface PushDeliveryMessage {
  /** Device registration token. Never logged or persisted in plain text. */
  token: string;
  /** Localized headline, read from the notification's bilingual columns. */
  title: string;
  /** Localized body, read from the notification's bilingual columns. */
  body: string;
  /**
   * Provider collapse key. Repeated alerts for the same routing target may be
   * collapsed by the platform so busy activity does not overwhelm the device.
   */
  collapseId: string;
  /** Notification routing metadata. Every value is a string for FCM data. */
  data: Record<string, string>;
}

/**
 * External push provider boundary. Implementations hand one message to the
 * platform and reject on failure. The backend does not promise provider-level
 * exactly-once delivery: a send accepted by the provider is never repeated,
 * but a crash between provider acceptance and the durable DELIVERED write may
 * result in one duplicate.
 */
export interface PushProvider {
  send(message: PushDeliveryMessage): Promise<void>;
}

/** Nest injection token for the configured push provider. */
export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

/**
 * Provider error codes that mean the token is permanently unusable. These
 * cause the device registration to be removed; every other failure is retried
 * under the bounded attempt policy.
 */
const DEAD_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/** True when a provider rejection means the device token must be cleaned up. */
export function isDeadPushTokenError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && DEAD_TOKEN_ERROR_CODES.has(code);
}

/**
 * Firebase Cloud Messaging provider. FCM is the existing project dependency and
 * relays to APNs for iOS, so no second provider integration is introduced.
 * Provider configuration (APNs credentials, Flutter listeners and tap routing)
 * remains external app/platform work.
 */
@Injectable()
export class FirebasePushProvider implements PushProvider {
  constructor(@Inject(FIREBASE_ADMIN_TOKEN) private readonly firebaseApp: App) {}

  async send(message: PushDeliveryMessage): Promise<void> {
    await getMessaging(this.firebaseApp).send({
      token: message.token,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: { collapseKey: message.collapseId },
      apns: { headers: { 'apns-collapse-id': message.collapseId } },
    });
  }
}

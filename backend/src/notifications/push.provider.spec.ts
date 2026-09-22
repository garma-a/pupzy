jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(),
}));

import { getMessaging } from 'firebase-admin/messaging';
import type { App } from 'firebase-admin/app';
import { FirebasePushProvider, isDeadPushTokenError, type PushDeliveryMessage } from './push.provider';

describe('FirebasePushProvider', () => {
  const send = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (getMessaging as jest.Mock).mockReturnValue({ send });
    send.mockResolvedValue('projects/pupzy/messages/1');
  });

  const message: PushDeliveryMessage = {
    token: 'device-token',
    title: 'Adoption application approved!',
    body: 'You can now contact the owner.',
    collapseId: 'collapse-key',
    data: { notificationId: 'notification-1', type: 'ADOPTION_APPLICATION_APPROVED' },
  };

  it('sends the localized notification with routing data and collapse controls', async () => {
    const provider = new FirebasePushProvider({} as App);

    await provider.send(message);

    expect(send).toHaveBeenCalledWith({
      token: 'device-token',
      notification: { title: 'Adoption application approved!', body: 'You can now contact the owner.' },
      data: { notificationId: 'notification-1', type: 'ADOPTION_APPLICATION_APPROVED' },
      android: { collapseKey: 'collapse-key' },
      apns: { headers: { 'apns-collapse-id': 'collapse-key' } },
    });
  });

  it('propagates provider rejections for the worker retry policy', async () => {
    send.mockRejectedValue(new Error('messaging/server-unavailable'));
    const provider = new FirebasePushProvider({} as App);

    await expect(provider.send(message)).rejects.toThrow('messaging/server-unavailable');
  });
});

describe('isDeadPushTokenError', () => {
  it('classifies unregistered and invalid tokens as dead', () => {
    expect(isDeadPushTokenError({ code: 'messaging/registration-token-not-registered' })).toBe(true);
    expect(isDeadPushTokenError({ code: 'messaging/invalid-registration-token' })).toBe(true);
  });

  it('keeps transient provider failures retryable', () => {
    expect(isDeadPushTokenError({ code: 'messaging/server-unavailable' })).toBe(false);
    expect(isDeadPushTokenError({ code: 'messaging/internal-error' })).toBe(false);
    expect(isDeadPushTokenError(new Error('network timeout'))).toBe(false);
    expect(isDeadPushTokenError(undefined)).toBe(false);
  });
});

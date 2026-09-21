import { buildPushCollapseId, buildPushMessage, buildPushRoutingData } from './push-payload';
import type { Notification } from '../database/schema';

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: '01916327-0000-7000-8000-000000000001',
    recipientId: '01916327-0000-7000-8000-000000000002',
    type: 'ADOPTION_APPLICATION_APPROVED',
    title: 'Adoption application approved!',
    body: 'Your adoption application for "Lovely puppy" has been approved. You can now contact the owner.',
    titleArabic: 'تمت الموافقة على طلب التبني!',
    bodyArabic: 'تمت الموافقة على طلب التبني الخاص بك لـ "Lovely puppy". يمكنك الآن التواصل مع صاحب المنشور.',
    relatedPostId: '01916327-0000-7000-8000-000000000010',
    relatedCommentId: null,
    discussionEventId: null,
    relatedContactRequestId: null,
    relatedApplicationId: '01916327-0000-7000-8000-000000000020',
    isRead: false,
    createdAt: new Date('2026-09-21T10:00:00Z'),
    ...overrides,
  };
}

describe('push payload builder', () => {
  it('localizes the push through the same stored columns as the inbox', () => {
    const arabic = buildPushMessage({ notification: notification(), languagePreference: 'ar', token: 'token-a' });
    expect(arabic.title).toBe('تمت الموافقة على طلب التبني!');
    expect(arabic.body).toContain('تمت الموافقة على طلب التبني الخاص بك');
    expect(arabic.token).toBe('token-a');

    const english = buildPushMessage({ notification: notification(), languagePreference: 'en', token: 'token-b' });
    expect(english.title).toBe('Adoption application approved!');

    const unsynchronized = buildPushMessage({
      notification: notification(),
      languagePreference: null,
      token: 'token-c',
    });
    expect(unsynchronized.title).toBe('Adoption application approved!');
  });

  it('falls back to English for a legacy row without Arabic content', () => {
    const message = buildPushMessage({
      notification: notification({ titleArabic: null, bodyArabic: null }),
      languagePreference: 'ar',
      token: 'token-a',
    });

    expect(message.title).toBe('Adoption application approved!');
    expect(message.body).toContain('"Lovely puppy"');
  });

  it('carries notification, type and related routing data as strings', () => {
    const data = buildPushRoutingData(notification());

    expect(data).toEqual({
      notificationId: '01916327-0000-7000-8000-000000000001',
      type: 'ADOPTION_APPLICATION_APPROVED',
      relatedPostId: '01916327-0000-7000-8000-000000000010',
      relatedApplicationId: '01916327-0000-7000-8000-000000000020',
    });
    for (const value of Object.values(data)) expect(typeof value).toBe('string');
  });

  it('omits absent related identifiers instead of sending empty values', () => {
    const data = buildPushRoutingData(
      notification({
        relatedPostId: null,
        relatedCommentId: null,
        relatedApplicationId: null,
        relatedContactRequestId: null,
      }),
    );

    expect(data).toEqual({
      notificationId: '01916327-0000-7000-8000-000000000001',
      type: 'ADOPTION_APPLICATION_APPROVED',
    });
  });

  it('derives a stable, bounded collapse id from type and routing target', () => {
    const first = buildPushCollapseId(notification());
    const second = buildPushCollapseId(notification({ id: '01916327-0000-7000-8000-000000000099' }));

    expect(first).toBe(second);
    expect(first).toHaveLength(32);
    expect(buildPushCollapseId(notification({ relatedPostId: '01916327-0000-7000-8000-000000000011' }))).not.toBe(
      first,
    );
    expect(buildPushCollapseId(notification({ type: 'NEW_COMMENT' }))).not.toBe(first);
  });

  it('falls back to the notification id for collapse when no target is routed', () => {
    const first = buildPushCollapseId(notification({ relatedPostId: null, relatedApplicationId: null }));
    const second = buildPushCollapseId(
      notification({
        id: '01916327-0000-7000-8000-000000000098',
        relatedPostId: null,
        relatedApplicationId: null,
      }),
    );

    expect(first).not.toBe(second);
  });
});

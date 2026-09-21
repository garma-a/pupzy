import { notificationTypeEnum } from '../database/schema/enums';
import { NOTIFICATION_TEMPLATE_TYPES } from './notification-templates';
import { PUSH_ENABLED_NOTIFICATION_TYPES, isPushDeliveryEnabled } from './push-delivery.constants';

/**
 * Ticket 20 — the push allowlist is the single source of truth for which
 * persisted notifications also create durable delivery intents. Every existing
 * workflow type is covered so a new notification cannot ship inbox-only by
 * accident; only the retired saved-search announcement stays out.
 */
describe('push delivery type coverage', () => {
  it('covers every existing workflow type except the retired saved-search announcement', () => {
    const excluded = notificationTypeEnum.enumValues.filter((type) => !isPushDeliveryEnabled(type));
    expect(excluded).toEqual(['SYSTEM_ANNOUNCEMENT']);
    expect(PUSH_ENABLED_NOTIFICATION_TYPES.size).toBe(notificationTypeEnum.enumValues.length - 1);
  });

  it('covers the ticket-20 workflow categories explicitly', () => {
    const covered = [
      'CONTACT_REQUEST_RECEIVED',
      'CONTACT_REQUEST_APPROVED',
      'CONTACT_REQUEST_REJECTED',
      'NEW_COMMENT',
      'NEW_REPLY',
      'COMMENT_BOOSTED',
      'COMMENT_PINNED',
      'POST_REMOVED_BY_ADMIN',
      'POST_RESOLVED_BY_ADMIN',
      'POST_REOPENED_BY_ADMIN',
      'POST_INACTIVITY_NUDGE',
    ] as const;

    for (const type of covered) {
      expect(isPushDeliveryEnabled(type)).toBe(true);
    }
  });

  it('only enables types with bilingual templates', () => {
    for (const type of PUSH_ENABLED_NOTIFICATION_TYPES) {
      expect(NOTIFICATION_TEMPLATE_TYPES).toContain(type);
    }
  });
});

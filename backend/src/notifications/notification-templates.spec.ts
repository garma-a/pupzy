import { notificationTypeEnum } from '../database/schema/enums';
import {
  DEFAULT_NOTIFICATION_LANGUAGE,
  NOTIFICATION_TEMPLATE_TYPES,
  buildNotificationContent,
  localizeNotification,
  resolveNotificationLanguage,
  type NotificationTemplateParamsMap,
} from './notification-templates';

/** Representative parameters for every type — also proves the params contract. */
const SAMPLE_PARAMS: NotificationTemplateParamsMap = {
  NEW_UPVOTE: { actorName: 'Ahmed', postTitle: 'Missing cat' },
  POST_SAVED: { actorName: 'Ahmed', postTitle: 'Missing cat' },
  CONTACT_REQUEST_RECEIVED: { actorName: 'Ahmed', postTitle: 'Missing cat' },
  CONTACT_REQUEST_APPROVED: { postTitle: 'Missing cat' },
  CONTACT_REQUEST_REJECTED: { postTitle: 'Missing cat' },
  ADOPTION_APPLICATION_RECEIVED: { actorName: 'Ahmed', postTitle: 'Missing cat' },
  ADOPTION_APPLICATION_APPROVED: { postTitle: 'Missing cat' },
  ADOPTION_APPLICATION_REJECTED: { postTitle: 'Missing cat' },
  POST_REMOVED_BY_ADMIN: { reason: 'Policy violation' },
  POST_INACTIVITY_NUDGE: { postTitle: 'Missing cat' },
  SYSTEM_ANNOUNCEMENT: { postTitle: 'Missing cat' },
  NEW_COMMENT: { actorName: 'Ahmed', postTitle: 'Missing cat' },
  NEW_REPLY: { actorName: 'Ahmed' },
  COMMENT_BOOSTED: { actorName: 'Ahmed', target: 'comment' },
  COMMENT_PINNED: { postTitle: 'Missing cat' },
};

describe('notification templates', () => {
  it('defines both languages for every notification type in the persistence enum', () => {
    expect([...NOTIFICATION_TEMPLATE_TYPES].sort()).toEqual([...notificationTypeEnum.enumValues].sort());

    for (const type of notificationTypeEnum.enumValues) {
      const content = buildNotificationContent(type, SAMPLE_PARAMS[type]);
      expect(content.title.trim().length).toBeGreaterThan(0);
      expect(content.body.trim().length).toBeGreaterThan(0);
      expect(content.titleArabic.trim().length).toBeGreaterThan(0);
      expect(content.bodyArabic.trim().length).toBeGreaterThan(0);
      expect(content.titleArabic).not.toBe(content.title);
    }
  });

  it('preserves the existing English copy byte-for-byte', () => {
    expect(buildNotificationContent('NEW_UPVOTE', SAMPLE_PARAMS.NEW_UPVOTE)).toMatchObject({
      title: 'New upvote',
      body: 'Ahmed upvoted your post "Missing cat"',
    });
    expect(buildNotificationContent('POST_SAVED', SAMPLE_PARAMS.POST_SAVED)).toMatchObject({
      title: 'Post saved',
      body: 'Ahmed saved your post "Missing cat"',
    });
    expect(buildNotificationContent('CONTACT_REQUEST_RECEIVED', SAMPLE_PARAMS.CONTACT_REQUEST_RECEIVED)).toMatchObject({
      title: 'New contact request',
      body: 'Ahmed wants to contact you about "Missing cat"',
    });
    expect(buildNotificationContent('CONTACT_REQUEST_APPROVED', SAMPLE_PARAMS.CONTACT_REQUEST_APPROVED)).toMatchObject({
      title: 'Contact request approved',
      body: 'You can now contact the owner via WhatsApp about "Missing cat"',
    });
    expect(buildNotificationContent('CONTACT_REQUEST_REJECTED', SAMPLE_PARAMS.CONTACT_REQUEST_REJECTED)).toMatchObject({
      title: 'Contact request update',
      body: 'Your contact request about "Missing cat" was not approved',
    });
    expect(
      buildNotificationContent('ADOPTION_APPLICATION_RECEIVED', SAMPLE_PARAMS.ADOPTION_APPLICATION_RECEIVED),
    ).toMatchObject({
      title: 'New adoption application',
      body: 'Ahmed applied to adopt from "Missing cat"',
    });
    expect(
      buildNotificationContent('ADOPTION_APPLICATION_APPROVED', SAMPLE_PARAMS.ADOPTION_APPLICATION_APPROVED),
    ).toMatchObject({
      title: 'Adoption application approved!',
      body: 'Your adoption application for "Missing cat" has been approved. You can now contact the owner.',
    });
    expect(
      buildNotificationContent('ADOPTION_APPLICATION_REJECTED', SAMPLE_PARAMS.ADOPTION_APPLICATION_REJECTED),
    ).toMatchObject({
      title: 'Adoption application update',
      body: 'Your adoption application for "Missing cat" was not approved at this time',
    });
    expect(buildNotificationContent('POST_REMOVED_BY_ADMIN', SAMPLE_PARAMS.POST_REMOVED_BY_ADMIN)).toMatchObject({
      title: 'Your post was removed',
      body: 'Policy violation',
    });
    expect(buildNotificationContent('NEW_COMMENT', SAMPLE_PARAMS.NEW_COMMENT)).toMatchObject({
      title: 'New comment',
      body: 'Ahmed commented on your post "Missing cat"',
    });
    expect(buildNotificationContent('NEW_REPLY', SAMPLE_PARAMS.NEW_REPLY)).toMatchObject({
      title: 'New reply',
      body: 'Ahmed replied to your comment',
    });
    expect(buildNotificationContent('COMMENT_BOOSTED', SAMPLE_PARAMS.COMMENT_BOOSTED)).toMatchObject({
      title: 'Comment boosted',
      body: 'Ahmed boosted your comment',
    });
    expect(buildNotificationContent('COMMENT_BOOSTED', { actorName: 'Ahmed', target: 'reply' })).toMatchObject({
      title: 'Comment boosted',
      body: 'Ahmed boosted your reply',
    });
    expect(buildNotificationContent('COMMENT_PINNED', SAMPLE_PARAMS.COMMENT_PINNED)).toMatchObject({
      title: 'Comment pinned',
      body: 'Your comment was pinned on "Missing cat"',
    });
  });

  it('preserves both account-ban cascade copy variants', () => {
    expect(buildNotificationContent('POST_REMOVED_BY_ADMIN', { reason: 'Spam', removedAll: true })).toMatchObject({
      title: 'Your posts were removed',
      body: 'Your account was banned (Spam) and your active posts were removed.',
    });
  });

  it('renders Arabic copy with the same parameters', () => {
    const content = buildNotificationContent('NEW_COMMENT', { actorName: 'Ahmed', postTitle: 'Missing cat' });
    expect(content.titleArabic).toBe('تعليق جديد');
    expect(content.bodyArabic).toContain('Ahmed');
    expect(content.bodyArabic).toContain('Missing cat');
  });

  describe('resolveNotificationLanguage', () => {
    it('defaults to English for unsynchronized and unknown values', () => {
      expect(DEFAULT_NOTIFICATION_LANGUAGE).toBe('en');
      expect(resolveNotificationLanguage(null)).toBe('en');
      expect(resolveNotificationLanguage(undefined)).toBe('en');
      expect(resolveNotificationLanguage('')).toBe('en');
      expect(resolveNotificationLanguage('fr')).toBe('en');
      expect(resolveNotificationLanguage('AR')).toBe('en');
    });

    it('honours explicit ar and en preferences', () => {
      expect(resolveNotificationLanguage('ar')).toBe('ar');
      expect(resolveNotificationLanguage('en')).toBe('en');
    });
  });

  describe('localizeNotification', () => {
    const bilingualRow = {
      id: 'notification-1',
      title: 'New comment',
      body: 'Ahmed commented on your post "Missing cat"',
      titleArabic: 'تعليق جديد',
      bodyArabic: 'علّق Ahmed على منشورك "Missing cat"',
      relatedPostId: 'post-1',
      relatedCommentId: 'comment-1',
      isRead: false,
    };

    it('renders Arabic for an explicitly Arabic recipient and preserves routing fields', () => {
      const localized = localizeNotification(bilingualRow, 'ar');
      expect(localized.title).toBe('تعليق جديد');
      expect(localized.body).toBe('علّق Ahmed على منشورك "Missing cat"');
      expect(localized.relatedPostId).toBe('post-1');
      expect(localized.relatedCommentId).toBe('comment-1');
      expect(localized.id).toBe('notification-1');
      expect(localized.isRead).toBe(false);
    });

    it('renders English for explicit en, unsynchronized and unknown preferences', () => {
      for (const preference of ['en', null, undefined, 'fr'] as const) {
        const localized = localizeNotification(bilingualRow, preference);
        expect(localized.title).toBe('New comment');
        expect(localized.body).toBe('Ahmed commented on your post "Missing cat"');
      }
    });

    it('falls back to English for legacy rows without Arabic columns', () => {
      const legacyRow = {
        id: 'notification-2',
        title: 'New upvote',
        body: 'Ahmed upvoted your post "Missing cat"',
        titleArabic: null,
        bodyArabic: null,
        relatedPostId: 'post-1',
      };
      const localized = localizeNotification(legacyRow, 'ar');
      expect(localized.title).toBe('New upvote');
      expect(localized.body).toBe('Ahmed upvoted your post "Missing cat"');
      expect(localized.relatedPostId).toBe('post-1');
    });

    it('falls back to English when only part of the Arabic content exists', () => {
      const partialRow = { ...bilingualRow, bodyArabic: null };
      const localized = localizeNotification(partialRow, 'ar');
      expect(localized.title).toBe('New comment');
      expect(localized.body).toBe('Ahmed commented on your post "Missing cat"');
    });
  });
});

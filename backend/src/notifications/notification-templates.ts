import type { notificationTypeEnum } from '../database/schema/enums';

/** Every notification type persisted by the `notification_type` enum. */
export type NotificationType = (typeof notificationTypeEnum.enumValues)[number];

/** Supported notification languages. */
export const NOTIFICATION_LANGUAGES = ['en', 'ar'] as const;
export type NotificationLanguage = (typeof NOTIFICATION_LANGUAGES)[number];

/**
 * Language used for unsynchronized accounts and for rows that predate bilingual
 * templates. The historic `ar` database default was never an explicit choice.
 */
export const DEFAULT_NOTIFICATION_LANGUAGE: NotificationLanguage = 'en';

/**
 * Parameters each notification type interpolates into its English and Arabic
 * templates. Adding a notification type adds one key here and one entry in
 * `NOTIFICATION_TEMPLATES`; the mapped registry type refuses to compile until
 * both languages are supplied, so new features cannot ship a single-language
 * notification.
 */
export interface NotificationTemplateParamsMap {
  NEW_UPVOTE: { actorName: string; postTitle: string };
  POST_SAVED: { actorName: string; postTitle: string };
  CONTACT_REQUEST_RECEIVED: { actorName: string; postTitle: string };
  CONTACT_REQUEST_APPROVED: { postTitle: string };
  CONTACT_REQUEST_REJECTED: { postTitle: string };
  ADOPTION_APPLICATION_RECEIVED: { actorName: string; postTitle: string };
  ADOPTION_APPLICATION_APPROVED: { postTitle: string };
  ADOPTION_APPLICATION_REJECTED: { postTitle: string };
  /** `removedAll` is the account-ban cascade variant that removes every post. */
  POST_REMOVED_BY_ADMIN: { reason: string; removedAll?: boolean };
  POST_INACTIVITY_NUDGE: { postTitle: string };
  SYSTEM_ANNOUNCEMENT: { postTitle: string };
  NEW_COMMENT: { actorName: string; postTitle: string };
  NEW_REPLY: { actorName: string };
  COMMENT_BOOSTED: { actorName: string; target: 'comment' | 'reply' };
  COMMENT_PINNED: { postTitle: string };
}

/** Rendered text for one language. */
export interface RenderedNotificationContent {
  title: string;
  body: string;
}

/** The English and Arabic columns persisted on a notification row. */
export interface NotificationContentColumns {
  title: string;
  body: string;
  titleArabic: string;
  bodyArabic: string;
}

interface BilingualNotificationTemplate<P> {
  readonly en: (params: P) => RenderedNotificationContent;
  readonly ar: (params: P) => RenderedNotificationContent;
}

type NotificationTemplateRegistry = {
  readonly [K in NotificationType]: BilingualNotificationTemplate<NotificationTemplateParamsMap[K]>;
};

/**
 * Centralized English and Arabic definitions for every existing notification
 * type. In-app display and push read the same rendered columns, and comments
 * repository records them in its durable discussion outbox.
 */
const NOTIFICATION_TEMPLATES: NotificationTemplateRegistry = {
  NEW_UPVOTE: {
    en: ({ actorName, postTitle }) => ({
      title: 'New upvote',
      body: `${actorName} upvoted your post "${postTitle}"`,
    }),
    ar: ({ actorName, postTitle }) => ({
      title: 'إعجاب جديد',
      body: `أعجب ${actorName} بمنشورك "${postTitle}"`,
    }),
  },
  POST_SAVED: {
    en: ({ actorName, postTitle }) => ({
      title: 'Post saved',
      body: `${actorName} saved your post "${postTitle}"`,
    }),
    ar: ({ actorName, postTitle }) => ({
      title: 'تم حفظ المنشور',
      body: `حفظ ${actorName} منشورك "${postTitle}"`,
    }),
  },
  CONTACT_REQUEST_RECEIVED: {
    en: ({ actorName, postTitle }) => ({
      title: 'New contact request',
      body: `${actorName} wants to contact you about "${postTitle}"`,
    }),
    ar: ({ actorName, postTitle }) => ({
      title: 'طلب تواصل جديد',
      body: `يرغب ${actorName} في التواصل معك بخصوص "${postTitle}"`,
    }),
  },
  CONTACT_REQUEST_APPROVED: {
    en: ({ postTitle }) => ({
      title: 'Contact request approved',
      body: `You can now contact the owner via WhatsApp about "${postTitle}"`,
    }),
    ar: ({ postTitle }) => ({
      title: 'تمت الموافقة على طلب التواصل',
      body: `يمكنك الآن التواصل مع صاحب المنشور عبر واتساب بخصوص "${postTitle}"`,
    }),
  },
  CONTACT_REQUEST_REJECTED: {
    en: ({ postTitle }) => ({
      title: 'Contact request update',
      body: `Your contact request about "${postTitle}" was not approved`,
    }),
    ar: ({ postTitle }) => ({
      title: 'تحديث طلب التواصل',
      body: `لم تتم الموافقة على طلب التواصل الخاص بك بخصوص "${postTitle}"`,
    }),
  },
  ADOPTION_APPLICATION_RECEIVED: {
    en: ({ actorName, postTitle }) => ({
      title: 'New adoption application',
      body: `${actorName} applied to adopt from "${postTitle}"`,
    }),
    ar: ({ actorName, postTitle }) => ({
      title: 'طلب تبنٍّ جديد',
      body: `تقدّم ${actorName} بطلب تبنٍّ لـ "${postTitle}"`,
    }),
  },
  ADOPTION_APPLICATION_APPROVED: {
    en: ({ postTitle }) => ({
      title: 'Adoption application approved!',
      body: `Your adoption application for "${postTitle}" has been approved. You can now contact the owner.`,
    }),
    ar: ({ postTitle }) => ({
      title: 'تمت الموافقة على طلب التبني!',
      body: `تمت الموافقة على طلب التبني الخاص بك لـ "${postTitle}". يمكنك الآن التواصل مع صاحب المنشور.`,
    }),
  },
  ADOPTION_APPLICATION_REJECTED: {
    en: ({ postTitle }) => ({
      title: 'Adoption application update',
      body: `Your adoption application for "${postTitle}" was not approved at this time`,
    }),
    ar: ({ postTitle }) => ({
      title: 'تحديث طلب التبني',
      body: `لم تتم الموافقة على طلب التبني الخاص بك لـ "${postTitle}" في الوقت الحالي`,
    }),
  },
  POST_REMOVED_BY_ADMIN: {
    en: ({ reason, removedAll = false }) =>
      removedAll
        ? {
            title: 'Your posts were removed',
            body: `Your account was banned (${reason}) and your active posts were removed.`,
          }
        : { title: 'Your post was removed', body: reason },
    ar: ({ reason, removedAll = false }) =>
      removedAll
        ? {
            title: 'تمت إزالة منشوراتك',
            body: `تم حظر حسابك (${reason}) وتمت إزالة منشوراتك النشطة.`,
          }
        : { title: 'تمت إزالة منشورك', body: reason },
  },
  POST_INACTIVITY_NUDGE: {
    en: ({ postTitle }) => ({
      title: 'Is your post still active?',
      body: `Your post "${postTitle}" has had no recent activity. Review it to keep it active.`,
    }),
    ar: ({ postTitle }) => ({
      title: 'هل لا يزال منشورك نشطًا؟',
      body: `لم يشهد منشورك "${postTitle}" أي نشاط حديث. راجعه للحفاظ على نشاطه.`,
    }),
  },
  SYSTEM_ANNOUNCEMENT: {
    en: ({ postTitle }) => ({
      title: 'New match for your saved search',
      body: `A new post matches your saved search: "${postTitle}"`,
    }),
    ar: ({ postTitle }) => ({
      title: 'نتيجة جديدة لبحثك المحفوظ',
      body: `يوجد منشور جديد يطابق بحثك المحفوظ: "${postTitle}"`,
    }),
  },
  NEW_COMMENT: {
    en: ({ actorName, postTitle }) => ({
      title: 'New comment',
      body: `${actorName} commented on your post "${postTitle}"`,
    }),
    ar: ({ actorName, postTitle }) => ({
      title: 'تعليق جديد',
      body: `علّق ${actorName} على منشورك "${postTitle}"`,
    }),
  },
  NEW_REPLY: {
    en: ({ actorName }) => ({
      title: 'New reply',
      body: `${actorName} replied to your comment`,
    }),
    ar: ({ actorName }) => ({
      title: 'رد جديد',
      body: `ردّ ${actorName} على تعليقك`,
    }),
  },
  COMMENT_BOOSTED: {
    en: ({ actorName, target }) => ({
      title: 'Comment boosted',
      body: `${actorName} boosted your ${target === 'reply' ? 'reply' : 'comment'}`,
    }),
    ar: ({ actorName, target }) => ({
      title: 'تم دعم التعليق',
      body: `قام ${actorName} بدعم ${target === 'reply' ? 'ردك' : 'تعليقك'}`,
    }),
  },
  COMMENT_PINNED: {
    en: ({ postTitle }) => ({
      title: 'Comment pinned',
      body: `Your comment was pinned on "${postTitle}"`,
    }),
    ar: ({ postTitle }) => ({
      title: 'تم تثبيت التعليق',
      body: `تم تثبيت تعليقك على "${postTitle}"`,
    }),
  },
};

export const NOTIFICATION_TEMPLATE_TYPES = Object.keys(NOTIFICATION_TEMPLATES) as NotificationType[];

/**
 * Renders the English and Arabic content columns for one notification type.
 * Creation sites pass the returned object straight into persistence, so the
 * same definitions feed in-app display, push and the durable outbox.
 */
export function buildNotificationContent<T extends NotificationType>(
  type: T,
  params: NotificationTemplateParamsMap[T],
): NotificationContentColumns {
  const template = NOTIFICATION_TEMPLATES[type];
  const en = template.en(params);
  const ar = template.ar(params);
  return { title: en.title, body: en.body, titleArabic: ar.title, bodyArabic: ar.body };
}

/**
 * Resolves an untrusted preference value. Only an explicit `ar` selects Arabic;
 * NULL, unknown and historic values fall back to English.
 */
export function resolveNotificationLanguage(preference: string | null | undefined): NotificationLanguage {
  return preference === 'ar' ? 'ar' : DEFAULT_NOTIFICATION_LANGUAGE;
}

/**
 * Picks the recipient's language for an existing row. Legacy rows without both
 * Arabic columns keep their stored English content.
 */
export function localizeNotification<
  T extends { title: string; body: string; titleArabic: string | null; bodyArabic: string | null },
>(notification: T, preference: string | null | undefined): T {
  if (resolveNotificationLanguage(preference) !== 'ar') return notification;
  if (!notification.titleArabic || !notification.bodyArabic) return notification;
  return { ...notification, title: notification.titleArabic, body: notification.bodyArabic };
}

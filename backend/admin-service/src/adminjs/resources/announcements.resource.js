import { ENUMS } from '../enums.js';
import { isSuperAdmin } from '../rbac.js';
import {
  attachPushStats,
  buildPreviewAnnouncementAction,
  buildSendAnnouncementAction,
} from '../actions/announcement.actions.js';
import { attachShortUuid, enumProperty, stripPopulatedPasswordHashes } from './resource-helpers.js';

/**
 * Column labels. Also registered as the resource's translations (AdminJS reads
 * table headers from those, not from the property option).
 */
export const ANNOUNCEMENT_PROPERTY_LABELS = Object.freeze({
  created_at: 'Sent',
  sent_by_admin_id: 'Sent by',
  audience: 'Audience',
  audience_city_name: 'City',
  title_en: 'English',
  body_en: 'English message',
  title_ar: 'Arabic',
  body_ar: 'Arabic message',
  failure_reason: 'Why it failed',
  audience_cutoff_at: 'Audience frozen at',
  expected_recipients: 'Recipients',
  in_app_count: 'In-app',
  push_intent_count: 'Push',
  started_at: 'Started',
  completed_at: 'Completed',
});

/**
 * Announcements: a SUPER_ADMIN's message to every eligible user or to one
 * City, written in English and Arabic. Read-only history; an announcement
 * cannot be edited or unsent. Every action is gated server-side by
 * `isSuperAdmin`, which also hides the navigation entry from a plain admin.
 */
export function buildAnnouncementsResource(db, pool, components = {}) {
  const properties = {
    id: { isTitle: false, isDisabled: true },
    sent_by_admin_id: { isDisabled: true },
    audience: enumProperty(ENUMS.announcementAudience, { isDisabled: true }),
    audience_city_id: { isVisible: false },
    audience_city_name: { isDisabled: true },
    title_en: { isTitle: true, isDisabled: true },
    body_en: { isDisabled: true },
    title_ar: { isDisabled: true },
    body_ar: { isDisabled: true },
    status: enumProperty(ENUMS.announcementStatus, { isDisabled: true }),
    failure_reason: { isDisabled: true },
    audience_cutoff_at: { isDisabled: true },
    expected_recipients: { isDisabled: true },
    in_app_count: { isDisabled: true },
    push_intent_count: { isDisabled: true },
    started_at: { isDisabled: true },
    completed_at: { isDisabled: true },
    created_at: { isDisabled: true },
    cursor_user_id: { isVisible: false },
    attempts: { isVisible: false },
    last_error: { isVisible: false },
    next_attempt_at: { isVisible: false },
    updated_at: { isVisible: false },
  };

  for (const [name, label] of Object.entries(ANNOUNCEMENT_PROPERTY_LABELS)) {
    properties[name] = { ...properties[name], label };
  }
  attachShortUuid(properties, ['id'], components, ['list', 'show']);
  if (components.ReferenceLink) {
    properties.sent_by_admin_id.components = { list: components.ReferenceLink, show: components.ReferenceLink };
  }
  for (const field of ['title_en', 'title_ar']) {
    if (components.AnnouncementText) properties[field].components = { list: components.AnnouncementText };
  }
  if (components.AnnouncementAudience) {
    properties.audience.components = { list: components.AnnouncementAudience };
  }
  if (components.AnnouncementPush) {
    properties.push_intent_count.components = { list: components.AnnouncementPush };
  }

  const superAdminOnly = { isAccessible: isSuperAdmin };
  return {
    resource: db.table('announcements'),
    options: {
      navigation: { name: null, icon: 'Bell' },
      properties,
      sort: { sortBy: 'created_at', direction: 'desc' },
      listProperties: [
        'created_at',
        'sent_by_admin_id',
        'audience',
        'title_en',
        'title_ar',
        'status',
        'expected_recipients',
        'in_app_count',
        'push_intent_count',
      ],
      showProperties: [
        'id',
        'sent_by_admin_id',
        'created_at',
        'audience',
        'audience_city_name',
        'title_en',
        'body_en',
        'title_ar',
        'body_ar',
        'status',
        'failure_reason',
        'expected_recipients',
        'in_app_count',
        'push_intent_count',
        'audience_cutoff_at',
        'started_at',
        'completed_at',
      ],
      filterProperties: ['status', 'audience', 'sent_by_admin_id', 'created_at'],
      actions: {
        list: { ...superAdminOnly, after: [stripPopulatedPasswordHashes, attachPushStats(pool)] },
        search: { ...superAdminOnly, after: stripPopulatedPasswordHashes },
        show: {
          ...superAdminOnly,
          ...(components.AnnouncementShow ? { component: components.AnnouncementShow } : {}),
          after: [stripPopulatedPasswordHashes, attachPushStats(pool)],
        },
        new: {
          ...buildSendAnnouncementAction(pool),
          label: 'New announcement',
          icon: 'Plus',
          ...(components.AnnouncementCompose ? { component: components.AnnouncementCompose } : {}),
        },
        previewAnnouncement: buildPreviewAnnouncementAction(pool),
        edit: { isAccessible: false },
        delete: { isAccessible: false },
        bulkDelete: { isAccessible: false },
      },
    },
  };
}

import { ENUMS } from '../enums.js';
import { isSuperAdmin } from '../rbac.js';
import {
  attachPushStats,
  buildPreviewAnnouncementAction,
  buildSendAnnouncementAction,
} from '../actions/announcement.actions.js';
import { attachShortUuid, enumProperty, stripPopulatedPasswordHashes } from './resource-helpers.js';

/**
 * Announcements: a SUPER_ADMIN's message to every eligible user or to one
 * City, written in English and Arabic. Read-only history; an announcement
 * cannot be edited or unsent. Every action is gated server-side by
 * `isSuperAdmin`, which also hides the navigation entry from a plain admin.
 */
export function buildAnnouncementsResource(db, pool, components = {}) {
  const properties = {
    id: { isTitle: false, isDisabled: true },
    sent_by_admin_id: { label: 'Sent by', isDisabled: true },
    audience: enumProperty(ENUMS.announcementAudience, { label: 'Audience', isDisabled: true }),
    audience_city_id: { isVisible: false },
    audience_city_name: { label: 'City', isDisabled: true },
    title_en: { label: 'English', isTitle: true, isDisabled: true },
    body_en: { label: 'English message', isDisabled: true },
    title_ar: { label: 'Arabic', isDisabled: true },
    body_ar: { label: 'Arabic message', isDisabled: true },
    status: enumProperty(ENUMS.announcementStatus, { isDisabled: true }),
    failure_reason: { label: 'Why it failed', isDisabled: true },
    audience_cutoff_at: { label: 'Audience frozen at', isDisabled: true },
    expected_recipients: { label: 'Recipients', isDisabled: true },
    in_app_count: { label: 'In-app', isDisabled: true },
    push_intent_count: { label: 'Push', isDisabled: true },
    started_at: { label: 'Started', isDisabled: true },
    completed_at: { label: 'Completed', isDisabled: true },
    created_at: { label: 'Sent', isDisabled: true },
    cursor_user_id: { isVisible: false },
    attempts: { isVisible: false },
    last_error: { isVisible: false },
    next_attempt_at: { isVisible: false },
    updated_at: { isVisible: false },
  };

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
      navigation: { name: 'Announcements', icon: 'Bell' },
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

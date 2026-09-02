import { ENUMS } from '../enums.js';
import {
  attachShortUuid,
  buildReadOnlyResource,
  enumProperty,
  stripPopulatedPasswordHashes,
} from './resource-helpers.js';

export function buildModerationActionsResource(db, components = {}) {
  const properties = {
    id: { isTitle: true, isDisabled: true },
    admin_user_id: {},
    action_type: enumProperty(ENUMS.moderationActionType),
    target_type: enumProperty(ENUMS.moderationTargetType),
    target_id: {},
    reason: {},
    metadata: {
      isVisible: { list: false, show: true, edit: false, filter: false },
    },
    created_at: { isDisabled: true },
  };

  attachShortUuid(properties, ['id', 'admin_user_id', 'target_id'], components, ['list', 'show']);

  return buildReadOnlyResource(db, 'moderation_actions', { name: 'Admin Management', icon: 'Lock' }, properties, {
    sort: { sortBy: 'created_at', direction: 'desc' },
    listProperties: ['id', 'action_type', 'target_type', 'target_id', 'admin_user_id', 'reason', 'created_at'],
    showProperties: [
      'id',
      'action_type',
      'target_type',
      'target_id',
      'admin_user_id',
      'reason',
      'metadata',
      'created_at',
    ],
    filterProperties: ['id', 'action_type', 'target_type', 'target_id', 'admin_user_id', 'created_at'],
    actions: {
      list: { after: stripPopulatedPasswordHashes },
      show: { after: stripPopulatedPasswordHashes },
    },
  });
}

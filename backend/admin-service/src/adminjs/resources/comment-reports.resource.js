import { ENUMS } from '../enums.js';
import {
  attachShortUuid,
  buildReadOnlyResource,
  enumProperty,
  stripPopulatedPasswordHashes,
} from './resource-helpers.js';

export function buildCommentReportsResource(db, components = {}) {
  const properties = {
    reason: enumProperty(ENUMS.reportReason),
    details: { isDisabled: true },
    created_at: { isDisabled: true },
  };

  attachShortUuid(properties, ['id', 'comment_id', 'reporter_id'], components, ['list', 'show']);

  return buildReadOnlyResource(db, 'comment_reports', { name: 'Moderation', icon: 'Flag' }, properties, {
    sort: { sortBy: 'created_at', direction: 'desc' },
    listProperties: ['id', 'comment_id', 'reporter_id', 'reason', 'created_at'],
    showProperties: ['id', 'comment_id', 'reporter_id', 'reason', 'details', 'created_at'],
    filterProperties: ['reason', 'comment_id', 'reporter_id', 'created_at'],
    actions: {
      list: { after: stripPopulatedPasswordHashes },
      show: { after: stripPopulatedPasswordHashes },
    },
  });
}

import { buildCommentReportReviewAction } from '../actions/review-report.actions.js';
import { ENUMS } from '../enums.js';
import { virtualFilterOptions } from '../queue-filters.js';
import {
  attachShortUuid,
  buildReadOnlyResource,
  enumProperty,
  stripPopulatedPasswordHashes,
} from './resource-helpers.js';

export function buildCommentReportsResource(db, components = {}, pool, cache) {
  const properties = {
    reason: enumProperty(ENUMS.reportReason),
    details: { isDisabled: true },
    reviewed_at: { isDisabled: true },
    created_at: { isDisabled: true },
    ...virtualFilterOptions('comment_reports'),
  };

  attachShortUuid(properties, ['id', 'comment_id', 'reporter_id'], components, ['list', 'show']);

  return buildReadOnlyResource(db, 'comment_reports', { name: 'Moderation', icon: 'Flag' }, properties, {
    sort: { sortBy: 'created_at', direction: 'desc' },
    listProperties: ['id', 'comment_id', 'reporter_id', 'reason', 'reviewed_at', 'created_at'],
    showProperties: ['id', 'comment_id', 'reporter_id', 'reason', 'details', 'reviewed_at', 'created_at'],
    filterProperties: ['reason', 'comment_id', 'reporter_id', 'reviewed_at', 'created_at', 'review_state'],
    actions: {
      list: { after: stripPopulatedPasswordHashes },
      show: { after: stripPopulatedPasswordHashes },
      reviewWithNoAction: buildCommentReportReviewAction(pool, components?.ModerationAction, cache),
    },
  });
}

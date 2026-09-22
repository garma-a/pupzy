import { buildPostReportReviewAction } from '../actions/review-report.actions.js';
import { ENUMS } from '../enums.js';
import { virtualFilterOptions } from '../queue-filters.js';
import {
  attachShortUuid,
  buildReadOnlyResource,
  enumProperty,
  stripPopulatedPasswordHashes,
} from './resource-helpers.js';

export function buildPostReportsResource(db, components = {}, pool, cache) {
  const properties = {
    reason: enumProperty(ENUMS.reportReason),
    review_outcome: enumProperty(ENUMS.postReportReviewOutcome),
    details: { isDisabled: true },
    reviewed_at: { isDisabled: true },
    created_at: { isDisabled: true },
    ...virtualFilterOptions('post_reports'),
  };

  attachShortUuid(properties, ['id', 'post_id', 'reporter_id', 'reviewed_by_admin_id'], components, ['list', 'show']);

  return buildReadOnlyResource(db, 'post_reports', { name: 'Moderation', icon: 'Flag' }, properties, {
    sort: { sortBy: 'created_at', direction: 'desc' },
    listProperties: ['id', 'post_id', 'reporter_id', 'reason', 'reviewed_at', 'created_at'],
    showProperties: [
      'id',
      'post_id',
      'reporter_id',
      'reason',
      'details',
      'reviewed_at',
      'reviewed_by_admin_id',
      'review_outcome',
      'created_at',
    ],
    filterProperties: [
      'reason',
      'post_id',
      'reporter_id',
      'reviewed_at',
      'review_outcome',
      'created_at',
      'review_state',
    ],
    actions: {
      list: { after: stripPopulatedPasswordHashes },
      show: { after: stripPopulatedPasswordHashes },
      reviewWithNoAction: buildPostReportReviewAction(pool, components?.ModerationAction, cache),
    },
  });
}

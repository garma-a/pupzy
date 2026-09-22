import { buildAccountReportReviewAction } from '../actions/review-report.actions.js';
import { ENUMS } from '../enums.js';
import { virtualFilterOptions } from '../queue-filters.js';
import {
  attachShortUuid,
  buildReadOnlyResource,
  enumProperty,
  stripPopulatedPasswordHashes,
} from './resource-helpers.js';

export function buildAccountReportsResource(db, components = {}, pool, cache) {
  const properties = {
    reason: enumProperty(ENUMS.accountReportReason),
    source_type: enumProperty(ENUMS.accountReportSourceType),
    review_outcome: enumProperty(ENUMS.accountReportReviewOutcome),
    details: { isDisabled: true },
    reviewed_at: { isDisabled: true },
    created_at: { isDisabled: true },
    ...virtualFilterOptions('account_reports'),
  };

  attachShortUuid(
    properties,
    ['id', 'reporter_id', 'reported_user_id', 'source_id', 'reviewed_by_admin_id'],
    components,
    ['list', 'show'],
  );

  return buildReadOnlyResource(db, 'account_reports', { name: 'Moderation', icon: 'Flag' }, properties, {
    sort: { sortBy: 'created_at', direction: 'desc' },
    listProperties: ['id', 'reporter_id', 'reported_user_id', 'reason', 'source_type', 'reviewed_at', 'created_at'],
    showProperties: [
      'id',
      'reporter_id',
      'reported_user_id',
      'reason',
      'details',
      'source_type',
      'source_id',
      'reviewed_at',
      'reviewed_by_admin_id',
      'review_outcome',
      'created_at',
    ],
    filterProperties: [
      'reason',
      'reporter_id',
      'reported_user_id',
      'source_type',
      'reviewed_at',
      'created_at',
      'review_state',
    ],
    actions: {
      list: { after: stripPopulatedPasswordHashes },
      show: { after: stripPopulatedPasswordHashes },
      reviewWithNoAction: buildAccountReportReviewAction(pool, components?.ModerationAction, cache),
    },
  });
}

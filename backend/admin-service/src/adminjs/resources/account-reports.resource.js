import { buildAccountReportReviewAction } from '../actions/review-report.actions.js';
import {
  buildAccountReportTargetActions,
  reportTargetState,
  withTargetState,
} from '../actions/report-target-actions.js';
import { ENUMS } from '../enums.js';
import { buildPolymorphicReferenceHook } from '../reference-targets.js';
import { virtualFilterOptions } from '../queue-filters.js';
import {
  attachReferenceLink,
  attachShortUuid,
  buildReadOnlyResource,
  enumProperty,
  reportStatusProperty,
  stripPopulatedPasswordHashes,
} from './resource-helpers.js';

export function buildAccountReportsResource(db, components = {}, pool, cache) {
  const properties = {
    review_status: reportStatusProperty(components),
    reason: enumProperty(ENUMS.accountReportReason),
    source_type: enumProperty(ENUMS.accountReportSourceType),
    review_outcome: enumProperty(ENUMS.accountReportReviewOutcome),
    details: { isDisabled: true },
    reviewed_at: { isDisabled: true },
    created_at: { isDisabled: true },
    ...virtualFilterOptions('account_reports'),
  };

  attachShortUuid(properties, ['id'], components, ['list', 'show']);
  attachReferenceLink(
    properties,
    ['reporter_id', 'reported_user_id', 'source_id', 'reviewed_by_admin_id'],
    components,
    ['list', 'show'],
  );
  const resolveSource = buildPolymorphicReferenceHook(pool, { typeField: 'source_type', idField: 'source_id' });

  return buildReadOnlyResource(db, 'account_reports', { name: 'Moderation', icon: 'Flag' }, properties, {
    sort: { sortBy: 'created_at', direction: 'desc' },
    listProperties: [
      'id',
      'review_status',
      'reporter_id',
      'reported_user_id',
      'reason',
      'source_type',
      'reviewed_at',
      'created_at',
    ],
    showProperties: [
      'review_status',
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
      list: { after: [stripPopulatedPasswordHashes, resolveSource] },
      ...withTargetState(
        {
          show: { after: [stripPopulatedPasswordHashes, resolveSource] },
          reviewWithNoAction: buildAccountReportReviewAction(pool, components?.ModerationAction, cache),
          ...buildAccountReportTargetActions(),
        },
        reportTargetState(pool, 'account'),
      ),
    },
  });
}

import { buildCommentReportReviewAction } from '../actions/review-report.actions.js';
import {
  buildCommentReportTargetActions,
  reportTargetState,
  withTargetState,
} from '../actions/report-target-actions.js';
import { ENUMS } from '../enums.js';
import { COMMENT_EVIDENCE_PARAM, attachCommentEvidence } from '../review/comment-evidence.js';
import { virtualFilterOptions } from '../queue-filters.js';
import {
  attachReferenceLink,
  attachShortUuid,
  buildReadOnlyResource,
  enumProperty,
  reportStatusProperty,
  stripPopulatedPasswordHashes,
} from './resource-helpers.js';

export function buildCommentReportsResource(db, components = {}, pool, cache) {
  const properties = {
    review_status: reportStatusProperty(components),
    reason: enumProperty(ENUMS.reportReason),
    review_outcome: enumProperty(ENUMS.commentReportReviewOutcome),
    details: { isDisabled: true },
    reviewed_at: { isDisabled: true },
    created_at: { isDisabled: true },
    ...virtualFilterOptions('comment_reports'),
  };

  const hasEvidence = Boolean(components?.CommentEvidence);
  if (hasEvidence) {
    properties[COMMENT_EVIDENCE_PARAM] = {
      isVisible: { list: false, show: true, edit: false, filter: false },
      isDisabled: true,
      components: { show: components.CommentEvidence },
    };
  }

  attachShortUuid(properties, ['id'], components, ['list', 'show']);
  attachReferenceLink(properties, ['comment_id', 'reporter_id', 'reviewed_by_admin_id'], components, ['list', 'show']);

  return buildReadOnlyResource(db, 'comment_reports', { name: 'Moderation', icon: 'Flag' }, properties, {
    sort: { sortBy: 'created_at', direction: 'desc' },
    listProperties: ['id', 'review_status', 'comment_id', 'reporter_id', 'reason', 'reviewed_at', 'created_at'],
    showProperties: [
      ...(hasEvidence ? [COMMENT_EVIDENCE_PARAM] : []),
      'review_status',
      'id',
      'comment_id',
      'reporter_id',
      'reason',
      'details',
      'reviewed_at',
      'reviewed_by_admin_id',
      'review_outcome',
      'created_at',
    ],
    filterProperties: ['reason', 'comment_id', 'reporter_id', 'reviewed_at', 'created_at', 'review_state'],
    actions: {
      list: { after: stripPopulatedPasswordHashes },
      ...withTargetState(
        {
          show: {
            after: [
              stripPopulatedPasswordHashes,
              attachCommentEvidence(pool, {
                commentIdOf: (params) => params.comment_id,
                reportIdOf: (params) => params.id,
                includeReports: !components?.ReportCase,
              }),
            ],
          },
          reviewWithNoAction: buildCommentReportReviewAction(pool, components?.ModerationAction, cache),
          ...buildCommentReportTargetActions(),
        },
        reportTargetState(pool, 'comment'),
      ),
    },
  });
}

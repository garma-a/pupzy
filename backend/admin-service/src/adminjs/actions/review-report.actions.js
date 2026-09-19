import { actionResponse, readModerationReason, runModerationTransaction } from './helpers.js';
import { isAnyAdmin } from '../rbac.js';

function getRecordProperty(record, property) {
  if (!record) return undefined;
  if (typeof record.get === 'function') {
    const val = record.get(property);
    if (val !== undefined) return val;
  }
  return record.params?.[property];
}

function isOpenReport(record) {
  const reviewedAt = getRecordProperty(record, 'reviewed_at');
  return reviewedAt === null || reviewedAt === undefined || reviewedAt === '';
}

/**
 * Builds the explicit reviewed-with-no-action administrative outcome for a
 * report. It closes exactly one open report and appends an authoritative
 * moderation audit entry carrying the reviewer, the report's target, and the
 * report id. Nothing commits unless both the report closure and the audit
 * insert commit together.
 */
function buildReportReviewAction(pool, component, definition) {
  return {
    actionType: 'record',
    icon: 'Check',
    isAccessible: isAnyAdmin,
    isVisible: (context) => Boolean(context?.record) && isOpenReport(context.record),
    component,
    handler: async (request, _response, context) => {
      const { record, currentAdmin } = context;
      if (request.method !== 'post') return { record: record.toJSON(currentAdmin) };

      const reasonResult = readModerationReason(request.payload?.reason);
      if (reasonResult.error) {
        return actionResponse(record, currentAdmin, { ok: false, error: reasonResult.error }, '');
      }
      const reason = reasonResult.reason;

      const result = await runModerationTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `SELECT id, ${definition.targetColumn}, reviewed_at
           FROM ${definition.reportTable}
           WHERE id = $1
           FOR UPDATE`,
          [record.id()],
        );
        const report = rows[0];
        if (!report) {
          return { ok: false, error: `${definition.reportLabel} not found` };
        }
        if (report.reviewed_at) {
          return { ok: false, error: `${definition.reportLabel} has already been reviewed.` };
        }

        await client.query(
          `UPDATE ${definition.reportTable}
           SET reviewed_at = now(), reviewed_by_admin_id = $2, review_outcome = 'NO_ACTION'
           WHERE id = $1`,
          [report.id, currentAdmin.id],
        );

        const { rows: auditRows } = await client.query(
          `INSERT INTO moderation_actions
             (admin_user_id, action_type, target_type, target_id, reason, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            currentAdmin.id,
            definition.actionType,
            definition.targetType,
            report[definition.targetColumn],
            reason || null,
            JSON.stringify({ reportId: report.id, reviewOutcome: 'NO_ACTION' }),
          ],
        );

        return { ok: true, auditId: auditRows[0]?.id, reportId: report.id };
      });

      return actionResponse(record, currentAdmin, result, definition.successMessage);
    },
  };
}

export function buildPostReportReviewAction(pool, component) {
  return buildReportReviewAction(pool, component, {
    reportTable: 'post_reports',
    reportLabel: 'Post Report',
    targetColumn: 'post_id',
    targetType: 'POST',
    actionType: 'POST_REPORT_REVIEWED_NO_ACTION',
    successMessage: 'Post Report reviewed with no action.',
  });
}

export function buildAccountReportReviewAction(pool, component) {
  return buildReportReviewAction(pool, component, {
    reportTable: 'account_reports',
    reportLabel: 'Pupzy Account Report',
    targetColumn: 'reported_user_id',
    targetType: 'USER',
    actionType: 'ACCOUNT_REPORT_REVIEWED_NO_ACTION',
    successMessage: 'Pupzy Account Report reviewed with no action.',
  });
}

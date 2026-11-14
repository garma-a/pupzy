import React from 'react';
import { reportReviewStatus } from '../report-status.js';
import { STATUS_STYLES, statusMeaning, plainValue } from '../status-styles.js';
import { BackToInbox } from './back-to-inbox.jsx';
import ShowField from './show-field.jsx';

export function StatusBadge({ value, label, children, ...props }) {
  if (value == null || value === '') return <span>—</span>;
  const meaning = statusMeaning(value);
  return (
    <span {...props} className="pupzy-status" data-meaning={meaning} style={STATUS_STYLES[meaning]}>
      {label ?? children ?? plainValue(value)}
    </span>
  );
}

/** AdminJS property adapter; report closure continues to use reportReviewStatus. */
export default function StatusProperty({ property, record, where }) {
  const params = record?.params ?? {};
  const report = property.path === 'review_status';
  const status = report
    ? reportReviewStatus({ reviewedAt: params.reviewed_at, reviewOutcome: params.review_outcome })
    : null;
  const value = property.path === 'is_banned' ? (params.is_banned ? 'BANNED' : 'ACTIVE') : params[property.path];
  const tag = <StatusBadge value={status?.state ?? value} label={status?.label} />;
  if (where !== 'show') return tag;
  const reviewer = record?.populated?.reviewed_by_admin_id;
  const closedOn = params.reviewed_at ? new Date(params.reviewed_at).toLocaleString() : null;
  return (
    <>
      {report ? <BackToInbox /> : null}
      <ShowField property={property}>
        <div data-testid={report ? 'pupzy-report-status' : undefined}>
          {tag}
          {status && !status.isOpen ? (
            <span className="pupzy-report-status-detail">
              {closedOn ? ` Closed on ${closedOn}` : ''}
              {reviewer ? ` by ${reviewer.params?.full_name || reviewer.title}` : ''}
            </span>
          ) : null}
        </div>
      </ShowField>
    </>
  );
}

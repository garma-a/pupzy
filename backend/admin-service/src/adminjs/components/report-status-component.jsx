import React from 'react';

import { reportReviewStatus } from '../report-status.js';
import { BackToInbox } from './back-to-inbox.jsx';
import { StateTag } from './record-status-component.jsx';
import ShowField from './show-field.jsx';

function formatDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : null;
}

/**
 * Read-only review status of a report: "Open", "Closed: no action",
 * "Closed: action taken" or "Closed". The show page adds when it was closed and
 * by whom.
 */
export default function ReportStatus({ property, record, where }) {
  const params = record?.params ?? {};
  const status = reportReviewStatus({ reviewedAt: params.reviewed_at, reviewOutcome: params.review_outcome });
  const tag = <StateTag value={status.state} label={status.label} />;
  if (where !== 'show') return tag;

  const reviewer = record?.populated?.reviewed_by_admin_id;
  const reviewerName = reviewer?.params?.full_name || reviewer?.title || null;
  const closedOn = formatDate(params.reviewed_at);
  const detail = status.isOpen
    ? null
    : [closedOn ? `Closed on ${closedOn}` : null, reviewerName ? `by ${reviewerName}` : null].filter(Boolean).join(' ');
  return (
    <>
      <BackToInbox />
      <ShowField property={property}>
        <div data-testid="pupzy-report-status">
          {tag}
          {detail ? <span className="pupzy-report-status-detail"> {detail}</span> : null}
        </div>
      </ShowField>
    </>
  );
}
